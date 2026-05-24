import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import JSZip from "jszip";

const outputPath = resolve(process.argv[2] ?? "japanese-smoke.apkg");
const tempDir = mkdtempSync(join(tmpdir(), "anki-smoke-apkg-"));

try {
  const collectionPath = join(tempDir, "collection.anki2");
  const db = new Database(collectionPath);
  db.exec(`
    CREATE TABLE col (
      id integer primary key, crt integer not null, mod integer not null, scm integer not null,
      ver integer not null, dty integer not null, usn integer not null, ls integer not null,
      conf text not null, models text not null, decks text not null, dconf text not null, tags text not null
    );
    CREATE TABLE notes (
      id integer primary key, guid text not null, mid integer not null, mod integer not null,
      usn integer not null, tags text not null, flds text not null, sfld integer not null,
      csum integer not null, flags integer not null, data text not null
    );
    CREATE TABLE cards (
      id integer primary key, nid integer not null, did integer not null, ord integer not null,
      mod integer not null, usn integer not null, type integer not null, queue integer not null,
      due integer not null, ivl integer not null, factor integer not null, reps integer not null,
      lapses integer not null, left integer not null, odue integer not null, odid integer not null,
      flags integer not null, data text not null
    );
    CREATE TABLE revlog (
      id integer primary key, cid integer not null, usn integer not null, ease integer not null,
      ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null,
      type integer not null
    );
    CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
  `);

  const modelId = 1779001000000;
  const deckId = 1779002000000;
  const noteId = 1779003000000;
  const cardId = 1779004000000;
  const now = 1779000000;
  const model = {
    [modelId]: {
      id: modelId,
      name: "Smoke Basic",
      type: 0,
      mod: now,
      usn: -1,
      sortf: 0,
      did: null,
      css: ".card { font-family: sans-serif; font-size: 22px; }",
      flds: [
        { name: "Front", ord: 0, sticky: false, rtl: false, font: "Arial", size: 24 },
        { name: "Back", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20 }
      ],
      tmpls: [{ name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr>{{Back}}", did: null, bqfmt: "", bafmt: "" }],
      latexPre: "",
      latexPost: "",
      req: [[0, "any", [0]]]
    }
  };
  const decks = {
    [deckId]: {
      id: deckId,
      name: "Smoke Japanese",
      mod: now,
      usn: -1,
      desc: "",
      dyn: 0,
      collapsed: false,
      extendNew: 0,
      extendRev: 0,
      conf: 1
    }
  };

  db.prepare(
    `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
     VALUES (1, ?, ?, ?, 11, 0, -1, 0, '{}', ?, ?, '{}', '{}')`
  ).run(now, now, now * 1000, JSON.stringify(model), JSON.stringify(decks));
  db.prepare(
    `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
     VALUES (?, 'smoke-japanese-guid', ?, ?, -1, ' smoke ', ?, '', 0, 0, '')`
  ).run(noteId, modelId, now, "復習\x1freview / 复习 / 前に学んだことをもう一度勉強すること");
  db.prepare(
    `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
     VALUES (?, ?, ?, 0, ?, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`
  ).run(cardId, noteId, deckId, now);
  db.close();

  const zip = new JSZip();
  zip.file("collection.anki2", readFileSync(collectionPath));
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  writeFileSync(outputPath, buffer);
  console.log(`Wrote ${basename(outputPath)} to ${dirname(outputPath)}`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
