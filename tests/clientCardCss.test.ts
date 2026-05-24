import { describe, expect, test } from "vitest";
import { sanitizeNoteTypeCss } from "../src/client/cardCss";

describe("note type CSS rendering safety", () => {
  test("preserves ordinary card styling", () => {
    expect(sanitizeNoteTypeCss(".card { color: #123456; } .jp { font-size: 32px; }")).toBe(
      ".card { color: #123456; } .jp { font-size: 32px; }"
    );
  });

  test("removes external fetch and script-capable CSS constructs before rendering imported note CSS", () => {
    const css = [
      '@import url("https://attacker.example/style.css");',
      ".card { background-image: url(https://attacker.example/pixel); color: red; }",
      ".jp { behavior: url(/evil.htc); -moz-binding: url('https://attacker.example/xbl.xml#x'); }",
      ".answer { width: expression(alert(1)); }",
      ".safe { font-weight: 700; }"
    ].join("\n");

    const sanitized = sanitizeNoteTypeCss(css);

    expect(sanitized).toContain(".safe { font-weight: 700; }");
    expect(sanitized).toContain("color: red");
    expect(sanitized).not.toContain("@import");
    expect(sanitized).not.toContain("url(");
    expect(sanitized).not.toContain("expression(");
    expect(sanitized).not.toContain("behavior:");
    expect(sanitized).not.toContain("-moz-binding");
    expect(sanitized).not.toContain("attacker.example");
  });
});
