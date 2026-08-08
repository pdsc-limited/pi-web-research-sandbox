# pi Web Research Sandbox

A pi extension that makes web research (`web_search` / `web_fetch`) run through a locked-down, low-privilege subagent and returns only structured, sanitized JSON to the main agent.

## Why

By default, `rpiv-web-tools` returns raw web content as markdown directly into the high-privilege main agent. A prompt injection in that content can trick the main agent into exfiltrating API keys, SSH keys, or taking harmful actions.

This extension:

- Intercepts `web_fetch` / `web_search` results and sanitizes them into rigid JSON before the main LLM sees them.
- Routes high-risk URLs through the `WebResearch` subagent and returns its structured JSON artifact to the main agent.
- Anchors the main agent to prefer `WebResearch` for all web research.
- Provides a `WebResearch` subagent with only `web_search` and `web_fetch` tools, forced to return the same JSON schema.
- Provides a lightweight `DocReader` subagent for searching local docs without inflating the main agent context.

## Install from GitHub

The extension is a normal pi package. Install it like any other git package:

```bash
pi install git:github.com/YOUR_USER/pi-web-research-sandbox
```

(Replace `YOUR_USER` with your GitHub username or organization.)

### Required pi packages

Your `~/.pi/agent/settings.json` must already include the packages this extension builds on:

```json
{
  "packages": [
    "npm:@juicesharp/rpiv-web-tools",
    "npm:@gotgenes/pi-subagents",
    "npm:@gotgenes/pi-subagents-worktrees"
  ]
}
```

Optional but recommended:

- `npm:@gotgenes/pi-subagents-worktrees` — runs the `WebResearch` subagent in an isolated git worktree.

Optional fail-safes:

- `npm:@aliou/pi-guardrails`
- `npm:@gotgenes/pi-permission-system`

### Agent files and worktree config

A pi package ships its extension, not its agent markdown files or worktree config. After installing the extension, copy the files from `home.pi/` into your actual `~/.pi/` directory:

```bash
cp home.pi/agent/agents/*.md ~/.pi/agent/agents/
cp home.pi/agent/subagents-worktrees.json ~/.pi/agent/
```

This registers:

- `WebResearch` — the locked-down web research subagent.
- `DocReader` — a cheap, read-only doc-search subagent.

## Development

Run pi in this directory. The extension is loaded from `package.json` and the local `.pi/` files are auto-discovered for development:

```bash
cd /workspace/pi-web-research-sandbox
pi
```

Trust the project when prompted.

## Project Layout

```
web-research-sandbox.ts            # main extension entry point
src/
  sanitizer.ts                     # deterministic HTML -> JSON
  schema.ts                        # typebox output schema
  policy.ts                        # high-risk URL detection
  subagent.ts                      # WebResearch subagent wrapper
home.pi/agent/agents/WebResearch.md   # template for global agent install
home.pi/agent/agents/DocReader.md     # template for global agent install
home.pi/agent/subagents-worktrees.json # template for global worktree config
.pi/                               # local development auto-discovery
```

## Tests

```bash
node test/sanitizer.test.ts
```

See `PLAN.md` for the full design.
