import type { SourceRecord } from "./api";

export interface SourceLibraryRow {
  source: SourceRecord;
  originLabel: string;
  canExport: boolean;
}

export interface SourceLibraryOptions {
  exportReadyOnly?: boolean;
  limit?: number;
}

export function sourceLibraryRows(sources: SourceRecord[], options: SourceLibraryOptions = {}): SourceLibraryRow[] {
  const rows = sources.map((source) => ({
    source,
    originLabel: sourceOriginLabel(source),
    canExport: source.approvedNotes > 0
  }));
  const filtered = options.exportReadyOnly ? rows.filter((row) => row.canExport) : rows;
  return typeof options.limit === "number" ? filtered.slice(0, options.limit) : filtered;
}

function sourceOriginLabel(source: Pick<SourceRecord, "type" | "url">) {
  if (source.type === "text-material") return "pasted study notes";
  if (source.type === "article-url") return source.url;
  return source.url || source.type;
}
