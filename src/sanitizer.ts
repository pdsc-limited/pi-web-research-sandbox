import { parseHTML } from "linkedom";
import DOMPurify from "isomorphic-dompurify";
import { createHash } from "node:crypto";
import {
  getResearchOutputErrors,
  type ResearchOutput,
  validateResearchOutput,
} from "./schema.ts";

// Phrases that are almost certainly prompt-injection attempts. We record them
// but never pass them back to the main agent as natural-language content.
const INJECTION_MARKERS = [
  /ignore\s+(?:previous|all|the)\s+instructions?/i,
  /disregard\s+(?:previous|all|the)?/i,
  /new\s+instructions?/i,
  /system\s+prompt/i,
  /<\/?\s*system\b/i,
  /you\s+are\s+now/i,
  /act\s+as\s+/i,
  /from\s+now\s+on/i,
  /forget\s+everything/i,
  /ignore\s+(?:the\s+)?above/i,
  /override\s+(?:the\s+)?previous/i,
];

const ZERO_WIDTH_CHARS = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;
const MIXED_SCRIPT_TOKEN = /(?=[^\s]*[A-Za-z])(?=[^\s]*[\u0370-\u03FF\u1F00-\u1FFF\u0400-\u052F])[^\s]+/u;
const VERSION_GRAMMAR = /^(?:v\d+(?:\.\d+)*|\d+\.\d+\.\d+(?:[-+.]?[0-9A-Za-z-]+)*)$/;

const MAX_SOURCE_LENGTH = 2048;
const MAX_FACTS = 50;
const MAX_FACT_LENGTH = 2000;
const MAX_SIGNATURES = 20;
const MAX_SIGNATURE_LENGTH = 1000;
const MAX_VERSIONS = 20;
const MAX_VERSION_LENGTH = 128;
const MAX_ERROR_LENGTH = 2048;
const REDACTED_UNTRUSTED_FRAGMENT = "redacted_untrusted_fragment";
const UNSAFE_ERROR = "WebResearch returned an unsafe error message.";

// The web tool result may be a string, a content array, or an object spilled
// to a temp file. Extract the raw text deterministically.
function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === "object") {
          if (
            "type" in part &&
            part.type === "text" &&
            "text" in part &&
            typeof part.text === "string"
          ) {
            return part.text;
          }
          return JSON.stringify(part);
        }
        return String(part);
      })
      .join("\n");
  }
  return JSON.stringify(content);
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function sanitizeText(text: string): string {
  // Parse as HTML so we can strip active elements and hidden subtrees. Plain
  // text is treated as a single text node, which is safe. We use a wrapper
  // <div> so fragments with multiple root elements are serialized fully.
  const { document } = parseHTML("");
  const root = document.createElement("div");
  root.innerHTML = text;

  const activeOrHidden =
    "script, style, noscript, iframe, object, embed, svg, canvas, template, link, meta, audio, video";
  for (const el of root.querySelectorAll(activeOrHidden)) {
    el.remove();
  }

  for (const el of root.querySelectorAll("[hidden]")) {
    el.remove();
  }

  for (const el of root.querySelectorAll("*")) {
    const ariaHidden = el.getAttribute("aria-hidden")?.trim().toLowerCase();
    const style = (el.getAttribute("style") ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, "")
      .toLowerCase();
    if (
      ariaHidden === "true" ||
      style.includes("display:none") ||
      style.includes("visibility:hidden")
    ) {
      el.remove();
    }
  }

  // Serialize the cleaned DOM and replace all tags with spaces so that text
  // from different block elements does not get concatenated. Decode HTML
  // entities so that encoded tags become real tags and can be stripped by
  // DOMPurify. DOMPurify then removes any remaining tags and keeps content.
  // Comments are not visible and must not turn marker text into separate words
  // (for example, `ig<!-- -->nore`); remove them before adding tag boundaries.
  let sanitized = root.innerHTML.replace(/<!--[\s\S]*?-->/g, "");
  sanitized = sanitized.replace(/<[^>]+>/g, " ");
  sanitized = decodeHtmlEntities(sanitized);
  // Preserve word boundaries before DOMPurify reparses plain text; some DOM
  // implementations otherwise discard text-node newlines during serialization.
  sanitized = sanitized.replace(/\s+/g, " ");
  sanitized = DOMPurify.sanitize(sanitized, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
  });

  // Normalize homoglyphs and canonicalize Unicode forms.
  sanitized = sanitized.normalize("NFKC");

  // Remove invisible characters that can smuggle tokens or break naive filters.
  sanitized = sanitized.replace(ZERO_WIDTH_CHARS, "");
  sanitized = sanitized.replace(/\x00/g, "");

  // Collapse whitespace to a single, predictable form.
  sanitized = sanitized.replace(/\s+/g, " ").trim();

  return sanitized;
}

