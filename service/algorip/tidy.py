"""The optional Claude tidy pass: a more idiomatic rewrite of the generated code that keeps the tempo."""

import re
from collections.abc import Callable

import anthropic

from algorip.schema import Analysis, SoundChoice

TIDY_MODEL = "claude-opus-5-5"
TIDY_SYSTEM = (
    "You tidy short Strudel live-coding patterns. Return only the code, no fences and no commentary. "
    "Make it more idiomatic and readable without changing what it plays: keep every setcpm value, every sound, "
    "every note and every rhythm exactly as given. You may rename nothing, reorder lines, merge voices into one "
    "mini-notation string, use Euclidean notation, and add brief comments."
)

Chat = Callable[[str, str, str], str]  # (system, user, api_key) -> reply text

_FENCE = re.compile(r"^```[^\n]*\n(.*?)\n?```$", re.DOTALL)
_SETCPM = re.compile(r"setcpm\([^)]*\)")


def summary_text(a: Analysis, s: SoundChoice) -> str:
    """One line per field; drum voices are named as in the code (the snare as s.snare_name)."""
    names = {"sd": s.snare_name}
    hits = ", ".join(f"{names.get(voice, voice)} {len(steps)}" for voice, steps in a.drums.items() if steps)
    return "\n".join([
        f"bpm: {round(a.bpm)}",
        f"key: {a.key}",
        f"bars: {a.bars}",
        f"bank: {s.drum_bank}",
        f"bass sound: {s.bass_sound}",
        f"chords: {' '.join(a.chords) or 'none'}",
        f"hits: {hits or 'none'}",
    ])


def anthropic_chat(system: str, user: str, api_key: str) -> str:
    client = anthropic.Anthropic(api_key=api_key, timeout=30.0, max_retries=1)
    response = client.messages.create(
        model=TIDY_MODEL,
        max_tokens=2048,
        output_config={"effort": "low"},
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("Claude declined to tidy this pattern")
    return "".join(block.text for block in response.content if block.type == "text")


def _strip_fence(text: str) -> str:
    text = text.strip()
    match = _FENCE.match(text)
    return match.group(1).strip() if match else text


def tidy(
    code: str, a: Analysis, s: SoundChoice, api_key: str, chat: Chat = anthropic_chat
) -> tuple[str | None, str | None]:
    """(tidied_code, None), or (None, error) when the call fails or the tempo changed. Never raises."""
    try:
        user = f"{code}\n\nWhat this pattern was transcribed from:\n{summary_text(a, s)}\n"
        tidied = _strip_fence(chat(TIDY_SYSTEM, user, api_key))
        if not tidied:
            return None, "Tidy returned no code"
        if _SETCPM.findall(tidied) != _SETCPM.findall(code):
            return None, "Tidy changed the tempo"
        return tidied + "\n", None
    except Exception as exc:  # noqa: BLE001 - the tidy pass is optional; any failure is reported, not raised
        return None, str(exc) or type(exc).__name__
