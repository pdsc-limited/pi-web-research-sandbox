import { createHash } from "node:crypto";
import type { SubagentRecord, SubagentsService } from "@gotgenes/pi-subagents";
import {
  type ResearchOutput,
  validateResearchOutput,
} from "./schema.ts";
import { sanitizeResearchOutput } from "./sanitizer.ts";

const SUBAGENT_TYPE = "WebResearch";
const POLL_MS = 250;
const DEFAULT_TIMEOUT_MS = 120_000;
const TERMINAL_STATUSES = new Set(["completed", "error", "aborted", "stopped"]);

const FALLBACK_ERRORS = {
  aborted: "WebResearch subagent was cancelled.",
  unavailable: "WebResearch subagent is unavailable.",
  spawn: "WebResearch subagent could not be started.",
  failed: "WebResearch subagent did not complete successfully.",
  missingResult: "WebResearch subagent completed without a result.",
  invalidResult: "WebResearch subagent returned an invalid result.",
  childReported: "WebResearch subagent reported unusable research.",
  wait: "WebResearch subagent could not be waited for.",
} as const;

/**
 * Spawn the locked-down WebResearch subagent and wait for its rigid JSON
 * artifact. Service, child, parsing, and timeout failures all become a
 * sanitized fixed artifact; no child error or exception text reaches parent.
 */
export async function spawnWebResearchSubagent(
  target: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ResearchOutput> {
  if (signal?.aborted) return fallback(target, FALLBACK_ERRORS.aborted);

  let svc: SubagentsService | undefined;
  try {
    const mod = await import("@gotgenes/pi-subagents");
    svc = mod.getSubagentsService();
  } catch {
    return fallback(target, FALLBACK_ERRORS.unavailable);
  }

  if (!svc) return fallback(target, FALLBACK_ERRORS.unavailable);
  if (signal?.aborted) return fallback(target, FALLBACK_ERRORS.aborted);

  let id: string;
  try {
    id = svc.spawn(SUBAGENT_TYPE, buildPrompt(target), {
      description: `Web research for ${target}`,
      foreground: true,
      inheritContext: false,
      maxTurns: 20,
    });
  } catch {
    return fallback(target, FALLBACK_ERRORS.spawn);
  }

  try {
    const record = await waitForSubagent(id, svc, signal, boundedTimeout(timeoutMs));
    if (record.status !== "completed") {
      return fallback(target, FALLBACK_ERRORS.failed);
    }
    if (record.result === undefined) {
      return fallback(target, FALLBACK_ERRORS.missingResult);
    }
    return parseSubagentResult(record.result, target) ??
      fallback(target, FALLBACK_ERRORS.invalidResult);
  } catch {
    return fallback(target, signal?.aborted ? FALLBACK_ERRORS.aborted : FALLBACK_ERRORS.wait);
  }
}

function boundedTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS;
  return Math.max(0, Math.min(timeoutMs, DEFAULT_TIMEOUT_MS));
}

function buildPrompt(target: string): string {
  return (
    "Research the following target and return only the rigid JSON artifact " +
    "defined in your instructions. Do not include markdown, natural language, " +
    "or any text outside the JSON object. The first character must be '{' and " +
    `the last character must be '}'.\n\nTarget: ${target}`
  );
}

function abortQuietly(svc: SubagentsService, id: string): void {
  try {
    svc.abort(id);
  } catch {
    // A failed abort must not prevent the deadline from resolving the wait.
  }
}

/** Exported for service-free tests. */
export function waitForSubagent(
  id: string,
  svc: SubagentsService,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SubagentRecord> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let pollId: ReturnType<typeof setTimeout> | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      // Timer/listener cleanup is defensive: none of these failures may
      // prevent settlement of the parent-facing promise.
      try {
        if (pollId !== undefined) clearTimeout(pollId);
      } catch {}
      try {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      } catch {}
      try {
        signal?.removeEventListener("abort", onAbort);
      } catch {}
      callback();
    };
    const fail = () => {
      if (settled) return;
      // If polling itself fails, the parent can no longer observe the child;
      // make the same best-effort cleanup attempt used for aborts/timeouts.
      abortQuietly(svc, id);
      finish(() => reject(new Error("Subagent wait failed")));
    };
    const onAbort = () => fail();
    const check = () => {
      if (settled) return;
      if (signal?.aborted) {
        onAbort();
        return;
      }
      let record: SubagentRecord | undefined;
      try {
        record = svc.getRecord(id);
      } catch {
        fail();
        return;
      }
      if (!record) {
        fail();
        return;
      }
      if (TERMINAL_STATUSES.has(record.status)) {
        finish(() => resolve(record));
        return;
      }
      try {
        pollId = setTimeout(check, POLL_MS);
      } catch {
        fail();
      }
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    timeoutId = setTimeout(() => {
      // Reject even if abort throws or leaves the child nonterminal.
      fail();
    }, boundedTimeout(timeoutMs));
    check();
  });
}

/** Exported for service-free tests. */
export function parseSubagentResult(
  result: string,
  source: string,
): ResearchOutput | undefined {
  try {
    const cleaned = result.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
    const parsed = JSON.parse(cleaned);
    if (!validateResearchOutput(parsed)) return undefined;
    const childReportedError = parsed.error !== undefined;
    const sanitized = sanitizeResearchOutput({ ...parsed, error: undefined });
    return childReportedError
      ? { ...sanitized, error: FALLBACK_ERRORS.childReported }
      : sanitized;
  } catch {
    return undefined;
  }
}

function fallback(source: string, error: string): ResearchOutput {
  try {
    const sanitized = sanitizeResearchOutput({
      source,
      content_type: "unknown",
      facts: [],
      signatures: [],
      versions: [],
      rejected_fragments: [],
      error,
    });
    return {
      ...sanitized,
      // This digest is parent-generated and never exposes child text.
      digest: digestOf(error),
    };
  } catch {
    return fixedFallback();
  }
}

function fixedFallback(): ResearchOutput {
  return {
    source: "unknown",
    content_type: "unknown",
    facts: [],
    signatures: [],
    versions: [],
    rejected_fragments: [],
    digest: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    error: "WebResearch subagent failed safely.",
  };
}

function digestOf(value: string): string {
  return "sha256:" + createHash("sha256").update(value).digest("hex");
}
