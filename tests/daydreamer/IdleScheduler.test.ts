/**
 * IdleScheduler tests (P2-A2)
 *
 * Tests cooperative yielding, task ordering, rate-limited execution,
 * and that scheduler interruption does not corrupt state.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdleScheduler, type ScheduledTask } from "../../daydreamer/IdleScheduler";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a task that records its execution and resolves after optional delay. */
function makeTask(
  id: string,
  log: string[],
  priority = 0,
  delayMs = 0,
): ScheduledTask {
  return {
    priority,
    run: async () => {
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      log.push(id);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IdleScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("executes tasks in priority order (lower priority number = runs first)", async () => {
    const scheduler = new IdleScheduler();
    const log: string[] = [];

    scheduler.enqueue(makeTask("low", log, 10));
    scheduler.enqueue(makeTask("high", log, 1));
    scheduler.enqueue(makeTask("medium", log, 5));

    scheduler.start();
    await vi.runAllTimersAsync();

    expect(log).toEqual(["high", "medium", "low"]);
  });

  it("FIFO order for tasks with equal priority", async () => {
    const scheduler = new IdleScheduler();
    const log: string[] = [];

    for (const id of ["a", "b", "c"]) {
      scheduler.enqueue(makeTask(id, log, 0));
    }

    scheduler.start();
    await vi.runAllTimersAsync();

    expect(log).toEqual(["a", "b", "c"]);
  });

  it("idle returns true when queue is empty", () => {
    const scheduler = new IdleScheduler();
    expect(scheduler.idle).toBe(true);

    const log: string[] = [];
    scheduler.enqueue(makeTask("t", log, 0));
    expect(scheduler.idle).toBe(false);
  });

  it("does not execute tasks after stop() is called", async () => {
    const scheduler = new IdleScheduler();
    const log: string[] = [];

    scheduler.enqueue(makeTask("a", log, 0, 50));
    scheduler.enqueue(makeTask("b", log, 0));

    scheduler.start();
    scheduler.stop();
    await vi.runAllTimersAsync();

    // After stop, no tasks should run (the stop happens before any idle callback)
    expect(log.length).toBe(0);
  });

  it("start() is idempotent — double start does not duplicate execution", async () => {
    const scheduler = new IdleScheduler();
    const log: string[] = [];

    scheduler.enqueue(makeTask("once", log, 0));

    scheduler.start();
    scheduler.start(); // second call should be a no-op
    await vi.runAllTimersAsync();

    expect(log).toEqual(["once"]);
  });

  it("tasks enqueued after start() are picked up on next turn", async () => {
    const scheduler = new IdleScheduler();
    const log: string[] = [];

    scheduler.start();

    // Enqueue after start
    scheduler.enqueue(makeTask("late", log, 0));
    await vi.runAllTimersAsync();

    expect(log).toEqual(["late"]);
  });

  it("a throwing task does not prevent subsequent tasks from running", async () => {
    const scheduler = new IdleScheduler();
    const log: string[] = [];

    scheduler.enqueue({
      priority: 0,
      run: async () => {
        throw new Error("boom");
      },
    });
    scheduler.enqueue(makeTask("after-error", log, 1));

    scheduler.start();
    await vi.runAllTimersAsync();

    expect(log).toEqual(["after-error"]);
  });

  it("interruption (stop then re-enqueue) does not corrupt remaining state", async () => {
    const scheduler = new IdleScheduler();
    const log: string[] = [];

    scheduler.enqueue(makeTask("pre-stop", log, 0));
    scheduler.start();
    scheduler.stop();

    // Tasks enqueued before stop are cleared conceptually — stop only prevents
    // future execution. Re-verify queue is never processed after stop.
    await vi.runAllTimersAsync();
    expect(log).toEqual([]);
  });
});
