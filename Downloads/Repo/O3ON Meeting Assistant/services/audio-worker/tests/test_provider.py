"""Tests for audio_worker.provider — parse helpers and adapter construction."""
from __future__ import annotations

import pytest

from audio_worker.provider import OpenAIProviderAdapter, build_provider, _extract_json_blob
from audio_worker.models import AudioChunk, MeetingParticipant, TranscriptSegment


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_adapter(**overrides) -> OpenAIProviderAdapter:
    defaults = dict(
        api_key="test-key",
        transcription_model="gpt-4o-transcribe",
        summary_model="gpt-4o",
    )
    defaults.update(overrides)
    return OpenAIProviderAdapter(**defaults)


# ---------------------------------------------------------------------------
# _parse_confidence
# ---------------------------------------------------------------------------

class TestParseConfidence:
    """OpenAIProviderAdapter._parse_confidence maps various inputs to [0,1]."""

    @pytest.mark.parametrize(
        "input_val, expected",
        [
            ("High", 0.9),
            ("high", 0.9),
            ("HIGH", 0.9),
            ("Medium", 0.6),
            ("medium", 0.6),
            ("med", 0.6),
            ("Low", 0.3),
            ("low", 0.3),
            ("very high", 0.95),
            ("very low", 0.1),
        ],
    )
    def test_text_labels(self, input_val: str, expected: float) -> None:
        assert OpenAIProviderAdapter._parse_confidence(input_val) == expected

    @pytest.mark.parametrize(
        "input_val, expected",
        [
            (0.75, 0.75),
            (0, 0.0),
            (1, 1.0),
            (0.0, 0.0),
            (1.0, 1.0),
        ],
    )
    def test_numeric_passthrough(self, input_val, expected: float) -> None:
        assert OpenAIProviderAdapter._parse_confidence(input_val) == expected

    def test_numeric_clamped_above_one(self) -> None:
        assert OpenAIProviderAdapter._parse_confidence(5.0) == 1.0

    def test_numeric_clamped_below_zero(self) -> None:
        assert OpenAIProviderAdapter._parse_confidence(-3.0) == 0.0

    def test_numeric_string(self) -> None:
        assert OpenAIProviderAdapter._parse_confidence("0.42") == pytest.approx(0.42)

    def test_numeric_string_clamped(self) -> None:
        assert OpenAIProviderAdapter._parse_confidence("2.5") == 1.0
        assert OpenAIProviderAdapter._parse_confidence("-1.0") == 0.0

    def test_invalid_string_returns_default(self) -> None:
        assert OpenAIProviderAdapter._parse_confidence("banana") == 0.5
        assert OpenAIProviderAdapter._parse_confidence("") == 0.5
        assert OpenAIProviderAdapter._parse_confidence("n/a") == 0.5

    def test_none_returns_default(self) -> None:
        # str(None) == "None" which is not in the mapping and not numeric → 0.5
        assert OpenAIProviderAdapter._parse_confidence(None) == 0.5

    def test_integer_input(self) -> None:
        assert OpenAIProviderAdapter._parse_confidence(1) == 1.0
        assert OpenAIProviderAdapter._parse_confidence(0) == 0.0


# ---------------------------------------------------------------------------
# _ensure_list (nested in summarize — we replicate the logic here for testing)
# ---------------------------------------------------------------------------

def _ensure_list(value: object) -> list:
    """Replica of the nested function inside OpenAIProviderAdapter.summarize."""
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


class TestEnsureList:
    """The _ensure_list helper normalizes varied inputs to a list."""

    def test_list_passthrough(self) -> None:
        assert _ensure_list(["a", "b"]) == ["a", "b"]

    def test_empty_list(self) -> None:
        assert _ensure_list([]) == []

    def test_string_wraps_in_list(self) -> None:
        assert _ensure_list("decision one") == ["decision one"]

    def test_string_stripped(self) -> None:
        assert _ensure_list("  padded  ") == ["padded"]

    def test_empty_string_returns_empty(self) -> None:
        assert _ensure_list("") == []

    def test_whitespace_only_returns_empty(self) -> None:
        assert _ensure_list("   ") == []

    def test_none_returns_empty(self) -> None:
        assert _ensure_list(None) == []

    def test_int_returns_empty(self) -> None:
        # int is not list and not str → []
        assert _ensure_list(42) == []


# ---------------------------------------------------------------------------
# _extract_json_blob
# ---------------------------------------------------------------------------

