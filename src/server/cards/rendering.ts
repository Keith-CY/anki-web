export type FieldMap = Record<string, string | null | undefined>;

export interface RenderCardOptions {
  clozeOrdinal?: number | null;
  clozeMode?: "question" | "answer";
}

export function renderCardTemplate(template: string, fields: FieldMap, frontSide = "", options: RenderCardOptions = {}) {
  let html = template.replaceAll("{{FrontSide}}", frontSide);

  html = html.replace(/{{#([^}]+)}}([\s\S]*?){{\/\1}}/g, (_match, fieldName: string, body: string) => {
    const value = fields[fieldName.trim()];
    return value ? body : "";
  });

  html = html.replace(/{{\^([^}]+)}}([\s\S]*?){{\/\1}}/g, (_match, fieldName: string, body: string) => {
    const value = fields[fieldName.trim()];
    return value ? "" : body;
  });

  html = html.replace(/{{cloze:([^}]+)}}/g, (_match, fieldName: string) => {
    const value = fields[fieldName.trim()] ?? "";
    return renderClozeField(String(value), options);
  });

  html = html.replace(/{{(furigana|kanji|kana):+([^}]+)}}/g, (_match, filterName: string, fieldName: string) => {
    const value = String(fields[fieldName.trim()] ?? "");
    return renderJapaneseFieldFilter(filterName, value);
  });

  html = html.replace(/{{([^#/^}][^}]*)}}/g, (_match, fieldName: string) => {
    const name = fieldName.trim();
    return fields[name] ?? "";
  });

  return sanitizeRenderedHtml(renderAnkiMediaMarkers(html));
}

function renderJapaneseFieldFilter(filterName: string, value: string) {
  if (filterName === "kanji") return replaceFuriganaMarkup(value, "$1");
  if (filterName === "kana") return replaceFuriganaMarkup(value, "$2");
  return replaceFuriganaMarkup(value, "<ruby>$1<rt>$2</rt></ruby>");
}

function replaceFuriganaMarkup(value: string, replacement: string) {
  return value.replace(/([^\s[\]<>()]+)\[([^\][\r\n]+)\]/g, replacement);
}

function renderClozeField(value: string, options: RenderCardOptions) {
  const targetNumber = (options.clozeOrdinal ?? 0) + 1;
  const mode = options.clozeMode ?? "question";
  return value.replace(/{{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?}}/g, (_match, numberText: string, text: string, hint?: string) => {
    const isTarget = Number(numberText) === targetNumber;
    if (mode === "question" && isTarget) {
      return hint ? `[${hint}]` : "[...]";
    }
    return text;
  });
}

function renderAnkiMediaMarkers(html: string) {
  return html
    .replace(/\[sound:([^\]]+)\]/g, (_match, fileName: string) => {
      return `<audio controls src="/media/${encodeURIComponent(fileName)}"></audio>`;
    })
    .replace(/<img\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>/gi, (match, before: string, quote: string, src: string, after: string) => {
      if (!isLocalMediaReference(src)) return match;
      return `<img${before}src=${quote}/media/${encodeURIComponent(src)}${quote}${after}>`;
    });
}

function isLocalMediaReference(src: string) {
  const lower = src.trim().toLowerCase();
  return Boolean(lower) && !lower.startsWith("/media/") && !lower.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/i.test(lower);
}

function sanitizeRenderedHtml(html: string) {
  return html
    .replace(/<\s*(script|iframe|object|embed|meta|link|base|form)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|iframe|object|embed|meta|link|base|form)\b[^>]*\/?\s*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (match: string, _attribute: string, rawValue: string) => {
      return isDangerousUrlAttribute(rawValue) ? "" : match;
    });
}

function isDangerousUrlAttribute(rawValue: string) {
  const value = stripAttributeQuotes(rawValue);
  const normalized = decodeHtmlEntities(value)
    .replace(/[\u0000-\u001f\u007f\s]+/g, "")
    .toLowerCase();
  return normalized.startsWith("javascript:") || normalized.startsWith("data:text/html") || normalized.startsWith("data:image/svg+xml");
}

function stripAttributeQuotes(value: string) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    colon: ":",
    tab: "\t",
    newline: "\n"
  };
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      return codePointToString(Number.parseInt(lower.slice(2), 16), match);
    }
    if (lower.startsWith("#")) {
      return codePointToString(Number.parseInt(lower.slice(1), 10), match);
    }
    return namedEntities[lower] ?? match;
  });
}

function codePointToString(value: number, fallback: string) {
  if (!Number.isFinite(value)) return fallback;
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}
