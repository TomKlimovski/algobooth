import { describe, expect, it } from 'vitest';
import { slugOf } from './cue';

describe('slugOf', () => {
  it('lower-cases and joins words with underscores', () => expect(slugOf('Acid line')).toBe('acid_line'));
  it('cuts at the first word boundary at or after 12 characters', () =>
    expect(slugOf('Solomun – Live at Alexandra Palace, London (2026) (Official Film) 36:40')).toBe('solomun_live'));
  it('keeps a hyphenated name whole when the 12th character lands inside its last word', () =>
    expect(slugOf('Acid-switch-angel')).toBe('acid_switch_angel'));
  it('keeps a long first word', () => expect(slugOf('Supercalifragilistic bass')).toBe('supercalifragilistic'));
  it('prefixes a slug that starts with a digit', () => expect(slugOf('909 kick')).toBe('p_909_kick'));
  it('falls back to cued for a name with no word characters', () => expect(slugOf('🎛 · …')).toBe('cued'));
});
