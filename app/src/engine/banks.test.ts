import { BUNDLED_MACHINES, filterManifest } from './banks';
test('bundled set includes the machines the rip rules name', () => {
  expect(BUNDLED_MACHINES).toEqual(expect.arrayContaining(['RolandTR909', 'RolandTR808', 'RolandTR707', 'RolandTR606', 'LinnDrum', 'AkaiMPC60']));
});
test('filterManifest keeps _base and only entries for bundled machines', () => {
  const m = { _base: 'x/', RolandTR909_bd: ['a.wav'], CasioSK1_bd: ['b.wav'] };
  expect(filterManifest(m, ['RolandTR909'])).toEqual({ _base: 'x/', RolandTR909_bd: ['a.wav'] });
});
