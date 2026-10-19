import { onCleanup, onMount } from 'solid-js';
import { StrudelMirror } from '@strudel/codemirror';
import { transpiler } from '@strudel/transpiler';
import { getAudioContext, webaudioOutput } from '@strudel/webaudio';
import { initEngine } from '../engine/strudel';
import { cpmFromCps, ORBIT, type DeckId, type DeckState } from './deckState';
import './deck.css';

export interface DeckApi {
  id: DeckId;
  /** Evaluates the code; `autostart` starts the deck, otherwise it keeps playing or stopped as it was. */
  evaluate(autostart?: boolean): Promise<void>;
  stop(): void;
  setCode(code: string): void;
  getCode(): string;
  setName(name: string): void;
  setFile(filePath: string | null, savedCode: string | null): void;
  scheduler: { cps: number; now(): number; started: boolean; start(): Promise<void>; stop(): void };
  setCps(cps: number): void;
  afterEval: Set<() => void>;
}

export const DEFAULT_CODE: Record<DeckId, string> = {
  A: 'setcpm(120/4)\n$: s("bd*4, [~ cp]*2, hh*8").bank("tr909")',
  B: 'setcpm(120/4)\n$: note("c2(5,8)").s("sawtooth").lpf(sine.range(200,3000).slow(8))',
};

// Browsers keep the AudioContext suspended until a user gesture; every
// transport click resumes it (initAudio's own resume() never fires).
const resumeAudio = () => getAudioContext().resume();

export function Deck(props: { state: DeckState; onReady?: (api: DeckApi) => void }) {
  const deck = props.state;
  const id = deck.state.id;
  let root!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  let mirror: any;
  const afterEval = new Set<() => void>();

  const fitCanvas = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
  };
  const clearCanvas = () => canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);

  // Re-evaluate without changing whether the deck is playing.
  const update = () => mirror.evaluate(mirror.repl.scheduler.started);
  const play = async () => {
    await resumeAudio();
    await mirror.evaluate(true);
  };
  const evaluate = (autostart?: boolean) => (autostart ? play() : update());
  const stop = () => mirror.stop();

  onMount(() => {
    fitCanvas();
    const resize = new ResizeObserver(fitCanvas);
    resize.observe(canvas);

    const initialCode = deck.state.code || DEFAULT_CODE[id];
    deck.setCode(initialCode);
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
      editPattern: (pat: any) => pat.orbit(ORBIT[id]).punchcard({ fold: 1 }),
      onToggle: (started: boolean) => {
        deck.setPlaying(started);
        if (!started) clearCanvas();
      },
      onEvalError: (e: unknown) => deck.setError(String(e)),
      afterEval: () => {
        deck.setError(null);
        deck.setCode(mirror.code);
        deck.setCpm(cpmFromCps(mirror.repl.scheduler.cps));
        afterEval.forEach((f) => f());
      },
      onUpdateState: () => {},
    });

    props.onReady?.({
      id,
      evaluate,
      stop,
      setCode: (code) => mirror.setCode(code),
      getCode: () => mirror.code,
      setName: deck.setName,
      setFile: () => {},
      scheduler: mirror.repl.scheduler,
      setCps: (cps) => mirror.repl.setCps(cps),
      afterEval,
    });

    onCleanup(() => {
      resize.disconnect();
      mirror.stop();
      mirror.clear();
    });
  });

  return (
    <section class="deck" data-deck={id}>
      <header class="deck-header">
        <span class="deck-letter">{id}</span>
        <span class="deck-name">{deck.state.name}</span>
        <span class="deck-cpm">{deck.state.cpm} cpm</span>
      </header>
      <canvas class="deck-viz" ref={canvas} />
      <div class="deck-editor" ref={root} />
      <div class="deck-error" role="alert">{deck.state.error}</div>
      <div class="deck-transport">
        <button class="deck-btn" classList={{ on: deck.state.playing }} onClick={play}>Play</button>
        <button class="deck-btn ghost" onClick={stop}>Stop</button>
        <button class="deck-btn ghost" onClick={update}>Update</button>
      </div>
    </section>
  );
}
