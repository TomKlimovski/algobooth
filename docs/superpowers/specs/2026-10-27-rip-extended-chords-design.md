# Rip chords: a sharper ear, thirds from the key, the key's seventh for colour, ninths when heard

Date: 2026-10-27. Follows the rip sounds work (handover, "Rip sounds"). Tom asked for 7th and 9th chords in the rip,
checked on Solomun 36:40 and 48:50. The house examples use them (`Fm9 Db^9 Eb^7 Cm7`); the rip writes triads only
(`chords.estimate_chords`, one major or minor triad per bar by template match on CQT chroma).

## What the two clips' "other" stems play

Measured on the cached stems (`~/Algobooth/cache/stems/6d44d581d8ad286f` is 36:40, `3dd127e18e1f4e87` is 48:50), on the
golden grids. Two chromas per bar, each scaled to the bar's loudest pitch class. The peak chroma numbers, the
top-four shares and the expected chords below were re-measured on 2026-10-27 with the built peak chroma
(`chords.peak_chroma_bars`); the first probe's bin alignment was approximate.

- **CQT chroma** is what `estimate_chords` uses now.
- **Peak chroma** is a CQT at 36 bins per octave. A semitone counts only by how far its centre bin stands above the
  bins on either side, so it measures a note rather than the smear of its neighbours.

