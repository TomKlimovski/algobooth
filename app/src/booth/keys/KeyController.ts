import { createSignal, untrack } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { DEFAULT_CLOCK_DURATION, DEFAULT_MIN_LATENCY } from '../../engine/sync';
import type { BoothState } from '../boothState';
import type { DeckApi } from '../Deck';
import type { DeckId, DeckState } from '../deckState';
import {
  dropTarget,
  effectiveLayout,
  withCleared,
  withDrop,
  withHidden,
  withMoved,
  withSnapshot,
  type Binding,
  type Layout,
  type MethodPart,
  type Quantise,
  type Shown,
  type Slot,
  type SnapshotKey,
} from './bindings';
import { PressTracker } from './hold';
import { lineAt, lineLabels, patternLines, refindTarget, type PatternLine } from './lines';
import { applyEdits, flipMute, isOn, nudge, REFUSED_LINE, toggle, type Edit, type Outcome } from './press';
import { KeyQueue, type Job } from './quantise';

export interface ControllerDeps {
  decks: () => Record<DeckId, DeckApi | null>;
  deckState: Record<DeckId, DeckState>;
  /** The deck the letters play: the library's target. */
  performing: () => DeckId;
  setPerforming: (id: DeckId) => void;
  /** Holds the perform flag. */
  booth: BoothState;
  /** The settings' key layout, under every pattern's. */
  global: () => Layout;
  setGlobal: (l: Layout) => Promise<void>;
  quantise: () => Quantise;
  /** The Booth stays mounted behind other tabs; keys belong to it only while it shows. */
  boothShowing: () => boolean;
  /** Wall clock in ms, for tap-versus-hold and the countdown. */
  now?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export type ShownKey = Shown & { on: boolean; held: boolean; pending: boolean; refused: boolean };

/** A press that may still be waiting in the queue, so a release knows whether its revert must wait for it. */
interface Press {
  binding: Binding;
  ran: boolean;
  revert: boolean;
  /** Whether the key's effect was on after the press landed; null when it was refused (nothing to undo). */
  after: boolean | null;
  /** The queued toggle, so a cancel can take it back before it runs. */
  job: Job | null;
  /** The target line when the key went down, re-found against the code when the job (or its revert) runs. */
  target: Target;
}

/** A line as last known: re-found by label when it has one, else by number. */
type Target = { n: number; label: string | null };

/** A hold's revert, queued or waiting out its boundary; `handle` is the wait's timer, null once queued. */
interface Inverse { slot: string; job: Job; handle: ReturnType<typeof setTimeout> | null }

/** A flush's working copy: each job reads and replaces `code`, so later jobs see earlier ones. */
interface Work { code: string; refused: Set<string>; reasons: string[]; after: Inverse[] }

const DECK_IDS: DeckId[] = ['A', 'B'];
const other = (id: DeckId): DeckId => (id === 'A' ? 'B' : 'A');
/** How often the header's "next bar in N" recounts while something waits. */
const COUNTDOWN_MS = 100;
/** Past the boundary by this much before a deferred revert is queued, so it takes the following one. */
const REVERT_MARGIN_MS = 20;
const LETTER = /^Key[A-Z]$/;
const DIGIT = /^Digit([1-9])$/;
const FKEY = /^F[1-8]$/;

const none = (): Record<DeckId, ReadonlySet<string>> => ({ A: new Set(), B: new Set() });

/** One replacement for the span where `a` and `b` differ, so a flush is one small transaction. */
function diff(a: string, b: string): Edit {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { from: p, to: a.length - s, insert: b.slice(p, b.length - s) };
}

/**
 * The method keyboard for the whole booth: one keydown/keyup pair on the window, a quantised queue per deck,
 * and the strip's derived state. Every press is a job that re-derives its edit from the code as it stands when
 * the queue flushes, so presses never go stale and two of the same key in one window cancel to nothing.
 *
 * `shown` and `lines` read the deck stores' `liveCode`, `keys` and `targetLine` and this controller's
 * signals, so a caller's memo or JSX tracks them; the controller keeps no memo of its own (it may be created
 * outside a reactive owner, as tests do).
 */
export class KeyController {
  private readonly queues: Record<DeckId, KeyQueue>;
  private readonly trackers: Record<DeckId, PressTracker>;
  private readonly presses = new Map<string, Press>();
  /** The slot each queued job is for, so taking one back knows whether its key still has work pending. */
  private readonly jobSlots = new WeakMap<Job, string>();
  /** Letters held on the keyboard and the deck each went to, so a Tab mid-hold still releases the right one. */
  private readonly keyboard = new Map<string, DeckId>();
  /** The target as last found, label included, so a code change re-finds it by name. */
  private readonly prev: Record<DeckId, Target | null> = { A: null, B: null };
  /** Keyed by deck: the booth's store hands out a proxy of the api that `onReady` passes raw, so the object differs. */
  private readonly attached = new Map<DeckId, { deck: DeckApi; detach: () => void }>();
  /** Reverts not yet run, per deck, so a Stop can run them instead of discarding them with the queue. */
  private readonly inverses: Record<DeckId, Set<Inverse>> = { A: new Set(), B: new Set() };
  private readonly deferred = new Set<ReturnType<typeof setTimeout>>();
  private ticker: ReturnType<typeof setTimeout> | null = null;
  private work: Work | null = null;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly down = createSignal(none());
  private readonly pending = createSignal(none());
  private readonly refused = createSignal<Record<DeckId, { slots: ReadonlySet<string>; code: string; target: number | null } | null>>({
    A: null,
    B: null,
  });

