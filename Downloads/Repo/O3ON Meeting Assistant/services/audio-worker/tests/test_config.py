"""Tests for audio_worker.config — WorkerSettings validation and defaults."""
from __future__ import annotations

import os
from pathlib import Path
from unittest import mock

import pytest

from audio_worker.config import WorkerSettings


# ---------------------------------------------------------------------------
# Default values
# ---------------------------------------------------------------------------

class TestDefaults:
    def test_transcription_model_default(self) -> None:
        settings = WorkerSettings()
        assert settings.transcription_model == "gpt-4o-transcribe-diarize"

    def test_summary_model_default(self) -> None:
        settings = WorkerSettings()
        assert settings.summary_model == "gpt-4o"

    def test_language_default(self) -> None:
        settings = WorkerSettings()
        assert settings.language == "sr"

    def test_chunk_defaults(self) -> None:
        settings = WorkerSettings()
        assert settings.chunk_seconds == 45
        assert settings.chunk_overlap_seconds == 5

    def test_max_speakers_default(self) -> None:
        settings = WorkerSettings()
        assert settings.max_speakers == 12

    def test_environment_default(self) -> None:
        settings = WorkerSettings()
        assert settings.environment == "development"

    def test_provider_name_default(self) -> None:
        settings = WorkerSettings()
        assert settings.provider_name == "openai"

    def test_port_default(self) -> None:
        settings = WorkerSettings()
        assert settings.port == 8080

    def test_storage_root_default(self) -> None:
        settings = WorkerSettings()
        assert settings.storage_root == "./var"


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

class TestValidation:
    def test_valid_development_settings(self) -> None:
        """Development environment does not require WORKER_SHARED_SECRET."""
        settings = WorkerSettings(environment="development", worker_shared_secret=None)
        settings.validate()  # should not raise

    def test_missing_shared_secret_in_production_raises(self) -> None:
        settings = WorkerSettings(environment="production", worker_shared_secret=None)
        with pytest.raises(ValueError, match="WORKER_SHARED_SECRET"):
            settings.validate()

    def test_missing_shared_secret_in_staging_raises(self) -> None:
        settings = WorkerSettings(environment="staging", worker_shared_secret=None)
        with pytest.raises(ValueError, match="WORKER_SHARED_SECRET"):
            settings.validate()

    def test_shared_secret_present_in_production_passes(self) -> None:
        settings = WorkerSettings(
            environment="production",
            worker_shared_secret="s3cr3t",
        )
        settings.validate()  # should not raise

    def test_chunk_seconds_must_be_positive(self) -> None:
        settings = WorkerSettings(chunk_seconds=0)
        with pytest.raises(ValueError, match="chunk_seconds must be positive"):
            settings.validate()

    def test_chunk_overlap_cannot_be_negative(self) -> None:
        settings = WorkerSettings(chunk_overlap_seconds=-1)
        with pytest.raises(ValueError, match="chunk_overlap_seconds cannot be negative"):
            settings.validate()

    def test_chunk_overlap_must_be_smaller_than_chunk(self) -> None:
        settings = WorkerSettings(chunk_seconds=30, chunk_overlap_seconds=30)
        with pytest.raises(ValueError, match="chunk_overlap_seconds must be smaller"):
            settings.validate()

    def test_max_speakers_must_be_positive(self) -> None:
        settings = WorkerSettings(max_speakers=0)
        with pytest.raises(ValueError, match="max_speakers must be positive"):
            settings.validate()


# ---------------------------------------------------------------------------
# from_env
# ---------------------------------------------------------------------------

class TestFromEnv:
    def test_reads_transcription_model_from_env(self) -> None:
        with mock.patch.dict(os.environ, {"WORKER_TRANSCRIPTION_MODEL": "whisper-1"}, clear=False):
            settings = WorkerSettings.from_env()
            assert settings.transcription_model == "whisper-1"

    def test_falls_back_to_openai_transcribe_model_env(self) -> None:
        env = {"OPENAI_TRANSCRIBE_MODEL": "whisper-large-v3"}
        with mock.patch.dict(os.environ, env, clear=False):
            # Remove WORKER_TRANSCRIPTION_MODEL if it happens to be set
            os.environ.pop("WORKER_TRANSCRIPTION_MODEL", None)
            settings = WorkerSettings.from_env()
            assert settings.transcription_model == "whisper-large-v3"

    def test_reads_openai_api_key(self) -> None:
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}, clear=False):
            settings = WorkerSettings.from_env()
            assert settings.openai_api_key == "sk-test"

    def test_api_key_none_when_not_set(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("OPENAI_API_KEY", None)
            settings = WorkerSettings.from_env()
            assert settings.openai_api_key is None

    def test_reads_port_as_int(self) -> None:
        with mock.patch.dict(os.environ, {"WORKER_PORT": "9090"}, clear=False):
            settings = WorkerSettings.from_env()
            assert settings.port == 9090
            assert isinstance(settings.port, int)

    def test_allowed_source_root_defaults_to_storage_root(self) -> None:
        env = {"WORKER_STORAGE_ROOT": "/data/meetings"}
        with mock.patch.dict(os.environ, env, clear=False):
            os.environ.pop("WORKER_ALLOWED_SOURCE_ROOT", None)
            settings = WorkerSettings.from_env()
            assert settings.allowed_source_root == "/data/meetings"


# ---------------------------------------------------------------------------
# Path resolution properties
# ---------------------------------------------------------------------------

class TestPathResolution:
    def test_resolved_storage_root_is_absolute(self) -> None:
        settings = WorkerSettings(storage_root="./var")
        resolved = settings.resolved_storage_root
        assert resolved.is_absolute()

    def test_resolved_allowed_source_root_falls_back(self) -> None:
        settings = WorkerSettings(storage_root="/opt/data", allowed_source_root=None)
        assert settings.resolved_allowed_source_root == Path("/opt/data").resolve()

    def test_resolved_allowed_source_root_uses_explicit(self) -> None:
        settings = WorkerSettings(
            storage_root="/opt/data",
            allowed_source_root="/mnt/uploads",
        )
        assert settings.resolved_allowed_source_root == Path("/mnt/uploads").resolve()
