"""Rule-based sound choice from the analysis: drum bank, snare name and bass oscillator."""

from algorip.schema import Analysis, Envelope, SoundChoice

# bass_harmonics is harmonic_ratio's magnitude-based measure; a sawtooth measures about 0.435-0.52.
SAWTOOTH_HARMONICS = 0.4
TRIANGLE_HARMONICS = 0.2
# A note that has fallen this much by its end is a pluck: the sawtooth gets an envelope. A held bass
# (its notes still near their peak at the end) gets none.
PLUCK_DB = 6.0
ATTACK_FLOOR = 0.005  # seconds: Strudel's default click is shorter than any measured attack
SUSTAIN_CAP = 0.5  # a pluck's sustain stays under this, whatever the median end level says


def _envelope(a: Analysis) -> Envelope | None:
    e = a.bass_envelope
    if e is None or e.end_db > -PLUCK_DB:
        return None
    return Envelope(
        attack=round(max(ATTACK_FLOOR, e.attack_ms / 1000), 3),
        decay=round(e.decay_ms / 1000, 3),
        sustain=round(min(SUSTAIN_CAP, 10 ** (e.end_db / 20)), 3),
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
    return SoundChoice(
        drum_bank=drum_bank, snare_name=snare_name, bass_sound=bass_sound, bass_lpf=bass_lpf, bass_envelope=_envelope(a)
    )
