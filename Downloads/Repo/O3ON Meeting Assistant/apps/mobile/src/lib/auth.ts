import type { AuthSession } from "../types";
import { clearSessionValue, loadSessionValue, saveSessionValue } from "./storage";

export async function loadSession(): Promise<AuthSession | null> {
  const value = await loadSessionValue();
  return value as AuthSession | null;
}

export async function persistSession(session: AuthSession) {
  await saveSessionValue(session);
}

export async function dropSession() {
  await clearSessionValue();
}

export async function signInWithCredentials(input: {
  email: string;
  password: string;
}): Promise<AuthSession> {
  return {
    accessToken: `${input.email}.token`,
    refreshToken: null,
    user: {
      id: "user-1",
      email: input.email,
      fullName: input.email.split("@")[0].replace(/[._-]/g, " "),
      role: "admin"
    },
    organization: {
      id: "org-1",
      name: "O3ON"
    }
  };
}
