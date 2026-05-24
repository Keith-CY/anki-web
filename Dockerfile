FROM oven/bun:1.1.8 AS deps
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/package.json /app/package.json
COPY --from=deps /app/bun.lockb* /app/
RUN npm rebuild better-sqlite3 --build-from-source
COPY . .
RUN node ./node_modules/typescript/lib/tsc.js --noEmit \
  && node ./node_modules/vite/bin/vite.js build \
  && node ./node_modules/esbuild/bin/esbuild src/server/index.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/server/index.js

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]
