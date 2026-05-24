import type { MediaAsset } from "./api";

export function mediaAssetReference(asset: Pick<MediaAsset, "fileName" | "mimeType">) {
  if (asset.mimeType.startsWith("audio/")) return `[sound:${asset.fileName}]`;
  if (asset.mimeType.startsWith("image/")) return `<img src="${asset.fileName}">`;
  return asset.fileName;
}

export function mediaUploadedMessage(asset: Pick<MediaAsset, "fileName" | "mimeType" | "originalName">) {
  return `Uploaded ${asset.originalName}: ${mediaAssetReference(asset)}`;
}

export function mediaDeletedMessage(asset: Pick<MediaAsset, "originalName">) {
  return `Deleted media ${asset.originalName} and removed its card references.`;
}

export function mediaActionErrorMessage(action: "upload" | "delete", error: unknown) {
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const prefix = action === "upload" ? "Media upload failed" : "Media delete failed";
  return detail ? `${prefix}: ${detail}` : prefix;
}
