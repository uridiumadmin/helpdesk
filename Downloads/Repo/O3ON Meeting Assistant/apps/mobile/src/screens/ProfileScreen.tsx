import { useEffect, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { PrimaryButton } from "../components/PrimaryButton";
import { useTheme, ThemeMode } from "../theme/ThemeContext";
import { api } from "../lib/api";
import type { AuthUser } from "../types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  token: string;
  user: AuthUser;
  onBack: () => void;
  onUpdated: (user: AuthUser) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }
  return (name.charAt(0) || "?").toUpperCase();
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Vlasnik",
  admin: "Administrator",
  member: "Član",
};

const THEME_MODES: ThemeMode[] = ["auto", "dark", "light"];
const THEME_LABELS: Record<ThemeMode, string> = {
  auto: "Auto",
  dark: "Dark",
  light: "Light",
};

// ---------------------------------------------------------------------------
// ProfileScreen
// ---------------------------------------------------------------------------

/* ─── Admin User Management Section ─────────────────────────────────── */

type AdminProps = {
  token: string;
  colors: ReturnType<typeof useTheme>["colors"];
  isDark: boolean;
};

type ManagedUser = {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  createdAt: string;
};

function AdminUserSection({ token, colors, isDark }: AdminProps) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<"member" | "admin">("member");
  const [creating, setCreating] = useState(false);
  const [lastCreated, setLastCreated] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.listUsers(token);
        setUsers(list);
      } catch {
        // silently fail
      }
    })();
  }, [token]);

  async function handleCreate() {
    if (!newEmail.trim()) return;
    setCreating(true);
    setError(null);
    setLastCreated(null);
    try {
      const result = await api.createUser(token, {
        email: newEmail.trim(),
        fullName: newName.trim() || undefined,
        role: newRole,
      });
      setLastCreated({ email: result.email, password: result.generatedPassword });
      setNewEmail("");
      setNewName("");
      setNewRole("member");
      // Refresh list
      const list = await api.listUsers(token);
      setUsers(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Greška pri kreiranju korisnika");
    } finally {
      setCreating(false);
    }
  }

  function handleCopy() {
    if (!lastCreated) return;
    const text = `Email: ${lastCreated.email}\nLozinka: ${lastCreated.password}`;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  const cardStyle = [
    styles.card,
    {
      backgroundColor: colors.bgCard,
      borderColor: colors.border,
    },
    !isDark && {
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 1,
      shadowRadius: 12,
      elevation: 3,
    },
  ];

  return (
    <View style={cardStyle}>
      <Text style={[styles.fieldLabel, { color: colors.text, fontSize: 17, fontWeight: "800" }]}>
        Upravljanje korisnicima
      </Text>

      {/* User list */}
      {users.map((u) => (
        <View
          key={u.id}
          style={[styles.userRow, { borderBottomColor: colors.separator }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[{ color: colors.text, fontSize: 14, fontWeight: "600" }]}>
              {u.fullName ?? u.email}
            </Text>
            <Text style={[{ color: colors.textDim, fontSize: 12 }]}>
              {u.email}
            </Text>
          </View>
          <View style={[styles.roleBadge, { backgroundColor: u.role === "admin" ? colors.accentBg : colors.brandBg }]}>
            <Text style={[styles.roleBadgeText, { color: u.role === "admin" ? colors.accent : colors.brand }]}>
              {u.role === "admin" ? "Admin" : "Korisnik"}
            </Text>
          </View>
        </View>
      ))}

      {/* Create new user */}
      <View style={[styles.createSection, { borderTopColor: colors.separator }]}>
        <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
          Novi korisnik
        </Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.bgInput, borderColor: colors.borderLight, color: colors.text }]}
          value={newEmail}
          onChangeText={setNewEmail}
          placeholder="Email adresa"
          placeholderTextColor={colors.textDim}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TextInput
          style={[styles.input, { backgroundColor: colors.bgInput, borderColor: colors.borderLight, color: colors.text }]}
          value={newName}
          onChangeText={setNewName}
          placeholder="Ime i prezime (opciono)"
          placeholderTextColor={colors.textDim}
        />
        <View style={styles.themeRow}>
          <Pressable
            onPress={() => setNewRole("member")}
            style={[styles.themeChip, {
              backgroundColor: newRole === "member" ? colors.brandBg : colors.bgInput,
              borderColor: newRole === "member" ? colors.brand : colors.border,
            }]}
          >
            <Text style={[styles.themeChipText, { color: newRole === "member" ? colors.brand : colors.textMuted }]}>
              Korisnik
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setNewRole("admin")}
            style={[styles.themeChip, {
              backgroundColor: newRole === "admin" ? colors.accentBg : colors.bgInput,
              borderColor: newRole === "admin" ? colors.accent : colors.border,
            }]}
          >
            <Text style={[styles.themeChipText, { color: newRole === "admin" ? colors.accent : colors.textMuted }]}>
              Admin
            </Text>
          </Pressable>
        </View>
        <PrimaryButton
          label={creating ? "Kreiranje..." : "Kreiraj korisnika"}
          onPress={handleCreate}
          disabled={creating || !newEmail.trim()}
          variant="brand"
        />
      </View>

      {/* Last created password */}
      {lastCreated ? (
        <View style={[styles.passwordCard, { backgroundColor: colors.successBg, borderColor: colors.success }]}>
          <Text style={[{ color: colors.success, fontSize: 13, fontWeight: "700", marginBottom: 4 }]}>
            Korisnik kreiran!
          </Text>
          <Text style={[{ color: colors.text, fontSize: 13 }]}>
            Email: {lastCreated.email}
          </Text>
          <Text style={[{ color: colors.text, fontSize: 13, fontFamily: "monospace" }]} selectable>
            Lozinka: {lastCreated.password}
          </Text>
          <Pressable onPress={handleCopy} style={[styles.copyBtn, { backgroundColor: colors.brandBg }]}>
            <Text style={[{ color: colors.brand, fontSize: 13, fontWeight: "700" }]}>
              {copied ? "Kopirano!" : "Kopiraj kredencijale"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <Text style={[{ color: colors.error, fontSize: 13 }]}>{error}</Text>
      ) : null}
    </View>
  );
}

