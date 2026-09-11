import {
  parseSandboxConfig,
  projectSandboxConfigPath,
  resolveStrictMainWebTools,
} from "../src/config.ts";
import { shouldBlockMainWebTool } from "../src/strict-main-web-tools.ts";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

check("parses strict mode", parseSandboxConfig('{"strictMainWebTools":true}'), { strictMainWebTools: true });
check("rejects malformed JSON", parseSandboxConfig("{"), undefined);
check("rejects missing property", parseSandboxConfig("{}"), undefined);
check("rejects wrong property type", parseSandboxConfig('{"strictMainWebTools":"true"}'), undefined);
check("rejects extra properties", parseSandboxConfig('{"strictMainWebTools":true,"extra":false}'), undefined);

const enabled = { strictMainWebTools: true };
const disabled = { strictMainWebTools: false };
check("defaults false", resolveStrictMainWebTools(undefined, undefined, true), false);
check("uses global config", resolveStrictMainWebTools(enabled, undefined, true), true);
check("valid trusted project overrides global", resolveStrictMainWebTools(enabled, disabled, true), false);
check("untrusted project cannot override global", resolveStrictMainWebTools(disabled, enabled, false), false);
check(
  "uses supplied Pi config directory for project config",
  projectSandboxConfigPath("/workspace/project", ".custom-pi"),
  "/workspace/project/.custom-pi/web-research-sandbox.json",
);

check("strict mode blocks web search", shouldBlockMainWebTool(true, "web_search"), true);
check("strict mode blocks web fetch", shouldBlockMainWebTool(true, "web_fetch"), true);
check("strict mode permits other tools", shouldBlockMainWebTool(true, "read"), false);
check("non-strict mode permits web tools", shouldBlockMainWebTool(false, "web_search"), false);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
