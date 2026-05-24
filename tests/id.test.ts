import { afterEach, describe, expect, test, vi } from "vitest";
import { numericId } from "../src/server/utils/id";

describe("numeric Anki-compatible ids", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("stays unique when many ids are generated in the same millisecond", () => {
    vi.spyOn(Date, "now").mockReturnValue(1779000000000);
    vi.spyOn(Math, "random").mockReturnValue(0.123);

    const ids = Array.from({ length: 10 }, () => numericId());

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });
});
