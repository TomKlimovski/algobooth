import type { RipResult } from './ripApi';
import { defaultName, ripPattern } from './ripPattern';

function result(a: { bpm: number; key: string }): RipResult {
  return {
    title: 'Around The World',
    analysis: {
      bpm: a.bpm, key: a.key, meter: '4/4', bars: 8, steps_per_bar: 16, first_downbeat: 0.1,
      drums: { bd: [[0, 0]] }, four_on_the_floor: true, bass: [], bass_harmonics: 0.2, bass_envelope: null, bass_tone: null, tuning_cents: 0, chords: [], melody: null, bass_loop: null, drum_summary: null, drum_tone: null, other_tone: null, heard_chords: null,
    },
    sounds: { drum_bank: 'RolandTR909', snare_name: 'cp', bass_sound: 'sawtooth', bass_lpf: 800, bass_envelope: null, bass_filter_env: null, bass_tremolo: null, drum_samples: {}, drum_gains: {}, bass_fm: null, bass_shape: 0.3, bass_gain: 0.55, chord_sound: 'gm_epiano1', chord_lpf: null, chord_gain: 0.6, melody_gain: 0.6, room: 0.4 },
    code: 'code', tidied_code: null, tidy_error: null, stems: ['drums', 'bass', 'other', 'vocals', 'mix'],
  };
}

test('builds a rip pattern with source and rounded cpm', () => {
  const p = ripPattern(result({ bpm: 125.6, key: 'A minor' }), { url: 'u', start: 72, end: 88 }, 'Around 1:12', 'code', () => new Date('2026-10-19T10:00:00Z'));
  expect(p).toEqual({ name: 'Around 1:12', code: 'code', cpm: 126, key: 'A minor', tags: [], notes: '',
    source: { kind: 'rip', url: 'u', start: 72, end: 88, rippedAt: '2026-10-19T10:00:00.000Z' } });
  expect(defaultName('Around The World', 72)).toBe('Around The World 1:12');
});

test('default name is trimmed to 80 characters', () => {
  const name = defaultName('x'.repeat(100), 72);
  expect(name).toHaveLength(80);
  expect(name).toBe('x'.repeat(80));
  expect(defaultName('', 5)).toBe('0:05');
});
