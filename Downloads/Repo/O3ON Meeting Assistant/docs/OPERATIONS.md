# Operations

## Core commands

Install:

```bash
pnpm install
```

Lint:

```bash
pnpm lint
```

Build:

```bash
pnpm build
```

Test:

```bash
pnpm test
```

Mobile typecheck:

```bash
pnpm --dir apps/mobile typecheck
```

Worker Python compile check:

```bash
python3 -m py_compile services/audio-worker/src/audio_worker/*.py services/audio-worker/src/audio_worker/pipeline/*.py
```

## Runtime endpoints

API:

- `GET /v1/health`
- `POST /v1/auth/session`
- `GET /v1/meetings`
- `POST /v1/meetings`
- `POST /v1/meetings/:meetingId/uploads/session`
- `POST /v1/meetings/:meetingId/uploads/:uploadId/file`
- `POST /v1/meetings/:meetingId/uploads/complete`
- `GET /v1/meetings/:meetingId/status`
- `GET /v1/meetings/:meetingId/artifacts`

Worker:

- `GET /healthz`
- `GET /readyz`
- `POST /process`

## Local storage

Uploaded files are stored under:

```text
var/uploads/<orgId>/<meetingId>/<uploadId>/
```

Normalized files and extracted chunks are stored under:

```text
var/normalized/
```

## Troubleshooting

### Mobile can sign in but processing never finishes

Check:

- worker is running on `127.0.0.1:8080`
- API was started with `WORKER_BASE_URL=http://127.0.0.1:8080`
- `GET /healthz` returns `ok`

### Artifacts are always stubbed

Check:

- `OPENAI_API_KEY` is set for the worker process
- the worker process was restarted after setting env vars
- outbound network access is available

### API restarts lose meetings

Expected in current MVP. Meeting metadata is in-memory.

### Upload completes but artifacts stay placeholder

Usually means:

- upload file never reached the API
- API is running stale build
- worker dispatch failed

## Production hardening next

- Replace in-memory meeting store with Postgres
- Replace local file storage with S3/MinIO client
- Add queue-based dispatch between API and worker
- Replace dev auth with Auth0/OIDC
- Add structured logs and audit records
