# pi Web Research Sandbox

A pi extension that makes web research (`web_search` / `web_fetch`) run through a locked-down, low-privilege subagent and returns only structured, sanitized JSON to the main agent.

## Why

By default, `rpiv-web-tools` returns raw web content as markdown directly into the high-privilege main agent. A prompt injection in that content can trick the main agent into exfiltrating API keys, SSH keys, or taking harmful actions.

This extension:

- Intercepts `web_fetch` / `web_search` results and sanitizes them into rigid JSON before the main LLM sees them.
- Routes high-risk URLs through the `WebResearch` subagent; its schema-valid JSON artifact is deterministically sanitized before reaching the main agent. This reduces prompt-injection exposure but does not verify facts or provide complete injection detection.
- Anchors the main agent to prefer `WebResearch` for all web research.
- Provides a `WebResearch` subagent with only `web_search` and `web_fetch` tools, forced to return the same JSON schema.

## Install from GitHub

The extension is a normal pi package. Install it like any other git package:

```bash
pi install git:github.com/PDlimited202/pi-web-research-sandbox
```

### Required pi packages

Your `~/.pi/agent/settings.json` must already include the packages this extension builds on:

```json
{
  "packages": [
    "npm:@juicesharp/rpiv-web-tools",
    "npm:@gotgenes/pi-subagents@>=19.3.0",
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
# -n preserves an existing strict-mode configuration.
cp -n home.pi/agent/web-research-sandbox.json ~/.pi/agent/
# Only if ~/.pi/agent/subagents.json does not already exist:
cp home.pi/agent/subagents.json ~/.pi/agent/
```

This registers:

- `WebResearch` — the locked-down web research subagent.

### Optional strict main-agent web-tool policy

By default, direct `web_search` and `web_fetch` remain available to the main
agent and their results are sanitized. To require all main-agent web research
to use `WebResearch`, enable strict mode in either configuration file:

- Global: `${PI_CODING_AGENT_DIR:-~/.pi/agent}/web-research-sandbox.json`
- Trusted project override: `<project>/.pi/web-research-sandbox.json`

```json
{
  "strictMainWebTools": true
}
```

The project value overrides the global value only when the project is trusted
and its file is valid. Missing or invalid files fail open (strict mode stays
disabled unless a valid global value enables it). The installed template leaves
strict mode disabled. In strict mode the extension removes `web_search` and
`web_fetch` from the parent active tool list, blocks calls to either tool even
if a later action re-enables them, and tells the main agent to use
`WebResearch` instead.

After changing strict-mode configuration, fully restart Pi. Do not rely on
`/reload` to re-enable direct web tools after disabling strict mode.

### Prevent recursive sandbox spawning

For pi-subagents 21.5.1, replace
`REPLACE_WITH_THE_EXACT_PACKAGE_SOURCE_FROM_SETTINGS_JSON` in
`~/.pi/agent/subagents.json` with the exact string for this package in your own
`~/.pi/agent/settings.json` `packages` array (a `git:` source or a local path).
If `subagents.json` already exists, merge this entry into its existing
`excludedExtensionPackages` array instead of overwriting the file.
`excludedExtensionPackages` keeps this sandbox extension out of inherited
subagent extensions, preventing a sandbox from spawning `WebResearch`
recursively; the parent extension remains loaded, so its sanitization stays
active. Strict mode relies on this existing recursion exclusion: the extension
must not be inherited by the `WebResearch` child, because that child needs its
direct web tools.

A project `<project>/.pi/subagents.json` takes precedence over the global
`~/.pi/agent/subagents.json`. If a project file exists, it must retain this
package's `excludedExtensionPackages` entry; do not clear the sandbox
exclusion, or strict-mode `WebResearch` can lose its web tools.

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
home.pi/agent/subagents-worktrees.json # template for global worktree config
home.pi/agent/web-research-sandbox.json # strict main-agent web-tool policy template
home.pi/agent/subagents.json           # template to exclude this extension in subagents
.pi/                               # local development auto-discovery
```

## Tests

```bash
node test/sanitizer.test.ts
node test/config.test.ts
```

See `PLAN.md` for the full design.
