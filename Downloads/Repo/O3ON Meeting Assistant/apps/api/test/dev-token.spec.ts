import { encodeDevToken, decodeDevToken } from "../src/security/dev-token";
import type { AuthContext } from "../src/security/auth-context";

const SECRET = "test-secret-key-for-unit-tests";

function makeAuth(overrides?: Partial<AuthContext>): AuthContext {
  return {
    orgId: "org-o3on",
    userId: "dev:user@example.com",
    email: "user@example.com",
    role: "member",
    ...overrides,
  };
}

describe("dev-token", () => {
  describe("encodeDevToken / decodeDevToken round-trip", () => {
    it("encodes a valid token and decodes it back with matching fields", () => {
      const auth = makeAuth();
      const token = encodeDevToken(auth, SECRET);
      const decoded = decodeDevToken(token, SECRET);

      expect(decoded).not.toBeNull();
      expect(decoded!.orgId).toBe(auth.orgId);
      expect(decoded!.userId).toBe(auth.userId);
      expect(decoded!.email).toBe(auth.email);
      expect(decoded!.role).toBe(auth.role);
    });

    it("preserves admin role through encode/decode", () => {
      const auth = makeAuth({ role: "admin" });
      const token = encodeDevToken(auth, SECRET);
      const decoded = decodeDevToken(token, SECRET);

      expect(decoded).not.toBeNull();
      expect(decoded!.role).toBe("admin");
    });

    it("preserves owner role through encode/decode", () => {
      const auth = makeAuth({ role: "owner" });
      const token = encodeDevToken(auth, SECRET);
      const decoded = decodeDevToken(token, SECRET);

      expect(decoded).not.toBeNull();
      expect(decoded!.role).toBe("owner");
    });

    it("sets an exp field in the encoded token payload", () => {
      const auth = makeAuth();
      const token = encodeDevToken(auth, SECRET);
      // Decode the payload manually to inspect exp
      const parts = token.split(".");
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));

      expect(payload.exp).toBeDefined();
      expect(typeof payload.exp).toBe("number");
      // exp should be roughly 24 hours from now
      const nowSec = Math.floor(Date.now() / 1000);
      expect(payload.exp).toBeGreaterThan(nowSec);
      expect(payload.exp).toBeLessThanOrEqual(nowSec + 24 * 60 * 60 + 2); // +2s tolerance
    });
  });

  describe("token format", () => {
    it("produces a token with dev. prefix and three dot-separated parts", () => {
      const token = encodeDevToken(makeAuth(), SECRET);

      expect(token.startsWith("dev.")).toBe(true);
      expect(token.split(".")).toHaveLength(3);
    });
  });

  describe("signature verification", () => {
    it("rejects tokens with a tampered signature", () => {
      const token = encodeDevToken(makeAuth(), SECRET);
      const parts = token.split(".");
      // Flip a character in the signature
      const tamperedSig = parts[2][0] === "a" ? "b" + parts[2].slice(1) : "a" + parts[2].slice(1);
      const tampered = `${parts[0]}.${parts[1]}.${tamperedSig}`;

      expect(decodeDevToken(tampered, SECRET)).toBeNull();
    });

    it("rejects tokens with a tampered payload", () => {
      const token = encodeDevToken(makeAuth(), SECRET);
      const parts = token.split(".");
      // Modify the payload
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
      payload.role = "owner"; // escalate role
      const newPayload = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
      const tampered = `${parts[0]}.${newPayload}.${parts[2]}`;

      expect(decodeDevToken(tampered, SECRET)).toBeNull();
    });

    it("rejects tokens signed with a different secret", () => {
      const token = encodeDevToken(makeAuth(), SECRET);

      expect(decodeDevToken(token, "wrong-secret")).toBeNull();
    });
  });

  describe("token expiry", () => {
    it("rejects expired tokens (exp in the past)", () => {
      const auth = makeAuth();
      const token = encodeDevToken(auth, SECRET);

      // Manually craft a token with exp in the past
      const pastExp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const payloadObj = { ...auth, exp: pastExp };
      const payloadB64 = Buffer.from(JSON.stringify(payloadObj), "utf-8").toString("base64url");
      // We need to sign it properly with the real secret to bypass signature check
      const { createHmac } = require("node:crypto");
      const sig = createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
      const expiredToken = `dev.${payloadB64}.${sig}`;

      expect(decodeDevToken(expiredToken, SECRET)).toBeNull();
    });

    it("accepts tokens that have not expired yet", () => {
      const auth = makeAuth();
      // Craft a token with exp 1 hour in the future
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const payloadObj = { ...auth, exp: futureExp };
      const payloadB64 = Buffer.from(JSON.stringify(payloadObj), "utf-8").toString("base64url");
      const { createHmac } = require("node:crypto");
      const sig = createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
      const validToken = `dev.${payloadB64}.${sig}`;

      const decoded = decodeDevToken(validToken, SECRET);
      expect(decoded).not.toBeNull();
      expect(decoded!.email).toBe(auth.email);
    });

    it("accepts the standard 24h token produced by encodeDevToken", () => {
      const token = encodeDevToken(makeAuth(), SECRET);
      // This should succeed since the token was just created
      expect(decodeDevToken(token, SECRET)).not.toBeNull();
    });
  });

  describe("missing required fields", () => {
    it("rejects a token missing orgId", () => {
      const payload = { userId: "u1", email: "a@b.com", role: "member", exp: Math.floor(Date.now() / 1000) + 3600 };
      const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
      const { createHmac } = require("node:crypto");
      const sig = createHmac("sha256", SECRET).update(b64).digest("base64url");

      expect(decodeDevToken(`dev.${b64}.${sig}`, SECRET)).toBeNull();
    });

    it("rejects a token missing userId", () => {
      const payload = { orgId: "org-1", email: "a@b.com", role: "member", exp: Math.floor(Date.now() / 1000) + 3600 };
      const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
      const { createHmac } = require("node:crypto");
      const sig = createHmac("sha256", SECRET).update(b64).digest("base64url");

      expect(decodeDevToken(`dev.${b64}.${sig}`, SECRET)).toBeNull();
    });

    it("rejects a token missing email", () => {
      const payload = { orgId: "org-1", userId: "u1", role: "member", exp: Math.floor(Date.now() / 1000) + 3600 };
      const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
      const { createHmac } = require("node:crypto");
      const sig = createHmac("sha256", SECRET).update(b64).digest("base64url");

      expect(decodeDevToken(`dev.${b64}.${sig}`, SECRET)).toBeNull();
    });

    it("rejects a token missing role", () => {
      const payload = { orgId: "org-1", userId: "u1", email: "a@b.com", exp: Math.floor(Date.now() / 1000) + 3600 };
      const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
      const { createHmac } = require("node:crypto");
      const sig = createHmac("sha256", SECRET).update(b64).digest("base64url");

      expect(decodeDevToken(`dev.${b64}.${sig}`, SECRET)).toBeNull();
    });
  });

  describe("non-dev tokens", () => {
    it("returns null for tokens without dev. prefix", () => {
      const token = encodeDevToken(makeAuth(), SECRET);
      // Strip the "dev." prefix
      const withoutPrefix = token.replace(/^dev\./, "bearer.");

      expect(decodeDevToken(withoutPrefix, SECRET)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(decodeDevToken("", SECRET)).toBeNull();
    });

    it("returns null for random gibberish", () => {
      expect(decodeDevToken("not-a-token-at-all", SECRET)).toBeNull();
    });

    it("returns null for a dev. prefixed token with wrong number of parts", () => {
      expect(decodeDevToken("dev.only-one-part", SECRET)).toBeNull();
      expect(decodeDevToken("dev.a.b.c", SECRET)).toBeNull();
    });
  });

  describe("malformed payload", () => {
    it("returns null when payload is not valid base64url", () => {
      const { createHmac } = require("node:crypto");
      const badPayload = "!!!not-base64!!!";
      const sig = createHmac("sha256", SECRET).update(badPayload).digest("base64url");

      expect(decodeDevToken(`dev.${badPayload}.${sig}`, SECRET)).toBeNull();
    });

    it("returns null when payload is not valid JSON", () => {
      const { createHmac } = require("node:crypto");
      const notJson = Buffer.from("this is not json", "utf-8").toString("base64url");
      const sig = createHmac("sha256", SECRET).update(notJson).digest("base64url");

      expect(decodeDevToken(`dev.${notJson}.${sig}`, SECRET)).toBeNull();
    });
  });
});
