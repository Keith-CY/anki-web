import { describe, expect, test } from "vitest";
import { applyReviewAnswer, buildInitialSchedulingState } from "../src/server/review/scheduler";

describe("FSRS review scheduler", () => {
  test("graduates a new card into a scheduled review when answered Good", () => {
    const now = new Date("2026-05-17T12:00:00.000Z");
    const result = applyReviewAnswer(buildInitialSchedulingState(now), "Good", now);

    expect(result.state).toBe("review");
    expect(result.dueAt.getTime()).toBeGreaterThan(now.getTime());
    expect(result.reps).toBe(1);
    expect(result.stability).toBeGreaterThan(0);
    expect(result.difficulty).toBeGreaterThan(0);
  });

  test("keeps a forgotten card in relearning with a near due time", () => {
    const now = new Date("2026-05-17T12:00:00.000Z");
    const prior = applyReviewAnswer(buildInitialSchedulingState(now), "Good", now);
    const lapse = applyReviewAnswer(prior, "Again", new Date("2026-05-20T12:00:00.000Z"));

    expect(lapse.state).toBe("relearning");
    expect(lapse.lapses).toBe(1);
    expect(lapse.dueAt.getTime()).toBeGreaterThan(new Date("2026-05-20T12:00:00.000Z").getTime());
  });

  test("uses deck retention to tune review intervals", () => {
    const firstReviewAt = new Date("2026-05-17T12:00:00.000Z");
    const secondReviewAt = new Date("2026-05-27T12:00:00.000Z");
    const prior = applyReviewAnswer(buildInitialSchedulingState(firstReviewAt), "Good", firstReviewAt);

    const lowerRetention = applyReviewAnswer(prior, "Good", secondReviewAt, { requestRetention: 0.7 });
    const higherRetention = applyReviewAnswer(prior, "Good", secondReviewAt, { requestRetention: 0.95 });

    expect(lowerRetention.scheduledDays).toBeGreaterThan(higherRetention.scheduledDays);
  });
});
