import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { StrudelMirror } from '@strudel/codemirror';
import { transpiler } from '@strudel/transpiler';
import { getAudioContext, webaudioOutput } from '@strudel/webaudio';
import type { Pattern } from '../library/api';
import { parentOf, PATTERN_MIME, type LibraryStore } from '../library/store';
import { settings } from '../settings/settings';
import { evaluateExclusive } from '../engine/evalLock';
import { initEngine } from '../engine/strudel';
import { isDirty, newPatternDecision, onDiskChange, patternFromDeck, sameCode } from './deckFile';
import { cpmFromCps, ORBIT, type DeckId, type DeckState } from './deckState';
import { SaveDialog, type SaveTarget } from './SaveDialog';
import './deck.css';

export interface DeckApi {
  id: DeckId;
  /** Evaluates the code; `autostart` starts the deck, otherwise it keeps playing or stopped as it was. */
  evaluate(autostart?: boolean): Promise<void>;
  stop(): void;
  setCode(code: string): void;
  getCode(): string;
  setName(name: string): void;
  /** Points the deck at a library file (null: none) whose content is `savedCode`; `pattern` is that file. */
  setFile(filePath: string | null, savedCode: string | null, pattern?: Pattern | null): void;
  /** Library-relative path of the deck's file; null when it has none. */
  filePath(): string | null;
  /** The deck's file was renamed or moved to `path` by the library. */
  moveFile(path: string): void;
  /** The watcher reported `paths` changed: reload the deck's file, or flag it if the deck has edits. */
  diskChanged(paths: string[]): void;
  /** The mirror's Cyclist. `beforeStart` runs (and is awaited) before its clock starts; `clock` is its zyklus clock. */
  scheduler: {
    cps: number;
    now(): number;
    started: boolean;
    start(): Promise<void>;
    stop(): void;
    beforeStart?: () => unknown;
    clock?: { duration?: number; minLatency?: number };
  };
  setCps(cps: number): void;
  afterEval: Set<() => void>;
  /** Called after the deck starts or stops, however that happened. */
  onToggle: Set<(started: boolean) => void>;
}

export const DEFAULT_CODE: Record<DeckId, string> = {
  A: 'setcpm(120/4)\n$: s("bd*4, [~ cp]*2, hh*8").bank("tr909")',
  B: 'setcpm(120/4)\n$: note("c2(5,8)").s("sawtooth").lpf(sine.range(200,3000).slow(8))',
};

// Browsers keep the AudioContext suspended until a user gesture; every
// evaluation resumes it (initAudio's own resume() never fires).
const resumeAudio = () => getAudioContext().resume();

