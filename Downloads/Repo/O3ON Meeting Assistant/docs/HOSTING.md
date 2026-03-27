# Hosting Guide

## Recommended topology

Use one public entrypoint and keep the worker private.

- Public reverse proxy on `443`
- API on private port `3000`
- Worker on `127.0.0.1:8080` or a private subnet only
- Postgres, Redis, and MinIO or S3-compatible storage on the private network

Do not expose the worker directly to the internet.

## Production baseline

Before deployment:

1. Set `AUTH_MODE=auth0`
2. Do not use the development auth flow
3. Bind the worker to `127.0.0.1`
4. Put the API behind Nginx or Caddy
5. Use a real database for meetings
6. Use object storage for uploaded audio
7. Store `OPENAI_API_KEY` only on the worker host or worker process
8. Set the same `WORKER_SHARED_SECRET` in both API and worker processes
9. Restrict `ALLOWED_ORIGINS` to your real mobile/web origins

## Required environment

API:

```bash
AUTH_MODE=auth0
AUTH0_DOMAIN=your-auth0-domain
AUTH0_AUDIENCE=your-api-audience
JWT_ISSUER=https://your-auth0-domain/
JWT_AUDIENCE=your-api-audience
ALLOWED_ORIGINS=https://app.your-domain.com
MEETING_STORAGE_ROOT=/var/lib/o3on-meeting-assistant
WORKER_BASE_URL=http://127.0.0.1:8080
WORKER_AUTO_PROCESS=true
WORKER_SHARED_SECRET=replace-with-long-random-secret
PORT=3000
```

Worker:

```bash
WORKER_HOST=127.0.0.1
WORKER_PORT=8080
WORKER_STORAGE_ROOT=/var/lib/o3on-meeting-assistant
WORKER_ALLOWED_SOURCE_ROOT=/var/lib/o3on-meeting-assistant
WORKER_SHARED_SECRET=replace-with-long-random-secret
OPENAI_API_KEY=your-openai-key
WORKER_PROVIDER=openai
WORKER_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
WORKER_SUMMARY_MODEL=gpt-5.4
```

## VPS deployment steps

The simplest production-style deployment is one Linux VPS with `systemd`.

### 1. Create directories

```bash
sudo mkdir -p /opt/o3on-meeting-assistant
sudo mkdir -p /var/lib/o3on-meeting-assistant
sudo chown -R $USER:$USER /opt/o3on-meeting-assistant
sudo chown -R $USER:$USER /var/lib/o3on-meeting-assistant
```

### 2. Copy project

Copy the project into:

```text
/opt/o3on-meeting-assistant
```

### 3. Install dependencies

```bash
cd /opt/o3on-meeting-assistant
pnpm install
pnpm build
```

### 4. Create API env file

```bash
cat >/opt/o3on-meeting-assistant/.env.api <<'EOF'
AUTH_MODE=auth0
AUTH0_DOMAIN=...
AUTH0_AUDIENCE=...
JWT_ISSUER=...
JWT_AUDIENCE=...
ALLOWED_ORIGINS=https://app.your-domain.com
MEETING_STORAGE_ROOT=/var/lib/o3on-meeting-assistant
WORKER_BASE_URL=http://127.0.0.1:8080
WORKER_AUTO_PROCESS=true
WORKER_SHARED_SECRET=replace-with-long-random-secret
PORT=3000
EOF
```

### 5. Create worker env file

```bash
cat >/opt/o3on-meeting-assistant/.env.worker <<'EOF'
WORKER_HOST=127.0.0.1
WORKER_PORT=8080
WORKER_STORAGE_ROOT=/var/lib/o3on-meeting-assistant
WORKER_ALLOWED_SOURCE_ROOT=/var/lib/o3on-meeting-assistant
WORKER_SHARED_SECRET=replace-with-long-random-secret
OPENAI_API_KEY=...
WORKER_PROVIDER=openai
WORKER_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
WORKER_SUMMARY_MODEL=gpt-5.4
EOF
```

### 6. Create systemd unit for API

Save as `/etc/systemd/system/o3on-api.service`:

```ini
[Unit]
Description=O3ON Meeting Assistant API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/o3on-meeting-assistant
EnvironmentFile=/opt/o3on-meeting-assistant/.env.api
ExecStart=/usr/bin/env pnpm --filter @o3on/api start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 7. Create systemd unit for worker

Save as `/etc/systemd/system/o3on-worker.service`:

```ini
[Unit]
Description=O3ON Meeting Assistant Worker
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/o3on-meeting-assistant/services/audio-worker
EnvironmentFile=/opt/o3on-meeting-assistant/.env.worker
ExecStart=/usr/bin/env bash -lc 'PYTHONPATH=src python3 -m audio_worker.cli'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 8. Enable and start services

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now o3on-worker
sudo systemctl enable --now o3on-api
```

### 9. Configure reverse proxy

Nginx example:

```nginx
server {
    listen 80;
    server_name api.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

After that, add TLS with Let's Encrypt or use Caddy.

## Health checks

API:

```bash
curl https://api.your-domain.com/v1/health
```

Worker from the host only:

```bash
curl http://127.0.0.1:8080/healthz
```

## Mobile production configuration

Set:

```bash
EXPO_PUBLIC_API_BASE_URL=https://api.your-domain.com
```

Then build the mobile app with your normal Expo or EAS release flow.

## What you should not do

- Do not expose `:8080` publicly
- Do not deploy with `AUTH_MODE=development`
- Do not run API and worker with different `WORKER_SHARED_SECRET` values
- Do not store uploads only in repo-relative `./var` on ephemeral hosts
- Do not put `OPENAI_API_KEY` in mobile env vars
