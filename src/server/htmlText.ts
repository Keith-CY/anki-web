import type * as cheerio from "cheerio";

export function preserveRubyReadings($: cheerio.CheerioAPI) {
  $("ruby").each((_, element) => {
    const ruby = $(element);
    const reading = ruby
      .find("rt")
      .map((__, rt) => $(rt).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean)
      .join("");
    ruby.find("rt, rp").remove();
    const base = ruby.text().replace(/\s+/g, " ").trim();
    ruby.replaceWith(reading && base ? `${base}（${reading}）` : base || reading);
  });
}
