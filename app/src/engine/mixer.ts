import * as webaudio from '@strudel/webaudio';
import { ORBIT, type DeckId } from '../booth/deckState';
import { crossfadeGains } from './crossfade';
import {
  DECK_CONTROL,
  DEFAULT_DECK_CONTROLS,
  DEFAULT_MASTER_CONTROLS,
  glue,
  MASTER_CONTROL,
  type DeckControl,
  type MasterControl,
} from './controlMap';
import { hallImpulse } from './impulse';
import { channelOf } from './lanes';

export type Knob = DeckControl;

/** The slice of superdough's (untyped) controller and output classes that the mixer relies on. */
interface Orbit {
  output: GainNode;
}
interface SuperdoughOutput {
  connectToDestination(input: AudioNode, channels?: number[]): void;
  disconnect(): void;
}
interface SuperdoughAudioController {
  audioContext: AudioContext;
  output: SuperdoughOutput;
  nodes: Record<number, Orbit>;
  getOrbit(orbitNum: number, channels?: number[]): Orbit;
  duck(targetOrbits: number | number[], t: number, ...rest: unknown[]): void;
  reset(): void;
}
type ControllerClass = new (audioContext: AudioContext) => SuperdoughAudioController;

interface DeckChain {
  /** Where the deck's lanes sum. */
  input: GainNode;
  lpf: BiquadFilterNode;
  knobGain: GainNode;
  reverbSend: GainNode;
  convolver: ConvolverNode;
  /** The channel fader, after the trim and effects, before the crossfader. */
  volume: GainNode;
  faderGain: GainNode;
}

/**
 * The summed deck mix: input -> hpf -> lpf -> glue -> volume -> limiter -> clipper -> destination, with
 * volume -> reverb send -> convolver -> limiter. The glue compressor thickens the mix (the master's glue fader);
 * the limiter and the soft clipper after it keep a hot mix of two decks from clipping the output.
 */
interface MasterChain {
  input: GainNode;
  hpf: BiquadFilterNode;
  lpf: BiquadFilterNode;
  glue: DynamicsCompressorNode;
  volume: GainNode;
  reverbSend: GainNode;
  convolver: ConvolverNode;
  limiter: DynamicsCompressorNode;
  clipper: WaveShaperNode;
}

/** Smoothing time constant for knob and fader moves, short enough to feel instant without zipper clicks. */
const SMOOTHING = 0.02;
const DECKS: DeckId[] = ['A', 'B'];

/** The Rip tab's result editor plays here: gain only, outside the decks, crossfader and master section. */
export const RIP_ORBIT = 3;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Where the soft clipper starts to bend: below it the signal passes untouched. */
const CLIP_KNEE = 0.8;

/**
 * The soft clipper's curve over [-1, 1]: straight up to the knee, then a tanh shoulder that never reaches full scale,
 * so what the limiter lets through (its attack is not instant) is rounded instead of clipped hard.
 */
export function softClipCurve(points = 2049): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  const room = 1 - CLIP_KNEE;
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = a <= CLIP_KNEE ? x : Math.sign(x) * (CLIP_KNEE + room * Math.tanh((a - CLIP_KNEE) / room));
  }
  return curve;
}

/**
 * superdough's bundle does not export `SuperdoughAudioController`, and importing its
 * source file instead loads a second copy of superdough's audio-context singleton
 * (orbit reverb and delay sends would then build nodes on a different context). So the
 * mixer subclasses the bundled class, taken from the live default controller.
 */
