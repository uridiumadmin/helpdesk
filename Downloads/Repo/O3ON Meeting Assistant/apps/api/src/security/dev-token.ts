import { createHmac, timingSafeEqual } from "node:crypto";
import { AuthContext } from "./auth-context";

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encodeDevToken(auth: AuthContext, secret: string): string {
  const payload = Buffer.from(JSON.stringify(auth), "utf-8").toString("base64url");
  const signature = signPayload(payload, secret);
  return `dev.${payload}.${signature}`;
}

export function decodeDevToken(token: string, secret: string): AuthContext | null {
  if (!token.startsWith("dev.")) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const raw = parts[1] ?? "";
  const signature = parts[2] ?? "";
  const expected = signPayload(raw, secret);
  const providedBytes = Buffer.from(signature, "utf-8");
  const expectedBytes = Buffer.from(expected, "utf-8");
  if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) {
    return null;
  }

  try {
    const payload = Buffer.from(raw, "base64url").toString("utf-8");
    const parsed = JSON.parse(payload) as AuthContext;
    if (!parsed.orgId || !parsed.userId || !parsed.email || !parsed.role) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
