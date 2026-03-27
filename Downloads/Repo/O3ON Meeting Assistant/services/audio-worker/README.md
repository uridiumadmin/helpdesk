# Audio Worker

This service is the audio-processing backbone for the meeting assistant.

It is intentionally scaffolded in a way that can grow into a production worker without
locking the implementation to a single provider or deployment style.

## What is here

- Meeting and audio domain models
- Audio normalization and chunking pipeline stages
- Speaker diarization and transcription interfaces
- Meeting summary, minutes, and action-item generation hooks
- HTTP health and `/process` endpoints
- Basic unit tests

## What is not here yet

- Real diarization / speaker embedding models
- Durable job queue integration
- Blob storage integration

## Run

```bash
python -m audio_worker.cli --host 0.0.0.0 --port 8080
```

If `OPENAI_API_KEY` is set, the worker will attempt live OpenAI transcription and meeting synthesis.
Without it, the worker automatically falls back to the stub provider so the end-to-end flow still works.

## Test

```bash
python -m unittest discover -s tests -p 'test_*.py'
```
