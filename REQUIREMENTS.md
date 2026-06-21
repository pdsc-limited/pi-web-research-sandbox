# Requirements: Integrating `pi-web-research-sandbox` into `sane_config`

> **Note:** An Explore/Worker subagent was attempted for this requirements collection, but the pi subagent harness failed with a `pi-permission-system` internal error (`registerSubagentSession`/`unregisterSubagentSession`). This document was written directly by the main agent after reading the relevant files in `/workspace/sane_config` and `/workspace/pi-web-research-sandbox`.

## 1. Integration strategy

**Development phase (now):** The extension is developed and tested inside this container at `/workspace/pi-web-research-sandbox`. No `sane_config` changes are made until the extension is ready.

**Publication and integration phase (later):** Once the extension is published on GitHub, integrate it into `sane_config` as a **git extension** using the same pattern already used for `control_your_sampling`:

- Add a new Dockerfile argument for the repository and a pinned commit ref (e.g., `PI_WEB_RESEARCH_EXT_REPO` and `PI_WEB_RESEARCH_EXT_REF`).
- Clone the repo into `/home/${USERNAME}/.pi/agent/extensions/web-research-sandbox`.
- Copy `Research.md` from the cloned repo to `/home/${USERNAME}/.pi/agent/agents/Research.md`.
- Copy `subagents-worktrees.json` from the cloned repo to `/home/${USERNAME}/.pi/agent/subagents-worktrees.json`.
- Update `pi-agent-config/settings.json` with the new gotgenes versions and, if needed, a reference to the extension package so it is loaded.

## 1.5 Development phase (this container)

Until the extension is published, development happens in `/workspace/pi-web-research-sandbox`. The gotgenes packages are already updated in the live global settings (`~/.pi/agent/settings.json`). The `.pi/subagents-worktrees.json` and `.pi/agents/Research.md` files in the project are used when the project is trusted in this container. No changes to `sane_config` are needed during this phase.

## 2. Files to modify in `/workspace/sane_config`

| File | Why it must change |
|------|-------------------|
| `pi-agent-config/npm/package.json` | Pin the updated gotgenes extension versions and add `pi-subagents-worktrees`. |
| `pi-agent-config/npm/package-lock.json` | Must be regenerated from the new `package.json`. |
| `pi-agent-config/settings.json` | Add `pi-subagents-worktrees` **after** `pi-subagents`, update version pins, and add a reference to the published web-research extension package if pi does not auto-discover it. |
| `Dockerfile` | After publication, clone the extension from GitHub and copy `subagents-worktrees.json` and `Research.md` into the image. |
| `Makefile` | No code changes required, but build commands and docs must be exercised. |
| `pi-agent-config/agents/Research.md` *(new)* | Provide the locked-down `Research` agent definition in the image. |
| `pi-agent-config/subagents-worktrees.json` *(new)* | Opt the `Research` agent into git worktree isolation globally. |
| `AGENTS.md` / `README.md` | Document the new extension, the gotgenes version bump, and the lockfile update steps. |
| `SUPPLY_CHAIN_SAFETY.md` | Consider noting the new package names under the age-gate policy. |

## 3. Exact changes per file

### 3.1 `pi-agent-config/npm/package.json`

Update gotgenes versions and add the worktree package:

```json
{
  "name": "pi-extensions",
  "private": true,
  "dependencies": {
    "@aliou/pi-guardrails": "0.13.1",
    "@gotgenes/pi-permission-system": "14.0.0",
    "@gotgenes/pi-subagents": "16.6.0",
    "@gotgenes/pi-subagents-worktrees": "0.2.3",
    "@juicesharp/rpiv-web-tools": "1.16.1",
    "pi-context": "1.1.4"
  }
}
```

**Ordering constraint:** `npm` dependencies are installed by name, but pi loads packages in the order they appear in `settings.json`. `pi-subagents-worktrees` must appear **after** `pi-subagents` in `settings.json` because it registers a `WorkspaceProvider` with the subagent service at load time.

### 3.2 `pi-agent-config/npm/package-lock.json`

Regenerate with the same npm version that the image will use:

```bash
cd /workspace/sane_config/pi-agent-config/npm
npm install
```

Then audit:

```bash
cd /workspace/sane_config
make check-lockfile-age
```

**Note:** The container enforces `min-release-age=3` (see `SUPPLY_CHAIN_SAFETY.md`). The chosen versions must be older than 3 days at build time. As of 2026-06-21, the target versions are 4 days old and should pass, but builds immediately after the bump may need to wait if the age gate is strict.

### 3.3 `pi-agent-config/settings.json`

Update to match the new gotgenes versions. Place `pi-subagents-worktrees` immediately after `pi-subagents`:

