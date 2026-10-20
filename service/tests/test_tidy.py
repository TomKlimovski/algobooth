from pathlib import Path
from types import SimpleNamespace

import anthropic

from algorip import tidy as tidy_module
from algorip.schema import Analysis
from algorip.sounds import choose_sounds
from algorip.tidy import TIDY_MODEL, TIDY_SYSTEM, anthropic_chat, summary_text, tidy

ANALYSIS = Analysis.model_validate_json((Path(__file__).parent / "golden" / "house.analysis.json").read_text())
SOUNDS = choose_sounds(ANALYSIS)
CODE = "setcpm(126/4)\n\n$: s(\"bd*4\").bank(\"tr909\")\n"


def test_tidy_returns_model_text_and_strips_fences():
    chat = lambda system, user, key: "```js\nsetcpm(126/4)\n$: s(\"bd*4\").bank(\"tr909\") // kick\n```"
    out, err = tidy(CODE, ANALYSIS, SOUNDS, "k", chat=chat)
    assert err is None and out.startswith("setcpm(126/4)") and "```" not in out


def test_tidy_passes_key_and_summary():
    seen = {}
    def chat(system, user, key): seen.update(system=system, user=user, key=key); return CODE
    tidy(CODE, ANALYSIS, SOUNDS, "sk-test", chat=chat)
    assert seen["key"] == "sk-test" and CODE in seen["user"] and "126" in seen["user"] and seen["system"] == TIDY_SYSTEM


def test_tidy_rejects_a_tempo_change():
    out, err = tidy(CODE, ANALYSIS, SOUNDS, "k", chat=lambda *a: CODE.replace("126", "120"))
    assert out is None and err == "Tidy changed the tempo"


def test_tidy_never_raises():
    def chat(*a): raise RuntimeError("network down")
    assert tidy(CODE, ANALYSIS, SOUNDS, "k", chat=chat) == (None, "network down")


def test_summary_text_lists_the_fields():
    text = summary_text(ANALYSIS, SOUNDS)
    for part in ("126", "A minor", "4", "tr909", "sawtooth", "Am F C G", "bd 16", "cp 8", "hh 32", "oh 16"):
        assert part in text


class FakeAnthropic:
    calls: list[dict] = []
    response = None

    def __init__(self, **kwargs):
        FakeAnthropic.calls.append({"client": kwargs})
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        FakeAnthropic.calls.append({"create": kwargs})
        return FakeAnthropic.response


def _fake(monkeypatch, response):
    FakeAnthropic.calls, FakeAnthropic.response = [], response
    monkeypatch.setattr(anthropic, "Anthropic", FakeAnthropic)


def test_anthropic_chat_sends_the_request_and_joins_text(monkeypatch):
    blocks = [SimpleNamespace(type="text", text="a"), SimpleNamespace(type="other"), SimpleNamespace(type="text", text="b")]
    _fake(monkeypatch, SimpleNamespace(stop_reason="end_turn", content=blocks))
    assert anthropic_chat("sys", "usr", "sk-x") == "ab"
    assert FakeAnthropic.calls == [
        {"client": {"api_key": "sk-x", "timeout": 30.0, "max_retries": 1}},
        {"create": {"model": TIDY_MODEL, "max_tokens": 2048, "output_config": {"effort": "low"}, "system": "sys",
                    "messages": [{"role": "user", "content": "usr"}]}},
    ]
    assert TIDY_MODEL == "claude-opus-5-5"


def test_anthropic_chat_refusal_becomes_a_tidy_error(monkeypatch):
    _fake(monkeypatch, SimpleNamespace(stop_reason="refusal", content=[]))
    out, err = tidy(CODE, ANALYSIS, SOUNDS, "k", chat=tidy_module.anthropic_chat)
    assert (out, err) == (None, "Claude declined to tidy this pattern")
