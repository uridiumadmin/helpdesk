import { Platform } from "react-native";

let SecureStore: typeof import("expo-secure-store") | null = null;
if (Platform.OS !== "web") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  SecureStore = require("expo-secure-store") as typeof import("expo-secure-store");
}

const SESSION_KEY = "o3on.meeting.session";

export async function loadSecureString(key: string): Promise<string | null> {
  if (SecureStore) return SecureStore.getItemAsync(key);
  try { return localStorage.getItem(key); } catch { return null; }
}

export async function saveSecureString(key: string, value: string): Promise<void> {
  if (SecureStore) { await SecureStore.setItemAsync(key, value); return; }
  try { localStorage.setItem(key, value); } catch { /* web fallback */ }
}

export async function removeSecureString(key: string): Promise<void> {
  if (SecureStore) { await SecureStore.deleteItemAsync(key); return; }
  try { localStorage.removeItem(key); } catch { /* web fallback */ }
}

export async function loadSessionValue() {
  const raw = await loadSecureString(SESSION_KEY);
  return raw ? (JSON.parse(raw) as unknown) : null;
}

export async function saveSessionValue(value: unknown) {
  await saveSecureString(SESSION_KEY, JSON.stringify(value));
}

export async function clearSessionValue() {
  await removeSecureString(SESSION_KEY);
}
