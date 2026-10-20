import { createEffect, createSignal, on, onCleanup, onMount } from 'solid-js';
import { StrudelMirror } from '@strudel/codemirror';
import { transpiler } from '@strudel/transpiler';
import { getAudioContext, webaudioOutput } from '@strudel/webaudio';
import type { DeckApi } from '../booth/Deck';
import { evaluateExclusive } from '../engine/evalLock';
import { installMixer, RIP_ORBIT } from '../engine/mixer';
import { initEngine } from '../engine/strudel';

export interface ResultApi {
  /** Evaluates the editor's code under the app-wide eval lock and starts it (Play). */
  play(): Promise<void>;
  stop(): void;
  scheduler: DeckApi['scheduler'];
  /** Called after the result starts or stops, however that happened. */
  onToggle: Set<(started: boolean) => void>;
}

/**
 * The rip's Strudel code in an editor that plays on orbit 3, like a deck but outside the booth: the mixer
 * gives orbit 3 only the A/B gain, so the crossfader and master section never touch it.
 */
export function ResultEditor(props: {
  code: string;
  onChange: (code: string) => void;
  onReady?: (api: ResultApi) => void;
}) {
  let root!: HTMLDivElement;
  let mirror: any;
  const onToggle = new Set<(started: boolean) => void>();
  const [error, setError] = createSignal<string | null>(null);
  // The mixer must own orbit 3 before it is first created, or the result would skip the A/B gain.
  const engine = initEngine().then(() => void installMixer());
  engine.catch(() => {}); // a boot failure surfaces on Play (and in the booth), not as an unhandled rejection

  // Bumped by every Stop, so a start queued behind the eval lock cannot undo a Stop pressed meanwhile.
  let stopGeneration = 0;
  const lockedEvaluate = async (autostart = true): Promise<void> => {
    const resumed = getAudioContext().resume().catch(() => {});
    const generation = stopGeneration;
    mirror.flash();
    try {
      await engine;
      await evaluateExclusive(mirror.repl, mirror.code, autostart, () => resumed, () => generation === stopGeneration);
    } catch (e) {
      setError(String(e));
    }
  };
  const stop = () => {
    stopGeneration++;
    mirror?.stop();
  };

  onMount(() => {
    mirror = new StrudelMirror({
      root,
      id: 'rip',
      initialCode: props.code,
      prebake: initEngine,
      solo: false,
      transpiler,
      defaultOutput: webaudioOutput,
      getTime: () => getAudioContext().currentTime,
      editPattern: (pat: any) => pat.orbit(RIP_ORBIT),
      onToggle: (started: boolean) => onToggle.forEach((f) => f(started)),
      onEvalError: (e: unknown) => setError(String(e)),
      afterEval: () => setError(null),
    });
    mirror.evaluate = lockedEvaluate;
    // Edits come from the document, which the editor reports through the repl's setCode on every change.
    // The repl's own state reports (onUpdateState) are not used: a start or stop echoes the repl's last
    // code, and in the moment between the store changing and the editor following it, that echo would
    // overwrite the new code with the old one.
    const replSetCode = mirror.repl.setCode;
    mirror.repl.setCode = (code: string) => {
      replSetCode(code);
      if (code !== props.code) props.onChange(code);
    };
    // Code that arrived before the editor existed (a rip finishing on another tab) goes in now.
    if (mirror.code !== props.code) mirror.setCode(props.code);
    // The document-wide `repl-evaluate` (Vim :w on a deck) must not start the hidden rip result.
    document.removeEventListener('repl-evaluate', mirror.onEvaluateRequest);

    props.onReady?.({
      play: () => lockedEvaluate(true),
      stop,
      scheduler: mirror.repl.scheduler,
      onToggle,
    });

    onCleanup(() => {
      mirror.stop();
      mirror.clear();
    });
  });

  // A new rip or the other version replaces the editor's text (an edit echoing back changes nothing).
  createEffect(
    on(
      () => props.code,
      (code) => {
        if (mirror && mirror.code !== code) mirror.setCode(code);
      },
      { defer: true },
    ),
  );

  return (
    <div class="rip-result-editor">
      <div class="deck-editor" ref={root} />
      <div class="deck-error" role="alert">{error()}</div>
    </div>
  );
}
