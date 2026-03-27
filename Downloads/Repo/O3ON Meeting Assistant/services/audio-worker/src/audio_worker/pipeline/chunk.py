from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
import shutil
import subprocess

from audio_worker.models import AudioChunk
from audio_worker.pipeline.normalize import NormalizedAudioSource


@dataclass(frozen=True, slots=True)
class ChunkPlan:
    chunk_seconds: int
    overlap_seconds: int

    def validate(self) -> None:
        if self.chunk_seconds <= 0:
            raise ValueError("chunk_seconds must be positive")
        if self.overlap_seconds < 0:
            raise ValueError("overlap_seconds cannot be negative")
        if self.overlap_seconds >= self.chunk_seconds:
            raise ValueError("overlap_seconds must be smaller than chunk_seconds")


def _extract_chunk_file(source: Path, destination: Path, start_seconds: float, duration_seconds: float) -> str:
    ffmpeg = shutil.which("ffmpeg")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not ffmpeg or not source.exists():
        return str(source)

    command = [
        ffmpeg,
        "-y",
        "-nostdin",
        "-ss",
        f"{start_seconds:.3f}",
        "-i",
        str(source),
        "-t",
        f"{duration_seconds:.3f}",
        "-ac",
        "1",
        "-ar",
        "16000",
        str(destination),
    ]

    try:
        subprocess.run(command, check=True, capture_output=True)
        return str(destination)
    except subprocess.CalledProcessError:
        return str(source)


def chunk_audio(
    normalized_source: NormalizedAudioSource,
    chunk_seconds: int,
    overlap_seconds: int,
) -> tuple[AudioChunk, ...]:
    plan = ChunkPlan(chunk_seconds=chunk_seconds, overlap_seconds=overlap_seconds)
    plan.validate()

    estimated_duration = normalized_source.duration_seconds
    if estimated_duration is None:
        return (
            AudioChunk(
                chunk_id=f"{normalized_source.source_id}-chunk-0001",
                index=1,
                start_seconds=0.0,
                end_seconds=float(chunk_seconds),
                overlap_seconds=float(overlap_seconds),
                source_id=normalized_source.source_id,
                chunk_uri=normalized_source.normalized_uri,
            ),
        )

    step = chunk_seconds - overlap_seconds
    source_path = Path(normalized_source.normalized_uri)
    chunk_directory = source_path.parent / "chunks"

    if estimated_duration <= chunk_seconds:
        single_path = _extract_chunk_file(source_path, chunk_directory / f"{normalized_source.source_id}-chunk-0001.wav", 0.0, float(estimated_duration))
        return (
            AudioChunk(
                chunk_id=f"{normalized_source.source_id}-chunk-0001",
                index=1,
                start_seconds=0.0,
                end_seconds=float(estimated_duration),
                overlap_seconds=float(overlap_seconds),
                source_id=normalized_source.source_id,
                chunk_uri=single_path,
            ),
        )

    chunk_total = max(1, math.ceil((estimated_duration - overlap_seconds) / step))
    chunks: list[AudioChunk] = []
    for index in range(chunk_total):
        start_seconds = float(index * step)
        end_seconds = min(estimated_duration, start_seconds + chunk_seconds)
        chunk_id = f"{normalized_source.source_id}-chunk-{index + 1:04d}"
        chunk_uri = _extract_chunk_file(
            source_path,
            chunk_directory / f"{chunk_id}.wav",
            start_seconds,
            end_seconds - start_seconds,
        )
        chunks.append(
            AudioChunk(
                chunk_id=chunk_id,
                index=index + 1,
                start_seconds=start_seconds,
                end_seconds=end_seconds,
                overlap_seconds=float(overlap_seconds),
                source_id=normalized_source.source_id,
                chunk_uri=chunk_uri,
            )
        )
    return tuple(chunks)