  constructor(private readonly deps: ControllerDeps) {
    // Unbound and read at call time: window.setTimeout rejects another `this`, and fake timers replace the global.
    this.setTimer = deps.setTimer ?? (((f: () => void, ms?: number) => setTimeout(f, ms)) as typeof setTimeout);
    this.clearTimer = deps.clearTimer ?? ((h?: ReturnType<typeof setTimeout>) => clearTimeout(h));
    const now = deps.now ?? (() => Date.now());
    const queue = (id: DeckId) =>
      new KeyQueue(() => this.api(id), (jobs) => this.flush(id, jobs), {
        quantise: deps.quantise,
        now,
        setTimer: this.setTimer,
        clearTimer: this.clearTimer,
      });
    this.queues = { A: queue('A'), B: queue('B') };
    this.trackers = { A: new PressTracker(now), B: new PressTracker(now) };
  }

  /** Listens on `target` for the keys and for blur (keyups never arrive after it); returns the uninstall. */
  install(target: Window): () => void {
    const doc = target.document;
    const keydown = (e: KeyboardEvent) => this.keydown(e, doc);
    const keyup = (e: KeyboardEvent) => {
      const id = this.keyboard.get(e.code);
      if (!id) return;
      this.keyboard.delete(e.code);
      this.release(id, e.code);
    };
    const blur = () => {
      this.keyboard.clear();
      for (const id of DECK_IDS) for (const slot of this.trackers[id].cancelAll()) this.ended(id, slot, true);
    };
    target.addEventListener('keydown', keydown);
    target.addEventListener('keyup', keyup);
    target.addEventListener('blur', blur);
    DECK_IDS.forEach((id) => this.api(id));
    return () => {
      target.removeEventListener('keydown', keydown);
      target.removeEventListener('keyup', keyup);
      target.removeEventListener('blur', blur);
      DECK_IDS.forEach((id) => this.queues[id].drop());
      this.deferred.forEach((h) => this.clearTimer(h));
      this.deferred.clear();
      if (this.ticker !== null) this.clearTimer(this.ticker);
      this.ticker = null;
      this.attached.forEach(({ detach }) => detach());
      this.attached.clear();
    };
  }

