import { sanitizeResearchOutput } from "../src/sanitizer.ts";
import { validateResearchOutput, type ResearchOutput } from "../src/schema.ts";
import { researchOutputFixtures } from "./research-output-fixtures.ts";

let passed = 0;
let failed = 0;

function check(condition: boolean, label: string): void {
  if (condition) return;
  // Do not serialize untrusted fixtures or results: a failed test must not
  // print an attacker-provided phrase into the test output.
  console.log(`❌ ${label}`);
  failed++;
}

function pass(name: string): void {
  console.log(`✅ ${name}`);
  passed++;
}

const benign = sanitizeResearchOutput(researchOutputFixtures[0].input);
check(benign.source === "https://example.test/a?x=1&y=2", "benign source normalization");
check(benign.facts[0] === "Useful documentation entry.", "benign fact normalization");
check(benign.error === "temporary problem", "benign error normalization");
check(benign.versions.length === 2, "valid versions are retained");
check(!("digest" in benign), "child digest is always omitted");
check(benign.rejected_fragments.length === 0, "benign artifact has no sentinel");
check(validateResearchOutput(benign), "benign output validates against schema");
pass(researchOutputFixtures[0].name);

const adversarial = sanitizeResearchOutput(researchOutputFixtures[1].input);
check(adversarial.source === "unknown", "unsafe source becomes unknown");
check(adversarial.facts.length === 2, "adversarial facts are dropped without partial redaction");
check(adversarial.facts[0] === "Useful first fact." && adversarial.facts[1] === "Useful second fact.", "clean fact siblings preserve order");
check(adversarial.signatures.length === 2, "adversarial signature is dropped");
check(adversarial.versions.length === 2 && adversarial.versions[0] === "v2.3.4", "strict anchored version validation");
check(adversarial.rejected_fragments.length === 1 && adversarial.rejected_fragments[0] === "redacted_untrusted_fragment", "rejected child text is replaced by sentinel");
check(adversarial.error === "WebResearch returned an unsafe error message.", "unsafe error is fixed text");
check(!("digest" in adversarial), "adversarial digest omitted");
check(validateResearchOutput(adversarial), "adversarial output validates against schema");
pass(researchOutputFixtures[1].name);

const homoglyph = sanitizeResearchOutput(researchOutputFixtures[2].input);
check(homoglyph.facts.length === 1 && homoglyph.facts[0] === "A clean sibling remains.", "Cyrillic mixed-script token is dropped while clean sibling remains");
check(homoglyph.rejected_fragments[0] === "redacted_untrusted_fragment", "mixed-script drop records sentinel");
pass(researchOutputFixtures[2].name);

const boundedInput: ResearchOutput = {
  source: "https://example.test/bounds",
  content_type: "release_notes",
  facts: Array.from({ length: 51 }, (_, i) => `Fact ${i}.`),
  signatures: Array.from({ length: 21 }, (_, i) => `function f${i}(value: string)`),
  versions: [...Array.from({ length: 20 }, (_, i) => `v1.2.${i}`), "not a version"],
  rejected_fragments: [],
  error: "",
};
const bounded = sanitizeResearchOutput(boundedInput);
check(bounded.facts.length === 50 && bounded.signatures.length === 20 && bounded.versions.length === 20, "array caps are enforced");
check(bounded.rejected_fragments[0] === "redacted_untrusted_fragment", "capped entries record sentinel");
check(!("error" in bounded), "empty error is omitted");
pass("enforces array caps and omits empty error");

const longInput: ResearchOutput = {
  source: "x".repeat(2049),
  content_type: "unknown",
  facts: ["f".repeat(2001)],
  signatures: ["s".repeat(1001)],
  versions: ["v" + "1".repeat(128)],
  rejected_fragments: [],
};
const longOutput = sanitizeResearchOutput(longInput);
check(longOutput.source === "unknown" && longOutput.facts.length === 0 && longOutput.signatures.length === 0 && longOutput.versions.length === 0, "field length bounds are enforced");
check(longOutput.rejected_fragments[0] === "redacted_untrusted_fragment", "overlong fields record sentinel");
pass("enforces field length bounds");

const immutableInput: ResearchOutput = JSON.parse(JSON.stringify(researchOutputFixtures[1].input));
const before = JSON.stringify(immutableInput);
const first = sanitizeResearchOutput(immutableInput);
const second = sanitizeResearchOutput(immutableInput);
check(JSON.stringify(immutableInput) === before, "input is not mutated");
check(JSON.stringify(first) === JSON.stringify(second), "sanitization is deterministic");
pass("is immutable and deterministic");

console.log(`\n${passed} fixture groups passed, ${failed} checks failed`);
if (failed > 0) process.exit(1);
