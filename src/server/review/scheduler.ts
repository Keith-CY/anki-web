import { createEmptyCard, fsrs, Rating, State, type Card } from "ts-fsrs";
import type { CardState, ReviewRating } from "../types";

export interface SchedulingState {
  state: CardState;
  dueAt: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  lastReview?: Date | null;
}

export interface SchedulingOptions {
  requestRetention?: number | null;
}

const reviewRatings: ReviewRating[] = ["Again", "Hard", "Good", "Easy"];

export function buildInitialSchedulingState(now = new Date()): SchedulingState {
  const card = createEmptyCard(now);
  return fromFsrsCard(card);
}

export function applyReviewAnswer(
  state: SchedulingState,
  rating: ReviewRating,
  reviewedAt = new Date(),
  options: SchedulingOptions = {}
): SchedulingState {
  const result = createScheduler(options).next(toFsrsCard(state), reviewedAt, toFsrsRating(rating));
  return fromFsrsCard(result.card);
}

export function previewReviewAnswers(state: SchedulingState, reviewedAt = new Date(), options: SchedulingOptions = {}) {
  return Object.fromEntries(reviewRatings.map((rating) => [rating, applyReviewAnswer(state, rating, reviewedAt, options)])) as Record<
    ReviewRating,
    SchedulingState
  >;
}

export function stateToFsrsState(state: CardState): State {
  switch (state) {
    case "learning":
      return State.Learning;
    case "review":
      return State.Review;
    case "relearning":
      return State.Relearning;
    default:
      return State.New;
  }
}

export function fsrsStateToCardState(state: State): CardState {
  switch (state) {
    case State.Learning:
      return "learning";
    case State.Review:
      return "review";
    case State.Relearning:
      return "relearning";
    default:
      return "new";
  }
}

function toFsrsCard(state: SchedulingState): Card {
  return {
    due: state.dueAt,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsedDays,
    scheduled_days: state.scheduledDays,
    learning_steps: 0,
    reps: state.reps,
    lapses: state.lapses,
    state: stateToFsrsState(state.state),
    last_review: state.lastReview ?? undefined
  };
}

function fromFsrsCard(card: Card): SchedulingState {
  return {
    state: fsrsStateToCardState(card.state),
    dueAt: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.last_review ?? null
  };
}

function toFsrsRating(rating: ReviewRating) {
  switch (rating) {
    case "Again":
      return Rating.Again;
    case "Hard":
      return Rating.Hard;
    case "Easy":
      return Rating.Easy;
    default:
      return Rating.Good;
  }
}

function createScheduler(options: SchedulingOptions) {
  return fsrs({
    request_retention: normalizeRetention(options.requestRetention),
    maximum_interval: 36500,
    enable_fuzz: false,
    enable_short_term: true,
    learning_steps: [],
    relearning_steps: ["10m"]
  });
}

function normalizeRetention(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return 0.9;
  return Math.max(0.7, Math.min(0.99, Number(value)));
}