function markerRegex(pattern: RegExp): RegExp {
  // Never reuse a global RegExp: its lastIndex can make repeated checks skip
  // a marker depending on prior calls.
  return new RegExp(pattern.source, "giu");
}

function hasInjectionMarker(text: string): boolean {
  return INJECTION_MARKERS.some((pattern) => markerRegex(pattern).test(text));
}

function hasMixedScriptToken(text: string): boolean {
  // This deliberately narrow heuristic catches common Cyrillic/Greek
  // homoglyph obfuscation, not every possible prompt-injection technique.
  return MIXED_SCRIPT_TOKEN.test(text);
}

function collectRejectedFragments(text: string): string[] {
  const fragments: string[] = [];
  for (const pattern of INJECTION_MARKERS) {
    const matches = text.match(markerRegex(pattern));
    if (matches) fragments.push(...matches);
  }
  return Array.from(new Set(fragments));
}

function redactInjectionText(text: string): string {
  let redacted = text;
  for (const pattern of INJECTION_MARKERS) {
    redacted = redacted.replace(markerRegex(pattern), " ");
  }
  return redacted.replace(/\s+/g, " ").trim();
}

function collectFacts(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const facts = sentences
    .map((s) => s.trim())
    .filter((s) => s.length >= 12)
    .filter((s) => /^[a-zA-Z0-9]/.test(s));
  return Array.from(new Set(facts)).slice(0, MAX_FACTS);
}

function collectSignatures(text: string): string[] {
  const declPattern =
    /\b(?:function|def|class|interface|struct|enum|type|fn|public|private|protected|static|async|abstract)\s+\w[\w\s]*\([^)]*\)/g;
  const arrowPattern =
    /\b(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
  const methodPattern =
    /\b\w+\([^)]*\)\s*(?::\s*\w+)?\s*(?:->|=>)/g;

  const matches = [
    ...(text.match(declPattern) || []),
    ...(text.match(arrowPattern) || []),
    ...(text.match(methodPattern) || []),
  ];
  return Array.from(new Set(matches))
    .map((s) => s.trim())
    .filter((s) => s.length >= 8)
    .slice(0, MAX_SIGNATURES);
}

function collectVersions(text: string): string[] {
  const versionPattern =
    /\b(?:v\d+(?:\.\d+)*|\d+\.\d+\.\d+(?:[-+.]?[0-9A-Za-z-]+)*)\b/g;
  const matches = text.match(versionPattern) || [];
  return Array.from(new Set(matches))
    .filter((s) => VERSION_GRAMMAR.test(s))
    .slice(0, MAX_VERSIONS);
}

function classifyContent(
  text: string,
  signatures: string[],
  versions: string[],
): ResearchOutput["content_type"] {
  if (
    signatures.length > 0 ||
    /api|endpoint|signature|method|function|def|class|interface/gi.test(text)
  ) {
    return "api_documentation";
  }
  if (
    versions.length > 0 ||
    /release|changelog|version|update notes/gi.test(text)
  ) {
    return "release_notes";
  }
  if (text.length > 0) {
    return "documentation";
  }
  return "unknown";
}

function buildOutput(
  text: string,
  source: string,
): ResearchOutput {
  const rejected = collectRejectedFragments(text);
  // Record the injection markers, then remove them from the text so they
  // cannot leak into facts or other structured fields.
  const redacted = redactInjectionText(text);
  const facts = collectFacts(redacted);
  const signatures = collectSignatures(redacted);
  const versions = collectVersions(redacted);
  const content_type = classifyContent(redacted, signatures, versions);
  const digest = "sha256:" + createHash("sha256").update(redacted).digest("hex");

  return {
    source,
    content_type,
    facts,
    signatures,
    versions,
    rejected_fragments: rejected,
    digest,
  };
}

