import * as SecureStore from "expo-secure-store";

const SESSION_KEY = "o3on.meeting.session";

export async function loadSecureString(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function saveSecureString(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function removeSecureString(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
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
