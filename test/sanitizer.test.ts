import { sanitizeToObject } from "../src/sanitizer.ts";
import { fixtures } from "./fixtures.ts";

let passed = 0;
let failed = 0;

for (const fixture of fixtures) {
  const result = sanitizeToObject(fixture.html, fixture.source);
  const failures: string[] = [];

  if (result.error) {
    failures.push(`sanitizer returned error: ${result.error}`);
  }

  if (fixture.expectedContentType !== undefined && result.content_type !== fixture.expectedContentType) {
    failures.push(`expected content_type ${fixture.expectedContentType}, got ${result.content_type}`);
  }

  if (fixture.expectedFactsMin !== undefined && result.facts.length < fixture.expectedFactsMin) {
    failures.push(`expected at least ${fixture.expectedFactsMin} facts, got ${result.facts.length}`);
  }

  if (fixture.expectedSignaturesMin !== undefined && result.signatures.length < fixture.expectedSignaturesMin) {
    failures.push(`expected at least ${fixture.expectedSignaturesMin} signatures, got ${result.signatures.length}`);
  }

  if (fixture.expectedVersionsMin !== undefined && result.versions.length < fixture.expectedVersionsMin) {
    failures.push(`expected at least ${fixture.expectedVersionsMin} versions, got ${result.versions.length}`);
  }

  if (fixture.expectedRejectedFragmentsMin !== undefined && result.rejected_fragments.length < fixture.expectedRejectedFragmentsMin) {
    failures.push(`expected at least ${fixture.expectedRejectedFragmentsMin} rejected fragments, got ${result.rejected_fragments.length}`);
  }

  const allFacts = result.facts.join(" ");
  for (const expected of fixture.expectedFactsContain ?? []) {
    if (!allFacts.includes(expected)) {
      failures.push(`expected facts to contain "${expected}"`);
    }
  }

  for (const notExpected of fixture.expectedFactsNotContain ?? []) {
    if (allFacts.includes(notExpected)) {
      failures.push(`facts leaked forbidden text: "${notExpected}"`);
    }
  }

  if (failures.length === 0) {
    console.log(`✅ ${fixture.name}`);
    passed++;
  } else {
    console.log(`❌ ${fixture.name}`);
    for (const f of failures) console.log(`   ${f}`);
    console.log("   output:", JSON.stringify(result, null, 2).split("\n").map((l) => "   " + l).join("\n"));
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed out of ${fixtures.length}`);
if (failed > 0) process.exit(1);
