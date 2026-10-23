import { BUNDLED_MACHINES, filterManifest, withPlainNames } from './banks';
test('bundled set includes the machines the rip rules name', () => {
  expect(BUNDLED_MACHINES).toEqual(expect.arrayContaining(['RolandTR909', 'RolandTR808', 'RolandTR707', 'RolandTR606', 'LinnDrum', 'AkaiMPC60']));
});
test('filterManifest keeps _base and only entries for bundled machines', () => {
  const m = { _base: 'x/', RolandTR909_bd: ['a.wav'], CasioSK1_bd: ['b.wav'] };
  expect(filterManifest(m, ['RolandTR909'])).toEqual({ _base: 'x/', RolandTR909_bd: ['a.wav'] });
});
test('withPlainNames names each voice by its first machine and keeps existing entries', () => {
  const manifest = {
    _base: './x/',
    RolandTR808_bd: ['808bd.wav'],
    RolandTR909_bd: ['909bd.wav'],
    RolandTR909_rd: ['909rd.wav'],
    hh: ['own.wav'],
    RolandTR808_hh: ['808hh.wav'],
  };
  const out = withPlainNames(manifest, ['RolandTR808', 'RolandTR909']);
  expect(out.bd).toEqual(['808bd.wav']);
  expect(out.rd).toEqual(['909rd.wav']);
  expect(out.hh).toEqual(['own.wav']);
  expect(out.RolandTR909_bd).toEqual(['909bd.wav']);
});
