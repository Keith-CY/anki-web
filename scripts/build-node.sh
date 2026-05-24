#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

node ./node_modules/typescript/lib/tsc.js --noEmit
node ./node_modules/vite/bin/vite.js build
node ./node_modules/esbuild/bin/esbuild src/server/index.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/server/index.js
