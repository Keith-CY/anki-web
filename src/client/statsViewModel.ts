import type { StatsPayload } from "./api";

type RatingKey = "Again" | "Hard" | "Good" | "Easy";

export interface StatsMetricRow {
  key: string;
  label: string;
  value: number;
}

export interface ActivityBar {
  date: string;
  label: string;
  reviews: number;
  percent: number;
}

export interface CalendarCell {
  date: string;
  label: string;
  reviews: number;
  elapsedMinutes: number;
  level: number;
}

export const emptyStatsPayload: StatsPayload = {
  due: 0,
  cards: 0,
  reviews: 0,
  drafts: 0,
  daily: null,
  cardStates: {
    new: 0,
    learning: 0,
    review: 0,
    relearning: 0,
    suspended: 0
  },
  ratings: {
    Again: 0,
    Hard: 0,
    Good: 0,
    Easy: 0
  },
  activity: [],
  calendar: []
};

const cardStateSpec = [
  ["new", "New"],
  ["learning", "Learning"],
  ["review", "Review"],
  ["relearning", "Relearning"],
  ["suspended", "Suspended"]
] as const;

const ratingSpec: Array<[RatingKey, string]> = [
  ["Again", "Again"],
  ["Hard", "Hard"],
  ["Good", "Good"],
  ["Easy", "Easy"]
];

export function cardStateRows(stats: StatsPayload): StatsMetricRow[] {
  return cardStateSpec.map(([key, label]) => ({ key, label, value: stats.cardStates[key] ?? 0 }));
}

export function ratingRows(stats: StatsPayload): StatsMetricRow[] {
  return ratingSpec.map(([key, label]) => ({ key, label, value: stats.ratings[key] ?? 0 }));
}

export function activityBars(stats: StatsPayload): ActivityBar[] {
  const maxReviews = Math.max(1, ...stats.activity.map((day) => day.reviews));
  return stats.activity.map((day) => ({
    date: day.date,
    label: day.date.slice(5),
    reviews: day.reviews,
    percent: Math.round((day.reviews / maxReviews) * 100)
  }));
}

export function calendarCells(stats: StatsPayload): CalendarCell[] {
  const maxReviews = Math.max(1, ...stats.calendar.map((day) => day.reviews));
  return stats.calendar.map((day) => ({
    date: day.date,
    label: String(Number(day.date.slice(8, 10))),
    reviews: day.reviews,
    elapsedMinutes: Math.round(day.elapsedMs / 60_000),
    level: day.reviews === 0 ? 0 : Math.max(1, Math.ceil((day.reviews / maxReviews) * 4))
  }));
}
