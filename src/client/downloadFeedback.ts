export type DownloadFeedbackKind = "deck-export" | "archived-import" | "generated-import-export" | "source-export";

export function downloadFeedbackMessage(kind: DownloadFeedbackKind, fileName: string) {
  switch (kind) {
    case "archived-import":
      return `Downloaded original imported package: ${fileName}.`;
    case "generated-import-export":
      return `Exported generated package: ${fileName}.`;
    case "source-export":
      return `Exported generated source package: ${fileName}.`;
    default:
      return `Exported deck package: ${fileName}.`;
  }
}

export function packageActionErrorMessage(kind: DownloadFeedbackKind, error: unknown) {
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const prefix = packageActionErrorPrefix(kind);
  return detail ? `${prefix}: ${detail}` : prefix;
}

function packageActionErrorPrefix(kind: DownloadFeedbackKind) {
  switch (kind) {
    case "archived-import":
      return "Original package download failed";
    case "generated-import-export":
      return "Generated package export failed";
    case "source-export":
      return "Generated source package export failed";
    default:
      return "Deck export failed";
  }
}