/* ─── ProfileScreen ─────────────────────────────────────────────────── */

export function ProfileScreen({ token, user, onBack, onUpdated }: Props) {
  const { colors, isDark, mode, setMode } = useTheme();

  const [fullName, setFullName] = useState(user.fullName);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load fresh profile on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await api.getProfile(token);
        if (!cancelled && profile.fullName) {
          setFullName(profile.fullName);
        }
      } catch {
        // keep local state
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function handleSave() {
    const trimmed = fullName.trim();
    if (!trimmed) return;

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const updated = await api.updateProfile(token, { fullName: trimmed });
      onUpdated({
        ...user,
        fullName: updated.fullName,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Greška pri čuvanju",
      );
    } finally {
      setSaving(false);
    }
  }

  const hasChanges = fullName.trim() !== user.fullName;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
        {/* Back button */}
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={styles.backBtn}
        >
          <Text style={[styles.backArrow, { color: colors.textMuted }]}>
            {"<"}
          </Text>
          <Text style={[styles.backLabel, { color: colors.textMuted }]}>
            Sastanci
          </Text>
        </Pressable>

        <Text style={[styles.title, { color: colors.text }]}>Profil</Text>

        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View
            style={[styles.avatarLarge, { backgroundColor: colors.brandBg }]}
          >
            <Text style={[styles.avatarLargeText, { color: colors.brand }]}>
              {userInitials(fullName || user.fullName)}
            </Text>
          </View>
        </View>

        {/* Form card */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.bgCard,
              borderColor: colors.border,
            },
            !isDark && {
              shadowColor: colors.shadow,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 1,
              shadowRadius: 12,
              elevation: 3,
            },
          ]}
        >
          {/* Full name */}
          <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
            Ime i prezime
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.bgInput,
                borderColor: colors.borderLight,
                color: colors.text,
              },
            ]}
            value={fullName}
            onChangeText={(v) => {
              setFullName(v);
              setSaveError(null);
              setSaveSuccess(false);
            }}
            placeholder="Ime i prezime"
            placeholderTextColor={colors.textDim}
          />

          {/* Email (read-only) */}
          <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
            Email
          </Text>
          <View
            style={[
              styles.readOnlyField,
              {
                backgroundColor: colors.bgInput,
                borderColor: colors.borderLight,
              },
            ]}
          >
            <Text style={[styles.readOnlyText, { color: colors.textDim }]}>
              {user.email}
            </Text>
          </View>

          {/* Role */}
          <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
            Uloga
          </Text>
          <View
            style={[
              styles.roleBadge,
              { backgroundColor: colors.brandBg },
            ]}
          >
            <Text style={[styles.roleBadgeText, { color: colors.brand }]}>
              {ROLE_LABELS[user.role] ?? user.role}
            </Text>
          </View>

          {/* Error / success */}
          {saveError ? (
            <Text style={[styles.errorText, { color: colors.error }]}>
              {saveError}
            </Text>
          ) : null}
          {saveSuccess ? (
            <Text style={[styles.successText, { color: colors.success }]}>
              Promene su sačuvane
            </Text>
          ) : null}

          {/* Save button */}
          <PrimaryButton
            label={saving ? "Čuvanje..." : "Sačuvaj"}
            onPress={handleSave}
            disabled={saving || !hasChanges || !fullName.trim()}
            variant="brand"
          />
        </View>

        {/* Admin: User Management — only visible for admin/owner */}
        {(user.role === "admin" || user.role === "owner") ? (
          <AdminUserSection token={token} colors={colors} isDark={isDark} />
        ) : null}

        {/* Theme selector card */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.bgCard,
              borderColor: colors.border,
            },
            !isDark && {
              shadowColor: colors.shadow,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 1,
              shadowRadius: 12,
              elevation: 3,
            },
          ]}
        >
          <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
            Tema
          </Text>
          <View style={styles.themeRow}>
            {THEME_MODES.map((m) => {
              const active = m === mode;
              return (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  style={[
                    styles.themeChip,
                    {
                      backgroundColor: active
                        ? colors.brandBg
                        : colors.bgInput,
                      borderColor: active ? colors.brand : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.themeChipText,
                      {
                        color: active ? colors.brand : colors.textMuted,
                      },
                    ]}
                  >
                    {THEME_LABELS[m]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  container: {
    padding: 20,
    gap: 14,
    paddingBottom: 40,
  },

  // Back button
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingVertical: 8,
    paddingRight: 12,
  },
  backArrow: {
    fontSize: 18,
    fontWeight: "600",
  },
  backLabel: {
    fontSize: 15,
    fontWeight: "600",
  },

  title: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.3,
  },

  // Avatar
  avatarSection: {
    alignItems: "center",
    paddingVertical: 8,
  },
  avatarLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLargeText: {
    fontSize: 30,
    fontWeight: "800",
  },

  // Card
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },

  // Fields
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  readOnlyField: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  readOnlyText: {
    fontSize: 15,
  },

  // Role badge
  roleBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  roleBadgeText: {
    fontSize: 13,
    fontWeight: "700",
  },

  // Messages
  errorText: {
    fontSize: 13,
    lineHeight: 18,
  },
  successText: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },

  // Theme selector
  themeRow: {
    flexDirection: "row",
    gap: 8,
  },
  themeChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  themeChipText: {
    fontSize: 14,
    fontWeight: "700",
  },

  // Admin user management
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 10,
  },
  createSection: {
    borderTopWidth: 1,
    paddingTop: 14,
    marginTop: 6,
    gap: 10,
  },
  passwordCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginTop: 8,
    gap: 4,
  },
  copyBtn: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
});
