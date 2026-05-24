import { describe, expect, test } from "vitest";
import { activityBars, calendarCells, cardStateRows, emptyStatsPayload, ratingRows } from "../src/client/statsViewModel";

describe("stats view model", () => {
  test("formats card state, rating, and activity rows in stable dashboard order", () => {
    const stats = {
      ...emptyStatsPayload,
      cardStates: { review: 4, suspended: 1 },
      ratings: { Again: 2, Hard: 0, Good: 5, Easy: 1 },
      activity: [
        { date: "2026-05-12", reviews: 0 },
        { date: "2026-05-13", reviews: 5 },
        { date: "2026-05-14", reviews: 10 }
      ]
    };

    expect(cardStateRows(stats)).toEqual([
      { key: "new", label: "New", value: 0 },
      { key: "learning", label: "Learning", value: 0 },
      { key: "review", label: "Review", value: 4 },
      { key: "relearning", label: "Relearning", value: 0 },
      { key: "suspended", label: "Suspended", value: 1 }
    ]);
    expect(ratingRows(stats).map((row) => `${row.label}:${row.value}`)).toEqual([
      "Again:2",
      "Hard:0",
      "Good:5",
      "Easy:1"
    ]);
    expect(activityBars(stats)).toEqual([
      { date: "2026-05-12", label: "05-12", reviews: 0, percent: 0 },
      { date: "2026-05-13", label: "05-13", reviews: 5, percent: 50 },
      { date: "2026-05-14", label: "05-14", reviews: 10, percent: 100 }
    ]);
  });

  test("builds current-month calendar cells with intensity levels", () => {
    const cells = calendarCells({
      ...emptyStatsPayload,
      calendar: [
        { date: "2026-05-01", reviews: 0, elapsedMs: 0, ratings: { Again: 0, Hard: 0, Good: 0, Easy: 0 } },
        { date: "2026-05-02", reviews: 3, elapsedMs: 300_000, ratings: { Again: 1, Hard: 0, Good: 2, Easy: 0 } }
      ]
    });

    expect(cells).toEqual([
      { date: "2026-05-01", label: "1", reviews: 0, elapsedMinutes: 0, level: 0 },
      { date: "2026-05-02", label: "2", reviews: 3, elapsedMinutes: 5, level: 4 }
    ]);
  });
});
