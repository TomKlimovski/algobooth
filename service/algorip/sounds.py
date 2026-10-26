"""Rule-based sound choice from the analysis: drum bank, snare name, bass oscillator, the chords' instrument and levels."""

import math

from algorip.kits import KitSample, nearest_sample
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
# Drum voices: the bank sample whose first 12 dB of fall is nearest the stem's (kits.nearest_sample), and a gain
# per voice from the stem's level relative to its kick against the chosen samples' (the kick is the reference).
# The kick plays at KICK_GAIN, the house examples' kick (it peaks about 0.55); none exceeds 1 and none rounds to 0.
# A voice the stem does not measure (no kick to measure against, or no hits of its own) takes the examples' gain.
KICK_GAIN = 0.65
DRUM_GAINS = {"sd": 0.5, "hh": 0.35, "oh": 0.35, "gh": 0.15}
# The bass's richness on top of the measured oscillator (the house examples' sub and saw basses): a sine gets an FM
# pluck on its attack, and every bass a little waveshaping after its filter. Its gain is the examples' for that
# oscillator.
SINE_FM = 1.5
BASS_SHAPE = 0.3
BASS_GAINS = {"sawtooth": 0.55, "triangle": 0.5, "sine": 0.5}
# The "other" stem's instrument. A part that holds within KEYS_DECAY_DB 250 ms after an onset is a pad: the
# supersaw, lowpassed at the stem's measured brightness. A part that falls is keys: the sampled piano when bright,
# the Rhodes (gm_epiano1) when mellow, and the Rhodes when there is nothing to measure. Measured: the synthetic pad
# holds at -0.4 dB; Solomun 36:40's stabs fall 16.6 dB (mellow, 1.3 kHz), 48:50's part 6 dB (bright, 5.3 kHz).
KEYS_DECAY_DB = -3.0
BRIGHT_HZ = 2500
PAD_LPF = (300, 8000)  # Hz: the pad's cutoff is kept within this
CHORD_GAINS = {"gm_epiano1": 0.6, "piano": 0.55, "supersaw": 0.2}  # a voiced chord: three or four notes
MELODY_GAINS = {"gm_epiano1": 0.6, "piano": 0.55, "supersaw": 0.3}
_SAMPLE_VOICE = {"bd": "bd", "hh": "hh", "oh": "oh", "gh": "hh"}  # the snare voice uses the bank's snare_name list


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


def sample_for(bank: str, voice: str, snare_name: str, fall_ms: float) -> KitSample | None:
    """The bank sample for a drum voice by the stem's fall: the snare voice from the clap or snare list, a ghost from the closed hats."""
    return nearest_sample(bank, snare_name if voice == "sd" else _SAMPLE_VOICE.get(voice, voice), fall_ms)


def gain_for(diff_db: float) -> float:
    """The line's gain for a voice the stem plays diff_db louder (or quieter) against its kick than the chosen samples would."""
    return max(0.01, min(1.0, round(KICK_GAIN * 10 ** (diff_db / 20), 2)))  # never silent


def _drum_samples_and_gains(a: Analysis, bank: str, snare_name: str) -> tuple[dict[str, int], dict[str, float]]:
    gains = {"bd": KICK_GAIN, **DRUM_GAINS}
    t = a.drum_tone
    if t is None:
        return {}, gains
    chosen = {voice: s for voice, fall in t.falls.items() if (s := sample_for(bank, voice, snare_name, fall)) is not None}
    samples = {voice: s.n for voice, s in chosen.items() if s.n != 0}
    kick = chosen.get("bd")
    if kick is not None and "bd" in t.levels:
        for voice, s in chosen.items():
            if voice != "bd" and voice in t.levels:
                gains[voice] = gain_for((t.levels[voice] - t.levels["bd"]) - (s.level_db - kick.level_db))
    return samples, gains


def other_instrument(a: Analysis) -> tuple[str, int | None]:
    """The chords' and melody's instrument by the "other" stem's decay and brightness, and its lowpass if it needs one."""
    t = a.other_tone
    if t is None:
        return "gm_epiano1", None
    if t.decay_db > KEYS_DECAY_DB:
        lo, hi = PAD_LPF
        return "supersaw", max(lo, min(hi, int(round(t.rolloff_hz / 10) * 10)))
    return ("piano" if t.rolloff_hz >= BRIGHT_HZ else "gm_epiano1"), None


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
    drum_samples, drum_gains = _drum_samples_and_gains(a, drum_bank, snare_name)
    chord_sound, chord_lpf = other_instrument(a)
    return SoundChoice(
        drum_bank=drum_bank,
        snare_name=snare_name,
        bass_sound=bass_sound,
        bass_lpf=bass_lpf,
        bass_envelope=_envelope(a),
        bass_filter_env=filter_env,
        bass_tremolo=_tremolo(a),
        drum_samples=drum_samples,
        drum_gains=drum_gains,
        bass_fm=SINE_FM if bass_sound == "sine" else None,
        bass_shape=BASS_SHAPE,
        bass_gain=BASS_GAINS[bass_sound],
        chord_sound=chord_sound,
        chord_lpf=chord_lpf,
        chord_gain=CHORD_GAINS[chord_sound],
        melody_gain=MELODY_GAINS[chord_sound],
    )
