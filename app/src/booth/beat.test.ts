import { describe, expect, it } from 'vitest';
import { beatAt, landingBeat } from './beat';

describe('beatAt', () => {
  it('counts bars and beats from 1, a cycle being a bar of four beats', () => {
    expect(beatAt(0)).toEqual({ bar: 1, beat: 1, flash: true });
    expect(beatAt(0.25)).toMatchObject({ bar: 1, beat: 2 });
    expect(beatAt(0.99)).toMatchObject({ bar: 1, beat: 4 });
    expect(beatAt(11.5)).toMatchObject({ bar: 12, beat: 3 });
  });

  it('flashes for the first part of each beat only', () => {
    expect(beatAt(2.26).flash).toBe(true);
    expect(beatAt(2.4).flash).toBe(false);
  });

  it('reads the clock lead before cycle 0 as the first beat', () => {
    expect(beatAt(-0.01)).toEqual({ bar: 1, beat: 1, flash: true });
  });
});

describe('landingBeat', () => {
  it('lands a bar press on the next downbeat and a beat press on the next beat', () => {
    expect(landingBeat(3, 'bar')).toBe(1);
    expect(landingBeat(3, 'beat')).toBe(4);
    expect(landingBeat(4, 'beat')).toBe(1);
  });

  it('has no landing for quantise now', () => {
    expect(landingBeat(2, 'now')).toBeNull();
  });
});
