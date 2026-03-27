import Constants from "expo-constants";

const manifest = Constants.expoConfig?.extra ?? {};

export const appConfig = {
  appName: process.env.EXPO_PUBLIC_APP_NAME ?? "O3ON Meeting Assistant",
  apiBaseUrl:
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    (manifest.apiBaseUrl as string | undefined) ??
    "http://localhost:3000",
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
