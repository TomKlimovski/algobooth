/** Test stand-in for @kabelsalat/web (Strudel's audio-graph language), which needs a real browser. */
export class SalatRepl {
  evaluate(): never {
    throw new Error('kabelsalat is not available in tests');
  }
}
