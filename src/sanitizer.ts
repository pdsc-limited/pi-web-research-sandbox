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
  /ignore\s+(?:previous|all|the)\s+instructions?/gi,
  /disregard\s+(?:previous|all|the)?/gi,
  /new\s+instructions?/gi,
  /system\s+prompt/gi,
  /<\/?\s*system\b/gi,
  /you\s+are\s+now/gi,
  /act\s+as\s+/gi,
  /from\s+now\s+on/gi,
  /forget\s+everything/gi,
  /ignore\s+(?:the\s+)?above/gi,
  /override\s+(?:the\s+)?previous/gi,
];

const ZERO_WIDTH_CHARS = /[\u200B-\u200F\u2060\uFEFF\u2028\u2029\u2061-\u2064\u202A-\u202E]/g;

const MAX_FACTS = 50;
const MAX_SIGNATURES = 20;
const MAX_VERSIONS = 20;

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

  for (const el of root.querySelectorAll("[hidden], [aria-hidden='true']")) {
    el.remove();
  }

  for (const el of root.querySelectorAll("*")) {
    const style = el.getAttribute("style")?.toLowerCase() ?? "";
    if (style.includes("display:none") || style.includes("visibility:hidden")) {
      el.remove();
    }
  }

  // Serialize the cleaned DOM and replace all tags with spaces so that text
  // from different block elements does not get concatenated. Decode HTML
  // entities so that encoded tags become real tags and can be stripped by
  // DOMPurify. DOMPurify then removes any remaining tags and keeps content.
  let sanitized = root.innerHTML.replace(/<[^>]+>/g, " ");
  sanitized = decodeHtmlEntities(sanitized);
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

function collectRejectedFragments(text: string): string[] {
  const fragments: string[] = [];
  for (const pattern of INJECTION_MARKERS) {
    const matches = text.match(pattern);
    if (matches) {
      fragments.push(...matches);
    }
  }
  return Array.from(new Set(fragments));
}

function redactInjectionText(text: string): string {
  let redacted = text;
  for (const pattern of INJECTION_MARKERS) {
    redacted = redacted.replace(pattern, " ");
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
    .filter((s) => /^\d/.test(s) || s.startsWith("v"))
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
