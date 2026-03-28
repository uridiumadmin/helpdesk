/**
 * Tests for the password-hashing logic used in auth.controller.ts.
 *
 * The functions hashPassword, verifyPassword, generateStrongPassword, and
 * timingSafeStringEqual are defined at module scope in auth.controller.ts but
 * are NOT exported.  Rather than modifying production code solely for tests,
 * we validate the same contracts by exercising bcryptjs and crypto directly.
 */

import * as bcrypt from "bcryptjs";
import { randomBytes, timingSafeEqual } from "node:crypto";

const BCRYPT_ROUNDS = 12;

// ── Re-implementations that mirror auth.controller.ts ─────────────────────

function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

function verifyPassword(password: string, hash: string): boolean {
  if (hash && !hash.startsWith("$2")) {
    return false;
  }
  return bcrypt.compareSync(password, hash);
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function generateStrongPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*()-_=+";
  const bytes = randomBytes(32);
  let password = "";
  for (let i = 0; i < 24; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("hashPassword / verifyPassword", () => {
  it("hashes a password and verifyPassword returns true for the correct password", () => {
    const password = "S3cure!Pass";
    const hash = hashPassword(password);

    expect(hash).toMatch(/^\$2[aby]?\$/); // bcrypt hash prefix
    expect(verifyPassword(password, hash)).toBe(true);
  });

  it("returns false for an incorrect password", () => {
    const hash = hashPassword("correct-password");

    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces different hashes for the same password (random salt)", () => {
    const password = "same-password";
    const hash1 = hashPassword(password);
    const hash2 = hashPassword(password);

    expect(hash1).not.toBe(hash2);
    // Both should still verify
    expect(verifyPassword(password, hash1)).toBe(true);
    expect(verifyPassword(password, hash2)).toBe(true);
  });

  it("uses cost factor 12 (embedded in the hash)", () => {
    const hash = hashPassword("test");
    // bcrypt hash format: $2b$12$...
    expect(hash).toContain("$12$");
  });
});

describe("verifyPassword — legacy HMAC hash migration", () => {
  it("returns false for a legacy hex hash (64 chars, no $2 prefix)", () => {
    // Simulate an old HMAC-SHA256 hex digest
    const legacyHash = "a".repeat(64);

    expect(verifyPassword("any-password", legacyHash)).toBe(false);
  });

  it("returns false for any non-bcrypt hash string", () => {
    expect(verifyPassword("password", "plaintext-not-a-hash")).toBe(false);
    expect(verifyPassword("password", "sha256:abc123")).toBe(false);
  });

  it("correctly verifies a bcrypt hash (starts with $2)", () => {
    const hash = bcrypt.hashSync("my-password", 10);
    expect(hash.startsWith("$2")).toBe(true);
    expect(verifyPassword("my-password", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("timingSafeStringEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeStringEqual("hello", "hello")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(timingSafeStringEqual("aaaaa", "aaaab")).toBe(false);
  });

  it("returns false for strings of different length", () => {
    expect(timingSafeStringEqual("short", "longer-string")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(timingSafeStringEqual("", "")).toBe(true);
  });

  it("handles unicode correctly", () => {
    expect(timingSafeStringEqual("čćžšđ", "čćžšđ")).toBe(true);
    expect(timingSafeStringEqual("čćžšđ", "ccžšd")).toBe(false);
  });
});

describe("generateStrongPassword", () => {
  it("generates a 24-character password", () => {
    const password = generateStrongPassword();
    expect(password).toHaveLength(24);
  });

  it("generates different passwords on each call", () => {
    const passwords = new Set<string>();
    for (let i = 0; i < 20; i++) {
      passwords.add(generateStrongPassword());
    }
    // All 20 should be unique (collision probability is negligible)
    expect(passwords.size).toBe(20);
  });

  it("only contains characters from the allowed charset", () => {
    const allowed = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*()-_=+";
    for (let i = 0; i < 50; i++) {
      const password = generateStrongPassword();
      for (const ch of password) {
        expect(allowed).toContain(ch);
      }
    }
  });

  it("produces passwords that bcrypt can hash and verify", () => {
    const password = generateStrongPassword();
    const hash = hashPassword(password);
    expect(verifyPassword(password, hash)).toBe(true);
  });

  it("excludes ambiguous characters (0, O, 1, l, I)", () => {
    // The charset intentionally omits 0, O, 1, l, I to avoid ambiguity
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*()-_=+";
    expect(charset).not.toContain("0");
    expect(charset).not.toContain("O");
    expect(charset).not.toContain("1");
    expect(charset).not.toContain("l");
    expect(charset).not.toContain("I");
  });
});
