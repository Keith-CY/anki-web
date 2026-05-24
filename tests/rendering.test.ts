import { describe, expect, test } from "vitest";
import { renderCardTemplate } from "../src/server/cards/rendering";

describe("card template rendering", () => {
  test("renders Anki-style fields and simple conditionals", () => {
    const html = renderCardTemplate(
      "{{Expression}}<br>{{#PitchAccent}}<span>{{PitchAccent}}</span>{{/PitchAccent}}{{^Audio}}no audio{{/Audio}}",
      {
        Expression: "勉強する",
        PitchAccent: "べんきょうする [0]",
        Audio: ""
      }
    );

    expect(html).toContain("勉強する");
    expect(html).toContain("べんきょうする [0]");
    expect(html).toContain("no audio");
  });

  test("renders Anki sound markers as playable audio", () => {
    const html = renderCardTemplate("{{Audio}}", {
      Audio: "[sound:hatsuon.mp3]"
    });

    expect(html).toContain('<audio controls src="/media/hatsuon.mp3"></audio>');
  });

  test("rewrites imported Anki image media to authenticated media URLs", () => {
    const html = renderCardTemplate('<div>{{Expression}}</div><img src="pitch chart 1.png"><img src="https://example.com/remote.png">', {
      Expression: "発音"
    });

    expect(html).toContain('<img src="/media/pitch%20chart%201.png">');
    expect(html).toContain('<img src="https://example.com/remote.png">');
  });

  test("sanitizes dangerous HTML while preserving normal Anki formatting", () => {
    const html = renderCardTemplate(
      '<section onclick="alert(1)">{{Expression}}</section><script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="https://example.com">ok</a><img src="pitch.png" onerror="alert(1)">',
      { Expression: '<b>発音</b>' }
    );

    expect(html).toContain("<b>発音</b>");
    expect(html).toContain('<a href="https://example.com">ok</a>');
    expect(html).toContain('<img src="/media/pitch.png">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });

  test("removes unquoted and entity-encoded dangerous media URLs", () => {
    const html = renderCardTemplate(
      '<a href=javascript:alert(1)>bad</a><a href="java&#x73;cript:alert(1)">encoded</a><img src=javascript:alert(1)><img src="data:text/html,<script>alert(1)</script>">',
      {}
    );

    expect(html).toContain(">bad</a>");
    expect(html).toContain(">encoded</a>");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("src=");
    expect(html.toLowerCase()).not.toContain("javascript:");
    expect(html.toLowerCase()).not.toContain("data:text/html");
  });

  test("renders Anki cloze fields for question and answer sides", () => {
    const fields = {
      Text: "今日は{{c1::学校}}で{{c2::勉強}}します。"
    };

    const question = renderCardTemplate("{{cloze:Text}}", fields, "", { clozeOrdinal: 0, clozeMode: "question" });
    const answer = renderCardTemplate("{{cloze:Text}}", fields, "", { clozeOrdinal: 0, clozeMode: "answer" });

    expect(question).toContain("[...]");
    expect(question).toContain("勉強");
    expect(question).not.toContain("学校");
    expect(answer).toContain("学校");
    expect(answer).toContain("勉強");
    expect(answer).not.toContain("{{c1::");
  });
});
