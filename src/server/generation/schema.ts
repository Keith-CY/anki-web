import { z } from "zod";

export const explanationSchema = z.object({
  zh: z.string().min(1),
  en: z.string().min(1),
  ja: z.string().min(1)
});

export const generatedDraftSchema = z.object({
  kind: z.enum(["vocabulary", "grammar", "pronunciation"]),
  expression: z.string().min(1),
  reading: z.string().default(""),
  pitchAccent: z.string().nullable().default(null),
  pitchAccentSource: z.enum(["lexicon", "ai", "none"]).default("none"),
  meanings: explanationSchema,
  example: z.string().default(""),
  exampleReading: z.string().default(""),
  explanation: explanationSchema,
  tags: z.array(z.string()).default([])
});

export const generatedDraftsSchema = z.object({
  drafts: z.array(generatedDraftSchema).min(1).max(40)
});

export type GeneratedDraft = z.infer<typeof generatedDraftSchema>;
export type GeneratedDrafts = z.infer<typeof generatedDraftsSchema>;

export function jsonSchemaForGeneratedDrafts() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["drafts"],
    properties: {
      drafts: {
        type: "array",
        minItems: 1,
        maxItems: 40,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "kind",
            "expression",
            "reading",
            "pitchAccent",
            "pitchAccentSource",
            "meanings",
            "example",
            "exampleReading",
            "explanation",
            "tags"
          ],
          properties: {
            kind: { type: "string", enum: ["vocabulary", "grammar", "pronunciation"] },
            expression: { type: "string" },
            reading: { type: "string" },
            pitchAccent: { type: ["string", "null"] },
            pitchAccentSource: { type: "string", enum: ["lexicon", "ai", "none"] },
            meanings: explanationJsonSchema(),
            example: { type: "string" },
            exampleReading: { type: "string" },
            explanation: explanationJsonSchema(),
            tags: { type: "array", items: { type: "string" } }
          }
        }
      }
    }
  };
}

function explanationJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["zh", "en", "ja"],
    properties: {
      zh: { type: "string" },
      en: { type: "string" },
      ja: { type: "string" }
    }
  };
}
