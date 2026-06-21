import { Type, type Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";

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

const compiled = TypeCompiler.Compile(ResearchOutputSchema);

export function validateResearchOutput(value: unknown): value is ResearchOutput {
  return compiled.Check(value);
}

export function getResearchOutputErrors(value: unknown): string[] {
  return [...compiled.Errors(value)].map((e) => `${e.path}: ${e.message}`);
}
