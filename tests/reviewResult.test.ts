import { describe, expect, test } from "vitest";
import {
  reviewElapsedMs,
  reviewKeyboardAction,
  reviewPreviewInterval,
  reviewRatingButtonState,
  reviewSchedulerSummary
} from "../src/client/reviewResult";

describe("review result helpers", () => {
  test("measures elapsed review time from the displayed card start", () => {
    expect(reviewElapsedMs(1_000, 3_750)).toBe(2_750);
  });

  test("clamps elapsed review time to the API accepted range", () => {
    expect(reviewElapsedMs(10_000, 8_000)).toBe(0);
    expect(reviewElapsedMs(0, 900_000)).toBe(600_000);
  });

  test("formats scheduler output for the study screen", () => {
    expect(
      reviewSchedulerSummary({
        rating: "Good",
        scheduler: {
          state: "review",
          dueAt: "2026-05-21T00:00:00.000Z",
          stability: 1.2,
          difficulty: 5.1,
          elapsedDays: 0,
          scheduledDays: 4,
          reps: 1,
          lapses: 0,
          lastReview: "2026-05-17T00:00:00.000Z"
        }
      })
    ).toBe("Good -> review in 4 days");

    expect(
      reviewSchedulerSummary({
        rating: "Again",
        scheduler: {
          state: "relearning",
          dueAt: "2026-05-17T00:10:00.000Z",
          stability: 0.1,
          difficulty: 8,
          elapsedDays: 0,
          scheduledDays: 0,
          reps: 3,
          lapses: 1,
          lastReview: "2026-05-17T00:00:00.000Z"
        }
      })
    ).toBe("Again -> relearning today");
  });

  test("formats answer preview intervals for rating buttons", () => {
    expect(reviewPreviewInterval({ scheduledDays: 0 })).toBe("today");
    expect(reviewPreviewInterval({ scheduledDays: 1 })).toBe("tomorrow");
    expect(reviewPreviewInterval({ scheduledDays: 12 })).toBe("in 12 days");
  });

  test("marks rating controls as busy while a review answer is being submitted", () => {
    expect(reviewRatingButtonState("Good", null)).toEqual({ disabled: false, busy: false, label: "Good" });
    expect(reviewRatingButtonState("Good", "Good")).toEqual({ disabled: true, busy: true, label: "Saving Good" });
    expect(reviewRatingButtonState("Again", "Good")).toEqual({ disabled: true, busy: false, label: "Again" });
  });

  test("maps review keyboard shortcuts without stealing input focus", () => {
    expect(reviewKeyboardAction({ key: " " }, false)).toBe("show-answer");
    expect(reviewKeyboardAction({ key: "Enter" }, false)).toBe("show-answer");
    expect(reviewKeyboardAction({ key: "1" }, true)).toBe("Again");
    expect(reviewKeyboardAction({ key: "2" }, true)).toBe("Hard");
    expect(reviewKeyboardAction({ key: "3" }, true)).toBe("Good");
    expect(reviewKeyboardAction({ key: "4" }, true)).toBe("Easy");
    expect(reviewKeyboardAction({ key: "3", target: { tagName: "INPUT" } }, true)).toBeNull();
    expect(reviewKeyboardAction({ key: " ", target: { isContentEditable: true } }, false)).toBeNull();
  });
});