| | 36:40 (key G minor, 9 bars) | 48:50 (key D# minor, 5 bars) |
|---|---|---|
| written before this change | `G G G G G G G Gm G` | `D# Em Em A# A#` |
| CQT chroma | G 1.0; G# 0.44 to 0.58 and F# 0.30 to 0.43 either side of it; B and A# about 0.2 | bar 0: D# 1.0, A# 0.65; bars 1 to 3: every pitch class 0.7 to 1.0 |
| peak chroma | G and D (D 0.35 of G to louder than G), plus F# 0.49 in bar 3; bars 0 to 6: A# at most 0.17 of G, B at most 0.16; bar 7: G 1.0, C 0.91, A# 0.77; bar 8: D 1.0, G 0.55, A 0.55, D# 0.48, B 0.40 of G | bar 0: D# 1.0, A# 0.90, F 0.44, G 0.29; bars 1 to 3: no clear pitch class (top four under 0.45); bar 4: F 1.0, A# 0.84, C 0.52 |
| spectral peaks | G2 (with energy 33 cents either side), G3, D4 | D#3, A#3, D#4 |

What this means:

1. **Neither clip plays a 7th or a 9th** that a fair test would hear:
   - 36:40's stab is a root and a fifth.
   - 48:50 has an F above D# at 0.32 in one bar, which is weak. (Re-measured with the built peak chroma: 0.44 of
     D#, which clears `EXT_SHARE`; see the predictions under "Sevenths and ninths".)
   - Bar 7 of 36:40 (C, G, A#) is the one place a 7th might be there: `Cm7` with no third, or `Gm` with C over it.
2. **The CQT chroma would invent extensions.** At 36:40 it puts F# and G# at 0.3 to 0.58 around the G: the smear of
   one note, plus the pitch wobble seen in the spectral peaks. A 7th or 9th test on that chroma would write `G^7` or
   `G7b9` on a bare G. Any extension test must use the peak chroma.
3. **The bigger error on these clips is the third.**
   - 36:40 has no third, so the template tie goes to major, and the rip writes `G` against a G minor key.
   - 48:50's bars 1 and 2 are noise to a chord template, and the rip writes `Em`, a chord outside D# minor.

So this change does four things, in order of what the two clips will hear: a sharper ear, the key's third where the
record plays none, the key's 7th on every chord for house colour (Tom, 2026-10-27: "thirdless or triad stabs should
borrow the key's diatonic 7th for colour"), and a 9th, or a 7th other than the key's, only where it is heard.

## Goals

- **Chords the record plays.** A thirdless stab takes the third of the key, so the rip writes `Gm` for 36:40, not
  `G`. A 7th or 9th that differs from the key's is written when the peak chroma shows it; neither clip is expected to
  show one.
- **House colour.** A chord on a degree of the key gets the key's diatonic 7th, whether or not the stem plays it, so
  36:40 writes `Gm7` and 48:50 `D#m7 … A#m7`. Colour is the rip's style choice, so a muted `_triads:` line keeps the
  chords as heard (no borrowed 7th) for an A/B by unmuting.
- **Honest bars.** A bar with no clear pitch class has no chord of its own: it repeats the previous bar's chord,
  exactly as a silent bar does now.
- **Symbols that voice.** Only spellings the house examples already play, which the golden test proves sound:
  `m`, `m7`, `m9`, `7`, `9`, `^7`, `^9`, plus `add9`, `madd9`, `m^7`, `m^9`, which the iReal dictionary has as
  `add9`, `-add9`, `-^7`, `-^9`. The `m` spellings reach it through its `-` to `m` alias; the golden test is what
  confirms each one voices.

## Non-goals and anti-goals

- **Colour only from the key.** A borrowed 7th is the key's own scale note. There is no borrowed 7th on a root
  outside the key, on a diminished degree, or where it would make a minor chord with a major 7th. A 9th is never
  borrowed, only heard.
- **No sus, diminished, augmented, 6th, 11th or 13th** chords, and no slash chords or inversions. `.voicing()` picks
  the voicing.
- **No change to how many chords per bar** (one), the bar grid, or the instrument choice.
- **Anti-goal:** a rip that writes `G^7`, `G7b9` or `Em9` on a bare G stab, or on a noisy bar. That is worse than a
  triad.

## The design

All in `service/algorip/chords.py` unless named otherwise.

1. **Peak chroma.**
   - A CQT of the "other" stem: hop 512 (as now), 36 bins per octave from C1 over 7 octaves, tuned by the clip's
     tuning, estimated with `librosa.estimate_tuning` (0.04 and 0.03 on the two clips).
   - Per frame and semitone: the centre bin minus the larger of its two neighbours, floored at 0, summed over
     octaves into 12 pitch classes.
   - The bar mean is taken as `_bar_means` takes it now.
   - The triad template match and the silence gate stay as they are (CQT chroma and STFT chroma). Only the third
     and extension tests, and the clear-bar test, read the peak chroma.

2. **A clear bar.** A bar whose four strongest peak pitch classes hold less than `CLEAR_SHARE` of its peak chroma
   is not clear, and repeats the previous symbol as a silent bar does. Flat chroma, as from noise, spreads its weight;
   a chord concentrates it.
   - The first version of this rule ("fewer than two pitch classes at half the loudest") would have called noise
     clear, because flat chroma has many pitch classes near the top.
   - Measured top-four shares:

     | | shares |
     |---|---|
     | 36:40 | 0.53 to 0.78 |
     | 48:50 | bar 0 0.69, bars 1 and 2 0.42 and 0.43, bar 3 0.447, bar 4 0.54 |
     | white noise | 0.38 to 0.43 (three seeds) |
     | synthetic triads and fifths | 1.0 |

   - Starting value 0.45: 48:50's bars 1 and 2 carry bar 0's chord. Bar 3 falls 0.003 under the line and carries it
     too, where the first probe had it clear as `A#m`: a finding for Tom by ear. The margins are thin on both sides
     (white noise reaches 0.43), so a rerun that moves a bar across the line is a finding to report, not to tune.

3. **The third.** After the template picks a root:
   - **Neither third heard.** Both the minor third and the major third are under `THIRD_SHARE` of the root's peak
     chroma (starting value 0.25; 36:40's bars 0 to 6 read B at most 0.16 and A# at most 0.17 of G). If the root is in the key's
     scale, the chord takes the key's diatonic quality on that degree (`key.py` `_SCALE_STEPS`: in G minor, G is
     minor). A root outside the key keeps the template's pick.
   - **Third heard.** If one third clears the test, it decides.
   - **Both heard.** The louder third decides.
   - **Diminished degrees.** The diatonic quality on a degree that holds a diminished triad (ii in minor, vii in
     major) is the template's pick, since diminished is a non-goal.

4. **Sevenths and ninths.** On a clear bar, measured on the peak chroma against the root:
   - **7th:** the minor 7th (10 semitones) or the major 7th (11) at or above `EXT_SHARE` of the root. If both clear
     it, neither is written and the bar borrows the key's 7th (section 5): a played chord rarely holds both, and on
     36:40's bar 8 (F 0.6656 against F# 0.6675 of G) they are smear around the 9th, a 0.002 coin flip. Starting
     value: 0.4, chosen to keep 48:50's F (0.32 in the first probe) out; re-measured, it reads 0.44 and clears it, a
     finding for Tom by ear.
   - **9th:** the major 9th (2 semitones) at or above `EXT_SHARE`. A minor 9th is never written.
   - **Not a smear.** An extension a semitone from a chord tone counts only if its peak chroma (not its CQT chroma)
     clears the test. The peak chroma already does this; a test pins it with a smeared fixture.
   - **Spelling** (major and minor):

     | heard | major chord | minor chord |
     |---|---|---|
     | 7th and 9th | `9` with a minor 7th, `^9` with a major 7th | `m9` with a minor 7th, `m^9` with a major 7th |
     | 7th only | `7` or `^7` | `m7` or `m^7` |
     | 9th only | `add9` | `madd9` |

   - The heard triads `estimate_chords` writes now (task 1): 36:40 `Gm Gm Gm Gm Gm Gm Gm Gm G`, 48:50
     `D# D# D# D# A#`. Where these differ from the first probe's expectation (`Gm` in every bar; `D#m … A#m A#m`)
     they are findings for Tom by ear, not values to tune:
     - 36:40 bar 8 hears B at 0.40 of G against A# at 0.37, so it writes `G`.
     - 48:50 bar 0 hears G at 0.29 of D#, so it writes `D#`; bars 1 to 3 repeat it (bar 3 is unclear, see above);
       bar 4 hears D at 0.40 against C# at 0.39 of A#, so it writes `A#`.
   - The heard chords with extensions (what `_triads:` holds), as `estimate_chords` writes them at `EXT_SHARE` 0.4
     against the root (task 2 measured; differences are findings for Tom by ear): 36:40
     `Gm Gm Gm Gm^7 Gm Gm Gm Gm Gadd9`, 48:50 `D#add9 D#add9 D#add9 D#add9 A#9`.
     - 36:40: `Gm` in bars 0 to 2 and 4 to 7 (7ths at most 0.23, 9ths at most 0.26; bar 3's 9th is 0.33). Bar 3's
       F# reads 0.49 of G, which writes `Gm^7`; whether that F# is a note or the G's wobble is the first thing to
       check by ear (the wobbling-fifth fixture puts F# at 0.01, so the peak chroma does not make it from a wobble).
       Bar 8: the 9th (A) at 1.00 and both 7ths at 0.67 of G (F# 0.6675 against F 0.6656), so neither 7th is
       written: `Gadd9`, which takes G minor's F in colour. Which 7th it is, if either, is a finding for Tom by ear.
     - 48:50: bar 0 the 9th (F) at 0.44, so `D#add9`, repeated in bars 1 to 3; bar 4 the minor 7th (G#) at 0.43 and
       the 9th (C) at 0.62, so `A#9`.
   - Bar 7 of 36:40 is the one ambiguous bar: the CQT template picks G, and the peak chroma reads G 1.0, C 0.91,
     A# 0.77, which is `Gm` with C over it or `Cm7` with no third. The root stays the template's in this change. If
     Tom hears `Cm7` there, moving the root choice to the peak chroma is the follow-up.

5. **The key's 7th for colour.** After the third and the heard extensions, a chord with no heard 7th borrows one:
   - **The borrowed 7th** is the key's scale note 10 or 11 semitones above the root. For a root in the scale, exactly
     one of the two is in it.
     - In minor: i `m7`, III `^7`, iv `m7`, v `m7`, VI `^7`, VII `7`.
     - In major: I `^7`, ii `m7`, iii `m7`, IV `^7`, V `7`, vi `m7`.
   - **No colour** on a root outside the key, on the diminished degree (ii in minor, vii in major), or where the
     borrowed 7th would make `m^7`. Such a bar keeps its heard symbol.
   - **A heard 7th wins.** If the stem plays a 7th, that one is written, even if it is not the key's.
   - **A heard 9th** with a borrowed 7th spells as a 9th chord (`m9`, `9`, `^9`) by the table above.
   - **Repeated bars.** A silent or unclear bar repeats the previous bar's symbol, colour included.
   - **Expected:**
     - Measured in task 3 with `colour_chords(estimate_chords(...), key)` on both stems (differences from the first
       probe's `Gm7` everywhere and `D#m7 D#m7 D#m7 A#m7 A#m7` are findings for Tom by ear):
     - 36:40: `Gm7 Gm7 Gm7 Gm^7 Gm7 Gm7 Gm7 Gm7 G9`: `Gm7` in bars 0 to 2 and 4 to 7, `Gm^7` in bar 3 (a heard 7th
       wins), `G9` in bar 8 (the heard 9th with G minor's F, since both 7ths were heard).
     - 48:50: `D#9 D#9 D#9 D#9 A#9` (bar 0's heard 9th with the borrowed C#; bar 4's heard 7th and 9th).

6. **Where it lives.**
   - `estimate_chords` returns the heard symbols as now.
   - A new `colour_chords(chords, key)` in `chords.py` adds the borrowed 7ths. `pipeline._analyse` stores both:
     - `Analysis.chords`: the coloured symbols, which every line of the rip reads.
     - New `Analysis.heard_chords: list[str] | None = None`: the heard ones, `None` on old saved results.
   - `generate.py` writes the coloured `chords:` line as now. When `heard_chords` differs from `chords`, it adds,
     right after `chords:`, a muted `_triads:` line: the same instrument and gains on the heard symbols. Tom's
     principle: variations go in muted `_name:` lines.
   - `ripApi.ts` `Analysis` gains `heard_chords: string[] | null`, and the test fixtures gain `heard_chords: null`.
     The Rip tab's analysis line shows `chords` as now.

7. **Fixtures and tests.**
   - `tests/synth.py` `pad_chords` gains qualities: `m7`, `7`, `^7`, `m9`, `9`, a bare fifth `5`, and a fifth with
     pitch wobble, which smears the chroma the way 36:40 does.
   - `test_chords.py` checks:
     - Each quality round-trips.
     - A bare fifth in a minor key reads minor, and in a major key reads major.
     - The wobbling fifth gets no 7th or 9th.
     - A noise bar repeats the previous chord.
     - `colour_chords` covers every degree in both modes, the no-colour cases (outside the key, diminished, `m^7`),
       a heard 7th that is not the key's, and a heard 9th.
   - `test_generate.py` checks that `_triads:` is written only when the heard and coloured chords differ, and that
     it is muted.
   - Regenerate the goldens (`scripts/bass_fixture.py stems` for `solomun` and `solomun2`, `synthetic build`).
     `rip/golden.test.ts` then proves every written symbol voices to at least three notes in every bar.
   - The golden diffs should be exactly the chord changes above, plus the `_triads:` lines. Anything else is a finding to report, not to tune
     away.

8. **Docs.** README "Rip" (what the chords line can now hold, and `_triads:`) and the handover's Rip sounds section
   get the peak chroma, the third rule, the extension rule, the colour rule, and the measurements in the table above.

## Left to the builder

- The exact peak chroma code: bin alignment with `librosa.cqt`'s bin order, and the octave range.
- Whether to compute the peak chroma once with the existing CQT, or as a second CQT.
- The starting values above may move if the synthetic fixtures need it. Each move gets a one-line reason in the
  docstring, as `other_tone` has.

## Open questions for Tom (by ear, after it is built)

- **Thirds:** does `Gm` under 36:40 sound right where `G` played before? Is bar 7 `Gm`, or `Cm7`?
- **House colour:** does `Gm7` on the Rhodes sit better than the heard `Gm`? Unmute `_triads:` and mute `chords:`
  to compare.
- A clip that really plays 7ths and 9ths (a deep house record) would test the heard-extension rule properly; neither
  Solomun clip does.