  /**
   * Hooks a deck's Stop (drops what is queued: nothing to audition on silence), Play (lands it with the start)
   * and evaluations (the target is re-found). Idempotent; `api()` calls it for any deck it has not seen.
   */
  attach(id: DeckId, deck: DeckApi): void {
    const raw = unwrap(deck);
    const seen = this.attached.get(id);
    if (seen?.deck === raw) return;
    seen?.detach(); // a remounted deck: the old one's hooks go
    const toggled = (started: boolean) => (started ? this.queues[id].flushNow() : this.dropQueue(id));
    const evaluated = () => this.codeChanged(id);
    const loaded = () => this.loaded(id);
    raw.onToggle.add(toggled);
    raw.afterEval.add(evaluated);
    raw.onLoad.add(loaded);
    this.attached.set(id, {
      deck: raw,
      detach: () => {
        raw.onToggle.delete(toggled);
        raw.afterEval.delete(evaluated);
        raw.onLoad.delete(loaded);
      },
    });
  }

  /** Re-finds the deck's target after its code changed: by label when it has one, else by number, clamped. */
  codeChanged(id: DeckId): void {
    const deck = this.deps.decks()[id];
    const lines = patternLines(deck ? deck.getCode() : this.deps.deckState[id].state.liveCode);
    this.setTarget(id, refindTarget(this.prev[id] ?? { n: 1, label: null }, lines));
  }

  // ---- presses ----

  /** Key down (or mouse down on the strip): the bound action, queued for the deck's next boundary. */
  press(id: DeckId, slot: Slot): void {
    const binding = this.layout(id)[slot]?.binding;
    if (!binding || !this.trackers[id].down(slot)) return;
    this.mark(this.down, id, slot, true);
    const press: Press = { binding, ran: false, revert: false, after: null, job: null, target: this.pressedOn(id) };
    this.presses.set(`${id}|${slot}`, press);
    press.job = this.toggleJob(id, slot, binding, press.target, press);
    this.push(id, slot, press.job);
  }

  /**
   * A press that was not meant (the strip's key became a drag): forgotten with no edit left behind. Still
   * queued, its job is taken back; already landed, it reverts as a hold's release would.
   */
  cancel(id: DeckId, slot: Slot): void {
    const key = `${id}|${slot}`;
    const press = this.presses.get(key);
    if (!this.trackers[id].up(slot)) return;
    if (!press || press.ran) return this.ended(id, slot, true);
    this.presses.delete(key);
    this.mark(this.down, id, slot, false);
    if (press.job && this.queues[id].remove(press.job)) {
      const still = this.queues[id].some((job) => this.jobSlots.get(job) === slot);
      if (!still) this.mark(this.pending, id, slot, false);
    }
    this.countdown();
  }

  /** Key up: a tap keeps its edit; a hold queues the inverse (after the press, if that has not landed yet). */
  release(id: DeckId, slot: Slot): void {
    const ev = this.trackers[id].up(slot);
    if (ev?.type === 'release') this.ended(id, slot, ev.held);
  }

  /** Shift (up) or Ctrl (down) on a key: doubles or halves the argument of its method on the target line. */
  nudge(id: DeckId, slot: Slot, dir: 'up' | 'down'): void {
    const binding = this.layout(id)[slot]?.binding;
    if (!binding || binding.kind === 'line') return;
    const pressed = this.pressedOn(id);
    this.push(id, slot, () => {
      const w = this.work!;
      const target = refindTarget(pressed, patternLines(w.code));
      this.land(w, slot, target ? nudge(w.code, target, binding, dir) : { ok: false, reason: REFUSED_LINE });
    });
  }

  /** A click in the editor: the pattern line at document offset `pos` becomes the target; a comment, a setup line or a blank leaves it. */
  selectAt(id: DeckId, pos: number): void {
    const line = lineAt(this.lines(id), pos);
    if (line) this.setTarget(id, line);
  }

  /** A digit: the n-th pattern line becomes the target; past the last line nothing changes. */
  selectLine(id: DeckId, n: number): void {
    const lines = this.lines(id);
    if (n >= 1 && n <= lines.length) this.setTarget(id, lines[n - 1]);
  }