```json
{
  "lastChangelogVersion": "0.79.8",
  "packages": [
    "npm:@gotgenes/pi-permission-system@14.0.0",
    "npm:@gotgenes/pi-subagents@16.6.0",
    "npm:@gotgenes/pi-subagents-worktrees@0.2.3",
    "npm:@juicesharp/rpiv-web-tools@1.16.1",
    "npm:@aliou/pi-guardrails@0.13.1",
    "npm:pi-context@1.1.4"
  ],
  "hideThinkingBlock": false
}
```

Also consider updating `lastChangelogVersion` from `"0.78.1"` to `"0.79.8"` to match the `PI_BRANCH=v0.79.8` default in the `Makefile`.

### 3.4 `Dockerfile`

After the extension is published on GitHub, add a git-extension clone step near the existing Phase 4.5 extension copy. For example:

```dockerfile
# Clone the web-research sandbox extension
ARG PI_WEB_RESEARCH_EXT_REPO=https://github.com/OWNER/pi-web-research-sandbox.git
ARG PI_WEB_RESEARCH_EXT_REF=PINNED_COMMIT_OR_TAG
RUN git clone --filter=blob:none ${PI_WEB_RESEARCH_EXT_REPO} /home/${USERNAME}/.pi/agent/extensions/web-research-sandbox \
    && cd /home/${USERNAME}/.pi/agent/extensions/web-research-sandbox \
    && git checkout ${PI_WEB_RESEARCH_EXT_REF}
RUN cp /home/${USERNAME}/.pi/agent/extensions/web-research-sandbox/.pi/agents/Research.md \
       /home/${USERNAME}/.pi/agent/agents/Research.md \
    && cp /home/${USERNAME}/.pi/agent/extensions/web-research-sandbox/.pi/subagents-worktrees.json \
       /home/${USERNAME}/.pi/agent/subagents-worktrees.json
```

If the `Research` agent definition should only be present when `INCLUDE_AGENT_CONFIGS=true`, copy it from the cloned repo conditionally instead of unconditionally.

### 3.5 `pi-agent-config/agents/Research.md` *(new)*

Copy the current `Research.md` from `/workspace/pi-web-research-sandbox/.pi/agents/Research.md`. It should remain unchanged unless the new `pi-subagents@16.6.0` frontmatter format differs from the current one. Keep the `display_name: Research`, `tools: [web_search, web_fetch]`, `prompt_mode: replace`, and `permission` blocks.

### 3.6 `pi-agent-config/subagents-worktrees.json` *(new)*

Create with the same content as the project file:

```json
{
  "worktreeAgents": ["Research"]
}
```

This opts the `Research` agent into git worktree isolation globally.

### 3.7 Web-research extension source location *(pre-publication)*

Until the extension is published, it is developed in this container at `/workspace/pi-web-research-sandbox`. No part of it is copied into `sane_config` during development.

Once it is published on GitHub, the Dockerfile clone step will place it at `~/.pi/agent/extensions/web-research-sandbox/` with the same layout:

```
pi-web-research-sandbox/
├── package.json
├── README.md
├── PLAN.md
├── .pi/
│   ├── agents/
│   │   └── Research.md
│   ├── extensions/
│   │   └── web-research-sandbox.ts
│   └── subagents-worktrees.json
└── src/
    ├── schema.ts
    ├── sanitizer.ts
    └── subagent.ts
```

The `package.json` must keep its `pi.extensions` entry pointing to `./.pi/extensions/web-research-sandbox.ts`. Imports inside the extension (e.g., `../../src/sanitizer`) must resolve correctly from the cloned layout.

**Note:** `src/schema.ts`, `src/sanitizer.ts`, and `src/subagent.ts` are still TODO in the current project. The `sane_config` integration should be deferred until those files are implemented and the extension loads locally.

### 3.8 `AGENTS.md` and `README.md`

Add sections covering:
- The new web-research extension and how it is loaded (git extension after publication).
- The requirement that `pi-subagents` must be listed before `pi-subagents-worktrees` in `settings.json`.
- The `subagents-worktrees.json` global config.
- The fact that the `Research` agent is locked down to only `web_search` and `web_fetch`.
- Update the npm extension version list in the update workflow to include the worktree package.

### 3.9 `SUPPLY_CHAIN_SAFETY.md`

No required changes, but consider adding a note that the new gotgenes packages (`@gotgenes/pi-subagents-worktrees`) and the published web-research extension package are subject to the same 3-day age gate and lockfile policy as existing npm extensions.

## 4. Handling configuration artifacts

