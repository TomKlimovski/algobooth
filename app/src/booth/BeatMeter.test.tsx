import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import type { BeatPosition } from './beat';
import { BeatMeter } from './BeatMeter';
import type { Quantise } from './keys/bindings';

let dispose = () => {};
afterEach(() => dispose());

function mount(pos: BeatPosition | null, waiting = false, quantise: Quantise = 'bar') {
  const root = document.createElement('div');
  const [p, setP] = createSignal(pos);
  const [w, setW] = createSignal(waiting);
  dispose = render(() => <BeatMeter pos={p()} waiting={w()} quantise={quantise} />, root);
  const lamps = () => [...root.querySelectorAll('.beat-lamp')];
  return { root, lamps, setP, setW };
}

describe('BeatMeter', () => {
  it('shows bar.beat and lights the current beat', () => {
    const { root, lamps } = mount({ bar: 12, beat: 3, flash: true });
    expect(root.querySelector('.beat-count')!.textContent).toBe('12.3');
    expect(lamps().map((l) => l.classList.contains('lit'))).toEqual([false, false, true, false]);
    expect(lamps()[2].classList.contains('flash')).toBe(true);
  });

  it('follows the clock as it moves on', () => {
    const { root, lamps, setP } = mount({ bar: 1, beat: 4, flash: false });
    setP({ bar: 2, beat: 1, flash: true });
    expect(root.querySelector('.beat-count')!.textContent).toBe('2.1');
    expect(lamps()[0].classList.contains('lit')).toBe(true);
  });

  it('shows a dash while the deck is stopped', () => {
    const { root, lamps } = mount(null);
    expect(root.querySelector('.beat-count')!.textContent).toBe('-.-');
    expect(lamps().some((l) => l.classList.contains('lit'))).toBe(false);
  });

  it('blinks the downbeat on the beat while presses wait for the bar', () => {
    const { root, lamps, setP, setW } = mount({ bar: 2, beat: 3, flash: true }, true);
    expect(root.querySelector('.beat-meter')!.classList.contains('waiting')).toBe(true);
    expect(lamps()[0].classList.contains('landing')).toBe(true);
    expect(lamps()[0].classList.contains('blink')).toBe(true);
    setP({ bar: 2, beat: 3, flash: false });
    expect(lamps()[0].classList.contains('blink')).toBe(false);
    setW(false);
    expect(lamps()[0].classList.contains('landing')).toBe(false);
  });

  it('marks the next beat when quantise is beat', () => {
    const { lamps } = mount({ bar: 1, beat: 4, flash: false }, true, 'beat');
    expect(lamps().map((l) => l.classList.contains('landing'))).toEqual([true, false, false, false]);
  });
});