  /** F1–F8: recall (the whole document, through the queue so it lands on the bar), or with `save` store the code. */
  snapshot(id: DeckId, key: SnapshotKey, save: boolean): void {
    const ds = this.deps.deckState[id];
    const deck = this.api(id);
    if (!deck) return;
    const keys = unwrap(ds.state.keys);
    if (save) {
      ds.setKeys(withSnapshot(keys, key, deck.getCode()));
      return;
    }
    const text = keys.snapshots?.[key];
    if (text === undefined) {
      ds.setError(`no snapshot on ${key}`);
      return;
    }
    this.push(id, key, () => {
      this.work!.code = text;
    });
  }

  // ---- perform mode ----

  /** Esc: both editors lock (or unlock); entering targets the line being edited, leaving puts the cursor on the target. */
  togglePerform(): void {
    const on = !this.deps.booth.state.perform;
    this.deps.booth.setPerform(on);
    DECK_IDS.forEach((id) => this.api(id)?.setLocked(on));
    const id = this.deps.performing();
    const deck = this.api(id);
    const lines = this.lines(id);
    if (on) {
      this.setTarget(id, (deck && lineAt(lines, deck.cursor())) ?? lines[0] ?? null);
      this.ensureTarget(other(id));
    } else {
      const target = this.targetIn(id, lines);
      deck?.focusLine(target ? target.firstLine + 1 : 1);
    }
  }

  // ---- layout edits (the strip's drop, drag and right-click) ----

  /** A method dropped on a key: written to the layer that owns the slot, so the key you see is the key you change. */
  drop(id: DeckId, slot: Slot, part: MethodPart): void {
    const keys = this.keys(id);
    if (dropTarget(this.deps.global(), keys, slot) === 'pattern') this.deps.deckState[id].setKeys(withDrop(keys, slot, part));
    else this.writeGlobal(id, withDrop(this.deps.global(), slot, part));
  }

  menu(id: DeckId, slot: Slot, action: 'clear' | 'hide' | 'keep' | 'global'): void {
    const owner = this.layout(id)[slot]?.owner;
    const keys = this.keys(id);
    const global = this.deps.global();
    const ds = this.deps.deckState[id];
    if (action === 'clear') {
      if (owner === 'pattern') ds.setKeys(withCleared(keys, slot));
      else if (owner === 'global') this.writeGlobal(id, withCleared(global, slot));
    } else if (action === 'hide') {
      if (owner === 'global') ds.setKeys(withHidden(keys, slot));
    } else if (action === 'keep') {
      const binding = global.bindings[slot];
      if (owner === 'global' && binding) ds.setKeys({ ...keys, bindings: { ...keys.bindings, [slot]: binding } });
    } else {
      const binding = keys.bindings[slot];
      if (owner !== 'pattern' || !binding) return;
      this.writeGlobal(id, { ...global, bindings: { ...global.bindings, [slot]: binding } });
      ds.setKeys(withCleared(keys, slot));
    }
  }

  /** A key dragged onto another: moved within the layer that owns it. A derived line key has nothing to move. */
  move(id: DeckId, from: Slot, to: Slot): void {
    const owner = this.layout(id)[from]?.owner;
    if (owner === 'pattern') this.deps.deckState[id].setKeys(withMoved(this.keys(id), from, to));
    else if (owner === 'global') this.writeGlobal(id, withMoved(this.deps.global(), from, to));
  }

  // ---- derived state, for the strip ----

  /** Each key as the strip draws it: lit from what the code says, not from what was pressed. */
  shown(id: DeckId): Partial<Record<Slot, ShownKey>> {
    const ds = this.deps.deckState[id];
    const code = ds.state.liveCode;
    const lines = patternLines(code);
    const target = this.targetIn(id, lines);
    const down = this.down[0]()[id];
    const pending = this.pending[0]()[id];
    const last = this.refused[0]()[id];
    // A refusal is about one code and one target; either changing makes it moot.
    const refused = last && last.code === code && last.target === ds.state.targetLine ? last.slots : null;
    const out: Partial<Record<Slot, ShownKey>> = {};
    for (const [slot, s] of Object.entries(this.layoutOf(id, lines))) {
      if (!s) continue;
      const b = s.binding;
      const line = b.kind === 'line' ? lines.find((l) => l.label === b.label) : target;
      out[slot] = {
        ...s,
        on: !!line && isOn(code, line, b),
        held: down.has(slot),
        pending: pending.has(slot),
        refused: !!refused?.has(slot),
      };
    }
    return out;
  }

