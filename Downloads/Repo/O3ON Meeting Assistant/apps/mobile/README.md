# O3ON Meeting Assistant Mobile

Expo-based mobile shell for meeting capture, speaker-aware processing, and post-meeting results.

## Scripts

- `npm run start`
- `npm run android`
- `npm run ios`
- `npm run web`
- `npm run typecheck`

## Environment

- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_AUTH_STRATEGY`
- `EXPO_PUBLIC_APP_NAME`

## Notes

- The scaffold keeps the screen awake during recording.
- Authentication is token-based and backed by secure storage.
- The API client is typed and ready for a backend that exposes meeting, upload, and artifact endpoints.
