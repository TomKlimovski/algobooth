/**
 * Strudel evaluations must not overlap. Each repl's `evaluate` first writes its own `setcpm`, `setcps`,
 * `hush`, `all`, `each`, `cpm` and `Pattern.prototype.p` (what `$:` uses) onto globals, then awaits before
 * running the code; two interleaved evaluations run one deck's code against the other deck's functions.
 */

let tail: Promise<unknown> = Promise.resolve();

/** Runs `fn` once every evaluation queued before it has settled; a failure does not block the next one. */
export function withEvalLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn);
  tail = run.catch(() => {});
  return run;
}

/** Rejects a start that sync held for the bar line and then dropped (the deck was stopped or replaced). */
export class StartCancelled extends Error {
  constructor() {
    super('start cancelled');
    this.name = 'StartCancelled';
  }
}

/** The slice of a Strudel repl that `evaluateExclusive` drives. */
export interface ExclusiveRepl {
  /** Resolves to the pattern, or undefined when the code failed (the repl reports that itself). */
  evaluate(code: string, autostart: boolean): Promise<unknown>;
  scheduler: { started: boolean; start(): Promise<void> };
}

/**
 * Evaluates `code` under the lock without starting, then starts the deck if `autostart` asks and it is
 * stopped. The start runs after the lock is released: sync may hold it until deck A's bar line, and the
 * other deck must be able to evaluate meanwhile. A cancelled start is not an error. `stillWanted` is
 * asked right before the start: a Stop pressed while the evaluation was queued or running must win, not
 * be undone a moment later by the start. Resolves to whether the code evaluated.
 */
export async function evaluateExclusive(
  repl: ExclusiveRepl,
  code: string,
  autostart: boolean,
  beforeAutostart?: () => Promise<unknown>,
  stillWanted: () => boolean = () => true,
): Promise<boolean> {
  const pattern = await withEvalLock(() => repl.evaluate(code, false));
  if (pattern === undefined) return false;
  if (autostart && !repl.scheduler.started && stillWanted()) {
    await beforeAutostart?.();
    if (!stillWanted()) return true;
    try {
      await repl.scheduler.start();
    } catch (e) {
      if (!(e instanceof StartCancelled)) throw e;
    }
  }
  return true;
}

// The audio graph and the Strudel scope are module singletons: a hot update would leave the
// old ones wired in while the UI drives new ones, so a change here reloads the whole page.
if (import.meta.hot) import.meta.hot.accept(() => import.meta.hot?.invalidate());
