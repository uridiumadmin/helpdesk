from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import shutil
import subprocess

from audio_worker.config import WorkerSettings
from audio_worker.models import AudioSource


@dataclass(frozen=True, slots=True)
class NormalizedAudioSource:
    source_id: str
    source_uri: str
    normalized_uri: str
    duration_seconds: float | None
    target_sample_rate_hz: int
    target_channels: int
    codec: str
    warnings: tuple[str, ...] = ()
    ffmpeg_args: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class NormalizationPlan:
    source: AudioSource
    target_sample_rate_hz: int = 16000
    target_channels: int = 1
    codec: str = "pcm_s16le"
    output_suffix: str = ".wav"
    warnings: tuple[str, ...] = ()


def build_ffmpeg_args(source_uri: str, output_uri: str, plan: NormalizationPlan) -> list[str]:
    return [
        "ffmpeg",
        "-y",
        "-nostdin",
        "-i",
        source_uri,
        "-ac",
        str(plan.target_channels),
        "-ar",
        str(plan.target_sample_rate_hz),
        "-c:a",
        plan.codec,
        output_uri,
    ]


def normalize_audio_source(source: AudioSource, settings: WorkerSettings) -> NormalizedAudioSource:
    plan = NormalizationPlan(source=source)
    source_path = Path(source.uri)
    output_directory = Path(settings.storage_root) / "normalized"
    output_directory.mkdir(parents=True, exist_ok=True)
    normalized_path = output_directory / f"{source_path.stem}{plan.output_suffix}"
    warnings: list[str] = []

    if source.duration_seconds is None:
        warnings.append("Source duration is unknown; downstream chunking will rely on best-effort estimates.")
    if source.sample_rate_hz and source.sample_rate_hz != plan.target_sample_rate_hz:
        warnings.append("Source sample rate differs from worker target sample rate.")
    if source.channels and source.channels != plan.target_channels:
        warnings.append("Source channel count differs from worker target channel count.")

    args = build_ffmpeg_args(source.uri, str(normalized_path), plan)
    ffmpeg = shutil.which("ffmpeg")
    if source_path.exists():
        if ffmpeg:
            try:
                subprocess.run(args, check=True, capture_output=True)
            except subprocess.CalledProcessError as exc:
                warnings.append(f"ffmpeg normalization failed; falling back to source file copy ({exc.returncode}).")
                shutil.copyfile(source_path, normalized_path)
        else:
            warnings.append("ffmpeg is not installed; using source file as normalized input.")
            shutil.copyfile(source_path, normalized_path)
    else:
        warnings.append("Source file does not exist on disk; normalization output is a planned path only.")

    probed_duration = source.duration_seconds
    if normalized_path.exists():
        probe_args = [
            "ffprobe", "-v", "quiet",
            "-show_entries", "format=duration",
            "-of", "csv=p=0",
            str(normalized_path),
        ]
        try:
            probe_result = subprocess.run(probe_args, capture_output=True, text=True, timeout=30)
            if probe_result.returncode == 0 and probe_result.stdout.strip():
                probed_duration = float(probe_result.stdout.strip())
        except (subprocess.TimeoutExpired, ValueError):
            pass

    return NormalizedAudioSource(
        source_id=source.source_id,
        source_uri=source.uri,
        normalized_uri=str(normalized_path),
        duration_seconds=probed_duration,
        target_sample_rate_hz=plan.target_sample_rate_hz,
        target_channels=plan.target_channels,
        codec=plan.codec,
        warnings=tuple(warnings),
        ffmpeg_args=tuple(args),
    )
