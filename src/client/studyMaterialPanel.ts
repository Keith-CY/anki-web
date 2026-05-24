export const acceptedStudyMaterialFileTypes =
  ".txt,.md,.markdown,.html,.htm,.csv,.tsv,.srt,.vtt,.docx,.zip,text/plain,text/markdown,text/html,text/csv,text/tab-separated-values,application/x-subrip,text/vtt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/zip";

export function studyMaterialUploadLabel(fileCount: number) {
  return fileCount > 0 ? `${fileCount} material files selected` : "Upload .txt/.md/.html/.csv/.tsv/.srt/.vtt/.docx/.zip materials";
}
