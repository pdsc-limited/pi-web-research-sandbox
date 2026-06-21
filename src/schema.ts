import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const ContentType = Type.Union([
  Type.Literal("api_documentation"),
  Type.Literal("release_notes"),
  Type.Literal("documentation"),
  Type.Literal("unknown"),
]);

export const ResearchOutputSchema = Type.Object(
  {
    source: Type.String(),
    content_type: ContentType,
    facts: Type.Array(Type.String()),
    signatures: Type.Array(Type.String()),
    versions: Type.Array(Type.String()),
    rejected_fragments: Type.Array(Type.String()),
    digest: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type ResearchOutput = Static<typeof ResearchOutputSchema>;

export function validateResearchOutput(value: unknown): value is ResearchOutput {
  return Value.Check(ResearchOutputSchema, value);
}

export function getResearchOutputErrors(value: unknown): string[] {
  return [...Value.Errors(ResearchOutputSchema, value)].map((e) => {
    // The pi loader aliases @sinclair/typebox to the unscoped typebox
    // package at runtime, whose error shape uses instancePath instead of path.
    const path = "path" in e && typeof e.path === "string"
      ? e.path
      : "instancePath" in e && typeof e.instancePath === "string"
        ? e.instancePath
        : "?";
    return `${path}: ${e.message}`;
  });
}