  lines(id: DeckId): PatternLine[] {
    return patternLines(this.deps.deckState[id].state.liveCode);
  }

  // ---- internals ----

  private keydown(e: KeyboardEvent, doc: Document): void {
    // Space stays with the transport handler; Meta is the system's.
    if (!this.deps.boothShowing() || e.metaKey || e.code === 'Space' || e.repeat) return;
    const el = e.target as Element | null;
    if (el && typeof el.closest === 'function' && el.closest('input, textarea, select, .save-dialog')) return;
    const id = this.deps.performing();
    const plain = !e.ctrlKey && !e.altKey && !e.shiftKey;
    if (e.code === 'Escape') {
      // Already handled: a menu closing, or the editor's own Escape.
      if (!plain || e.defaultPrevented || doc.querySelector('.save-backdrop')) return;
      e.preventDefault();
      this.togglePerform();
      return;
    }
    // Snapshots are safe while editing, so the F-keys work in both modes.
    if (FKEY.test(e.code)) {
      if (e.ctrlKey || e.altKey) return;
      e.preventDefault();
      this.snapshot(id, e.code as SnapshotKey, e.shiftKey);
      return;
    }
    if (!this.deps.booth.state.perform) return;
    if (e.code === 'Tab') {
      if (!plain) return;
      e.preventDefault();
      const next = other(id);
      this.deps.setPerforming(next);
      this.ensureTarget(next);
      return;
    }
    const digit = DIGIT.exec(e.code);
    if (digit) {
      if (!plain) return;
      e.preventDefault();
      this.selectLine(id, Number(digit[1]));
      return;
    }
    if (!LETTER.test(e.code) || e.altKey || (e.shiftKey && e.ctrlKey)) return;
    e.preventDefault();
    if (e.shiftKey) this.nudge(id, e.code, 'up');
    else if (e.ctrlKey) this.nudge(id, e.code, 'down');
    else {
      this.keyboard.set(e.code, id);
      this.press(id, e.code);
    }
  }

  /** The deck's api, hooked on first sight (decks mount after the engine, after `install`). */
  private api(id: DeckId): DeckApi | null {
    const deck = this.deps.decks()[id];
    if (deck) this.attach(id, deck);
    return deck;
  }

  private keys(id: DeckId): Layout {
    return unwrap(this.deps.deckState[id].state.keys);
  }

  private layout(id: DeckId): Partial<Record<Slot, Shown>> {
    return this.layoutOf(id, this.lines(id));
  }

  private layoutOf(id: DeckId, lines: PatternLine[]): Partial<Record<Slot, Shown>> {
    // Read through the store so a tracking caller follows `keys`, then unwrapped for the pure functions.
    void this.deps.deckState[id].state.keys;
    return effectiveLayout(this.deps.global(), this.keys(id), lineLabels(lines));
  }

  /** The target among `lines`, re-found from the last known one; the first line when none was ever chosen. */
  private targetIn(id: DeckId, lines: PatternLine[]): PatternLine | null {
    return refindTarget(this.prev[id] ?? { n: 1, label: null }, lines);
  }

  /** The target as a key goes down, so the job lands there even if a digit moves the target before the bar. */
  private pressedOn(id: DeckId): Target {
    const line = this.targetIn(id, this.lines(id));
    return line ? { n: line.n, label: line.label } : (this.prev[id] ?? { n: 1, label: null });
  }

  private setTarget(id: DeckId, line: PatternLine | null): void {
    if (line) this.prev[id] = { n: line.n, label: line.label };
    const n = line?.n ?? null;
    if (this.deps.deckState[id].state.targetLine !== n) this.deps.deckState[id].setTargetLine(n);
  }

