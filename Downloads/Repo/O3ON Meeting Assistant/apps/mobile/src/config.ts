import Constants from "expo-constants";

const manifest = Constants.expoConfig?.extra ?? {};

function resolveApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (fromEnv) return fromEnv;
  const fromManifest = manifest.apiBaseUrl as string | undefined;
  if (fromManifest) return fromManifest;
  // On web in production: use same origin (relative URLs via nginx proxy)
  if (typeof window !== "undefined" && window.location?.hostname !== "localhost") {
    return window.location.origin;
  }
  return "http://localhost:3000";
}

export const appConfig = {
  appName: process.env.EXPO_PUBLIC_APP_NAME ?? "O3ON Meeting Assistant",
  apiBaseUrl: resolveApiBaseUrl(),
  authStrategy:
    process.env.EXPO_PUBLIC_AUTH_STRATEGY ??
    (manifest.authStrategy as string | undefined) ??
    "api"
};

export const recordingDefaults = {
  chunkSeconds: 45,
  keepScreenAwake: true,
  language: "sr-RS"
} as const;
