# Anki Web

A single-user, self-hosted web Anki workspace focused on Japanese study.

## Features

- Password-protected private instance
- Study-first mobile UI and desktop management views
- SQLite data under `/data` for Coolify/Docker persistence
- `.apkg` URL import, `.colpkg`/modern compressed collection import, and deck export
- FSRS-first review scheduling
- Japanese vocabulary, grammar, pronunciation, trilingual explanation, and pitch-accent draft fields
- Public article URL, uploaded `.txt`/`.md`/`.html`/`.csv`/`.tsv`/`.docx`/`.zip` bundles, and pasted study-note ingestion with OpenAI-compatible structured draft generation

## Local Development

```bash
bun install
bun run dev
```

The server listens on `http://localhost:3000`. Build the client with:

```bash
bun run build
```

If Bun's script runner is unavailable in the local shell, use the direct Node build path:

```bash
bun run build:node
# or
bash scripts/build-node.sh
```

To run a local end-to-end smoke check without Docker:

```bash
bun run smoke:local
```

If Bun's package script runner is unavailable in the local shell, run the same smoke script directly after building:

```bash
bash scripts/smoke-local.sh
```

This starts the bundled server on a temporary port with a temporary data directory, verifies login, imports a generated
Japanese `.apkg` package, completes one review, exports the deck, and shuts the server down.

The project uses Bun for dependency management. The server is bundled and run on Node in production because the SQLite and Argon2 native modules are more reliable there.
Local server commands require Node 22 or newer for Anki package compression support.

## Coolify

Use the included `Dockerfile`, expose port `3000`, and mount persistent storage to `/data`. The container defines a Docker
health check against `GET /health`, which should return `{"ok":true}` when the app is ready.

When Docker is available locally, run the deployment smoke check with:

```bash
bun run smoke:coolify
```

If Docker is not running, use the local smoke check first:

```bash
bash scripts/smoke-local.sh
```

The smoke check builds the image, runs it with a temporary `/data` volume, verifies `/health`, logs in with a throwaway
password, imports a generated Japanese `.apkg` fixture, completes one review, exports the imported deck, and confirms the
SQLite database was written under the mounted data directory.

Required production secrets:

- `APP_PASSWORD` or `APP_PASSWORD_HASH`
- `SESSION_SECRET` with at least 32 characters

To avoid storing the cleartext instance password in Coolify, generate an Argon2id hash locally and set `APP_PASSWORD_HASH`:

```bash
bun src/server/hash-password.ts "your long private password"
```

Optional AI settings:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_TEXT_MODEL`
- `OPENAI_TTS_MODEL`
- `OPENAI_TTS_VOICE`
- `PITCH_ACCENT_LEXICON_SOURCE` to mark generated lexicon pitch accent as confirmed

AnkiWeb sync is intentionally not implemented. Use packaged deck import/export for exchange with the Anki ecosystem.