function safeFallback(source: string, error: string): ResearchOutput {
  return {
    source,
    content_type: "unknown",
    facts: [],
    signatures: [],
    versions: [],
    rejected_fragments: [],
    digest: "sha256:" + createHash("sha256").update("").digest("hex"),
    error,
  };
}

// Public API used by the extension tool_result handler.
/**
 * Sanitize a schema-valid artifact returned by the low-privilege child before
 * it reaches the parent. This is intentionally heuristic, not a claim that
 * arbitrary adversarial prose can be comprehensively classified.
 */
export function sanitizeResearchOutput(input: ResearchOutput): ResearchOutput {
  let dropped = input.rejected_fragments.length > 0;
  const sourceCandidate = sanitizeText(input.source);
  const sourceIsSafe = sourceCandidate.length > 0 &&
    sourceCandidate.length <= MAX_SOURCE_LENGTH &&
    !hasInjectionMarker(sourceCandidate) &&
    !hasMixedScriptToken(sourceCandidate);
  if (!sourceIsSafe && sourceCandidate.length > 0) dropped = true;
  const source = sourceIsSafe ? sourceCandidate : "unknown";

  const sanitizeEntries = (entries: string[], cap: number, maxLength: number): string[] => {
    if (entries.length > cap) dropped = true;
    const seen = new Set<string>();
    const output: string[] = [];
    for (const entry of entries.slice(0, cap)) {
      const normalized = sanitizeText(entry);
      if (
        normalized.length === 0 ||
        normalized.length > maxLength ||
        hasInjectionMarker(normalized) ||
        hasMixedScriptToken(normalized) ||
        seen.has(normalized)
      ) {
        dropped = true;
        continue;
      }
      seen.add(normalized);
      output.push(normalized);
    }
    return output;
  };

  const facts = sanitizeEntries(input.facts, MAX_FACTS, MAX_FACT_LENGTH);
  const signatures = sanitizeEntries(
    input.signatures,
    MAX_SIGNATURES,
    MAX_SIGNATURE_LENGTH,
  );
  const versions = sanitizeEntries(input.versions, MAX_VERSIONS, MAX_VERSION_LENGTH)
    .filter((version) => {
      const valid = VERSION_GRAMMAR.test(version);
      if (!valid) dropped = true;
      return valid;
    });

  const normalizedError = input.error === undefined ? undefined : sanitizeText(input.error);
  const unsafeError = normalizedError !== undefined &&
    normalizedError.length > 0 &&
    (normalizedError.length > MAX_ERROR_LENGTH ||
      hasInjectionMarker(normalizedError) ||
      hasMixedScriptToken(normalizedError));
  if (unsafeError) dropped = true;
  const error = normalizedError === undefined || normalizedError.length === 0
    ? undefined
    : unsafeError
      ? UNSAFE_ERROR
      : normalizedError;

  const output: ResearchOutput = {
    source,
    content_type: input.content_type,
    facts,
    signatures,
    versions,
    rejected_fragments: dropped ? [REDACTED_UNTRUSTED_FRAGMENT] : [],
    ...(error === undefined ? {} : { error }),
  };

  // This should be guaranteed by the transformations above; keep a safe,
  // schema-valid fallback in case the schema changes independently.
  if (!validateResearchOutput(output)) {
    return {
      source: "unknown",
      content_type: "unknown",
      facts: [],
      signatures: [],
      versions: [],
      rejected_fragments: [REDACTED_UNTRUSTED_FRAGMENT],
    };
  }
  return output;
}

export function sanitizeToJson(input: unknown, source = "unknown"): string {
  const raw = extractText(input);
  const text = sanitizeText(raw);
  const output = buildOutput(text, source);

  if (!validateResearchOutput(output)) {
    const errors = getResearchOutputErrors(output);
    return JSON.stringify(safeFallback(source, errors.join("; ")));
  }

  return JSON.stringify(output);
}

// Object variant for unit tests or callers that need structured data.
export function sanitizeToObject(input: unknown, source = "unknown"): ResearchOutput {
  const raw = extractText(input);
  const text = sanitizeText(raw);
  const output = buildOutput(text, source);

  if (!validateResearchOutput(output)) {
    const errors = getResearchOutputErrors(output);
    return safeFallback(source, errors.join("; "));
  }

  return output;
}
