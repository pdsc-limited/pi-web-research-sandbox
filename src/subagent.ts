import { createHash } from "node:crypto";
import type { SubagentRecord, SubagentsService } from "@gotgenes/pi-subagents";
import {
  getResearchOutputErrors,
  type ResearchOutput,
  validateResearchOutput,
} from "./schema.ts";

const SUBAGENT_TYPE = "WebResearch";
const POLL_MS = 250;
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Spawn the locked-down WebResearch subagent and wait for its rigid JSON
 * artifact. If the subagent service is unavailable, the subagent fails, or the
 * returned JSON does not match the schema, a structured fallback is returned
 * with an error field instead of raw web content.
 */
export async function spawnWebResearchSubagent(
  target: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ResearchOutput> {
  let svc: SubagentsService | undefined;
  try {
    const mod = await import("@gotgenes/pi-subagents");
    svc = mod.getSubagentsService();
  } catch (err) {
    return fallback(
      target,
      `WebResearch subagent service is unavailable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!svc) {
    return fallback(
      target,
      "WebResearch subagent service is not published. Ensure @gotgenes/pi-subagents is installed and loaded before pi-web-research-sandbox.",
    );
  }

  const prompt = buildPrompt(target);
  const id = svc.spawn(SUBAGENT_TYPE, prompt, {
    description: `Web research for ${target}`,
    foreground: true,
    inheritContext: false,
    maxTurns: 20,
  });

  const timeoutId = setTimeout(() => {
    svc!.abort(id);
  }, timeoutMs);

  const cleanup = () => clearTimeout(timeoutId);

  signal?.addEventListener(
    "abort",
    () => {
      svc!.abort(id);
      cleanup();
    },
    { once: true },
  );

  try {
    const record = await waitForSubagent(id, svc, signal);
    if (
      record.status === "error" ||
      record.status === "aborted" ||
      record.status === "stopped"
    ) {
      return fallback(
        target,
        record.error ??
          `WebResearch subagent ended with status "${record.status}"`,
      );
    }
    if (record.result === undefined) {
      return fallback(target, "WebResearch subagent completed with no result.");
    }
    const parsed = parseSubagentResult(record.result, target);
    if (parsed) {
      return parsed;
    }
    return fallback(target, "WebResearch subagent returned invalid JSON.");
  } catch (err) {
    return fallback(
      target,
      `Waiting for WebResearch subagent failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    cleanup();
  }
}

function buildPrompt(target: string): string {
  return (
    "Research the following target and return only the rigid JSON artifact " +
    "defined in your instructions. Do not include markdown, natural language, " +
    "or any text outside the JSON object. The first character must be '{' and " +
    `the last character must be '}'.\n\nTarget: ${target}`
  );
}

function waitForSubagent(
  id: string,
  svc: SubagentsService,
  signal?: AbortSignal,
): Promise<SubagentRecord> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const record = svc.getRecord(id);
      if (!record) {
        reject(new Error(`Subagent ${id} disappeared from the service`));
        return;
      }
      if (signal?.aborted) {
        reject(new Error("Subagent aborted by parent signal"));
        return;
      }
      if (
        record.status === "completed" ||
        record.status === "error" ||
        record.status === "aborted" ||
        record.status === "stopped"
      ) {
        resolve(record);
        return;
      }
      setTimeout(check, POLL_MS);
    };
    check();
  });
}

function parseSubagentResult(
  result: string,
  source: string,
): ResearchOutput | undefined {
  try {
    const cleaned = result.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
    const parsed = JSON.parse(cleaned);
    if (!validateResearchOutput(parsed)) {
      const errors = getResearchOutputErrors(parsed);
      return {
        source,
        content_type: "unknown",
        facts: [],
        signatures: [],
        versions: [],
        rejected_fragments: [],
        digest: digestOf(errors.join("; ")),
        error: `WebResearch subagent returned JSON that does not match the schema: ${errors.join("; ")}`,
      };
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function fallback(source: string, error: string): ResearchOutput {
  return {
    source,
    content_type: "unknown",
    facts: [],
    signatures: [],
    versions: [],
    rejected_fragments: [],
    digest: digestOf(error),
    error,
  };
}

function digestOf(value: string): string {
  return "sha256:" + createHash("sha256").update(value).digest("hex");
}
