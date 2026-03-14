// ---------------------------------------------------------------------------
// IdleScheduler — Cooperative background task scheduler (P2-A)
// ---------------------------------------------------------------------------
//
// Drives background Daydreamer operations without blocking the main thread.
// Uses requestIdleCallback in browsers and setImmediate in Node/test envs.
// Tasks are prioritised by a numeric priority field (lower = higher priority).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single schedulable background task. */
export interface ScheduledTask {
  /** Lower number = higher priority. Tasks with equal priority run FIFO. */
  priority: number;
  /** The work to perform. May be called multiple times if it re-enqueues itself. */
  run(): Promise<void>;
}

/** Internal queue entry. */
interface QueueEntry {
  insertionOrder: number;
  task: ScheduledTask;
}

// ---------------------------------------------------------------------------
// Idle callback shim
// ---------------------------------------------------------------------------

/** Minimum time (ms) the scheduler will attempt to do work per idle slice. */
const DEFAULT_BUDGET_MS = 5;

/**
 * Schedule a callback for when the host is idle.
 * Falls back to setImmediate (Node) or setTimeout(0) when
 * requestIdleCallback is not available.
 */
function scheduleIdle(callback: (deadline: { timeRemaining(): number }) => void): void {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback((deadline) => callback(deadline));
  } else if (typeof setImmediate === "function") {
    setImmediate(() => callback({ timeRemaining: () => DEFAULT_BUDGET_MS }));
  } else {
    setTimeout(() => callback({ timeRemaining: () => DEFAULT_BUDGET_MS }), 0);
  }
}

// ---------------------------------------------------------------------------
// IdleScheduler
// ---------------------------------------------------------------------------

/**
 * Cooperative background task scheduler.
 *
 * Tasks are run one at a time during idle slices. Each task is given a single
 * idle deadline per scheduling turn; if the deadline expires the scheduler
 * yields and resumes on the next idle callback.
 *
 * State corruption is prevented by never interrupting a task mid-execution —
 * each `task.run()` call is awaited to completion before the next task starts.
 */
export class IdleScheduler {
  private queue: QueueEntry[] = [];
  private counter = 0;
  private active = false;
  private stopped = false;
  private readonly budgetMs: number;
  private readonly errorHandler: (error: unknown, task: ScheduledTask) => void;

  /**
   * @param budgetMs  Approximate milliseconds of work per idle slice.
   *                  Defaults to 5 ms. The scheduler yields after this
   *                  budget is consumed even if the queue is non-empty.
   * @param onError   Optional error handler invoked when a task throws.
   *                  Defaults to logging to console.error (if available).
   */
  constructor(
    budgetMs = DEFAULT_BUDGET_MS,
    onError?: (error: unknown, task: ScheduledTask) => void,
  ) {
    this.budgetMs = budgetMs;
    this.errorHandler =
      onError ??
      ((error: unknown, task: ScheduledTask): void => {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("[IdleScheduler] Task failed", { error, task });
        }
      });
  }

  /**
   * Enqueue a task. The task will be run in priority order (ascending
   * priority value) during the next idle callback. Enqueueing while
   * the scheduler is running is safe — the task will be picked up on
   * the next scheduling turn.
   */
  enqueue(task: ScheduledTask): void {
    this.queue.push({ insertionOrder: this.counter++, task });
    this._sortQueue();
  }

  /**
   * Start the idle loop. Safe to call multiple times — extra calls are no-ops
   * if the loop is already running.
   */
  start(): void {
    if (this.active || this.stopped) return;
    this.active = true;
    this._scheduleNextTurn();
  }

  /**
   * Permanently stop the scheduler. After calling `stop()` no further tasks
   * will be executed and `start()` becomes a no-op. Tasks already in-flight
   * will complete normally.
   */
  stop(): void {
    this.stopped = true;
    this.active = false;
  }

  /** True when the task queue is empty. */
  get idle(): boolean {
    return this.queue.length === 0;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private _sortQueue(): void {
    this.queue.sort(
      (a, b) =>
        a.task.priority - b.task.priority ||
        a.insertionOrder - b.insertionOrder,
    );
  }

  private _scheduleNextTurn(): void {
    if (this.stopped) return;
    scheduleIdle((deadline) => {
      void this._runTurn(deadline);
    });
  }

  private async _runTurn(deadline: { timeRemaining(): number }): Promise<void> {
    if (this.stopped) return;

    const turnEnd = Date.now() + Math.max(deadline.timeRemaining(), this.budgetMs);

    while (this.queue.length > 0 && Date.now() < turnEnd && !this.stopped) {
      const entry = this.queue.shift();
      if (!entry) break;
      try {
        await entry.task.run();
      } catch (error) {
        // Report errors so failing tasks can be diagnosed, but do not
        // allow a single bad task to crash the idle loop.
        this.errorHandler(error, entry.task);
      }
    }

    if (!this.stopped && this.queue.length > 0) {
      // More work remains — schedule another turn.
      this._scheduleNextTurn();
    } else {
      this.active = this.queue.length > 0;
    }
  }
}
