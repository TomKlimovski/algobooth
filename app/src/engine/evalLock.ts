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
 * other deck must be able to evaluate meanwhile. A cancelled start is not an error. Resolves to whether
 * the code evaluated.
 */
export async function evaluateExclusive(
  repl: ExclusiveRepl,
  code: string,
  autostart: boolean,
  beforeAutostart?: () => Promise<unknown>,
): Promise<boolean> {
  const pattern = await withEvalLock(() => repl.evaluate(code, false));
  if (pattern === undefined) return false;
  if (autostart && !repl.scheduler.started) {
    await beforeAutostart?.();
    try {
      await repl.scheduler.start();
    } catch (e) {
      if (!(e instanceof StartCancelled)) throw e;
    }
  }
  return true;
}
