import type { ResearchOutput } from "./schema.ts";

/**
 * Spawn the locked-down WebResearch subagent.
 *
 * NOTE: This wrapper is a stub. The direct tool_result sanitization path in the
 * extension is active. Once the project needs to invoke the WebResearch agent
 * programmatically from an extension or command, this file can call the
 * `subagent` tool with subagent_type "WebResearch" and return its JSON output.
 */
export async function spawnWebResearchSubagent(
  _target: string,
  _signal?: AbortSignal,
): Promise<ResearchOutput> {
  return {
    source: _target,
    content_type: "unknown",
    facts: [],
    signatures: [],
    versions: [],
    rejected_fragments: [],
    digest:
      "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    error: "spawnWebResearchSubagent is not yet implemented.",
  };
}
