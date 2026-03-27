# Setup Guide

## Prerequisites

- Node.js 18
- `pnpm`
- Python 3.10+
- Docker Desktop or equivalent
- Expo Go or iOS/Android simulator

## Environment

Create `.env` in the project root from [`.env.example`](/Users/sasatabakovic/Downloads/Repo/O3ON%20Meeting%20Assistant/.env.example).

Important variables:

- `AUTH_MODE=development` for local testing
- `DEV_AUTH_SECRET=...` and `DEV_AUTH_PASSWORD=...` for signed local dev login
- `WORKER_BASE_URL=http://127.0.0.1:8080`
- `WORKER_SHARED_SECRET=...` with the same value in API and worker env
- `MEETING_STORAGE_ROOT=./var`
- `OPENAI_API_KEY=...` if live OpenAI processing is desired

## Install

```bash
pnpm install
```

## Start local dependencies

```bash
docker compose -f infra/docker-compose.yml up -d
```

This starts:

- Postgres
- Redis
- MinIO

Current MVP does not require all three services for the in-memory flow, but they are included because they are the intended next persistence layer.

## Start the worker

```bash
cd services/audio-worker
PYTHONPATH=src python3 -m audio_worker.cli --host 127.0.0.1 --port 8080
```

Health check:

```bash
curl http://127.0.0.1:8080/healthz
```

## Start the API

```bash
cd /Users/sasatabakovic/Downloads/Repo/O3ON\ Meeting\ Assistant
WORKER_BASE_URL=http://127.0.0.1:8080 pnpm --filter @o3on/api start
```

Health check:

```bash
curl http://127.0.0.1:3000/v1/health
```

## Start the mobile app

```bash
pnpm dev:mobile
```

Use Expo to launch on simulator or device.

## First end-to-end test

1. Sign in with any email and the configured `DEV_AUTH_PASSWORD`.
2. Create a meeting from the mobile dashboard.
3. Open the meeting and record a short sample.
4. Stop recording.
5. Tap `Upload and process`.
6. Wait on the results screen until status changes to `ready` or `needs_review`.

If `OPENAI_API_KEY` is not set, the results will come from the stub provider.
