# Rip Extended Chords Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rip's chords line hears the third from the key when the stem plays none, writes a heard 7th or 9th, and
borrows the key's diatonic 7th for colour. A muted `_triads:` line keeps the chords as heard.

**Architecture:**
- **Peak chroma.** A peak-picked chroma (CQT at 36 bins per octave; each semitone's centre bin over its neighbours)
  drives three new per-bar tests in `chords.py`: is the bar clear, which third, which extensions. The existing CQT
  template still picks the root.
- **Colour.** A pure `colour_chords(chords, key)` adds the borrowed 7ths.
- **Pipeline.** The pipeline stores the coloured chords as `Analysis.chords`, which every existing line reads, and
  the heard ones as `Analysis.heard_chords`.
- **Code.** `generate.py` adds `_triads:` when the two differ.

**Tech Stack:** Python 3 with librosa, numpy, pydantic and pytest (run with `uv run` from `service/`); TypeScript with
vitest (`pnpm exec vitest run` and `pnpm exec tsc --noEmit` from the repo root).

**Spec:** `docs/superpowers/specs/2026-10-27-rip-extended-chords-design.md`

## Global Constraints

- **Starting values:**
  - `CLEAR_SHARE = 0.45`, the share of a bar's peak chroma held by its four strongest pitch classes
  - `THIRD_SHARE = 0.25`
  - `EXT_SHARE = 0.4`

  These may move only if a synthetic fixture needs it, with a one-line reason in the docstring.
- **Symbols written.** Only `""` (major), `m`, `7`, `^7`, `9`, `^9`, `add9`, `m7`, `m^7`, `m9`, `m^9`, `madd9`, plus
  `~` for no chord. Never sus, dim, aug, 6, 11, 13, slash chords or a minor 9th.
- **Roots** are sharps-only names, as `chord_name` writes them now.
- **Borrowed 7ths.**
  - In minor: i `m7`, III `^7`, iv `m7`, v `m7`, VI `^7`, VII `7`.
  - In major: I `^7`, ii `m7`, iii `m7`, IV `^7`, V `7`, vi `m7`.
  - None outside the key, on the diminished degree, or where the result would be `m^7`.
- **The anti-goal:** a 7th or 9th written from smear. A bare G with pitch wobble must not become `G^7` or `G7b9`.
- **Golden diffs:** a diff that is not one of the spec's expected chord changes, or a `_triads:` line, is a finding to
  report, not to tune away.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **An old saved result** with no `heard_chords` (`None`) must generate with no `_triads:` line and no error.
  Task 4 adds this test.
- **A first bar with no chord (`~`)** must stay `~` through colouring, and `_triads:` must not differ only because
  of it. Task 3 adds this test.
- **A heard quality the key would not give.** A major V in a minor key (D major in G minor) borrows the scale's 7th
  and gives `D7`, not `D^7`. Task 3 adds this test.
- **`estimate_chords` called with no key** (old callers and tests) must behave as now for chords with clear thirds:
  no third rule and no crash. Task 1 keeps `test_chords_per_bar` unchanged and passing without a key.
- **A heard 9th on a chord whose 7th is borrowed** spells as a 9th chord (`Gm9`), not `Gmadd9`. Task 3 adds this
  test.

---

### Task 1: Peak chroma, clear bars and the key's third

**Files:**
- Modify: `service/algorip/chords.py`
- Modify: `service/tests/synth.py` (`pad_chords` qualities)
- Modify: `service/algorip/pipeline.py:136` (pass `key`)
- Test: `service/tests/test_chords.py`

**Interfaces:**
- Produces:
  - `peak_chroma_bars(other: np.ndarray, sr: int, grid: Grid) -> list[np.ndarray]`: per bar, a 12-vector of peak
    chroma, zeros for a bar with no frames.
  - `estimate_chords(other, sr, grid, key: Key | None = None) -> list[str]`: the heard symbols (this task: triads
    only).
  - `pad_chords(chords: list[tuple[int, str]], bpm: float)`, which now accepts these qualities:
    `"major"`, `"minor"`, `"m7"`, `"7"`, `"^7"`, `"m9"`, `"9"`, `"5"` and `"5wobble"`.

- [ ] **Step 1: Extend `pad_chords` in `tests/synth.py`.**
  - Interval sets:
    - `m7` (0,3,7,10)
    - `7` (0,4,7,10)
    - `^7` (0,4,7,11)
    - `m9` (0,3,7,10,14)
    - `9` (0,4,7,10,14)
    - `5` (0,7,12)
  - `5wobble` is the same notes as `5`, with each note's frequency modulated ±40 cents at 6 Hz. Use a phase
    accumulator like `swept_bass`, harmonics 1 and 2. It stands in for 36:40's smeared G.
  - Keep the `"major"`/`"minor"` names and the `ValueError`.

- [ ] **Step 2: Write the failing tests.**

```python
from algorip.key import Key

G_MINOR = Key(tonic=7, mode="minor")
G_MAJOR = Key(tonic=7, mode="major")

def test_a_bare_fifth_takes_the_keys_third():
    y = pad_chords([(55, "5")], 120)
    g = Grid(bpm=120, first_downbeat=0.0, bars=1)
    assert estimate_chords(y, SR, g, G_MINOR) == ["Gm"]
    assert estimate_chords(y, SR, g, G_MAJOR) == ["G"]

def test_a_heard_third_beats_the_key():
    y = pad_chords([(55, "major")], 120)  # G major heard, in G minor
    assert estimate_chords(y, SR, Grid(bpm=120, first_downbeat=0.0, bars=1), G_MINOR) == ["G"]

def test_a_root_outside_the_key_keeps_the_templates_pick():
    y = pad_chords([(56, "5")], 120)  # G# is not in G minor
    assert estimate_chords(y, SR, Grid(bpm=120, first_downbeat=0.0, bars=1), G_MINOR)[0] in ("G#", "G#m")

def test_a_noise_bar_repeats_the_previous_chord():
    from tests.synth import _noise  # white noise: no clear pitch class
    bar = len(pad_chords([(57, "minor")], 120))
    y = np.concatenate([pad_chords([(57, "minor")], 120), 0.3 * _noise(bar, seed=3)]).astype(np.float32)
    assert estimate_chords(y, SR, Grid(bpm=120, first_downbeat=0.0, bars=2)) == ["Am", "Am"]

def test_peak_chroma_names_the_notes_not_their_smear():
    y = pad_chords([(55, "5wobble")], 120)
    bar = peak_chroma_bars(y, SR, Grid(bpm=120, first_downbeat=0.0, bars=1))[0]
    bar = bar / bar.max()
    assert bar[7] == 1.0 and bar[2] >= 0.3          # G and D
    assert bar[6] < 0.25 and bar[8] < 0.25          # no F# or G# from the wobble
```

- [ ] **Step 3: Run them.**
  - Run: `uv run pytest tests/test_chords.py -q`
  - Expected: FAIL, because `peak_chroma_bars` is not defined and `estimate_chords` takes no `key`.

- [ ] **Step 4: Implement in `chords.py`.**
  - Constants: `CLEAR_SHARE = 0.45`, `THIRD_SHARE = 0.25`.
  - `peak_chroma_bars`:
    - Takes `librosa.cqt` magnitude with hop `_HOP`, `fmin=librosa.note_to_hz("C1")`, 252 bins, 36 bins per octave,
      and `tuning=librosa.estimate_tuning(y=y, sr=sr)`.
    - Check which of each semitone's three bins is the centre. With `fmin` on C1 and `tuning` applied, bin `3k` is
      semitone `k`'s centre and `3k±1` are its neighbours; the step 2 smear test is the check.
    - Takes per-frame `max(0, centre - max(neighbours))`, sums octaves into 12 pitch classes, and takes bar means
      with `_bar_means`.
  - `estimate_chords`: keep the template pick and the silence gate. Then, per bar:
    1. **Clear bar.** A bar whose four strongest peak pitch classes hold less than `CLEAR_SHARE` of the bar's peak
       chroma repeats the previous symbol, as a silent bar does. Measured: white noise 0.36, a synthetic triad 1.0,
       48:50's bars 1 to 3 at 0.40, 0.42 and 0.46.
    2. **Third.** With a `key`: if both thirds of the picked root are under `THIRD_SHARE` of the root's peak, and
       the root is in `key.scale`, take the key's diatonic quality. That is minor if `(root+3) % 12` is in the scale
       and `(root+4) % 12` is not; major in the opposite case. Otherwise keep the template's pick.
    3. **Both thirds heard.** If both clear `THIRD_SHARE`, the louder decides; if exactly one does, it decides.
  - Update the module and function docstrings with the 36:40 and 48:50 numbers from the spec.
  - `pipeline.py`: call `estimate_chords(other, SR, grid, key)`.

- [ ] **Step 5: Run the tests.**
  - Run: `uv run pytest tests/test_chords.py -q`
  - Expected: all pass, including the four existing tests unchanged.

- [ ] **Step 6: Commit.** Use the message "Rip chords take the key's third when the stem plays none, and a bar with
  no clear notes repeats the last chord".

### Task 2: Heard sevenths and ninths

**Files:**
- Modify: `service/algorip/chords.py`
- Test: `service/tests/test_chords.py`

**Interfaces:**
- Consumes: `peak_chroma_bars` and the quality decided in Task 1.
- Produces:
  - `estimate_chords` returns heard symbols, which may carry `7`, `^7`, `9`, `^9`, `add9`, `m7`, `m^7`, `m9`, `m^9`
    or `madd9`.
  - `spell(root: int, minor: bool, seventh: int | None, ninth: bool) -> str`, where `seventh` is 10, 11 or `None`.

- [ ] **Step 1: Write the failing tests.**

```python
@pytest.mark.parametrize("quality,symbol", [("m7", "Am7"), ("7", "A7"), ("^7", "A^7"), ("m9", "Am9"), ("9", "A9")])
def test_heard_extensions_round_trip(quality, symbol):
    y = pad_chords([(57, quality)], 120)
    assert estimate_chords(y, SR, Grid(bpm=120, first_downbeat=0.0, bars=1)) == [symbol]

def test_a_wobbling_fifth_gets_no_seventh_or_ninth():
    y = pad_chords([(55, "5wobble")], 120)
    assert estimate_chords(y, SR, Grid(bpm=120, first_downbeat=0.0, bars=1), G_MINOR) == ["Gm"]

def test_spelling():
    assert spell(9, True, 10, False) == "Am7" and spell(9, True, 11, True) == "Am^9"
    assert spell(7, False, None, True) == "Gadd9" and spell(7, True, None, True) == "Gmadd9"
    assert spell(7, False, 10, True) == "G9" and spell(7, False, None, False) == "G"
```

- [ ] **Step 2: Run them.**
  - Run: `uv run pytest tests/test_chords.py -q`
  - Expected: FAIL, because `spell` is not defined and the extensions are not written.

- [ ] **Step 3: Implement in `chords.py`.**
  - New constant: `EXT_SHARE = 0.4`.
  - On a clear bar, measured on the peak chroma relative to the root's peak:
    - **7th:** `(root+10)` or `(root+11)` at or above `EXT_SHARE`; if both, the louder.
    - **9th:** `(root+2)` at or above `EXT_SHARE`.
  - `spell` follows the spec's table:
    - With a 9th and a 7th: `9`/`^9` for major, `m9`/`m^9` for minor.
    - 7th only: `7`/`^7`, or `m7`/`m^7`.
    - 9th only: `add9`/`madd9`.
  - **If the wobble test fails** (an F# or G# clears 0.4), strengthen the peak test, for example by requiring the
    centre bin to be the local maximum over ±2 bins. Do not raise `EXT_SHARE`.

- [ ] **Step 4: Run the tests.**
  - Run: `uv run pytest tests/test_chords.py -q`
  - Expected: all pass.

- [ ] **Step 5: Commit.** Use the message "Rip chords write a 7th or 9th the stem plays, read from the peak chroma so
  a smeared root is not one".

### Task 3: The key's 7th for colour

**Files:**
- Modify: `service/algorip/chords.py`
- Test: `service/tests/test_chords.py`

**Interfaces:**
- Consumes: `spell`, and the heard symbols from Task 2.
- Produces: `colour_chords(chords: list[str], key: Key) -> list[str]`, which is the same length as its input and
  leaves `~` as it is.

- [ ] **Step 1: Write the failing tests.**

```python
def test_every_degree_borrows_the_keys_seventh():
    assert colour_chords(["Gm", "A#", "Cm", "Dm", "D#", "F"], G_MINOR) == ["Gm7", "A#^7", "Cm7", "Dm7", "D#^7", "F7"]
    c_major = Key(tonic=0, mode="major")
    assert colour_chords(["C", "Dm", "Em", "F", "G", "Am"], c_major) == ["C^7", "Dm7", "Em7", "F^7", "G7", "Am7"]

def test_no_colour_outside_the_key_on_the_diminished_degree_or_as_m_maj7():
    assert colour_chords(["G#", "Am", "A#m"], G_MINOR) == ["G#", "Am", "A#m"]  # outside; ii; III's ^7 on a minor

def test_a_heard_quality_the_key_would_not_give_takes_the_scales_seventh():
    assert colour_chords(["D"], G_MINOR) == ["D7"]

def test_a_heard_seventh_wins_and_a_heard_ninth_spells_a_ninth_chord():
    assert colour_chords(["Gm^7", "Gmadd9"], G_MINOR) == ["Gm^7", "Gm9"]

def test_no_chord_stays_no_chord():
    assert colour_chords(["~", "Gm"], G_MINOR) == ["~", "Gm7"]
```

- [ ] **Step 2: Run them.**
  - Run: `uv run pytest tests/test_chords.py -q -k "colour or degree or seventh or no_chord"`
  - Expected: FAIL, because `colour_chords` is not defined.

- [ ] **Step 3: Implement `colour_chords`.**
  - Parse each symbol into a root, minor or not, a heard 7th and a heard 9th. Only the symbols `spell` writes need
    parsing.
  - A symbol that already has a 7th is returned unchanged.
  - Otherwise, the borrowed 7th is whichever of `(root+10)` or `(root+11)` is in `key.scale`, used only if:
    - the root is in `key.scale`;
    - the root is not the diminished degree, that is, `(root+6) % 12` is not in the scale; and
    - the result is not a minor chord with 11.
  - Re-spell with `spell`.

- [ ] **Step 4: Run the tests.**
  - Run: `uv run pytest tests/test_chords.py -q`
  - Expected: all pass.

- [ ] **Step 5: Commit.** Use the message "Rip chords borrow the key's diatonic 7th for house colour".

### Task 4: Store both, write `_triads:`

**Files:**
- Modify:
  - `service/algorip/schema.py` (`Analysis.heard_chords: list[str] | None = None`, with a comment saying it holds
    the chords as heard and that `chords` is coloured)
  - `service/algorip/pipeline.py` (`chords=colour_chords(heard, key)`, `heard_chords=heard`)
  - `service/algorip/generate.py`
  - `app/src/rip/ripApi.ts` (`heard_chords: string[] | null`, with a doc comment)
  - the `Analysis` fixtures in `app/src/rip/{RipTab.test.tsx,ripStore.test.ts,ripPattern.test.ts,audition.test.ts}`
    (add `heard_chords: null`)
- Test: `service/tests/test_generate.py`

**Interfaces:**
- Consumes: `colour_chords`.
- Produces: a muted `_triads:` line, written right after `chords:` when `a.heard_chords` is set and differs from
  `a.chords`. It is the `chords:` line with the name `_triads` and the heard symbols, with the same instrument, room,
  gain and lane.

- [ ] **Step 1: Write the failing tests.**

```python
def test_the_heard_chords_are_a_muted_triads_line_under_the_coloured_ones():
    a = HOUSE.model_copy(update={"chords": ["Am7", "F^7", "C^7", "G7"], "heard_chords": ["Am", "F", "C", "G"]})
    lines = generate(a, choose_sounds(a), "t", 0, 8).splitlines()
    i = next(n for n, line in enumerate(lines) if line.startswith("chords:"))
    assert lines[i].startswith('chords: chord("<Am7 F^7 C^7 G7>")')
    assert lines[i + 1] == lines[i].replace("chords:", "_triads:", 1).replace("<Am7 F^7 C^7 G7>", "<Am F C G>")

def test_no_triads_line_when_nothing_was_borrowed_or_on_an_old_result():
    for heard in (None, list(HOUSE.chords)):
        code = generate(HOUSE.model_copy(update={"heard_chords": heard}), choose_sounds(HOUSE), "t", 0, 8)
        assert "_triads:" not in code
```

- [ ] **Step 2: Run them.**
  - Run: `uv run pytest tests/test_generate.py -q`
  - Expected: FAIL, because `heard_chords` is not a field and no `_triads:` line is written.

- [ ] **Step 3: Implement the schema field, the pipeline call and the `_triads:` line.**
  - Build the `chords:` and `_triads:` lines from one helper so they cannot drift.
  - Add `heard_chords` to the app type and the fixtures.

- [ ] **Step 4: Run the tests and the type check.**
  - Run: `uv run pytest -q`
  - Then, from the repo root: `pnpm exec tsc --noEmit && pnpm exec vitest run`
  - Expected: the service tests pass except goldens whose `.analysis.json` lacks `heard_chords` (it defaults to
    `None`, so they should pass too); `tsc` is clean; vitest passes.

- [ ] **Step 5: Commit.** Use the message "The rip keeps the chords as heard in a muted _triads: line under the
  coloured ones".

### Task 5: Goldens, by-ear expectations and docs

**Files:**
- Regenerate:
  - `service/tests/golden/{solomun,solomun2,build}.*`, via `scripts/bass_fixture.py`
  - the other goldens with their existing regeneration path. Check `test_golden.py` for how
    `drums_only`, `house` and the others are rebuilt.
- Modify:
  - `README.md` (Rip: chords, `_triads:`)
  - `docs/handover-2026-10-21.md` (Rip sounds section, open questions)

- [ ] **Step 1: Regenerate the goldens.** From `service/`, run:

```bash
uv run python scripts/bass_fixture.py stems ~/Algobooth/cache/stems/6d44d581d8ad286f solomun --title "<as in the golden header>" --start <s> --end <e>
uv run python scripts/bass_fixture.py stems ~/Algobooth/cache/stems/3dd127e18e1f4e87 solomun2 --title "<as in the golden header>" --start <s> --end <e>
uv run python scripts/bass_fixture.py synthetic build
```

  Take the title, start and end from each golden's existing `.strudel` header.

- [ ] **Step 2: Compare the chord diffs with the spec's expectations.**
  - Run: `git diff --stat service/tests/golden && git diff service/tests/golden/*.strudel`
  - Expected, for `chords` and `heard_chords`:

    | clip | `chords` | `heard_chords` |
    |---|---|---|
    | 36:40 | `Gm7` × 9 | `Gm` × 9 |
    | 48:50 | `D#m7 D#m7 D#m7 A#m7 A#m7` | `D#m D#m D#m A#m A#m` |

    - 36:40 bar 3 may read `Gm^7` (heard F#).
    - 36:40 bar 7 may read `Cm7`/`Gm`.
    - `build` keeps its triads, coloured by its key.
    - 48:50's bars 1 to 3 sit within 0.05 of `CLEAR_SHARE`; a bar on the other side of the line is a finding.
    - No bass, drum or other line changes.
  - Write each case that differs from these expectations into the handover's findings, with its peak chroma
    numbers. Do not tune the thresholds to remove it.

- [ ] **Step 3: Run every suite.**
  - From `service/`: `uv run pytest -q`
  - From the repo root: `pnpm exec tsc --noEmit && pnpm exec vitest run`
  - Expected: everything passes. `rip/golden.test.ts` proves each new symbol voices to at least three notes in
    every bar, and covers the muted `_triads:` lines for shipped sounds. If a symbol voices to silence, swap it for
    its iReal spelling (`-^7`, `-add9`) in `spell`, then rerun.

- [ ] **Step 4: Update the docs.**
  - **README "Rip":** the chords line can carry 7ths and 9ths, and `_triads:` holds the chords as heard.
  - **Handover Rip sounds section:** add the peak chroma, the third rule, the heard-extension rule and the colour
    rule, with the spec's measurement table and the golden results.
  - **Handover open questions:**
    - Does `Gm7` sit better than `Gm`?
    - Is 36:40 bar 7 `Gm` or `Cm7`?
    - A clip with real 7ths is wanted.

- [ ] **Step 5: Commit and push.** Use the message "Goldens and docs: the rip writes Gm7 for 36:40 and D#m7 / A#m7
  for 48:50, with the heard triads muted underneath", then run
  `git push origin claude/rip-extended-chords`.
