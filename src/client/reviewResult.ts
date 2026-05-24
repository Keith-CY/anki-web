import type { ReviewAnswerPayload, ReviewRating } from "./api";

export function reviewElapsedMs(startedAt: number, answeredAt = performance.now()) {
  return Math.max(0, Math.min(600_000, Math.round(answeredAt - startedAt)));
}

export function reviewSchedulerSummary(result: Pick<ReviewAnswerPayload, "rating" | "scheduler">) {
  return `${result.rating} -> ${result.scheduler.state} ${formatInterval(result.scheduler.scheduledDays)}`;
}

export function reviewPreviewInterval(preview: Pick<ReviewAnswerPayload["scheduler"], "scheduledDays">) {
  return formatInterval(preview.scheduledDays);
}

export function reviewRatingButtonState(rating: ReviewRating, submittingRating: ReviewRating | null) {
  return {
    disabled: Boolean(submittingRating),
    busy: submittingRating === rating,
    label: submittingRating === rating ? `Saving ${rating}` : rating
  };
}

type KeyboardTarget = {
  tagName?: string;
  isContentEditable?: boolean;
};

export function reviewKeyboardAction(
  event: { key: string; target?: EventTarget | KeyboardTarget | null },
  showAnswer: boolean
): "show-answer" | ReviewRating | null {
  if (isEditableTarget(event.target)) return null;
  if (!showAnswer && (event.key === " " || event.key === "Enter")) return "show-answer";
  if (!showAnswer) return null;
  if (event.key === "1") return "Again";
  if (event.key === "2") return "Hard";
  if (event.key === "3") return "Good";
  if (event.key === "4") return "Easy";
  return null;
}

function isEditableTarget(target: EventTarget | KeyboardTarget | null | undefined) {
  if (!target) return false;
  const candidate = target as KeyboardTarget;
  if (candidate.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(String(candidate.tagName ?? "").toUpperCase());
}

function formatInterval(scheduledDays: number) {
  if (scheduledDays <= 0) return "today";
  if (scheduledDays === 1) return "tomorrow";
  return `in ${scheduledDays} days`;
}

export type { ReviewRating };