  private ensureTarget(id: DeckId): void {
    if (this.deps.deckState[id].state.targetLine === null) this.setTarget(id, this.targetIn(id, this.lines(id)));
  }

  private writeGlobal(id: DeckId, layout: Layout): void {
    this.deps.setGlobal(layout).catch((e) => this.deps.deckState[id].setError(`key layout not saved: ${String(e)}`));
  }

  /** A press ended; `held` releases revert, waiting behind the press itself when it has not landed yet. */
  private ended(id: DeckId, slot: Slot, held: boolean): void {
    this.mark(this.down, id, slot, false);
    const key = `${id}|${slot}`;
    const press = this.presses.get(key);
    this.presses.delete(key);
    if (!held || !press) return;
    if (!press.ran) press.revert = true;
    else if (press.after !== null) this.queueInverse(id, this.inverse(id, slot, press.binding, !press.after, press.target));
  }

  /** A method or macro toggles on the target line; a line key flips its own line's underscore. */
  private toggleJob(id: DeckId, slot: Slot, binding: Binding, target: Target, press?: Press): Job {
    const job: Job = () => {
      const w = this.work!;
      const lines = patternLines(w.code);
      const line = binding.kind === 'line' ? lines.find((l) => l.label === binding.label) : refindTarget(target, lines);
      let outcome: Outcome = { ok: false, reason: REFUSED_LINE };
      if (line) outcome = binding.kind === 'line' ? flipMute(w.code, line) : toggle(w.code, line, binding);
      this.land(w, slot, outcome);
      if (!press) return;
      press.ran = true;
      press.after = outcome.ok ? outcome.on : null;
      if (press.revert && press.after !== null) w.after.push(this.inverse(id, slot, binding, !press.after, target));
    };
    return job;
  }

  /**
   * A hold's revert: brings the key back to `wanted` (on or off), and does nothing when the code already is
   * there. A blind toggle would act on whatever the deck holds by then: a pattern loaded before the bar
   * would gain the method the hold was auditioning on the old one.
   */
  private inverse(id: DeckId, slot: Slot, binding: Binding, wanted: boolean, target: Target): Inverse {
    const inv: Inverse = { slot, handle: null, job: () => {} };
    inv.job = () => {
      this.inverses[id].delete(inv);
      const w = this.work!;
      const lines = patternLines(w.code);
      const line = binding.kind === 'line' ? lines.find((l) => l.label === binding.label) : refindTarget(target, lines);
      if (!line || isOn(w.code, line, binding) === wanted) return;
      this.land(w, slot, binding.kind === 'line' ? flipMute(w.code, line) : toggle(w.code, line, binding));
    };
    return inv;
  }

  private queueInverse(id: DeckId, inv: Inverse): void {
    inv.handle = null;
    this.inverses[id].add(inv);
    this.push(id, inv.slot, inv.job);
  }

  private land(w: Work, slot: Slot, outcome: Outcome): void {
    if (outcome.ok) w.code = applyEdits(w.code, outcome.edits);
    else {
      w.refused.add(slot);
      w.reasons.push(outcome.reason);
    }
  }

  private push(id: DeckId, slot: string, job: Job): void {
    this.jobSlots.set(job, slot);
    this.mark(this.pending, id, slot, true);
    this.queues[id].push(job);
    this.countdown();
  }

  /** The queue's boundary: every job in order against a working copy, then one transaction and one Update. */
  private flush(id: DeckId, jobs: Job[]): void {
    const deck = this.api(id);
    this.pending[1]((p) => ({ ...p, [id]: new Set() }));
    if (!deck) return;
    const start = deck.getCode();
    const w: Work = { code: start, refused: new Set(), reasons: [], after: [] };
    this.work = w;
    try {
      jobs.forEach((job) => job());
    } finally {
      this.work = null;
    }
    const ds = this.deps.deckState[id];
    if (w.code !== start) {
      deck.applyEdits([diff(start, w.code)], 'input.key');
      this.codeChanged(id);
      void deck.evaluate(false);
    }
    // After the transaction, whose listener clears an earlier refusal, so this one shows.
    if (w.reasons.length) ds.setError(w.reasons[w.reasons.length - 1]);
    this.refused[1]((r) => ({
      ...r,
      [id]: w.refused.size ? { slots: w.refused, code: deck.getCode(), target: ds.state.targetLine } : null,
    }));
    w.after.forEach((inv) => this.pushAfterBoundary(id, inv));
    this.countdown();
  }

