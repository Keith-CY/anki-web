import type { ImportJob } from "./api";

export function canExportGeneratedImport(job: ImportJob) {
  return (
    job.status === "completed" &&
    (job.type === "text-material" || job.type === "article-url" || job.type === "source-regeneration") &&
    typeof job.result?.sourceId === "string" &&
    Boolean(job.generatedSource && job.generatedSource.approvedCards > 0)
  );
}

export function canDownloadArchivedPackage(job: ImportJob) {
  return (
    job.status === "completed" &&
    (job.type === "apkg-url" || job.type === "apkg-file") &&
    typeof job.result?.packageFileName === "string" &&
    job.result.packageFileName.trim().length > 0
  );
}

export function canRetryImport(job: ImportJob) {
  return job.status === "failed" && job.type === "apkg-url" && job.url.startsWith("http");
}

export function formatImportUrl(job: ImportJob) {
  if (job.type === "text-material") return "pasted study notes";
  if (job.type === "source-regeneration") return "regenerated study source";
  return job.url;
}

export function formatImportResult(job: ImportJob) {
  if (!job.result) return job.error ? "failed" : "pending";
  const result = job.result as Record<string, unknown>;
  if (typeof result.draftsCreated === "number" && job.generatedSource) {
    return `${result.draftsCreated} drafts · ${job.generatedSource.approvedCards} approved`;
  }
  if (typeof result.draftsCreated === "number") return `${result.draftsCreated} drafts`;
  const notes = typeof result.notesImported === "number" ? result.notesImported : 0;
  const cards = typeof result.cardsImported === "number" ? result.cardsImported : 0;
  if (notes || cards) {
    const recommendation = studyMaterialRecommendationSummary(result);
    return `${notes} notes · ${cards} cards${recommendation ? ` · ${recommendation}` : ""}`;
  }
  return "completed";
}

export function studyMaterialTargetForImport(job: ImportJob) {
  if (job.status !== "completed" || !job.result) return null;
  const result = job.result as Record<string, unknown>;
  if (result.needsStudyMaterial !== true || !Array.isArray(result.studyMaterialRecommendations)) return null;
  for (const recommendation of result.studyMaterialRecommendations) {
    if (!isRecord(recommendation) || typeof recommendation.deckId !== "string" || !recommendation.deckId.trim()) continue;
    const deckCoverage = recommendation.deckCoverage;
    if (!isRecord(deckCoverage) || deckCoverage.needsMaterial !== true) continue;
    const summary = deckCoverageGapSummary(deckCoverage);
    if (!summary) continue;
    return {
      deckId: recommendation.deckId,
      deckName: typeof recommendation.deckName === "string" && recommendation.deckName.trim() ? recommendation.deckName : "Imported deck",
      summary
    };
  }
  return null;
}

function studyMaterialRecommendationSummary(result: Record<string, unknown>) {
  if (result.needsStudyMaterial !== true || !Array.isArray(result.studyMaterialRecommendations)) return "";
  for (const recommendation of result.studyMaterialRecommendations) {
    if (!isRecord(recommendation)) continue;
    const deckCoverage = recommendation.deckCoverage;
    if (!isRecord(deckCoverage) || deckCoverage.needsMaterial !== true) continue;
    const gaps = deckCoverageGapSummary(deckCoverage);
    if (gaps) return `needs material: ${gaps}`;
  }
  return "";
}

function deckCoverageGapSummary(deckCoverage: Record<string, unknown>) {
  if (!Array.isArray(deckCoverage.kinds)) return "";
  return deckCoverage.kinds
    .filter(isRecord)
    .filter((kind) => kind.insufficient === true && typeof kind.missing === "number" && kind.missing > 0)
    .map((kind) => `${typeof kind.label === "string" ? kind.label : String(kind.kind)} ${kind.missing}`)
    .join(", ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
