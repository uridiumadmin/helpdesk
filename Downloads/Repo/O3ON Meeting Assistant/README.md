# O3ON Meeting Assistant

Mobile-first meeting assistant for Serbian-language meetings with secure backend-side AI processing.

## What is implemented

- React Native mobile app for sign-in, meeting creation, recording, upload, processing wait-state, and results review
- NestJS API for dev auth, meeting management, local upload storage, worker dispatch, and artifact retrieval
- Python audio worker with health endpoint, `/process` endpoint, chunking pipeline, stub provider fallback, and OpenAI adapter
- Shared TypeScript contracts for API and mobile app

## Workspace

- `apps/mobile` - React Native Expo app
- `apps/api` - NestJS API
- `services/audio-worker` - Python worker service
- `packages/contracts` - shared contracts
- `infra` - local Postgres, Redis, and MinIO manifests
- `docs` - setup, architecture, operations, and usage docs

## Quick start

1. Copy [`.env.example`](/Users/sasatabakovic/Downloads/Repo/O3ON%20Meeting%20Assistant/.env.example) to `.env`.
2. For local development, set `AUTH_MODE=development`, choose `DEV_AUTH_SECRET`, and keep the same `WORKER_SHARED_SECRET` in both API and worker env.
3. Optionally set `OPENAI_API_KEY` if you want live transcription and summary instead of stub output.
4. Install dependencies:

```bash
pnpm install
```

5. Start local infrastructure:

```bash
docker compose -f infra/docker-compose.yml up -d
```

6. Start the worker:

```bash
cd services/audio-worker
PYTHONPATH=src python3 -m audio_worker.cli --host 127.0.0.1 --port 8080
```

7. Start the API:

```bash
cd /Users/sasatabakovic/Downloads/Repo/O3ON\ Meeting\ Assistant
WORKER_BASE_URL=http://127.0.0.1:8080 pnpm --filter @o3on/api start
```

8. Start mobile development:

```bash
pnpm dev:mobile
```

## Current behavior

- Without `OPENAI_API_KEY`, the worker uses the stub provider and still returns transcript, minutes, and action items.
- With `OPENAI_API_KEY`, the worker attempts live OpenAI transcription and summary generation.
- API data is in-memory for meetings and local-disk for uploaded audio in development.

## Verification

The current codebase was verified with:

```bash
pnpm lint
pnpm build
pnpm test
pnpm --dir apps/mobile typecheck
python3 -m py_compile services/audio-worker/src/audio_worker/*.py services/audio-worker/src/audio_worker/pipeline/*.py
```

## Documentation

- [Setup Guide](/Users/sasatabakovic/Downloads/Repo/O3ON%20Meeting%20Assistant/docs/SETUP.md)
- [Architecture](/Users/sasatabakovic/Downloads/Repo/O3ON%20Meeting%20Assistant/docs/ARCHITECTURE.md)
- [Operations](/Users/sasatabakovic/Downloads/Repo/O3ON%20Meeting%20Assistant/docs/OPERATIONS.md)
- [User Guide](/Users/sasatabakovic/Downloads/Repo/O3ON%20Meeting%20Assistant/docs/USER_GUIDE.md)
- [Hosting Guide](/Users/sasatabakovic/Downloads/Repo/O3ON%20Meeting%20Assistant/docs/HOSTING.md)
- [Security Review](/Users/sasatabakovic/Downloads/Repo/O3ON%20Meeting%20Assistant/docs/SECURITY_REVIEW.md)

## Security notes

- AI provider keys stay on the server and worker side.
- Mobile never receives OpenAI credentials.
- `AUTH_MODE=development` is only for local development and now requires signed dev tokens.
- API and worker must share `WORKER_SHARED_SECRET` before backend processing is enabled.
- Production should replace in-memory meeting state with Postgres and local upload storage with S3/MinIO-backed persistence.
