export function draftAudioSource(fields: Partial<Record<"Audio", string | undefined>>) {
  const marker = /\[sound:([^\]]+)\]/.exec(fields.Audio ?? "");
  return marker ? `/media/${encodeURIComponent(marker[1])}` : null;
}

export function draftAudioTitle(fields: Partial<Record<"Audio", string | undefined>>) {
  return draftAudioSource(fields) ? "Refresh audio" : "Generate audio";
}
