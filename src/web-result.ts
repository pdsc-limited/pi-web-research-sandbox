import { sanitizeResearchOutput, sanitizeToJson } from "./sanitizer.ts";
import { type ResearchOutput, validateResearchOutput } from "./schema.ts";
import { isHighRiskUrl } from "./policy.ts";
import { spawnWebResearchSubagent } from "./subagent.ts";

const SAFE_WEB_RESULT_JSON = '{"source":"unknown","content_type":"unknown","facts":[],"signatures":[],"versions":[],"rejected_fragments":[],"digest":"sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","error":"WebResearch result was safely discarded."}';

/** A fixed literal so even JSON serialization failure cannot expose input. */
export function safeWebResultJson(): string {
  return SAFE_WEB_RESULT_JSON;
}

function extractSource(event: any): string {
  if (event && typeof event.input === "object" && event.input !== null) {
    if (typeof event.input.url === "string") return event.input.url;
    if (typeof event.input.query === "string") return event.input.query;
  }
  return "unknown";
}

function serializeArtifact(value: unknown): string {
  try {
    if (!validateResearchOutput(value)) return safeWebResultJson();
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : safeWebResultJson();
  } catch {
    return safeWebResultJson();
  }
}

export type WebResultTransformDependencies = {
  isHighRiskUrl: (source: string) => boolean;
  sanitizeToJson: (content: unknown, source: string) => string;
  sanitizeResearchOutput: (output: ResearchOutput) => ResearchOutput;
  spawnWebResearchSubagent: (source: string, signal?: AbortSignal) => Promise<ResearchOutput>;
};

const defaultDependencies: WebResultTransformDependencies = {
  isHighRiskUrl,
  sanitizeToJson,
  sanitizeResearchOutput,
  spawnWebResearchSubagent,
};

/**
 * Complete web-result boundary. Nothing from the original event is returned
 * if source extraction, routing, sanitization, parsing, or serialization fails.
 */
export async function transformWebToolResult(
  event: any,
  signal?: AbortSignal,
  dependencies: WebResultTransformDependencies = defaultDependencies,
): Promise<string> {
  try {
    // Tool failure text may include remote-controlled status/body details. It
    // has no research value, so discard it rather than treating it as facts.
    if (event?.isError === true) return safeWebResultJson();

    const source = extractSource(event);
    if (event.toolName === "web_fetch" && dependencies.isHighRiskUrl(source)) {
      const childOutput = await dependencies.spawnWebResearchSubagent(source, signal);
      return serializeArtifact(dependencies.sanitizeResearchOutput(childOutput));
    }

    // Reparse the sanitizer's JSON rather than passing a string through: this
    // also fails closed if its own serialization ever returns invalid output.
    const output = JSON.parse(dependencies.sanitizeToJson(event.content, source));
    if (!validateResearchOutput(output)) return safeWebResultJson();
    // Apply the structured-output boundary here too: direct sanitizer output
    // still contains the original source and exact rejected marker text.
    return serializeArtifact(dependencies.sanitizeResearchOutput(output));
  } catch {
    return safeWebResultJson();
  }
}
