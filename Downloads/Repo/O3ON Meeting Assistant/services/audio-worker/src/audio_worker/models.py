from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _json_safe(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    return value


@dataclass(frozen=True, slots=True)
class MeetingParticipant:
    participant_id: str
    display_name: str
    email: str | None = None
    locale: str = "sr-RS"
    speaker_label: str | None = None


@dataclass(frozen=True, slots=True)
class SpeakerEnrollment:
    participant_id: str
    enrollment_sample_id: str
    sample_uri: str
    embedding_ref: str | None = None
    confidence: float | None = None


@dataclass(frozen=True, slots=True)
class AudioSource:
    source_id: str
    uri: str
    duration_seconds: float | None = None
    sample_rate_hz: int | None = None
    channels: int | None = None
    language: str = "sr"
    created_at: datetime = field(default_factory=_utcnow)


@dataclass(frozen=True, slots=True)
class AudioChunk:
    chunk_id: str
    index: int
    start_seconds: float
    end_seconds: float
    overlap_seconds: float
    source_id: str
    speaker_hint: str | None = None
    chunk_uri: str | None = None

    @property
    def duration_seconds(self) -> float:
        return max(0.0, self.end_seconds - self.start_seconds)


@dataclass(frozen=True, slots=True)
class DiarizedSegment:
    chunk_id: str
    speaker_id: str
    start_seconds: float
    end_seconds: float
    confidence: float
    text: str | None = None


@dataclass(frozen=True, slots=True)
class TranscriptSegment:
    chunk_id: str
    speaker_id: str
    start_seconds: float
    end_seconds: float
    text: str
    confidence: float


@dataclass(frozen=True, slots=True)
class ActionItem:
    task: str
    owner: str | None = None
    due_date: str | None = None
    priority: str = "medium"
    confidence: float = 0.0
    evidence: str | None = None


@dataclass(frozen=True, slots=True)
class MeetingArtifact:
    meeting_id: str
    language: str
    summary: str
    meeting_minutes: str
    decisions: tuple[str, ...] = ()
    action_items: tuple[ActionItem, ...] = ()
    risks: tuple[str, ...] = ()
    next_steps: tuple[str, ...] = ()
    generated_at: datetime = field(default_factory=_utcnow)
    provider_name: str = "stub"

    def to_dict(self) -> dict:
        return _json_safe(asdict(self))


@dataclass(frozen=True, slots=True)
class ProcessingRequest:
    meeting_id: str
    title: str
    organizer_id: str
    audio_source: AudioSource
    participants: tuple[MeetingParticipant, ...]
    enrollments: tuple[SpeakerEnrollment, ...] = ()
    language: str = "sr"
    chunk_seconds: int = 45
    chunk_overlap_seconds: int = 5
    notes: str | None = None


@dataclass(frozen=True, slots=True)
class ProcessingResult:
    meeting_id: str
    normalized_audio_uri: str
    chunks: tuple[AudioChunk, ...]
    diarized_segments: tuple[DiarizedSegment, ...]
    transcript_segments: tuple[TranscriptSegment, ...]
    artifact: MeetingArtifact
    provider_name: str
    warnings: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        return _json_safe(asdict(self))
