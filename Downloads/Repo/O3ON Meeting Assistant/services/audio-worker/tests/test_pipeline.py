from __future__ import annotations

from pathlib import Path
import hashlib
import hmac
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from audio_worker.config import WorkerSettings
from audio_worker.engine import MeetingPipeline
from audio_worker.models import AudioSource, MeetingParticipant, ProcessingRequest
from audio_worker.provider import StubMeetingAIProvider
from audio_worker.pipeline.chunk import chunk_audio
from audio_worker.pipeline.normalize import NormalizedAudioSource
from audio_worker.server import (
    _resolve_allowed_path,
    _verify_worker_signature,
    build_health_payload,
)


class ChunkingTests(unittest.TestCase):
    def test_chunk_audio_creates_one_chunk_when_duration_is_unknown(self) -> None:
        normalized = NormalizedAudioSource(
            source_id="src-1",
            source_uri="/tmp/meeting.m4a",
            normalized_uri="/tmp/meeting.wav",
            duration_seconds=100.0,
            target_sample_rate_hz=16000,
            target_channels=1,
            codec="pcm_s16le",
        )
        chunks = chunk_audio(normalized, chunk_seconds=45, overlap_seconds=5)
        self.assertEqual(len(chunks), 3)
        self.assertEqual(chunks[0].chunk_id, "src-1-chunk-0001")
        self.assertEqual(chunks[-1].end_seconds, 100.0)


class PipelineTests(unittest.TestCase):
    def test_pipeline_processes_request_with_stub_provider(self) -> None:
        settings = WorkerSettings()
        provider = StubMeetingAIProvider()
        pipeline = MeetingPipeline(settings=settings, provider=provider)
        request = ProcessingRequest(
            meeting_id="meeting-1",
            title="Weekly sync",
            organizer_id="user-1",
            audio_source=AudioSource(source_id="audio-1", uri="/tmp/weekly-sync.m4a"),
            participants=(
                MeetingParticipant(participant_id="user-1", display_name="Ana", speaker_label="ana"),
                MeetingParticipant(participant_id="user-2", display_name="Marko", speaker_label="marko"),
            ),
        )
        result = pipeline.process(request)
        self.assertEqual(result.meeting_id, "meeting-1")
        self.assertGreaterEqual(len(result.transcript_segments), 1)
        self.assertIn("Stub summary", result.artifact.summary)


class ServerTests(unittest.TestCase):
    def test_health_payload_contains_core_fields(self) -> None:
        payload = build_health_payload(WorkerSettings(service_name="meeting-worker"))
        self.assertEqual(payload["service"], "meeting-worker")
        self.assertEqual(payload["status"], "ok")
        self.assertIn("transcription_model", payload)

    def test_worker_signature_validation_accepts_signed_request(self) -> None:
        settings = WorkerSettings(worker_shared_secret="worker-secret")
        raw = b'{"meeting_id":"m1"}'
        timestamp = str(int(time.time()))
        signature = hmac.new(
            b"worker-secret", timestamp.encode("utf-8") + b"." + raw, hashlib.sha256
        ).hexdigest()
        headers = {
            "x-o3on-timestamp": timestamp,
            "x-o3on-signature": signature,
        }
        self.assertTrue(_verify_worker_signature(settings, headers, raw))

    def test_resolve_allowed_path_rejects_outside_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            allowed = Path(temp_dir) / "allowed"
            allowed.mkdir()
            safe_file = allowed / "clip.wav"
            safe_file.write_bytes(b"data")
            self.assertEqual(_resolve_allowed_path(str(safe_file), allowed), str(safe_file.resolve()))

            outside = Path(temp_dir) / "outside.wav"
            outside.write_bytes(b"data")
            with self.assertRaises(PermissionError):
                _resolve_allowed_path(str(outside), allowed)


if __name__ == "__main__":
    unittest.main()
