import type Database from "better-sqlite3";
import type { AppServices } from "../types";
import { id, nowIso, parseJson } from "../utils/id";

type JobStatus = "queued" | "running" | "completed" | "failed";

export interface CreateJobInput {
  type: string;
  payload?: Record<string, unknown>;
  status?: JobStatus;
}

export function createJob(services: AppServices, input: CreateJobInput) {
  const now = nowIso();
  const jobId = id("job");
  services.db
    .prepare(
      `INSERT INTO jobs (id, type, status, payload_json, result_json, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`
    )
    .run(jobId, input.type, input.status ?? "running", JSON.stringify(input.payload ?? {}), now, now);
  return jobId;
}

export function completeJob(services: AppServices, jobId: string, result?: Record<string, unknown>) {
  services.db
    .prepare("UPDATE jobs SET status = 'completed', result_json = ?, error = NULL, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(result ?? {}), nowIso(), jobId);
}

export function failJob(services: AppServices, jobId: string, error: unknown) {
  services.db
    .prepare("UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
    .run(error instanceof Error ? error.message : String(error), nowIso(), jobId);
}

export function listJobs(db: Database.Database, limit = 50) {
  return db
    .prepare("SELECT * FROM jobs ORDER BY updated_at DESC LIMIT ?")
    .all(limit)
    .map(jobDto);
}

export function getJob(db: Database.Database, jobId: string) {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
  return row ? jobDto(row) : null;
}

function jobDto(row: any) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    payload: parseJson(row.payload_json, {}),
    result: row.result_json ? parseJson(row.result_json, {}) : null,
    error: row.error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
