import { DIRT_SOUNDS, findZone, parseFont, pickSounds, SOUNDFONTS } from './packs';
import { BUNDLED_MACHINES } from './banks';

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));

test('parseFont reads zones as text and decodes their audio, even with // inside the base64', () => {
  const source = `console.log('load _tone_x');
var _tone_x={
	zones:[
		{
			midi:4
			,originalPitch:4400
			,keyRangeLow:0
			,keyRangeHigh:40
			,loopStart:13689
			,loopEnd:14117
			,coarseTune:0
			,fineTune:16
			,sampleRate:44100
			,ahdsr:true
			,file:'${b64([0xff, 0xff, 0xfc, 1, 2])}'
			,anchor:0.0054
			//_tone.Soft_EP_C1
		}
		,{
			midi:4
			,originalPitch:5600
			,keyRangeLow:41
			,keyRangeHigh:127
			,coarseTune:1
			,fineTune:-10
			,sampleRate:22050
			,file:'${b64([9])}'
		}
	]
};`;
  expect(b64([0xff, 0xff, 0xfc, 1, 2])).toContain('//');
  const zones = parseFont(source);
  expect(zones).toHaveLength(2);
  expect(zones[0]).toMatchObject({ low: 0, high: 40, pitch: 4384, loopStart: 13689, loopEnd: 14117, sampleRate: 44100 });
  expect([...zones[0].audio]).toEqual([0xff, 0xff, 0xfc, 1, 2]);
  expect(zones[1]).toMatchObject({ low: 41, high: 127, pitch: 5510, loopStart: 0, loopEnd: 0, sampleRate: 22050 });
});

test('findZone takes the first range holding the note, its top inclusive by one as upstream', () => {
  const zones = [
    { low: 0, high: 40, id: 'a' },
    { low: 41, high: 60, id: 'b' },
  ];
  expect(findZone(zones, 40)?.id).toBe('a');
  expect(findZone(zones, 41)?.id).toBe('a');
  expect(findZone(zones, 42)?.id).toBe('b');
  expect(findZone(zones, 62)).toBeUndefined();
});

test('pickSounds keeps _base and the named entries', () => {
  expect(pickSounds({ _base: 'x/', house: ['a'], bd: ['b'] }, ['house'])).toEqual({ _base: 'x/', house: ['a'] });
});

test('no bundled Dirt-Samples folder hides a drum voice or a drum machine name', () => {
  const voices = ['bd', 'sd', 'hh', 'oh', 'cp', 'rim', 'lt', 'mt', 'ht', 'cr', 'rd', 'cb', 'sh', 'perc', 'misc', 'fx', 'tb'];
  for (const name of DIRT_SOUNDS) {
    expect(voices).not.toContain(name);
    expect(BUNDLED_MACHINES.map((m) => m.toLowerCase())).not.toContain(name);
  }
});

test('every soundfont instrument has at least one font and no font is listed twice for it', () => {
  for (const [name, fonts] of Object.entries(SOUNDFONTS)) {
    expect(name).toMatch(/^gm_/);
    expect(fonts.length).toBeGreaterThan(0);
    expect(new Set(fonts).size).toBe(fonts.length);
  }
});