  /**
   * A revert that was waiting for its press: queued once the deck's clock has passed the boundary the press
   * landed on. The flush fires a clock lead before the bar line, so queueing at once would aim at that same
   * line and cancel the audition; a stopped deck has no bar line and reverts at once.
   */
  private pushAfterBoundary(id: DeckId, inv: Inverse): void {
    const deck = this.api(id);
    if (!deck?.scheduler.started || this.deps.quantise() === 'now') return this.queueInverse(id, inv);
    const clock = deck.scheduler.clock;
    const lead = (clock?.duration ?? DEFAULT_CLOCK_DURATION) + (clock?.minLatency ?? DEFAULT_MIN_LATENCY);
    this.mark(this.pending, id, inv.slot, true);
    this.inverses[id].add(inv);
    const setTimer = this.setTimer;
    const handle = setTimer(() => {
      this.deferred.delete(handle);
      this.queueInverse(id, inv);
    }, lead * 1000 + REVERT_MARGIN_MS);
    inv.handle = handle;
    this.deferred.add(handle);
  }

  /**
   * Stop: the queued presses are discarded (nothing to audition on silence), but a hold's revert runs now,
   * whether it was queued or still waiting out its boundary, so a Stop never leaves an audition stuck on.
   */
  private dropQueue(id: DeckId): void {
    const reverts = [...this.inverses[id]];
    this.inverses[id].clear();
    const clearTimer = this.clearTimer;
    for (const inv of reverts) {
      if (inv.handle === null) continue;
      clearTimer(inv.handle);
      this.deferred.delete(inv.handle);
    }
    this.queues[id].drop();
    this.pending[1]((p) => ({ ...p, [id]: new Set() }));
    // The deck is stopped by now, so each push flushes at once.
    reverts.forEach((inv) => this.queueInverse(id, inv));
    this.countdown();
  }

  /**
   * The deck was pointed at a newly loaded pattern: queued presses and recalls were aimed at the old code, so
   * they go; a hold's revert stays (queued again, or still waiting out its boundary) and runs by its own rule.
   */
  private loaded(id: DeckId): void {
    const queued = [...this.inverses[id]].filter((inv) => inv.handle === null);
    this.queues[id].drop();
    this.pending[1]((p) => ({ ...p, [id]: new Set([...this.inverses[id]].filter((inv) => inv.handle !== null).map((inv) => inv.slot)) }));
    queued.forEach((inv) => this.queueInverse(id, inv));
    this.countdown();
  }

  /** Writes each deck's "next bar in N", re-armed every 100 ms while anything waits. */
  private countdown(): void {
    let waiting = false;
    for (const id of DECK_IDS) {
      const q = this.queues[id];
      this.deps.deckState[id].setQueue(q.pending, q.beatsLeft());
      waiting ||= q.pending > 0;
    }
    if (waiting && this.ticker === null) {
      const setTimer = this.setTimer;
      this.ticker = setTimer(() => {
        this.ticker = null;
        this.countdown();
      }, COUNTDOWN_MS);
    } else if (!waiting && this.ticker !== null) {
      const clearTimer = this.clearTimer;
      clearTimer(this.ticker);
      this.ticker = null;
    }
  }

  private mark(
    [get, set]: ReturnType<typeof createSignal<Record<DeckId, ReadonlySet<string>>>>,
    id: DeckId,
    slot: string,
    on: boolean,
  ): void {
    // Untracked: a press from inside an effect must not make that effect depend on the strip's state.
    const now = untrack(get);
    const next = new Set(now[id]);
    if (on) next.add(slot);
    else next.delete(slot);
    set({ ...now, [id]: next });
  }
}
