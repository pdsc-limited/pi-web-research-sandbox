export const RESEARCH_TOOL_NAMES = new Set(["web_fetch", "web_search"]);

export function isResearchTool(toolName: string): boolean {
  return RESEARCH_TOOL_NAMES.has(toolName);
}

/** Strict mode remains authoritative if another action later re-enables a tool. */
export function shouldBlockMainWebTool(strictMode: boolean, toolName: string): boolean {
  return strictMode && isResearchTool(toolName);
}
