export function sanitizeNoteTypeCss(css: string) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@import\b[^;]*(?:;|$)/gi, "")
    .replace(/([;{])\s*[-\w]+\s*:\s*[^;{}]*(?:url\s*\(|expression\s*\(|javascript:|data:text\/html|data:image\/svg\+xml)[^;{}]*;?/gi, "$1 ")
    .replace(/([;{])\s*(?:behavior|-moz-binding)\s*:\s*[^;{}]*;?/gi, "$1 ")
    .trim();
}
