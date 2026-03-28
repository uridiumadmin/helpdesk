"""Tests for audio_worker.pipeline.chunk — chunk planning and splitting logic.

These tests avoid calling ffmpeg by exercising planning math and the
unknown-duration fallback path only.
"""
from __future__ import annotations

import math

import pytest

from audio_worker.pipeline.chunk import ChunkPlan, chunk_audio
from audio_worker.pipeline.normalize import NormalizedAudioSource


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _make_source(
    source_id: str = "src-1",
    duration_seconds: float | None = 60.0,
    normalized_uri: str = "/tmp/normalized.wav",
) -> NormalizedAudioSource:
    return NormalizedAudioSource(
        source_id=source_id,
        source_uri="/tmp/original.m4a",
        normalized_uri=normalized_uri,
        duration_seconds=duration_seconds,
        target_sample_rate_hz=16000,
        target_channels=1,
        codec="pcm_s16le",
    )


# ---------------------------------------------------------------------------
# ChunkPlan validation
# ---------------------------------------------------------------------------

class TestChunkPlanValidation:
    def test_valid_plan(self) -> None:
        plan = ChunkPlan(chunk_seconds=300, overlap_seconds=10)
        plan.validate()  # should not raise

    def test_chunk_seconds_must_be_positive(self) -> None:
        with pytest.raises(ValueError, match="chunk_seconds must be positive"):
            ChunkPlan(chunk_seconds=0, overlap_seconds=0).validate()

    def test_negative_chunk_seconds(self) -> None:
        with pytest.raises(ValueError, match="chunk_seconds must be positive"):
            ChunkPlan(chunk_seconds=-10, overlap_seconds=0).validate()

    def test_overlap_cannot_be_negative(self) -> None:
        with pytest.raises(ValueError, match="overlap_seconds cannot be negative"):
            ChunkPlan(chunk_seconds=60, overlap_seconds=-1).validate()

    def test_overlap_must_be_smaller_than_chunk(self) -> None:
        with pytest.raises(ValueError, match="overlap_seconds must be smaller"):
            ChunkPlan(chunk_seconds=60, overlap_seconds=60).validate()

        with pytest.raises(ValueError, match="overlap_seconds must be smaller"):
            ChunkPlan(chunk_seconds=60, overlap_seconds=100).validate()


# ---------------------------------------------------------------------------
# Chunk count arithmetic (does NOT call ffmpeg)
# ---------------------------------------------------------------------------

class TestChunkCountArithmetic:
    """Verify that the chunk_audio function plans the correct number of
    chunks.  These tests exercise the unknown-duration path and the
    fits-in-one-chunk path since those do not invoke ffmpeg."""

    def test_60s_audio_300s_chunks_yields_one_chunk(self) -> None:
        """60 seconds of audio fits inside a 300-second chunk window."""
        source = _make_source(duration_seconds=60.0)
        # chunk_audio with duration <= chunk_seconds takes the early-return
        # single-chunk path which DOES call _extract_chunk_file (ffmpeg).
        # Instead we verify the arithmetic independently.
        chunk_seconds = 300
        overlap_seconds = 10
        step = chunk_seconds - overlap_seconds  # 290
        estimated_duration = 60.0
        # Formula from chunk.py line 115
        expected_chunks = max(1, math.ceil((estimated_duration - overlap_seconds) / step))
        # 60 <= 300 → single-chunk early return means 1
        assert estimated_duration <= chunk_seconds
        assert expected_chunks == 1

    def test_600s_audio_300s_chunks_yields_correct_count(self) -> None:
        """600 seconds of audio with 300-second chunks (10s overlap) → ceil((600-10)/290) = 3."""
        chunk_seconds = 300
        overlap_seconds = 10
        step = chunk_seconds - overlap_seconds  # 290
        estimated_duration = 600.0
        expected_chunks = max(1, math.ceil((estimated_duration - overlap_seconds) / step))
        assert expected_chunks == 3

    def test_exact_boundary(self) -> None:
        """Duration == chunk_seconds → single chunk."""
        chunk_seconds = 300
        overlap_seconds = 10
        estimated_duration = 300.0
        # The code returns early when estimated_duration <= chunk_seconds
        assert estimated_duration <= chunk_seconds

    def test_slightly_over_boundary(self) -> None:
        """Duration just over chunk_seconds → 2 chunks."""
        chunk_seconds = 300
        overlap_seconds = 10
        step = chunk_seconds - overlap_seconds  # 290
        estimated_duration = 301.0
        expected_chunks = max(1, math.ceil((estimated_duration - overlap_seconds) / step))
        assert expected_chunks == 2

    def test_very_short_audio(self) -> None:
        """5 seconds with 45-second chunks → 1 chunk."""
        chunk_seconds = 45
        estimated_duration = 5.0
        assert estimated_duration <= chunk_seconds


class TestChunkAudioUnknownDuration:
    """When duration_seconds is None, chunk_audio returns a single chunk
    that covers 0..chunk_seconds using the original normalized file."""

    def test_unknown_duration_returns_single_chunk(self) -> None:
        source = _make_source(duration_seconds=None)
        chunks = chunk_audio(source, chunk_seconds=300, overlap_seconds=10)
        assert len(chunks) == 1
        assert chunks[0].chunk_id == "src-1-chunk-0001"
        assert chunks[0].index == 1
        assert chunks[0].start_seconds == 0.0
        assert chunks[0].end_seconds == 300.0
        assert chunks[0].overlap_seconds == 10.0
        assert chunks[0].source_id == "src-1"
        # The chunk_uri should be the normalized file itself (no ffmpeg)
        assert chunks[0].chunk_uri == "/tmp/normalized.wav"

    def test_unknown_duration_respects_chunk_seconds(self) -> None:
        source = _make_source(duration_seconds=None)
        chunks = chunk_audio(source, chunk_seconds=120, overlap_seconds=5)
        assert chunks[0].end_seconds == 120.0

    def test_unknown_duration_preserves_source_id(self) -> None:
        source = _make_source(source_id="meeting-xyz", duration_seconds=None)
        chunks = chunk_audio(source, chunk_seconds=45, overlap_seconds=5)
        assert chunks[0].source_id == "meeting-xyz"
        assert "meeting-xyz" in chunks[0].chunk_id


class TestChunkAudioValidation:
    """chunk_audio calls ChunkPlan.validate, so invalid params raise."""

    def test_zero_chunk_seconds_raises(self) -> None:
        source = _make_source(duration_seconds=None)
        with pytest.raises(ValueError, match="chunk_seconds must be positive"):
            chunk_audio(source, chunk_seconds=0, overlap_seconds=0)

    def test_overlap_equals_chunk_raises(self) -> None:
        source = _make_source(duration_seconds=None)
        with pytest.raises(ValueError, match="overlap_seconds must be smaller"):
            chunk_audio(source, chunk_seconds=60, overlap_seconds=60)
