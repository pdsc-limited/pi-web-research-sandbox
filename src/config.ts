import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SandboxConfig {
  strictMainWebTools: boolean;
}

/** Returns undefined for missing, malformed, or schema-invalid config. */
export function parseSandboxConfig(text: string): SandboxConfig | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      !("strictMainWebTools" in value) ||
      typeof value.strictMainWebTools !== "boolean"
    ) {
      return undefined;
    }
    return { strictMainWebTools: value.strictMainWebTools };
  } catch {
    return undefined;
  }
}

export async function readSandboxConfig(path: string): Promise<SandboxConfig | undefined> {
  try {
    return parseSandboxConfig(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

export function globalSandboxConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "web-research-sandbox.json");
}

/** Resolve configuration fail-open with trusted project precedence. */
export function resolveStrictMainWebTools(
  global: SandboxConfig | undefined,
  project: SandboxConfig | undefined,
  projectTrusted: boolean,
): boolean {
  return projectTrusted ? project?.strictMainWebTools ?? global?.strictMainWebTools ?? false : global?.strictMainWebTools ?? false;
}

export function projectSandboxConfigPath(cwd: string, configDirName: string): string {
  return join(cwd, configDirName, "web-research-sandbox.json");
}

export async function loadStrictMainWebTools(
  cwd: string,
  projectTrusted: boolean,
  configDirName: string,
): Promise<boolean> {
  const global = await readSandboxConfig(globalSandboxConfigPath());
  const project = projectTrusted
    ? await readSandboxConfig(projectSandboxConfigPath(cwd, configDirName))
    : undefined;
  return resolveStrictMainWebTools(global, project, projectTrusted);
}
