import * as webaudio from '@strudel/webaudio';
import { ORBIT, type DeckId } from '../booth/deckState';
import { crossfadeGains } from './crossfade';
import {
  DECK_CONTROL,
  DEFAULT_DECK_CONTROLS,
  DEFAULT_MASTER_CONTROLS,
  MASTER_CONTROL,
  type DeckControl,
  type MasterControl,
} from './controlMap';

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
  reset(): void;
}
type ControllerClass = new (audioContext: AudioContext) => SuperdoughAudioController;

interface DeckChain {
  lpf: BiquadFilterNode;
  knobGain: GainNode;
  reverbSend: GainNode;
  convolver: ConvolverNode;
  /** The channel fader, after the trim and effects, before the crossfader. */
  volume: GainNode;
  faderGain: GainNode;
}

/** The summed deck mix: input -> hpf -> lpf -> volume -> destination, with volume -> reverb send -> convolver -> destination. */
interface MasterChain {
  input: GainNode;
  hpf: BiquadFilterNode;
  lpf: BiquadFilterNode;
  volume: GainNode;
  reverbSend: GainNode;
  convolver: ConvolverNode;
}

/** Smoothing time constant for knob and fader moves, short enough to feel instant without zipper clicks. */
const SMOOTHING = 0.02;
const REVERB_SECONDS = 2;
const DECKS: DeckId[] = ['A', 'B'];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function noiseImpulse(ac: AudioContext): AudioBuffer {
  const length = Math.round(REVERB_SECONDS * ac.sampleRate);
  const buffer = ac.createBuffer(2, length, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
  }
  return buffer;
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

    override getOrbit(orbitNum: number, channels?: number[]): Orbit {
      const deck = DECKS.find((d) => ORBIT[d] === orbitNum);
      if (deck === undefined || this.nodes[orbitNum] != null) return super.getOrbit(orbitNum, channels);
      // The superclass creates the orbit and wires it straight to the output; reroute it through the deck chain.
      const orbit = super.getOrbit(orbitNum, channels);
      orbit.output.disconnect();
      // Both deck chains sum into the master chain, which is what reaches the destination.
      this.buildChain(deck, orbit.output).connect(this.masterChain(channels).input);
      return orbit;
    }

    override reset(): void {
      for (const chain of Object.values(this.chains)) {
        for (const node of Object.values(chain)) (node as AudioNode).disconnect();
      }
      this.chains = {};
      if (this.master) for (const node of Object.values(this.master)) (node as AudioNode).disconnect();
      this.master = undefined;
      super.reset();
    }

    /** Master section position in [0, 1]; remembered until the first deck sounds. */
    setMaster(control: MasterControl, value: number): void {
      this.masterValues[control] = clamp01(value);
      this.ramp(this.masterParam(control), MASTER_CONTROL[control](this.masterValues[control]));
    }

    private masterParam(control: MasterControl): AudioParam | undefined {
      const m = this.master;
      if (!m) return undefined;
      return { hpf: m.hpf.frequency, lpf: m.lpf.frequency, volume: m.volume.gain, reverb: m.reverbSend.gain }[control];
    }

    private masterChain(channels?: number[]): MasterChain {
      if (this.master) return this.master;
      const ac = this.audioContext;
      const v = this.masterValues;
      const input = new GainNode(ac);
      const hpf = new BiquadFilterNode(ac, { type: 'highpass', frequency: MASTER_CONTROL.hpf(v.hpf) });
      const lpf = new BiquadFilterNode(ac, { type: 'lowpass', frequency: MASTER_CONTROL.lpf(v.lpf) });
      const volume = new GainNode(ac, { gain: MASTER_CONTROL.volume(v.volume) });
      const reverbSend = new GainNode(ac, { gain: MASTER_CONTROL.reverb(v.reverb) });
      this.impulse ??= noiseImpulse(ac);
      const convolver = new ConvolverNode(ac, { buffer: this.impulse });
      input.connect(hpf).connect(lpf).connect(volume);
      volume.connect(reverbSend).connect(convolver);
      this.output.connectToDestination(volume, channels);
      this.output.connectToDestination(convolver, channels);
      this.master = { input, hpf, lpf, volume, reverbSend, convolver };
      return this.master;
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

    /** orbit -> lowpass -> trim -> volume -> crossfader gain, with trim -> reverb send -> convolver -> volume. */
    private buildChain(deck: DeckId, input: AudioNode): GainNode {
      const ac = this.audioContext;
      const knobs = this.knobs[deck];
      const lpf = new BiquadFilterNode(ac, { type: 'lowpass', frequency: DECK_CONTROL.lpf(knobs.lpf) });
      const knobGain = new GainNode(ac, { gain: DECK_CONTROL.gain(knobs.gain) });
      const reverbSend = new GainNode(ac, { gain: DECK_CONTROL.reverb(knobs.reverb) });
      this.impulse ??= noiseImpulse(ac);
      const convolver = new ConvolverNode(ac, { buffer: this.impulse });
      const volume = new GainNode(ac, { gain: DECK_CONTROL.volume(knobs.volume) });
      const faderGain = new GainNode(ac, { gain: crossfadeGains(this.fader)[DECKS.indexOf(deck)] });
      input.connect(lpf).connect(knobGain).connect(volume).connect(faderGain);
      knobGain.connect(reverbSend).connect(convolver).connect(volume);
      this.chains[deck] = { lpf, knobGain, reverbSend, convolver, volume, faderGain };
      return faderGain;
    }
  };
}

export type DeckMixer = InstanceType<ReturnType<typeof defineDeckMixer>>;

let mixer: DeckMixer | undefined;

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
