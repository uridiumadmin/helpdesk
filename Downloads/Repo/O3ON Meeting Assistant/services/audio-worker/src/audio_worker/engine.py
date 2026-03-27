from __future__ import annotations

from dataclasses import dataclass

from audio_worker.config import WorkerSettings
from audio_worker.models import ProcessingRequest, ProcessingResult
from audio_worker.pipeline.chunk import chunk_audio
from audio_worker.pipeline.diarize import diarize_chunks
from audio_worker.pipeline.normalize import normalize_audio_source
from audio_worker.pipeline.summarize import summarize_transcript
from audio_worker.pipeline.transcribe import transcribe_chunks
from audio_worker.provider import MeetingAIProvider


@dataclass(frozen=True, slots=True)
class MeetingPipeline:
    settings: WorkerSettings
    provider: MeetingAIProvider

    def process(self, request: ProcessingRequest) -> ProcessingResult:
        self.settings.validate()

        normalized = normalize_audio_source(request.audio_source, self.settings)
        chunks = chunk_audio(
            normalized_source=normalized,
            chunk_seconds=request.chunk_seconds or self.settings.chunk_seconds,
            overlap_seconds=request.chunk_overlap_seconds or self.settings.chunk_overlap_seconds,
        )
        diarized_segments = diarize_chunks(
            chunks=chunks,
            participants=request.participants,
            enrollments=request.enrollments,
            max_speakers=self.settings.max_speakers,
            normalized_audio_path=normalized.normalized_uri,
        )
        transcript_segments = transcribe_chunks(
            provider=self.provider,
            meeting_id=request.meeting_id,
            chunks=chunks,
            diarized_segments=diarized_segments,
            participants=request.participants,
            language=request.language,
            title=request.title,
            notes=request.notes,
        )
        artifact = summarize_transcript(
            provider=self.provider,
            meeting_id=request.meeting_id,
            language=request.language,
            title=request.title,
            transcript_segments=transcript_segments,
            participants=request.participants,
            notes=request.notes,
        )
        warnings = tuple(normalized.warnings)
        return ProcessingResult(
            meeting_id=request.meeting_id,
            normalized_audio_uri=normalized.normalized_uri,
            chunks=chunks,
            diarized_segments=diarized_segments,
            transcript_segments=transcript_segments,
            artifact=artifact,
            provider_name=self.provider.provider_name,
            warnings=warnings,
        )