class TestExtractJsonBlob:
    def test_extracts_json_from_surrounding_text(self) -> None:
        raw = 'Here is the result: {"key": "value"} and some trailing text'
        assert _extract_json_blob(raw) == '{"key": "value"}'

    def test_raises_on_no_json(self) -> None:
        with pytest.raises(ValueError, match="No JSON"):
            _extract_json_blob("no json here at all")

    def test_raises_on_empty_string(self) -> None:
        with pytest.raises(ValueError, match="No JSON"):
            _extract_json_blob("")

    def test_nested_braces(self) -> None:
        raw = '{"outer": {"inner": 1}}'
        assert _extract_json_blob(raw) == '{"outer": {"inner": 1}}'


# ---------------------------------------------------------------------------
# _parse_diarized_response
# ---------------------------------------------------------------------------

class TestParseDiarizedResponse:
    """Test the diarized response parser with synthesized API payloads."""

    def _make_request(self):
        from audio_worker.provider import TranscriptionRequest

        chunk = AudioChunk(
            chunk_id="src-1-chunk-0001",
            index=1,
            start_seconds=10.0,
            end_seconds=55.0,
            overlap_seconds=5.0,
            source_id="src-1",
            chunk_uri="/tmp/fake.wav",
        )
        participants = (
            MeetingParticipant(
                participant_id="u1",
                display_name="Ana",
                speaker_label="ana",
            ),
            MeetingParticipant(
                participant_id="u2",
                display_name="Marko",
                speaker_label="marko",
            ),
        )
        return TranscriptionRequest(
            meeting_id="m-1",
            chunk=chunk,
            language="sr",
            participants=participants,
        )

    def test_segments_mapped_to_participant_labels(self) -> None:
        adapter = _make_adapter(transcription_model="gpt-4o-transcribe-diarize")
        request = self._make_request()
        data = {
            "segments": [
                {"speaker": "Ana", "text": "Zdravo!", "start": 0.0, "end": 2.0},
                {"speaker": "Marko", "text": "Cao.", "start": 2.0, "end": 4.0},
            ]
        }
        segments = adapter._parse_diarized_response(data, request)
        assert len(segments) == 2
        assert segments[0].speaker_id == "ana"
        assert segments[0].text == "Zdravo!"
        # start_seconds should be offset by chunk start (10.0)
        assert segments[0].start_seconds == pytest.approx(10.0)
        assert segments[1].speaker_id == "marko"
        assert segments[1].start_seconds == pytest.approx(12.0)

    def test_empty_segments_falls_back_to_text(self) -> None:
        adapter = _make_adapter(transcription_model="gpt-4o-transcribe-diarize")
        request = self._make_request()
        data = {"segments": [], "text": "Fallback transcript."}
        segments = adapter._parse_diarized_response(data, request)
        assert len(segments) == 1
        assert segments[0].text == "Fallback transcript."

    def test_no_segments_no_text_raises(self) -> None:
        adapter = _make_adapter(transcription_model="gpt-4o-transcribe-diarize")
        request = self._make_request()
        data = {"segments": [], "text": ""}
        with pytest.raises(RuntimeError, match="no segments"):
            adapter._parse_diarized_response(data, request)

    def test_unknown_speaker_preserved_verbatim(self) -> None:
        adapter = _make_adapter(transcription_model="gpt-4o-transcribe-diarize")
        request = self._make_request()
        data = {
            "segments": [
                {"speaker": "speaker_0", "text": "Hello", "start": 0.0, "end": 1.0},
            ]
        }
        segments = adapter._parse_diarized_response(data, request)
        assert segments[0].speaker_id == "speaker_0"

    def test_empty_text_segments_are_skipped(self) -> None:
        adapter = _make_adapter(transcription_model="gpt-4o-transcribe-diarize")
        request = self._make_request()
        data = {
            "segments": [
                {"speaker": "Ana", "text": "", "start": 0.0, "end": 1.0},
                {"speaker": "Ana", "text": "Real text", "start": 1.0, "end": 2.0},
            ]
        }
        segments = adapter._parse_diarized_response(data, request)
        assert len(segments) == 1
        assert segments[0].text == "Real text"


# ---------------------------------------------------------------------------
# build_provider factory
# ---------------------------------------------------------------------------

class TestBuildProvider:
    def test_returns_openai_adapter_when_key_present(self) -> None:
        provider = build_provider("openai", "sk-test", "gpt-4o-transcribe", "gpt-4o", "https://api.openai.com/v1")
        assert isinstance(provider, OpenAIProviderAdapter)

    def test_returns_stub_when_no_api_key(self) -> None:
        from audio_worker.provider import StubMeetingAIProvider
        provider = build_provider("openai", None, "gpt-4o-transcribe", "gpt-4o", "https://api.openai.com/v1")
        assert isinstance(provider, StubMeetingAIProvider)

    def test_returns_stub_for_unknown_provider(self) -> None:
        from audio_worker.provider import StubMeetingAIProvider
        provider = build_provider("azure", "some-key", "model", "model", "https://example.com")
        assert isinstance(provider, StubMeetingAIProvider)
