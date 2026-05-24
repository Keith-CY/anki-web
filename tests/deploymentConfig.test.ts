import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("deployment configuration", () => {
  test("defines Coolify-friendly persistence and health checks", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const readme = readFileSync("README.md", "utf8");
    const serverEntry = readFileSync("src/server/index.ts", "utf8");

    expect(dockerfile).toContain('ENV DATA_DIR=/data');
    expect(dockerfile).toContain('VOLUME ["/data"]');
    expect(dockerfile).toMatch(/HEALTHCHECK[\s\S]*\/health/);
    expect(dockerfile).toMatch(/EXPOSE 3000/);
    expect(readme).toContain("/health");
    expect(readme).toContain("/data");
    expect(serverEntry).toContain("process.env.HOST");
    expect(serverEntry).toContain("hostname: host");
  });

  test("keeps the deployment environment example committable", () => {
    const envExample = readFileSync(".env.example", "utf8");
    const gitignore = readFileSync(".gitignore", "utf8");
    const appSource = readFileSync("src/client/App.tsx", "utf8");

    expect(envExample).toContain("APP_PASSWORD=");
    expect(envExample).toContain("APP_PASSWORD_HASH=");
    expect(envExample).toContain("SESSION_SECRET=change-me-to-a-long-random-string-32chars-min");
    expect(envExample).toContain("DATA_DIR=/data");
    expect(envExample).toContain("PITCH_ACCENT_LEXICON_SOURCE=");
    expect(appSource.includes("SESSION_SECRET</code> with at least 32 characters")).toBe(true);
    expect(gitignore).toMatch(/^!.env\.example$/m);
  });

  test("uses Bun for dependency install and Node 22 for deterministic Coolify builds", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");

    expect(dockerfile).toContain("FROM oven/bun:");
    expect(dockerfile).toContain("RUN bun install --frozen-lockfile");
    expect(dockerfile).toContain("FROM node:22-slim AS build");
    expect(dockerfile).toContain("COPY --from=deps /app/node_modules /app/node_modules");
    expect(dockerfile).toContain("node ./node_modules/typescript/lib/tsc.js --noEmit");
    expect(dockerfile).toContain("node ./node_modules/vite/bin/vite.js build");
    expect(dockerfile).toContain("node ./node_modules/esbuild/bin/esbuild");
  });

  test("builds native SQLite dependencies for the final Node runtime", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");

    expect(dockerfile).toContain("bun install --frozen-lockfile --ignore-scripts");
    expect(dockerfile).toContain("apt-get install -y --no-install-recommends python3 make g++");
    expect(dockerfile).toContain("npm rebuild better-sqlite3 --build-from-source");
    expect(dockerfile.indexOf("npm rebuild better-sqlite3 --build-from-source")).toBeGreaterThan(
      dockerfile.indexOf("FROM node:22-slim AS build")
    );
    expect(dockerfile.indexOf("npm rebuild better-sqlite3 --build-from-source")).toBeLessThan(
      dockerfile.indexOf("FROM node:22-slim AS runtime")
    );
  });

  test("documents a direct Node build path for shells where Bun script execution is unavailable", () => {
    const script = readFileSync("scripts/build-node.sh", "utf8");
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    const readme = readFileSync("README.md", "utf8");

    expect(packageJson.scripts["build:node"]).toBe("bash scripts/build-node.sh");
    expect(script).toContain("node ./node_modules/typescript/lib/tsc.js --noEmit");
    expect(script).toContain("node ./node_modules/vite/bin/vite.js build");
    expect(script).toContain("node ./node_modules/esbuild/bin/esbuild");
    expect(readme).toContain("bun run build:node");
    expect(readme).toContain("bash scripts/build-node.sh");
  });

  test("provides a repeatable Docker smoke check for Coolify deployment readiness", () => {
    const script = readFileSync("scripts/smoke-coolify.sh", "utf8");
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    const readme = readFileSync("README.md", "utf8");

    expect(packageJson.scripts["smoke:coolify"]).toBe("bash scripts/smoke-coolify.sh");
    expect(script).toContain("docker info");
    expect(script).toContain("Docker daemon is not available");
    expect(script).toContain("docker build");
    expect(script).toContain("docker run");
    expect(script).toContain("APP_PASSWORD");
    expect(script).toContain("SESSION_SECRET");
    expect(script).toContain("/data");
    expect(script).toContain("/health");
    expect(script).toContain("/api/session/login");
    expect(script).toContain("/api/imports/apkg-file");
    expect(script).toContain("/api/review/next");
    expect(script).toContain("/api/decks/");
    expect(readme).toContain("bun run smoke:coolify");
    expect(readme).toContain("If Docker is not running, use the local smoke check first");
  });

  test("keeps the Docker smoke check from writing Docker metadata under the user home", () => {
    const script = readFileSync("scripts/smoke-coolify.sh", "utf8");

    expect(script).toContain('DOCKER_CONFIG="${DOCKER_CONFIG:-$WORK_DIR/docker-config}"');
    expect(script).toContain("export DOCKER_CONFIG");
    expect(script).toContain('mkdir -p "$DATA_DIR" "$DOCKER_CONFIG"');
  });

  test("preserves the active Docker endpoint before isolating smoke metadata", () => {
    const script = readFileSync("scripts/smoke-coolify.sh", "utf8");

    expect(script).toContain("DOCKER_CONTEXT_HOST");
    expect(script).toContain("docker context inspect");
    expect(script).toContain('export DOCKER_HOST="$DOCKER_CONTEXT_HOST"');
    expect(script.indexOf("docker context inspect")).toBeLessThan(script.indexOf('DOCKER_CONFIG="${DOCKER_CONFIG:-$WORK_DIR/docker-config}"'));
    expect(script.indexOf('export DOCKER_HOST="$DOCKER_CONTEXT_HOST"')).toBeGreaterThan(script.indexOf("export DOCKER_CONFIG"));
  });

  test("creates the temporary Docker config directory before checking Docker availability", () => {
    const script = readFileSync("scripts/smoke-coolify.sh", "utf8");

    const lines = script.split("\n").map((line) => line.trim());
    expect(lines.indexOf('mkdir -p "$DATA_DIR" "$DOCKER_CONFIG"')).toBeLessThan(lines.indexOf("require_docker"));
  });

  test("provides a local end-to-end smoke check when Docker is unavailable", () => {
    const script = readFileSync("scripts/smoke-local.sh", "utf8");
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    const readme = readFileSync("README.md", "utf8");

    expect(packageJson.scripts["smoke:local"]).toBe("bun run build && bash scripts/smoke-local.sh");
    expect(script).toContain("node dist/server/index.js");
    expect(script).toContain('HOST="${HOST:-127.0.0.1}"');
    expect(script).toContain('HOST="$HOST"');
    expect(script).toContain("PORT");
    expect(script).toContain("DATA_DIR");
    expect(script).toContain("/health");
    expect(script).toContain("/api/session/login");
    expect(script).toContain("/api/imports/apkg-file");
    expect(script).toContain("/api/review/next");
    expect(script).toContain("/api/decks/");
    expect(script).toContain("kill");
    expect(readme).toContain("bun run smoke:local");
    expect(readme).toContain("bash scripts/smoke-local.sh");
  });

  test("proves generated study material cards can be exported during smoke checks", () => {
    for (const scriptPath of ["scripts/smoke-local.sh", "scripts/smoke-coolify.sh"]) {
      const script = readFileSync(scriptPath, "utf8");

      expect(script).toContain("/api/generation/from-text");
      expect(script).toContain("/api/drafts/approve-bulk");
      expect(script).toContain("/api/sources/");
      expect(script).toContain("exported-generated.apkg");
    }
  });
});
