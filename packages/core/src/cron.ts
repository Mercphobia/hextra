import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./config.js";

export interface CronJob {
  id: string;
  prompt: string;
  everyMinutes?: number;
  at?: string;
  lastRun?: string;
  created: string;
}

function path(): string {
  mkdirSync(configDir(), { recursive: true });
  return join(configDir(), "cron.json");
}

export function loadJobs(): CronJob[] {
  try {
    if (existsSync(path())) return JSON.parse(readFileSync(path(), "utf8")) as CronJob[];
  } catch { /* start empty */ }
  return [];
}

export function saveJobs(jobs: CronJob[]): void {
  writeFileSync(path(), JSON.stringify(jobs, null, 2));
}

export function addJob(prompt: string, opts: { everyMinutes?: number; at?: string }): CronJob {
  if (!opts.everyMinutes && !opts.at) throw new Error("cron needs --every <minutes> or --at HH:MM");
  if (opts.at && !/^\d{2}:\d{2}$/.test(opts.at)) throw new Error("bad --at format, want HH:MM");
  const job: CronJob = {
    id: Date.now().toString(36),
    prompt,
    ...opts,
    created: new Date().toISOString(),
  };
  const jobs = loadJobs();
  jobs.push(job);
  saveJobs(jobs);
  return job;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Jobs due at `now`: interval elapsed, or daily time reached and not yet run today. */
export function dueJobs(now = new Date()): CronJob[] {
  return loadJobs().filter((j) => {
    const last = j.lastRun ? new Date(j.lastRun) : null;
    if (j.everyMinutes) {
      if (!last) return true;
      return now.getTime() - last.getTime() >= j.everyMinutes * 60_000;
    }
    if (j.at) {
      const [h, m] = j.at.split(":").map(Number);
      const target = new Date(now);
      target.setHours(h, m, 0, 0);
      if (now < target) return false;
      if (last && sameDay(last, now) && last >= target) return false;
      return true;
    }
    return false;
  });
}

export function markRun(id: string, now = new Date()): void {
  const jobs = loadJobs().map((j) => (j.id === id ? { ...j, lastRun: now.toISOString() } : j));
  saveJobs(jobs);
}
