"""Rule-based sound choice from the analysis: drum bank, snare name and bass oscillator."""

from algorip.schema import Analysis, SoundChoice

# bass_harmonics is harmonic_ratio's magnitude-based measure; a sawtooth measures about 0.435-0.52.
SAWTOOTH_HARMONICS = 0.4
TRIANGLE_HARMONICS = 0.2


def choose_sounds(a: Analysis) -> SoundChoice:
    drum_bank = "tr909" if a.four_on_the_floor and 118 <= a.bpm <= 132 else "tr808"
    snare_name = "cp" if drum_bank == "tr909" else "sd"
    if a.bass_harmonics >= SAWTOOTH_HARMONICS:
        bass_sound, bass_lpf = "sawtooth", 800
    elif a.bass_harmonics >= TRIANGLE_HARMONICS:
        bass_sound, bass_lpf = "triangle", 1200
    else:
        bass_sound, bass_lpf = "sine", None
    return SoundChoice(drum_bank=drum_bank, snare_name=snare_name, bass_sound=bass_sound, bass_lpf=bass_lpf)
