import { createSignal } from 'solid-js';
import type { Analysis } from './ripApi';

export type AbSide = 'original' | 'result';

/** The A/B toggle: exactly one of the original mix and the Strudel result is heard. */
export function abGains(side: AbSide): { original: number; result: number } {
  return side === 'original' ? { original: 1, result: 0 } : { original: 0, result: 1 };
}

/** The analysed bars in the stems' timeline: from the first downbeat, `bars` bars of 4 beats. */
export function loopBounds(a: Analysis): { start: number; end: number } {
  return { start: a.first_downbeat, end: a.first_downbeat + (a.bars * 240) / a.bpm };
}

/** Same smoothing as the mixer's knobs: instant to the ear, without a click. */
const SMOOTHING = 0.02;

/** Plays one decoded stem at a time through a shared gain, straight to the context's destination. */
export class Audition {
  private buffers = new Map<string, AudioBuffer>();
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private gain = 1;
  private readonly playingSignal = createSignal<string | null>(null);
  /** The stem playing now, or null. Reactive. */
  readonly playing = this.playingSignal[0];

  constructor(private readonly ctx: () => AudioContext) {}

  /** Decodes a stem's wav bytes and keeps it under `name`. */
  async load(name: string, bytes: ArrayBuffer): Promise<void> {
    this.buffers.set(name, await this.ctx().decodeAudioData(bytes));
  }

  has(name: string): boolean {
    return this.buffers.has(name);
  }

  /** Stops and forgets every stem (a new rip). */
  clear(): void {
    this.stop();
    this.buffers.clear();
  }

  /** Stops whatever plays, then plays `name` from `loop.start`, looping to `loop.end`; once through without a loop. */
  play(name: string, loop?: { start: number; end: number }): void {
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    this.stop();
    const ctx = this.ctx();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (loop) {
      source.loop = true;
      source.loopStart = loop.start;
      source.loopEnd = loop.end;
    }
    source.connect(this.output(ctx));
    source.onended = () => {
      if (this.source !== source) return; // an earlier source ending late
      this.source = null;
      this.playingSignal[1](null);
    };
    this.source = source;
    this.playingSignal[1](name);
    source.start(0, loop?.start ?? 0);
  }

  stop(): void {
    const source = this.source;
    this.source = null;
    this.playingSignal[1](null);
    if (!source) return;
    try {
      source.stop();
    } catch {
      // never started or already stopped
    }
    source.disconnect?.();
  }

  /** The level of everything auditioned, 0 to 1. */
  setGain(value: number): void {
    this.gain = Math.min(1, Math.max(0, value));
    this.gainNode?.gain.setTargetAtTime(this.gain, this.ctx().currentTime, SMOOTHING);
  }

  private output(ctx: AudioContext): GainNode {
    if (!this.gainNode) {
      this.gainNode = ctx.createGain();
      this.gainNode.gain.value = this.gain;
      this.gainNode.connect(ctx.destination);
    }
    return this.gainNode;
  }
}