| Artifact | Placement in container | How it gets there |
|----------|------------------------|-------------------|
| `web-research-sandbox.ts` + `src/` | `~/.pi/agent/extensions/web-research-sandbox/` | Cloned from the published GitHub repo |
| `Research.md` | `~/.pi/agent/agents/Research.md` | Either via existing `INCLUDE_AGENT_CONFIGS` mechanism or an unconditional COPY |
| `subagents-worktrees.json` | `~/.pi/agent/subagents-worktrees.json` (global) | New COPY step in Dockerfile |
| `settings.json` | `~/.pi/agent/settings.json` | Existing COPY from `pi-agent-config/settings.json` |

**Global vs. project config:** The `subagents-worktrees.json` should be global so the `Research` agent is isolated in any workspace the user opens. The project-level `.pi/subagents-worktrees.json` in `/workspace/pi-web-research-sandbox` is useful for development but is not baked into the image.

## 5. Lockfile and version-update workflow

### 5.1 Updating the gotgenes packages (as just done in the live environment)

1. Edit `pi-agent-config/npm/package.json` to bump versions and add `pi-subagents-worktrees`.
2. Regenerate the lockfile on the host:
   ```bash
   cd /workspace/sane_config/pi-agent-config/npm
   npm install
   ```
3. Audit the lockfile freshness:
   ```bash
   cd /workspace/sane_config
   make check-lockfile-age
   ```
4. Update `pi-agent-config/settings.json` with the new version pins and the correct package order.
5. Build and test:
   ```bash
   cd /workspace/sane_config
   make build-with-configs
   ```
6. Verify inside the container:
   ```bash
   podman run --rm pi-agent /app/pi-test.sh list
   podman run --rm pi-agent cat /home/USER/.pi/agent/settings.json
   ```

### 5.2 Future updates of the web-research extension itself

- **Git-extension mode:** Update the `PI_WEB_RESEARCH_EXT_REF` to the desired commit/tag, similar to `control_your_sampling`.

### 5.3 Testing after updates

- Confirm `pi` starts without errors.
- Confirm `/app/pi-test.sh list` shows all expected packages, including the web-research extension and `pi-subagents-worktrees`.
- Spawn a `Research` subagent in a git-initialized workspace and verify it runs in a temporary worktree.
- Confirm the deterministic sanitizer returns only the JSON schema to the main agent.
- Verify the main agent refuses to use web data as arguments to `bash`, `write`, or `edit`.

## 6. Risks and open questions

1. **Gotgenes major-version jump.** `pi-subagents` goes from `7.5.1` to `16.6.0` and `pi-permission-system` from `7.3.1` to `14.0.0`. There may be frontmatter, API, or policy-format changes. The `Research.md` frontmatter and the `pi-permission-system` `config.json` must be tested after the container build.
2. **Subagent harness instability.** The pi subagent/permission system currently has an internal bug (`registerSubagentSession`/`unregisterSubagentSession` is not a function), which prevented spawning a requirements-gathering subagent. This may also affect the `Research` subagent at runtime. The root cause should be confirmed before relying on the sandbox.
3. **Git repo requirement.** Worktree isolation only works if the current project is a git repository with at least one commit. Users must be told to `git init && git commit` before using the `Research` agent, or the spawn will fail with *“not a git repo, no commits yet, or `git worktree add` failed.”*
4. **Age gate timing.** `pi-subagents@16.6.0` and `pi-permission-system@14.0.0` were published on 2026-06-17. The container’s 3-day `min-release-age` gate means builds before 2026-06-20/21 may reject them. Schedule the first build accordingly, or temporarily override with `--min-release-age=0` only after verification.
5. **Extension source imports.** The extension imports `src/sanitizer.ts`, `src/schema.ts`, and `src/subagent.ts`. Ensure the relative import paths work when the project is cloned to `~/.pi/agent/extensions/web-research-sandbox/`.
6. **Permission-system policy.** The current `pi-permission-system` config allows almost everything. If the web-research feature is meant to enforce least privilege, the permission config should be reviewed and possibly tightened for `Research` agent operations.

## 7. Top 3 recommendations

1. **Develop in this container until publication.** Keep the extension source in `/workspace/pi-web-research-sandbox`. Do not modify `sane_config` until the extension is published on GitHub. After publication, add it as a git extension in `sane_config` using the same pattern as `control_your_sampling`.
2. **Update the gotgenes ecosystem together.** Bump `pi-subagents` to `16.6.0`, `pi-permission-system` to `14.0.0`, and add `pi-subagents-worktrees@0.2.3` in both `pi-agent-config/npm/package.json` and `pi-agent-config/settings.json`. Keep `pi-subagents` immediately before `pi-subagents-worktrees` in the settings order.
3. **Defer the `sane_config` integration until after publication.** `src/sanitizer.ts`, `src/schema.ts`, and `src/subagent.ts` are still TODO. Once they are implemented and the extension loads locally, publish the repo and then update `sane_config` with the git extension, lockfile, and settings changes.