export function Deck(props: {
  state: DeckState;
  onReady?: (api: DeckApi) => void;
  /** A library entry (relative path) was dropped on this deck. */
  onDropPattern?: (path: string) => void;
  /** Checked during dragover, so the deck refuses (no drop cursor) entries it cannot load. */
  canDropPattern?: () => boolean;
  /** Where Save, Save as and disk reconciliation read and write; without it those buttons are disabled. */
  library?: LibraryStore;
}) {
  const deck = props.state;
  const id = deck.state.id;
  let root!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  let mirror: any;
  const afterEval = new Set<() => void>();
  const onToggle = new Set<(started: boolean) => void>();
  const [dragOver, setDragOver] = createSignal(false);
  /** The live editor text (`deck.state.code` only follows evaluations). */
  const [editorCode, setEditorCode] = createSignal('');
  const dirty = createMemo(() => isDirty(editorCode(), deck.state.savedCode, DEFAULT_CODE[id]));
  /** The open Save as dialog's answer; resolves null on cancel. */
  const [asking, setAsking] = createSignal<((target: SaveTarget | null) => void) | null>(null);
  const askTarget = () => new Promise<SaveTarget | null>((resolve) => setAsking(() => resolve));
  const answer = (target: SaveTarget | null) => {
    asking()?.(target);
    setAsking(null);
  };
  const accepts = (e: DragEvent) =>
    !!props.onDropPattern &&
    (e.dataTransfer?.types.includes(PATTERN_MIME) ?? false) &&
    (props.canDropPattern?.() ?? true);
  const onDragOver = (e: DragEvent) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
    setDragOver(true);
  };
  // Listened for in the capture phase, so the deck sees the drop before the editor inside it does.
  const onDrop = (e: DragEvent) => {
    setDragOver(false);
    const path = e.dataTransfer?.getData(PATTERN_MIME);
    if (!path) return;
    // A library entry never reaches CodeMirror, even a refused one (a heading).
    e.preventDefault();
    e.stopPropagation();
    if (accepts(e)) props.onDropPattern?.(path);
  };

  const fitCanvas = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
  };
  const clearCanvas = () => canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);

  /**
   * Replaces StrudelMirror's `evaluate`, so every path takes the booth-wide eval lock: Play and Update,
   * Ctrl+Enter, the document-wide `repl-evaluate` event (Vim :w), sync's release and master play.
   * Never rejects; a failure shows in the deck's error line.
   */
  const lockedEvaluate = async (autostart = true): Promise<void> => {
    const resumed = resumeAudio().catch(() => {});
    mirror.flash();
    try {
      await evaluateExclusive(mirror.repl, mirror.code, autostart, () => resumed);
    } catch (e) {
      deck.setError(String(e));
    }
  };
  // Re-evaluate without changing whether the deck is playing.
  const update = () => mirror.evaluate(mirror.repl.scheduler.started);
  const play = () => mirror.evaluate(true);
  const evaluate = (autostart?: boolean) => (autostart ? play() : update());
  const stop = () => mirror.stop();

  // Library errors already show in the sidebar's error line; these only report whether they worked.
  const succeeded = (p: Promise<unknown>) => p.then(() => true, () => false);

  const current = (name: string): Pattern =>
    patternFromDeck({ name, code: mirror.code, cpm: deck.state.cpm }, deck.state.pattern ?? undefined);

  /** Asks for a name and heading, writes a new file, and points the deck at it. Resolves false if cancelled. */
  const saveAs = async (): Promise<boolean> => {
    const lib = props.library;
    if (!lib || asking()) return false;
    const target = await askTarget();
    if (!target) return false;
    const pattern = current(target.name);
    return succeeded(
      lib.writePattern(target.heading, pattern).then((written) => {
        deck.setName(target.name);
        deck.setFile(written, pattern.code, pattern);
      }),
    );
  };
  const save = async (): Promise<boolean> => {
    const lib = props.library;
    const path = deck.state.filePath;
    if (!lib) return false;
    if (path === null) return saveAs();
    const pattern = current(deck.state.name);
    return succeeded(lib.savePattern(path, pattern).then(() => deck.setFile(path, pattern.code, pattern)));
  };
  const newPattern = async () => {
    const confirmed =
      dirty() && window.confirm('Save changes before starting a new pattern? OK saves first, Cancel keeps editing.');
    const decision = newPatternDecision(dirty(), confirmed);
    if (decision === 'abort') return;
    if (decision === 'save-then-start' && !(await save())) return;
    mirror.setCode(DEFAULT_CODE[id]);
    deck.setName('untitled');
    deck.setFile(null, null);
  };

  /** Replaces the editor with the file on disk, without evaluating it. */
  const applyDisk = (path: string, pattern: Pattern) => {
    if (mirror.code !== pattern.code) mirror.setCode(pattern.code);
    deck.setName(pattern.name);
    deck.setFile(path, pattern.code, pattern);
  };
  const reload = async () => {
    const path = deck.state.filePath;
    if (!props.library || path === null) return;
    const pattern = await props.library.readPattern(path).catch(() => null);
    if (pattern && deck.state.filePath === path) applyDisk(path, pattern);
  };
  const diskChanged = async (paths: string[]) => {
    const path = deck.state.filePath;
    if (!props.library || path === null) return;
    if (onDiskChange({ filePath: path, dirty: dirty() }, paths) === 'ignore') return;
    const pattern = await props.library.readPattern(path).catch(() => null);
    // The deck moved on while the file was read, or the file is unreadable (the sidebar says so).
    if (!pattern || deck.state.filePath !== path) return;
    // Our own save echoing back, or an edit that left the code alone: nothing to reconcile.
    const saved = deck.state.savedCode;
    if (saved !== null && sameCode(pattern.code, saved)) return deck.setPattern(pattern);
    // Decide again: the editor may have changed while the file was read.
    if (onDiskChange({ filePath: path, dirty: dirty() }, paths) === 'reload') applyDisk(path, pattern);
    else deck.setDiskChanged(true);
  };

  onMount(() => {
    fitCanvas();
    const resize = new ResizeObserver(fitCanvas);
    resize.observe(canvas);

    const initialCode = deck.state.code || DEFAULT_CODE[id];
    deck.setCode(initialCode);
    setEditorCode(initialCode);
    mirror = new StrudelMirror({
      root,
      id: 'deck-' + id,
      initialCode,
      prebake: initEngine,
      solo: false,
      drawContext: canvas.getContext('2d'),
      drawTime: [-2, 2],
      transpiler,
      defaultOutput: webaudioOutput,
      getTime: () => getAudioContext().currentTime,
      // punchcard is @strudel/draw's onPaint pianoroll: it paints into this
      // mirror's drawContext. Pattern.pianoroll() would draw to a global canvas.
      // scope takes its own ctx; its draw id starts with the mirror id so stop() cancels it.
      editPattern: (pat: any) => {
        const routed = pat.orbit(ORBIT[id]);
        return settings().visualiser === 'scope'
          ? routed.scope({ ctx: canvas.getContext('2d'), id: 'deck-' + id })
          : routed.punchcard({ fold: 1 });
      },
      onToggle: (started: boolean) => {
        deck.setPlaying(started);
        if (!started) clearCanvas();
        onToggle.forEach((f) => f(started));
      },
      onEvalError: (e: unknown) => deck.setError(String(e)),
      afterEval: () => {
        deck.setError(null);
        deck.setCode(mirror.code);
        deck.setCpm(cpmFromCps(mirror.repl.scheduler.cps));
        afterEval.forEach((f) => f());
      },
      // The repl's state carries the editor text on every edit; dirty tracking follows it.
      onUpdateState: (s: { code: string }) => setEditorCode(s.code),
    });
    mirror.evaluate = lockedEvaluate;

    props.onReady?.({
      id,
      evaluate,
      stop,
      setCode: (code) => mirror.setCode(code),
      getCode: () => mirror.code,
      setName: deck.setName,
      setFile: deck.setFile,
      filePath: () => deck.state.filePath,
      moveFile: deck.setFilePath,
      diskChanged: (paths) => void diskChanged(paths),
      scheduler: mirror.repl.scheduler,
      setCps: (cps) => mirror.repl.setCps(cps),
      afterEval,
      onToggle,
    });

    onCleanup(() => {
      resize.disconnect();
      mirror.stop();
      mirror.clear();
    });
  });

  return (
    <section
      class="deck"
      classList={{ 'drop-target': dragOver() }}
      data-deck={id}
      onDragOver={onDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragOver(false)}
      on:drop={{ handleEvent: onDrop, capture: true }}
    >
      <header class="deck-header">
        <span class="deck-letter">{id}</span>
        <span class="deck-name">
          {deck.state.name}
          <Show when={dirty()}>
            <span class="deck-dirty" title="Unsaved changes" aria-label="unsaved changes">●</span>
          </Show>
        </span>
        <span class="deck-cpm">{deck.state.cpm} cpm</span>
      </header>
      <Show when={deck.state.diskChanged}>
        <div class="deck-disk" role="alert">
          <span>Changed on disk.</span>
          <button class="deck-btn ghost" onClick={() => void reload()}>Reload</button>
          <span>or</span>
          <button class="deck-btn ghost" onClick={() => deck.setDiskChanged(false)}>Keep mine</button>
        </div>
      </Show>
      <canvas class="deck-viz" ref={canvas} />
      <div class="deck-editor" ref={root} />
      <div class="deck-error" role="alert">{deck.state.error}</div>
      <div class="deck-transport">
        <button class="deck-btn" classList={{ on: deck.state.playing }} onClick={play}>Play</button>
        <button class="deck-btn ghost" onClick={stop}>Stop</button>
        <button class="deck-btn ghost" onClick={update}>Update</button>
        <span class="deck-transport-gap" />
        <button class="deck-btn ghost" disabled={!props.library} onClick={() => void newPattern()}>New</button>
        <button class="deck-btn ghost" disabled={!props.library} onClick={() => void save()}>Save</button>
        <button class="deck-btn ghost" disabled={!props.library} onClick={() => void saveAs()}>Save as</button>
      </div>
      <Show when={asking()}>
        <SaveDialog
          deckId={id}
          tree={props.library?.state.root ?? null}
          name={deck.state.name}
          heading={deck.state.filePath === null ? 'mine' : parentOf(deck.state.filePath)}
          onSave={answer}
          onCancel={() => answer(null)}
        />
      </Show>
    </section>
  );
}
