# pi Web Research Sandbox

A pi extension that makes web research (`web_search` / `web_fetch`) run through a locked-down, low-privilege subagent and returns only structured, sanitized JSON to the main agent.

## Why

By default, `rpiv-web-tools` returns raw web content as markdown directly into the high-privilege main agent. A prompt injection in that content can trick the main agent into exfiltrating API keys, SSH keys, or taking harmful actions.

This extension:

- Spawns a dedicated `WebResearch` subagent with only `web_search` and `web_fetch` tools.
- Forces the subagent to return a rigid JSON schema, not natural language.
- Sanitizes fetched HTML deterministically before it crosses the trust boundary.
- Keeps the research subagent out of the main agent's environment, secrets, and filesystem.

## Stack

- `@earendil-works/pi-coding-agent` — extension API and `tool_result` interception.
- `@juicesharp/rpiv-web-tools` — the web search/fetch tools being wrapped.
- `@gotgenes/pi-subagents` — the subagent harness used for the locked-down research agent.
- `@gotgenes/pi-subagents-worktrees` — runs the `WebResearch` agent in an isolated git worktree.
- `@gotgenes/pi-permission-system` — centralized, deterministic permission gates (used alongside guardrails).
- `@aliou/pi-guardrails` — kept as a fail-safe policy layer.

## Project Layout

```
.pi/settings.json                   # project pi packages
.pi/subagents-worktrees.json        # worktree isolation config
.pi/agents/WebResearch.md              # locked-down subagent type
.pi/extensions/web-research-sandbox.ts  # main extension entry
src/sanitizer.ts                    # deterministic HTML -> JSON
src/schema.ts                       # typebox output schema
src/subagent.ts                     # subagent wrapper
```

## Development

Run pi in this directory. The extension and agent type are auto-discovered from `.pi/`. Trust the project when prompted.

```bash
cd /workspace/pi-web-research-sandbox
pi
```

See `PLAN.md` for the full implementation plan.
