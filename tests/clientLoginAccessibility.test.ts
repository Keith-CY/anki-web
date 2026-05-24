import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

describe("login view accessibility", () => {
  test("gives the private instance password field an accessible name", () => {
    const appSource = readFileSync(join(process.cwd(), "src/client/App.tsx"), "utf8");
    expect(appSource).toMatch(/<input[\s\S]*type="password"[\s\S]*aria-label="Instance password"/);
  });
});
