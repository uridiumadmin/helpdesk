from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path


@dataclass(frozen=True, slots=True)
class WorkerSettings:
    service_name: str = "audio-worker"
    environment: str = "development"
    host: str = "127.0.0.1"
    port: int = 8080
    language: str = "sr"
    transcription_model: str = "gpt-4o-transcribe-diarize"
    summary_model: str = "gpt-4o"
    diarize_enabled: bool = True
    chunk_seconds: int = 45
    chunk_overlap_seconds: int = 5
    max_speakers: int = 12
    storage_root: str = "./var"
    openai_api_key: str | None = None
    openai_base_url: str = "https://api.openai.com/v1"
    provider_name: str = "openai"
    worker_shared_secret: str | None = None
    allowed_source_root: str | None = None

    @classmethod
    def from_env(cls) -> "WorkerSettings":
        defaults = cls()
        storage_root = os.getenv("WORKER_STORAGE_ROOT", defaults.storage_root)
        return cls(
            service_name=os.getenv("WORKER_SERVICE_NAME", defaults.service_name),
            environment=os.getenv("WORKER_ENVIRONMENT", defaults.environment),
            host=os.getenv("WORKER_HOST", defaults.host),
            port=int(os.getenv("WORKER_PORT", str(defaults.port))),
            language=os.getenv("WORKER_LANGUAGE", defaults.language),
            transcription_model=os.getenv(
                "WORKER_TRANSCRIPTION_MODEL",
                os.getenv("OPENAI_TRANSCRIBE_MODEL", defaults.transcription_model),
            ),
            summary_model=os.getenv(
                "WORKER_SUMMARY_MODEL",
                os.getenv("OPENAI_SUMMARIZE_MODEL", defaults.summary_model),
            ),
            chunk_seconds=int(os.getenv("WORKER_CHUNK_SECONDS", str(defaults.chunk_seconds))),
            chunk_overlap_seconds=int(
                os.getenv("WORKER_CHUNK_OVERLAP_SECONDS", str(defaults.chunk_overlap_seconds))
            ),
            max_speakers=int(os.getenv("WORKER_MAX_SPEAKERS", str(defaults.max_speakers))),
            storage_root=storage_root,
            openai_api_key=os.getenv("OPENAI_API_KEY"),
            openai_base_url=os.getenv("OPENAI_BASE_URL", defaults.openai_base_url),
            provider_name=os.getenv("WORKER_PROVIDER", defaults.provider_name),
            worker_shared_secret=os.getenv("WORKER_SHARED_SECRET"),
            allowed_source_root=os.getenv("WORKER_ALLOWED_SOURCE_ROOT", storage_root),
        )

    def validate(self) -> None:
        if self.chunk_seconds <= 0:
            raise ValueError("chunk_seconds must be positive")
        if self.chunk_overlap_seconds < 0:
            raise ValueError("chunk_overlap_seconds cannot be negative")
        if self.chunk_overlap_seconds >= self.chunk_seconds:
            raise ValueError("chunk_overlap_seconds must be smaller than chunk_seconds")
        if self.max_speakers <= 0:
            raise ValueError("max_speakers must be positive")
        if self.environment != "development" and not self.worker_shared_secret:
            raise ValueError("WORKER_SHARED_SECRET must be configured outside development.")

    @property
    def resolved_storage_root(self) -> Path:
        return Path(self.storage_root).expanduser().resolve()

    @property
    def resolved_allowed_source_root(self) -> Path:
        return Path(self.allowed_source_root or self.storage_root).expanduser().resolve()