function defineDeckMixer(Base: ControllerClass) {
  return class DeckMixer extends Base {
    private chains: Partial<Record<DeckId, DeckChain>> = {};
    private master: MasterChain | undefined;
    private knobs: Record<DeckId, Record<Knob, number>> = {
      A: { ...DEFAULT_DECK_CONTROLS },
      B: { ...DEFAULT_DECK_CONTROLS },
    };
    private masterValues: Record<MasterControl, number> = { ...DEFAULT_MASTER_CONTROLS };
    private fader = 0.5;
    private impulse: AudioBuffer | undefined;
    private ripGain: GainNode | undefined;
    private ripLevel = 1;

    /** A deck's or the rip's lane orbit (see lanes.ts) goes to its channel; any other orbit stays superdough's. */
    override getOrbit(orbitNum: number, channels?: number[]): Orbit {
      const channel = channelOf(orbitNum);
      if (channel === null || this.nodes[orbitNum] != null) return super.getOrbit(orbitNum, channels);
      // The superclass creates the orbit and wires it straight to the output; reroute it through the channel.
      const orbit = super.getOrbit(orbitNum, channels);
      orbit.output.disconnect();
      orbit.output.connect(this.channelInput(channel, channels));
      return orbit;
    }

    /**
     * A kick's `.duckorbit(2)` can come before the pads' lane has sounded; superdough would log that the target
     * does not exist and skip the duck. A lane of a channel is created on demand instead.
     */
    override duck(targetOrbits: number | number[], t: number, ...rest: unknown[]): void {
      for (const target of [targetOrbits].flat()) {
        if (this.nodes[target] == null && channelOf(target) !== null) this.getOrbit(target);
      }
      super.duck(targetOrbits, t, ...rest);
    }

    /** Where a channel's lanes sum: the deck chain's input, or the rip's A/B gain. */
    private channelInput(channel: number, channels?: number[]): AudioNode {
      if (channel === RIP_ORBIT) {
        if (!this.ripGain) {
          // rip lanes -> ripGain -> destination: no knobs, no crossfader, no master section.
          this.ripGain = new GainNode(this.audioContext, { gain: this.ripLevel });
          this.output.connectToDestination(this.ripGain, channels);
        }
        return this.ripGain;
      }
      const deck = DECKS.find((d) => ORBIT[d] === channel)!;
      return (this.chains[deck] ?? this.buildChain(deck, channels)).input;
    }

    override reset(): void {
      for (const chain of Object.values(this.chains)) {
        for (const node of Object.values(chain)) (node as AudioNode).disconnect();
      }
      this.chains = {};
      if (this.master) for (const node of Object.values(this.master)) (node as AudioNode).disconnect();
      this.master = undefined;
      this.ripGain?.disconnect();
      this.ripGain = undefined;
      super.reset();
    }

    /** Master section position in [0, 1]; remembered until the first deck sounds. */
    setMaster(control: MasterControl, value: number): void {
      this.masterValues[control] = clamp01(value);
      this.ramp(this.masterParam(control), MASTER_CONTROL[control](this.masterValues[control]));
      if (control === 'glue') this.ramp(this.master?.glue.ratio, glue(this.masterValues.glue).ratio);
    }

    private masterParam(control: MasterControl): AudioParam | undefined {
      const m = this.master;
      if (!m) return undefined;
      return { hpf: m.hpf.frequency, lpf: m.lpf.frequency, volume: m.volume.gain, reverb: m.reverbSend.gain, glue: m.glue.threshold }[
        control
      ];
    }

    private masterChain(channels?: number[]): MasterChain {
      if (this.master) return this.master;
      const ac = this.audioContext;
      const v = this.masterValues;
      const input = new GainNode(ac);
      const hpf = new BiquadFilterNode(ac, { type: 'highpass', frequency: MASTER_CONTROL.hpf(v.hpf) });
      const lpf = new BiquadFilterNode(ac, { type: 'lowpass', frequency: MASTER_CONTROL.lpf(v.lpf) });
      const g = glue(v.glue);
      const glueNode = new DynamicsCompressorNode(ac, { threshold: g.threshold, ratio: g.ratio, knee: 6, attack: 0.01, release: 0.2 });
      const volume = new GainNode(ac, { gain: MASTER_CONTROL.volume(v.volume) });
      const reverbSend = new GainNode(ac, { gain: MASTER_CONTROL.reverb(v.reverb) });
      this.impulse ??= hallImpulse(ac);
      const convolver = new ConvolverNode(ac, { buffer: this.impulse });
      const limiter = new DynamicsCompressorNode(ac, { threshold: -1, knee: 0, ratio: 20, attack: 0.002, release: 0.1 });
      const clipper = new WaveShaperNode(ac, { curve: softClipCurve(), oversample: '4x' });
      input.connect(hpf).connect(lpf).connect(glueNode).connect(volume).connect(limiter);
      volume.connect(reverbSend).connect(convolver).connect(limiter);
      limiter.connect(clipper);
      this.output.connectToDestination(clipper, channels);
      this.master = { input, hpf, lpf, glue: glueNode, volume, reverbSend, convolver, limiter, clipper };
      return this.master;
    }

    /** The Rip tab result's level in [0, 1] (the A/B toggle); remembered until the result first sounds. */
    setRipGain(value: number): void {
      this.ripLevel = clamp01(value);
      this.ramp(this.ripGain?.gain, this.ripLevel);
    }

    /** Crossfader position: 0 is full deck A, 1 is full deck B. */
    setFader(x: number): void {
      this.fader = clamp01(x);
      const gains = crossfadeGains(this.fader);
      DECKS.forEach((deck, i) => this.ramp(this.chains[deck]?.faderGain.gain, gains[i]));
    }

    /** Knob position in [0, 1]; remembered if the deck has not sounded yet. */
    setKnob(deck: DeckId, knob: Knob, value: number): void {
      this.knobs[deck][knob] = clamp01(value);
      this.ramp(this.knobParam(deck, knob), DECK_CONTROL[knob](this.knobs[deck][knob]));
    }

    private knobParam(deck: DeckId, knob: Knob): AudioParam | undefined {
      const chain = this.chains[deck];
      if (!chain) return undefined;
      return { lpf: chain.lpf.frequency, gain: chain.knobGain.gain, reverb: chain.reverbSend.gain, volume: chain.volume.gain }[knob];
    }

    private ramp(param: AudioParam | undefined, value: number): void {
      param?.setTargetAtTime(value, this.audioContext.currentTime, SMOOTHING);
    }

    /**
     * lanes -> input -> lowpass -> trim -> volume -> crossfader gain -> master, with trim -> reverb send -> convolver
     * -> volume. Both decks' chains sum into the master chain, which is what reaches the destination.
     */
    private buildChain(deck: DeckId, channels?: number[]): DeckChain {
      const ac = this.audioContext;
      const knobs = this.knobs[deck];
      const input = new GainNode(ac);
      const lpf = new BiquadFilterNode(ac, { type: 'lowpass', frequency: DECK_CONTROL.lpf(knobs.lpf) });
      const knobGain = new GainNode(ac, { gain: DECK_CONTROL.gain(knobs.gain) });
      const reverbSend = new GainNode(ac, { gain: DECK_CONTROL.reverb(knobs.reverb) });
      this.impulse ??= hallImpulse(ac);
      const convolver = new ConvolverNode(ac, { buffer: this.impulse });
      const volume = new GainNode(ac, { gain: DECK_CONTROL.volume(knobs.volume) });
      const faderGain = new GainNode(ac, { gain: crossfadeGains(this.fader)[DECKS.indexOf(deck)] });
      input.connect(lpf).connect(knobGain).connect(volume).connect(faderGain).connect(this.masterChain(channels).input);
      knobGain.connect(reverbSend).connect(convolver).connect(volume);
      const chain: DeckChain = { input, lpf, knobGain, reverbSend, convolver, volume, faderGain };
      this.chains[deck] = chain;
      return chain;
    }
  };
}

export type DeckMixer = InstanceType<ReturnType<typeof defineDeckMixer>>;

let mixer: DeckMixer | undefined;

/** The mixer `installMixer()` last created, or null before the engine has booted. */
export function getMixer(): DeckMixer | null {
  return mixer ?? null;
}

/**
 * Installs the deck mixer as superdough's audio controller. Call once after
 * `initEngine()` resolves and before any deck starts; later calls return the same mixer.
 */
export function installMixer(): DeckMixer {
  const current = webaudio.getSuperdoughAudioController() as SuperdoughAudioController;
  if (mixer && current === mixer) return mixer;
  const DeckMixerClass = defineDeckMixer(current.constructor as ControllerClass);
  const next = new DeckMixerClass(webaudio.getAudioContext());
  // Keep the single output graph superdough already built; drop the one our constructor made.
  next.output.disconnect();
  next.output = current.output;
  mixer = next;
  webaudio.setSuperdoughAudioController(mixer);
  return mixer;
}

// The audio graph and the Strudel scope are module singletons: a hot update would leave the
// old ones wired in while the UI drives new ones, so a change here reloads the whole page.
if (import.meta.hot) import.meta.hot.accept(() => import.meta.hot?.invalidate());
