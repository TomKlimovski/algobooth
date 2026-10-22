"""Rule-based sound choice from the analysis: drum bank, snare name and bass oscillator."""

import math

from algorip.schema import Analysis, FilterEnvelope, SoundChoice, StrudelEnvelope, Tremolo

# bass_harmonics is harmonic_ratio's magnitude-based measure; a sawtooth measures about 0.435-0.52.
SAWTOOTH_HARMONICS = 0.4
TRIANGLE_HARMONICS = 0.2
# A note that has fallen this much by its end is gated: the sawtooth gets a fast attack, a shortened gate
# (clip) and a short release. A held bass (its notes still near their peak at the end) gets none.
GATE_DB = 6.0
ATTACK_FLOOR = 0.005  # seconds: Strudel's default click is shorter than any measured attack
RELEASE_FLOOR = 0.01  # seconds: a cut shorter than this clicks
CLIP_FULL = 0.9  # a hold at least this share of the written note is the whole note: no clip
LPF_FLOOR = 100  # Hz: the measured hold cutoff is written no lower than this
FILTER_ENV_MIN_OCTAVES = 1.0  # an opening under this is not worth a filter envelope
# An onset's click is broadband for a frame or two; a filter that "closes" faster than this is that click,
# not a filter (the synthetic build's 10 ms ramp read as a 3-octave opening closing in 20 ms).
FILTER_ENV_MIN_CLOSE_MS = 50.0


def _filter(a: Analysis, default_lpf: int | None) -> tuple[int | None, FilterEnvelope | None]:
    """The lowpass cutoff and its envelope: measured on the stem when there is a tone, else the oscillator's default."""
    if default_lpf is None:  # a sine: nothing to filter
        return None, None
    t = a.bass_tone
    if t is None:
        return default_lpf, None
    cutoff = max(LPF_FLOOR, int(round(t.hold_hz / 10) * 10))
    octaves = round(math.log2(t.open_hz / t.hold_hz), 1) if t.open_hz > t.hold_hz else 0.0
    moving = octaves >= FILTER_ENV_MIN_OCTAVES and t.close_ms >= FILTER_ENV_MIN_CLOSE_MS
    env = FilterEnvelope(octaves=octaves, close=round(t.close_ms / 1000, 3)) if moving else None
    return cutoff, env


def _tremolo(a: Analysis) -> Tremolo | None:
    t = a.bass_tone
    if t is None or t.wobble_hz is None or t.wobble_db is None:
        return None
    return Tremolo(rate=round(t.wobble_hz, 1), depth=round(1 - 10 ** (-t.wobble_db / 20), 2))


def _envelope(a: Analysis) -> StrudelEnvelope | None:
    e = a.bass_envelope
    if e is None or e.end_db > -GATE_DB:
        return None
    return StrudelEnvelope(
        attack=round(max(ATTACK_FLOOR, e.attack_ms / 1000), 3),
        clip=None if e.hold_share >= CLIP_FULL else round(e.hold_share, 2),
        release=round(max(RELEASE_FLOOR, e.fall_ms / 1000), 3),
    )


def choose_sounds(a: Analysis) -> SoundChoice:
    drum_bank = "tr909" if a.four_on_the_floor and 118 <= a.bpm <= 132 else "tr808"
    snare_name = "cp" if drum_bank == "tr909" else "sd"
    if a.bass_harmonics >= SAWTOOTH_HARMONICS:
        bass_sound, bass_lpf = "sawtooth", 800
    elif a.bass_harmonics >= TRIANGLE_HARMONICS:
        bass_sound, bass_lpf = "triangle", 1200
    else:
        bass_sound, bass_lpf = "sine", None
    bass_lpf, filter_env = _filter(a, bass_lpf)
    return SoundChoice(
        drum_bank=drum_bank,
        snare_name=snare_name,
        bass_sound=bass_sound,
        bass_lpf=bass_lpf,
        bass_envelope=_envelope(a),
        bass_filter_env=filter_env,
        bass_tremolo=_tremolo(a),
    )
