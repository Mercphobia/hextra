import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { addJob, dueJobs, markRun } from "./cron.js";

beforeEach(() => {
  process.env.HEXTRA_HOME = mkdtempSync(`${tmpdir()}/hextra-cron-`);
});

describe("cron", () => {
  it("requires a schedule", () => {
    assert.throws(() => addJob("hi", {}), /needs --every/);
  });

  it("interval job is due when never run, not due right after run", () => {
    const j = addJob("ping", { everyMinutes: 60 });
    assert.equal(dueJobs().length, 1);
    markRun(j.id);
    assert.equal(dueJobs().length, 0);
  });

  it("daily job is due after its time, once per day", () => {
    const j = addJob("report", { at: "00:01" });
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    assert.equal(dueJobs(noon).length, 1);
    markRun(j.id, noon);
    assert.equal(dueJobs(noon).length, 0);
    const next = new Date(noon.getTime() + 24 * 3600_000);
    assert.equal(dueJobs(next).length, 1);
  });
});
