from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from audio_worker.models import AudioChunk, DiarizedSegment, MeetingParticipant, SpeakerEnrollment

try:
    from pyannote.audio import Pipeline as PyannotePipeline
    _HAS_PYANNOTE = True
except ImportError:
    _HAS_PYANNOTE = False


@dataclass(frozen=True, slots=True)
class DiarizationPlan:
    max_speakers: int

    def validate(self) -> None:
        if self.max_speakers <= 0:
            raise ValueError("max_speakers must be positive")


def _speaker_lookup(
    participants: tuple[MeetingParticipant, ...],
    enrollments: tuple[SpeakerEnrollment, ...],
) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for participant in participants:
        label = participant.speaker_label or participant.participant_id
        lookup[participant.participant_id] = label
    for enrollment in enrollments:
        lookup.setdefault(enrollment.participant_id, enrollment.participant_id)
    return lookup


def diarize_chunks(
    chunks: tuple[AudioChunk, ...],
    participants: tuple[MeetingParticipant, ...],
    enrollments: tuple[SpeakerEnrollment, ...],
    max_speakers: int,
    normalized_audio_path: str | None = None,
) -> tuple[DiarizedSegment, ...]:
    plan = DiarizationPlan(max_speakers=max_speakers)
    plan.validate()

    speaker_lookup = _speaker_lookup(participants, enrollments)
    default_speaker_id = "speaker_unknown"
    if len(speaker_lookup) == 1:
        default_speaker_id = next(iter(speaker_lookup.values()))

    if _HAS_PYANNOTE and normalized_audio_path:
        audio_path = Path(normalized_audio_path)
        if audio_path.exists():
            try:
                pipeline = PyannotePipeline.from_pretrained(
                    "pyannote/speaker-diarization-3.1",
                    use_auth_token=True,
                )
                diarization = pipeline(str(audio_path))
                # Map pyannote speaker labels to participants
                pyannote_speakers = sorted(set(label for _, _, label in diarization.itertracks(yield_label=True)))
                label_map = {}
                for idx, label in enumerate(pyannote_speakers):
                    if idx < len(participants):
                        p = participants[idx]
                        label_map[label] = p.speaker_label or p.participant_id
                    else:
                        label_map[label] = f"speaker_{idx + 1}"

                diarized_segments = []
                for chunk in chunks:
                    mid = (chunk.start_seconds + chunk.end_seconds) / 2
                    best_label = default_speaker_id
                    best_overlap = 0.0
                    for turn, _, label in diarization.itertracks(yield_label=True):
                        overlap = min(turn.end, chunk.end_seconds) - max(turn.start, chunk.start_seconds)
                        if overlap > best_overlap:
                            best_overlap = overlap
                            best_label = label_map.get(label, label)
                    diarized_segments.append(
                        DiarizedSegment(
                            chunk_id=chunk.chunk_id,
                            speaker_id=best_label,
                            start_seconds=chunk.start_seconds,
                            end_seconds=chunk.end_seconds,
                            confidence=0.85,
                        )
                    )
                return tuple(diarized_segments)
            except Exception as exc:
                print(f"[diarize] pyannote failed: {exc}, assigning all segments to 'unknown'")

    if not _HAS_PYANNOTE and participants:
        print("[diarize] pyannote.audio not available, assigning all segments to 'unknown'")

    # Fallback: assign all chunks to "unknown" with low confidence rather than
    # guessing with round-robin, which produces completely wrong labels.
    diarized_segments: list[DiarizedSegment] = []
    for chunk in chunks:
        speaker_id = chunk.speaker_hint or default_speaker_id
        diarized_segments.append(
            DiarizedSegment(
                chunk_id=chunk.chunk_id,
                speaker_id=speaker_id,
                start_seconds=chunk.start_seconds,
                end_seconds=chunk.end_seconds,
                confidence=0.2,
            )
        )
    return tuple(diarized_segments)

