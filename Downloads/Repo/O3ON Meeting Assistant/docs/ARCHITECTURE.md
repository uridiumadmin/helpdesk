# Architecture

## Overview

The application is split into three runtime components:

1. Mobile app
2. API server
3. Audio worker

## Mobile app

Location: [apps/mobile](/Users/sasatabakovic/Downloads/Repo/O3ON%20Meeting%20Assistant/apps/mobile)

Responsibilities:

- Sign-in
- Meeting creation
- Local audio capture
- Keep-awake recording session
- File upload initiation
- Upload completion
- Polling meeting status and displaying results

The mobile app never receives AI provider credentials.

## API server

Location: [apps/api](/Users/sasatabakovic/Downloads/Repo/O3ON%20Meeting%20Assistant/apps/api)

Responsibilities:

- Development auth session creation
- Meeting creation and participant storage
- Upload session creation
- Multipart audio file ingestion
- Local disk persistence for uploaded meeting audio
- Worker dispatch
- Mapping worker output into mobile-facing transcript and artifact contracts

Current state:

- Meeting metadata is stored in memory
- Audio files are stored under `var/uploads/...`

## Audio worker

Location: [services/audio-worker](/Users/sasatabakovic/Downloads/Repo/O3ON%20Meeting%20Assistant/services/audio-worker)

Responsibilities:

- Normalize audio
- Chunk audio into overlapping windows
- Assign diarization placeholders / speaker routing
- Transcribe chunks
- Generate summary, minutes, decisions, risks, and action items

Behavior:

- If `OPENAI_API_KEY` is present, the worker uses the OpenAI adapter
- If not, it falls back to the stub provider

## Processing flow

1. User creates a meeting in mobile.
2. User records audio locally on device.
3. Mobile requests an upload session from the API.
4. Mobile uploads the recorded file to the API.
5. Mobile calls upload completion with measured recording duration.
6. API dispatches a processing request to the worker.
7. Worker returns transcript segments and meeting artifacts.
8. API stores transformed artifacts in memory.
9. Mobile polls status and fetches artifacts when ready.

## Security model

- Mobile authenticates to API with bearer token
- OpenAI key is only available to worker
- Audio never goes directly from mobile to OpenAI
- API acts as the trust boundary between device and AI provider

## Current limitations

- In-memory meetings are lost on API restart
- Upload storage is local disk only
- Diarization is heuristic
- OpenAI transport is implemented but production validation depends on a real key and provider account
