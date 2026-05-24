#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

HOST_PORT="${HOST_PORT:-33101}"
HOST="${HOST:-127.0.0.1}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-smoke-password}"
SESSION_SECRET="${SESSION_SECRET:-smoke-session-secret-change-me-$(date +%s)}"
WORK_DIR="$(mktemp -d)"
DATA_DIR="$WORK_DIR/data"
DATABASE_URL="$DATA_DIR/anki-web.db"
FIXTURE_PATH="$WORK_DIR/japanese-smoke.apkg"
COOKIE_JAR="$WORK_DIR/cookies.txt"
EXPORT_PATH="$WORK_DIR/exported-smoke.apkg"
GENERATED_EXPORT_PATH="$WORK_DIR/exported-generated.apkg"
SERVER_LOG="$WORK_DIR/server.log"
BASE_URL="http://127.0.0.1:${HOST_PORT}"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

json_field() {
  node -e "const data = JSON.parse(process.argv[1]); const value = ${2}; if (!value) process.exit(1); console.log(value)" "$1"
}

mkdir -p "$DATA_DIR"
node scripts/create-smoke-apkg.mjs "$FIXTURE_PATH" >/dev/null

NODE_ENV=production \
PORT="$HOST_PORT" \
HOST="$HOST" \
DATA_DIR="$DATA_DIR" \
DATABASE_URL="$DATABASE_URL" \
APP_PASSWORD="$SMOKE_PASSWORD" \
SESSION_SECRET="$SESSION_SECRET" \
node dist/server/index.js >"$SERVER_LOG" 2>&1 &
SERVER_PID="$!"

ready=false
for _ in $(seq 1 60); do
  if curl -fsS "$BASE_URL/health" >/dev/null; then
    ready=true
    break
  fi
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    cat "$SERVER_LOG" >&2 || true
    echo "Local server exited before /health passed" >&2
    exit 1
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  cat "$SERVER_LOG" >&2 || true
  echo "Local server did not pass /health" >&2
  exit 1
fi

LOGIN_JSON="$(curl -fsS -c "$COOKIE_JAR" -H "content-type: application/json" -d "{\"password\":\"${SMOKE_PASSWORD}\"}" "$BASE_URL/api/session/login")"
CSRF_TOKEN="$(json_field "$LOGIN_JSON" "data.csrfToken")"

curl -fsS \
  -b "$COOKIE_JAR" \
  -H "x-csrf-token: ${CSRF_TOKEN}" \
  -F "includeScheduling=false" \
  -F "file=@${FIXTURE_PATH};type=application/vnd.anki.package" \
  "$BASE_URL/api/imports/apkg-file" >/dev/null

DECKS_JSON="$(curl -fsS -b "$COOKIE_JAR" "$BASE_URL/api/decks")"
DECK_ID="$(
  node -e "const data = JSON.parse(process.argv[1]); const deck = data.decks.find((entry) => entry.name === 'Smoke Japanese'); if (!deck) process.exit(1); console.log(deck.id)" "$DECKS_JSON"
)"

NEXT_JSON="$(curl -fsS -b "$COOKIE_JAR" "$BASE_URL/api/review/next?deckId=${DECK_ID}")"
CARD_ID="$(json_field "$NEXT_JSON" "data.card && data.card.id")"

curl -fsS \
  -b "$COOKIE_JAR" \
  -H "content-type: application/json" \
  -H "x-csrf-token: ${CSRF_TOKEN}" \
  -d '{"rating":"Good","elapsedMs":1000}' \
  "$BASE_URL/api/review/${CARD_ID}/answer" >/dev/null

curl -fsS \
  -b "$COOKIE_JAR" \
  -H "content-type: application/json" \
  -H "x-csrf-token: ${CSRF_TOKEN}" \
  -d '{"includeMedia":true,"includeScheduling":false,"legacySupport":true}' \
  "$BASE_URL/api/decks/${DECK_ID}/export" \
  -o "$EXPORT_PATH"

test -s "$EXPORT_PATH"

STUDY_TEXT="今日は学校で新しい文法を勉強しました。先生と一緒に語彙、発音、例文を確認して、あとで日本語の会話を練習しました。"
GENERATION_PAYLOAD="$(
  STUDY_TEXT="$STUDY_TEXT" node -e 'console.log(JSON.stringify({ title: "Smoke Study Notes", text: process.env.STUDY_TEXT, jlptLevel: "N4" }))'
)"
GENERATION_JSON="$(curl -fsS \
  -b "$COOKIE_JAR" \
  -H "content-type: application/json" \
  -H "x-csrf-token: ${CSRF_TOKEN}" \
  -d "$GENERATION_PAYLOAD" \
  "$BASE_URL/api/generation/from-text")"
SOURCE_ID="$(json_field "$GENERATION_JSON" "data.sourceId")"
DRAFT_IDS="$(
  node -e 'const data = JSON.parse(process.argv[1]); const ids = data.drafts.map((draft) => draft.id); if (ids.length < 3) process.exit(1); console.log(JSON.stringify(ids))' "$GENERATION_JSON"
)"
APPROVAL_PAYLOAD="$(
  DRAFT_IDS="$DRAFT_IDS" node -e 'console.log(JSON.stringify({ ids: JSON.parse(process.env.DRAFT_IDS) }))'
)"
APPROVAL_JSON="$(curl -fsS \
  -b "$COOKIE_JAR" \
  -H "content-type: application/json" \
  -H "x-csrf-token: ${CSRF_TOKEN}" \
  -d "$APPROVAL_PAYLOAD" \
  "$BASE_URL/api/drafts/approve-bulk")"
node -e 'const data = JSON.parse(process.argv[1]); if (data.approved < 3 || data.cardsCreated < 3) process.exit(1)' "$APPROVAL_JSON"

curl -fsS \
  -b "$COOKIE_JAR" \
  -H "content-type: application/json" \
  -H "x-csrf-token: ${CSRF_TOKEN}" \
  -d '{"includeMedia":true,"includeScheduling":false,"legacySupport":true}' \
  "$BASE_URL/api/sources/${SOURCE_ID}/export" \
  -o "$GENERATED_EXPORT_PATH"

test -s "$GENERATED_EXPORT_PATH"
test -f "$DATABASE_URL"

echo "Local smoke passed: health, login, data persistence, fixture import, one review, deck export, study-material generation, draft approval, generated package export."
