import * as webaudio from '@strudel/webaudio';
import { ORBIT, type DeckId } from '../booth/deckState';
import { crossfadeGains } from './crossfade';

export type Knob = 'lpf' | 'gain' | 'reverb';

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
  faderGain: GainNode;
}

/** Smoothing time constant for knob and fader moves, short enough to feel instant without zipper clicks. */
const SMOOTHING = 0.02;
const REVERB_SECONDS = 2;
const DECKS: DeckId[] = ['A', 'B'];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Knob position in [0, 1] to the AudioParam value it drives. */
const KNOB_VALUE: Record<Knob, (v: number) => number> = {
  lpf: (v) => 200 * Math.pow(100, v), // exponential 200 Hz .. 20 kHz
  gain: (v) => 1.2 * v,
  reverb: (v) => 0.6 * v, // send gain
};

/** Knob positions a fresh deck starts at: filter open, unity gain, dry. */
const DEFAULT_KNOBS: Record<Knob, number> = { lpf: 1, gain: 1 / 1.2, reverb: 0 };

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
    private knobs: Record<DeckId, Record<Knob, number>> = { A: { ...DEFAULT_KNOBS }, B: { ...DEFAULT_KNOBS } };
    private fader = 0.5;
    private impulse: AudioBuffer | undefined;

    override getOrbit(orbitNum: number, channels?: number[]): Orbit {
      const deck = DECKS.find((d) => ORBIT[d] === orbitNum);
      if (deck === undefined || this.nodes[orbitNum] != null) return super.getOrbit(orbitNum, channels);
      // The superclass creates the orbit and wires it straight to the output; reroute it through the deck chain.
      const orbit = super.getOrbit(orbitNum, channels);
      orbit.output.disconnect();
      const faderGain = this.buildChain(deck, orbit.output);
      this.output.connectToDestination(faderGain, channels);
      return orbit;
    }

    override reset(): void {
      for (const chain of Object.values(this.chains)) {
        for (const node of Object.values(chain)) (node as AudioNode).disconnect();
      }
      this.chains = {};
      super.reset();
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
      this.ramp(this.knobParam(deck, knob), KNOB_VALUE[knob](this.knobs[deck][knob]));
    }

    private knobParam(deck: DeckId, knob: Knob): AudioParam | undefined {
      const chain = this.chains[deck];
      if (!chain) return undefined;
      return { lpf: chain.lpf.frequency, gain: chain.knobGain.gain, reverb: chain.reverbSend.gain }[knob];
    }

    private ramp(param: AudioParam | undefined, value: number): void {
      param?.setTargetAtTime(value, this.audioContext.currentTime, SMOOTHING);
    }

    /** orbit -> lowpass -> knob gain -> fader gain, with knob gain -> reverb send -> convolver -> fader gain. */
    private buildChain(deck: DeckId, input: AudioNode): GainNode {
      const ac = this.audioContext;
      const knobs = this.knobs[deck];
      const lpf = new BiquadFilterNode(ac, { type: 'lowpass', frequency: KNOB_VALUE.lpf(knobs.lpf) });
      const knobGain = new GainNode(ac, { gain: KNOB_VALUE.gain(knobs.gain) });
      const reverbSend = new GainNode(ac, { gain: KNOB_VALUE.reverb(knobs.reverb) });
      this.impulse ??= noiseImpulse(ac);
      const convolver = new ConvolverNode(ac, { buffer: this.impulse });
      const faderGain = new GainNode(ac, { gain: crossfadeGains(this.fader)[DECKS.indexOf(deck)] });
      input.connect(lpf).connect(knobGain).connect(faderGain);
      knobGain.connect(reverbSend).connect(convolver).connect(faderGain);
      this.chains[deck] = { lpf, knobGain, reverbSend, convolver, faderGain };
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
