"""Rule-based sound choice from the analysis: drum bank, snare name and bass oscillator."""

from algorip.schema import Analysis, SoundChoice, StrudelEnvelope

# bass_harmonics is harmonic_ratio's magnitude-based measure; a sawtooth measures about 0.435-0.52.
SAWTOOTH_HARMONICS = 0.4
TRIANGLE_HARMONICS = 0.2
# A note that has fallen this much by its end is gated: the sawtooth gets a fast attack, a shortened gate
# (clip) and a short release. A held bass (its notes still near their peak at the end) gets none.
GATE_DB = 6.0
ATTACK_FLOOR = 0.005  # seconds: Strudel's default click is shorter than any measured attack
RELEASE_FLOOR = 0.01  # seconds: a cut shorter than this clicks
CLIP_FULL = 0.9  # a hold at least this share of the written note is the whole note: no clip


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
    return SoundChoice(
        drum_bank=drum_bank, snare_name=snare_name, bass_sound=bass_sound, bass_lpf=bass_lpf, bass_envelope=_envelope(a)
    )
