import { describe, expect, test } from "vitest";
import { makeTestServer } from "./helpers/server";

async function login(server: ReturnType<typeof makeTestServer>) {
  const response = await server.request("/api/session/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "secret" })
  });
  const cookie = response.headers.get("set-cookie") ?? "";
  const csrfToken = (await response.json()).csrfToken;
  return { cookie, csrfToken };
}

const sentenceMiningPayload = {
  name: "Sentence Mining",
  css: ".card { font-family: sans-serif; }",
  fields: ["Sentence", "Reading", "Meaning"],
  templates: [
    {
      name: "Read",
      questionFormat: "{{Sentence}}",
      answerFormat: "{{FrontSide}}<hr>{{Reading}}<br>{{Meaning}}"
    }
  ]
};

describe("note type management APIs", () => {
  test("creates updates and deletes unused custom note types", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);

    const createResponse = await server.request("/api/note-types", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify(sentenceMiningPayload)
    });

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    expect(created.noteType).toMatchObject({
      name: "Sentence Mining",
      hasCss: true,
      noteCount: 0,
      cardCount: 0
    });
    expect(created.noteType.fields.map((field: any) => field.name)).toEqual(["Sentence", "Reading", "Meaning"]);
    expect(created.noteType.templates.map((template: any) => template.name)).toEqual(["Read"]);

    const updateResponse = await server.request(`/api/note-types/${created.noteType.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({
        name: "Sentence Mining Plus",
        css: ".card { font-size: 20px; }",
        fields: ["Sentence", "Reading", "Meaning", "Source"],
        templates: [
          {
            name: "Read",
            questionFormat: "{{Sentence}}",
            answerFormat: "{{FrontSide}}<hr>{{Reading}}<br>{{Meaning}}"
          },
          {
            name: "Recall",
            questionFormat: "{{Meaning}}",
            answerFormat: "{{FrontSide}}<hr>{{Sentence}}"
          }
        ]
      })
    });

    expect(updateResponse.status).toBe(200);
    const updated = await updateResponse.json();
    expect(updated.noteType.name).toBe("Sentence Mining Plus");
    expect(updated.noteType.fields.map((field: any) => field.name)).toEqual(["Sentence", "Reading", "Meaning", "Source"]);
    expect(updated.noteType.templates.map((template: any) => template.name)).toEqual(["Read", "Recall"]);

    const deleteResponse = await server.request(`/api/note-types/${created.noteType.id}`, {
      method: "DELETE",
      headers: { cookie, "x-csrf-token": csrfToken }
    });

    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({ ok: true });

    const listResponse = await server.request("/api/note-types", { headers: { cookie } });
    const list = await listResponse.json();
    expect(list.noteTypes.map((noteType: any) => noteType.id)).not.toContain(created.noteType.id);
    expect(server.services.db.prepare("SELECT COUNT(*) AS count FROM note_fields WHERE note_type_id = ?").get(created.noteType.id)).toEqual({
      count: 0
    });
    expect(server.services.db.prepare("SELECT COUNT(*) AS count FROM card_templates WHERE note_type_id = ?").get(created.noteType.id)).toEqual({
      count: 0
    });
  });

  test("keeps built-in and used note types from destructive definition changes", async () => {
    const server = makeTestServer();
    const { cookie, csrfToken } = await login(server);

    const builtIn = (await (await server.request("/api/note-types", { headers: { cookie } })).json()).noteTypes[0];
    const builtInDelete = await server.request(`/api/note-types/${builtIn.id}`, {
      method: "DELETE",
      headers: { cookie, "x-csrf-token": csrfToken }
    });
    expect(builtInDelete.status).toBe(400);
    expect((await builtInDelete.json()).error).toMatch(/built-in/i);

    const createResponse = await server.request("/api/note-types", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify(sentenceMiningPayload)
    });
    const created = await createResponse.json();
    const deck = server.services.decks.createDeck({ name: "Custom Use", jlptLevel: "N4" });
    server.services.db
      .prepare(
        `INSERT INTO notes (id, anki_guid, note_type_id, deck_id, fields_json, tags_json, source_id, created_at, updated_at)
         VALUES ('note_custom_use', 'guid_custom_use', ?, ?, '{}', '[]', NULL, '2026-05-18T00:00:00.000Z', '2026-05-18T00:00:00.000Z')`
      )
      .run(created.noteType.id, deck.id);

    const fieldRewrite = await server.request(`/api/note-types/${created.noteType.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrfToken },
      body: JSON.stringify({ fields: ["Sentence"], templates: sentenceMiningPayload.templates })
    });
    expect(fieldRewrite.status).toBe(400);
    expect((await fieldRewrite.json()).error).toMatch(/existing notes/i);

    const deleteUsed = await server.request(`/api/note-types/${created.noteType.id}`, {
      method: "DELETE",
      headers: { cookie, "x-csrf-token": csrfToken }
    });
    expect(deleteUsed.status).toBe(400);
    expect((await deleteUsed.json()).error).toMatch(/existing notes/i);
  });
});
