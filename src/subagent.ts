import type { ResearchOutput } from "./schema.ts";

/**
 * Spawn the locked-down Research subagent.
 *
 * NOTE: The pi subagent harness is currently broken (registerSubagentSession /
 * unregisterSubagentSession is not a function), so this wrapper is a stub. The
 * direct tool_result sanitization path in the extension is active instead; once
 * the harness is fixed, this file can call the Research agent via the
 * `Agent` tool and return its JSON output.
 */
export async function spawnResearchSubagent(
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
    error:
      "Subagent spawn is currently disabled because the pi subagent harness is broken.",
  };
}
