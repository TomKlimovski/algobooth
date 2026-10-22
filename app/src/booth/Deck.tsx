import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { StrudelMirror } from '@strudel/codemirror';
import { Compartment, EditorState, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { transpiler } from '@strudel/transpiler';
import { getAudioContext, webaudioOutput } from '@strudel/webaudio';
import type { Pattern } from '../library/api';
import { parentOf, PATTERN_MIME, type LibraryStore } from '../library/store';
import { settings } from '../settings/settings';
import { evaluateExclusive } from '../engine/evalLock';
import { initEngine } from '../engine/strudel';
import { isDirty, newPatternDecision, onDiskChange, patternFromDeck, sameCode } from './deckFile';
import { cpmFromCps, ORBIT, type DeckId, type DeckState } from './deckState';
import { sameLayout, type Quantise } from './keys/bindings';
import type { KeyController } from './keys/KeyController';
import { KeyStrip } from './keys/KeyStrip';
import { lineGutterExtension, patternLineDecoration, refreshLines } from './keys/lineGutter';
import { REFUSED_ARG, REFUSED_LINE, type Edit } from './keys/press';
import { insertAtCursor, methodDropExtension, type MethodDrag } from './methodDrop';
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
  /** Forgets the deck's file but keeps its code (now unsaved), so Save opens Save as. */
  unpointFile(): void;
  /** The watcher reported `paths` changed: reload the deck's file, or flag it if the deck has edits. */
  diskChanged(paths: string[]): void;
  /** Whether the editor holds unsaved edits. */
  isDirty(): boolean;
  /** The deck's Save (Save as when it has no file); resolves false if cancelled or failed. */
  save(): Promise<boolean>;
  /** Inserts a method at the end of the cursor's line (the panel's double-click); false when refused. */
  insertSnippet(drag: MethodDrag): boolean;
  /** Applies key edits (offsets into the current text) as one transaction, so one Cmd+Z undoes a batch. */
  applyEdits(edits: Edit[], userEvent?: string): void;
  /** Perform mode: read-only with no caret, and blurred so letters reach the key handler, not the text. */
  setLocked(on: boolean): void;
  /** Puts the cursor at the start of 1-based document line `n` (clamped) and focuses the editor. */
  focusLine(n: number): void;
  /** The cursor's document offset, so entering perform mode can target the line being edited. */
  cursor(): number;
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

/** Shown in the error slot when a method has nowhere to go. */
const REFUSED = 'drop onto a pattern line';
const REFUSED_FUNCTION = 'drop a function where a value goes: inside ( ), after a comma, or on a blank line';
// The key strip's refusals too: the next drop or key edit makes them moot, like a drop's.
const REFUSALS = new Set([REFUSED, REFUSED_FUNCTION, REFUSED_LINE, REFUSED_ARG]);
const isRefusal = (error: string | null) => !!error && (REFUSALS.has(error) || error.startsWith('no snapshot on '));

/** How long a failed save's message stays under the deck header. */
const SAVE_ERROR_MS = 5000;
/** The editor's font size, in px: small enough for two decks and a key strip to share the window. */
const EDITOR_FONT_PX = 13;

export function Deck(props: {
  state: DeckState;
  onReady?: (api: DeckApi) => void;
  /** A library entry (relative path) was dropped on this deck. */
  onDropPattern?: (path: string) => void;
  /** This deck is where a library double-click loads; shown as a marker in the header. */
  target?: boolean;
  /** The user clicked or typed in this deck: it becomes the library's target. */
  onUse?: () => void;
  /** Checked during dragover, so the deck refuses (no drop cursor) entries it cannot load. */
  canDropPattern?: () => boolean;
  /** Where Save, Save as and disk reconciliation read and write; without it those buttons are disabled. */
  library?: LibraryStore;
  /** The booth's method keyboard: the strip under the editor draws and drives it, the gutter shows its lines. */
  controller: KeyController;
  /** The booth is in perform mode. */
  perform: () => boolean;
  /** This deck is the one the letters play (the library's target). */
  performing: () => boolean;
  quantise: () => Quantise;
  setQuantise: (q: Quantise) => void;
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
  // A changed key layer is an unsaved change too: Save writes it into the file.
  const dirty = createMemo(
    () => isDirty(editorCode(), deck.state.savedCode, DEFAULT_CODE[id]) || !sameLayout(deck.state.keys, deck.state.savedKeys),
  );
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
  // Bumped by every Stop, so a start queued behind the eval lock cannot undo a Stop pressed meanwhile.
  let stopGeneration = 0;
  const lockedEvaluate = async (autostart = true): Promise<void> => {
    const resumed = resumeAudio().catch(() => {});
    const generation = stopGeneration;
    mirror.flash();
    try {
      await evaluateExclusive(mirror.repl, mirror.code, autostart, () => resumed, () => generation === stopGeneration);
    } catch (e) {
      deck.setError(String(e));
    }
  };
  // Re-evaluate without changing whether the deck is playing.
  const update = () => mirror.evaluate(mirror.repl.scheduler.started);
  const play = () => mirror.evaluate(true);
  const evaluate = (autostart?: boolean) => (autostart ? play() : update());
  const stop = () => {
    stopGeneration++;
    mirror.stop();
  };

  /** A failed save, shown under the header for a few seconds (the sidebar may be folded away). */
  const [saveError, setSaveError] = createSignal<string | null>(null);
  let saveErrorTimer: ReturnType<typeof setTimeout> | undefined;
  const showSaveError = (e: unknown) => {
    clearTimeout(saveErrorTimer);
    setSaveError(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    saveErrorTimer = setTimeout(() => setSaveError(null), SAVE_ERROR_MS);
  };
  onCleanup(() => clearTimeout(saveErrorTimer));
  /** Resolves whether a save worked; a failure also shows on the deck (and in the sidebar's error line). */
  const succeeded = (p: Promise<unknown>) =>
    p.then(
      () => true,
      (e) => {
        showSaveError(e);
        return false;
      },
    );

  const current = (name: string): Pattern =>
    patternFromDeck(
      { name, code: mirror.code, codeCpm: deck.state.codeCpm, keys: deck.state.keys },
      deck.state.pattern ?? undefined,
    );

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

  // Memoised: the gutter asks once per visible line, and each ask would otherwise re-parse the code.
  const lines = createMemo(() => props.controller.lines(id));
  const target = () => deck.state.targetLine;

  onMount(() => {
    fitCanvas();
    const resize = new ResizeObserver(fitCanvas);
    resize.observe(canvas);

    const initialCode = deck.state.code || DEFAULT_CODE[id];
    deck.setCode(initialCode);
    setEditorCode(initialCode);
    deck.setLiveCode(initialCode);
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
        // The code's own tempo, recorded before the sync follower (in afterEval) pulls B to A's.
        const cpm = cpmFromCps(mirror.repl.scheduler.cps);
        deck.setCpm(cpm);
        deck.setCodeCpm(cpm);
        afterEval.forEach((f) => f());
      },
      // The repl's state carries the editor text on every edit; dirty tracking follows it.
      // The key strip's lights follow it too, through `liveCode`.
      onUpdateState: (s: { code: string }) => {
        setEditorCode(s.code);
        deck.setLiveCode(s.code);
      },
    });
    mirror.evaluate = lockedEvaluate;
    // Strudel restores its own font size and line numbers from localStorage on construction, so a stale
    // setting would come back on every mount; the deck's density wins. The pattern-line gutter replaces the numbers.
    mirror.setFontSize(EDITOR_FONT_PX);
    mirror.reconfigureExtension('isLineNumbersDisplayed', false);
    const refuse = (kind: MethodDrag['kind']) => deck.setError(kind === 'function' ? REFUSED_FUNCTION : REFUSED);
    // Perform mode's lock. Both facets: readOnly alone still shows a caret and takes focus.
    const lock = new Compartment();
    const locked = (on: boolean) => [EditorState.readOnly.of(on), EditorView.editable.of(!on)];
    mirror.editor.dispatch({
      effects: StateEffect.appendConfig.of([
        methodDropExtension(() => mirror.editor, refuse),
        lock.of(locked(false)),
        lineGutterExtension(lines, target),
        patternLineDecoration(lines, target),
        // A drop or a key press is an interaction with this deck, like clicking in it: the deck becomes the
        // library's target, and an earlier refusal no longer applies.
        EditorView.updateListener.of((u) => {
          if (!u.transactions.some((t) => t.isUserEvent('input.drop') || t.isUserEvent('input.key'))) return;
          if (isRefusal(deck.state.error)) deck.setError(null);
          props.onUse?.();
        }),
      ]),
    });
    const insertSnippet = (drag: MethodDrag) => {
      const ok = insertAtCursor(mirror.editor, drag);
      if (!ok) refuse(drag.kind);
      return ok;
    };

    const view = (): EditorView => mirror.editor;
    // The lines follow `liveCode`, which updates after the editor's own update; redraw once they (or the target) move.
    createEffect(() => {
      lines();
      target();
      view().dispatch({ effects: refreshLines.of(null) });
    });
    const applyEdits = (edits: Edit[], userEvent = 'input.key') => {
      if (edits.length === 0) return;
      view().dispatch({ changes: edits.map((e) => ({ from: e.from, to: e.to, insert: e.insert })), userEvent });
    };
    const setLocked = (on: boolean) => {
      view().dispatch({ effects: lock.reconfigure(locked(on)) });
      if (on) view().contentDOM.blur();
    };
    const focusLine = (n: number) => {
      const doc = view().state.doc;
      const line = doc.line(Math.min(Math.max(Math.round(n), 1), doc.lines));
      view().dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
      view().focus();
    };

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
      // The key layer stays with the code (both now unsaved), as setFile alone would reset it.
      unpointFile: () => {
        const keys = deck.state.keys;
        deck.setFile(null, null);
        deck.setKeys(keys);
      },
      diskChanged: (paths) => void diskChanged(paths),
      isDirty: dirty,
      save,
      insertSnippet,
      applyEdits,
      setLocked,
      focusLine,
      cursor: () => view().state.selection.main.head,
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
      classList={{ 'drop-target': dragOver(), performing: props.perform() && props.performing() }}
      data-deck={id}
      onDragOver={onDragOver}
      onPointerDown={() => props.onUse?.()}
      onFocusIn={() => props.onUse?.()}
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
        <Show when={props.target}>
          <span class="deck-target" title="A double-click in the library loads here" aria-label="library target">◂ library</span>
        </Show>
        <Show when={deck.state.queued > 0}>
          <span class="deck-countdown" role="status">next {props.quantise()} in {deck.state.beatsLeft}</span>
        </Show>
        <Show when={props.perform() && props.performing()}>
          <span class="deck-perform">perform</span>
        </Show>
        <span class="deck-cpm">{deck.state.cpm} cpm</span>
      </header>
      <Show when={saveError()}>
        {(message) => (
          <div class="deck-save-error" role="alert">
            <span>{message()}</span>
            <button class="deck-btn ghost" aria-label="dismiss" onClick={() => setSaveError(null)}>×</button>
          </div>
        )}
      </Show>
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
      <KeyStrip
        deck={id}
        controller={props.controller}
        state={deck}
        perform={props.perform}
        performing={props.performing}
        quantise={props.quantise}
        setQuantise={props.setQuantise}
      />
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
