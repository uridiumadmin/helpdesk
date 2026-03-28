import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { PrimaryButton } from "../components/PrimaryButton";
import { useTheme, ThemeMode } from "../theme/ThemeContext";
import { api } from "../lib/api";
import type { Meeting, MeetingStatus } from "../types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  token: string;
  user: { id: string; email: string; fullName: string; role: string };
  onRecord: (meeting: Meeting) => void;
  onOpenMeeting: (meeting: Meeting) => void;
  onSignOut: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DURATIONS = [15, 30, 45, 60, 90] as const;

function formatDate(iso: string): string {
  const d = new Date(iso);
  const months = [
    "januar",
    "februar",
    "mart",
    "april",
    "maj",
    "jun",
    "jul",
    "avgust",
    "septembar",
    "oktobar",
    "novembar",
    "decembar",
  ];
  return `${d.getDate()}. ${months[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function userInitial(name: string): string {
  return (name.charAt(0) || "?").toUpperCase();
}

const THEME_CYCLE: ThemeMode[] = ["auto", "dark", "light"];
const THEME_LABELS: Record<ThemeMode, string> = {
  auto: "Auto",
  dark: "Dark",
  light: "Light",
};

// ---------------------------------------------------------------------------
// Status badge colors - derived from theme
// ---------------------------------------------------------------------------

type BadgeConfig = {
  label: string;
  bgKey: string;
  colorKey: string;
  borderColorKey?: string;
  pulse?: boolean;
};

const STATUS_BADGE_MAP: Record<MeetingStatus, BadgeConfig> = {
  draft: { label: "Nacrt", bgKey: "bgCardHover", colorKey: "textMuted" },
  recording: {
    label: "Snimanje",
    bgKey: "recordingBg",
    colorKey: "recording",
    pulse: true,
  },
  processing: { label: "Obrada...", bgKey: "warningBg", colorKey: "warning" },
  ready: {
    label: "Zavrsen",
    bgKey: "successBg",
    colorKey: "success",
    borderColorKey: "success",
  },
  needs_review: {
    label: "Revizija",
    bgKey: "warningBg",
    colorKey: "warning",
    borderColorKey: "warning",
  },
  failed: { label: "Greska", bgKey: "errorBg", colorKey: "error" },
};

// Map status to card left-border color key
function statusBorderColorKey(status: MeetingStatus): string {
  switch (status) {
    case "ready":
      return "success";
    case "needs_review":
      return "warning";
    case "recording":
      return "recording";
    case "processing":
      return "accent";
    case "failed":
      return "error";
    default:
      return "border";
  }
}

// ---------------------------------------------------------------------------
// Pulsing badge for recording status
// ---------------------------------------------------------------------------

function PulsingBadge({
  config,
  bg,
  color,
}: {
  config: BadgeConfig;
  bg: string;
  color: string;
}) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!config.pulse) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [config.pulse, opacity]);

  return (
    <Animated.View
      style={[
        styles.badge,
        { backgroundColor: bg },
        config.pulse ? { opacity } : undefined,
      ]}
    >
      <Text style={[styles.badgeText, { color }]}>{config.label}</Text>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Spinning indicator for processing status
// ---------------------------------------------------------------------------

function SpinningIndicator({ color }: { color: string }) {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [rotation]);

  const spin = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View
      style={[
        styles.spinner,
        {
          borderColor: "transparent",
          borderTopColor: color,
          borderRightColor: color,
          transform: [{ rotate: spin }],
        },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Participant avatar circle
// ---------------------------------------------------------------------------

function ParticipantAvatar({
  name,
  index,
}: {
  name: string;
  index: number;
}) {
  const AVATAR_COLORS = [
    "#1565C0",
    "#7B1FA2",
    "#C62828",
    "#00838F",
    "#2E7D32",
    "#EF6C00",
  ];
  const bgColor = AVATAR_COLORS[index % AVATAR_COLORS.length];
  const initial = (name.charAt(0) || "?").toUpperCase();

  return (
    <View
      style={[
        styles.participantAvatar,
        { backgroundColor: bgColor, marginLeft: index > 0 ? -6 : 0 },
      ]}
    >
      <Text style={styles.participantAvatarText}>{initial}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// MeetingsScreen
// ---------------------------------------------------------------------------

export function MeetingsScreen({
  token,
  user,
  onRecord,
  onOpenMeeting,
  onSignOut,
}: Props) {
  const { colors, isDark, mode, setMode } = useTheme();

  // Data
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Create form
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [participants, setParticipants] = useState("");
  const [duration, setDuration] = useState<number>(30);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Animations
  const headerFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(headerFade, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [headerFade]);

  // --------------------------------------------------
  // Data fetching
  // --------------------------------------------------

  const fetchMeetings = useCallback(async () => {
    try {
      const data = await api.listMeetings(token);
      setMeetings(data);
    } catch {
      // keep current list on error
    }
  }, [token]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await api.listMeetings(token);
        if (mounted) setMeetings(data);
      } catch {
        // keep empty
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [token]);

  // Auto-refresh every 10 seconds (skip while creating)
  useEffect(() => {
    const timer = setInterval(() => {
      if (!formOpen) fetchMeetings();
    }, 10000);
    return () => clearInterval(timer);
  }, [formOpen, token, fetchMeetings]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchMeetings();
    setRefreshing(false);
  }, [fetchMeetings]);

  // --------------------------------------------------
  // Theme toggle
  // --------------------------------------------------

  function cycleTheme() {
    const currentIndex = THEME_CYCLE.indexOf(mode);
    const next = THEME_CYCLE[(currentIndex + 1) % THEME_CYCLE.length];
    setMode(next);
  }

  // --------------------------------------------------
  // Create meeting
  // --------------------------------------------------

  function resetForm() {
    setTitle("");
    setParticipants("");
    setDuration(30);
    setCreateError(null);
  }

  async function handleCreate(andRecord: boolean) {
    setCreating(true);
    setCreateError(null);

    try {
      const participantNames = participants
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const created = await api.createMeeting(token, {
        title: title.trim() || "Novi sastanak",
        startsAt: new Date().toISOString(),
        durationMinutes: duration,
        participantNames,
      });

      resetForm();
      setFormOpen(false);

      if (andRecord) {
        onRecord(created);
      } else {
        setMeetings((prev) => [created, ...prev]);
      }
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Greska pri kreiranju",
      );
    } finally {
      setCreating(false);
    }
  }

  // --------------------------------------------------
  // Card press handler
  // --------------------------------------------------

  function handleCardPress(meeting: Meeting) {
    switch (meeting.status) {
      case "draft":
      case "recording":
        onRecord(meeting);
        break;
      case "processing":
      case "ready":
      case "needs_review":
      case "failed":
        onOpenMeeting(meeting);
        break;
    }
  }

  // --------------------------------------------------
  // Render helpers
  // --------------------------------------------------

  function renderHeader() {
    return (
      <Animated.View style={[styles.header, { opacity: headerFade }]}>
        <View>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Sastanci
          </Text>
        </View>
        <View style={styles.headerRight}>
          {/* Theme toggle */}
          <Pressable
            onPress={cycleTheme}
            hitSlop={8}
            style={[
              styles.themeToggle,
              {
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.08)"
                  : "rgba(0,0,0,0.06)",
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.themeToggleText, { color: colors.textMuted }]}>
              {THEME_LABELS[mode]}
            </Text>
          </Pressable>

          {/* User avatar */}
          <View
            style={[styles.avatar, { backgroundColor: colors.brandBg }]}
          >
            <Text style={[styles.avatarText, { color: colors.brand }]}>
              {userInitial(user.fullName)}
            </Text>
          </View>

          {/* Sign out */}
          <Pressable onPress={onSignOut} hitSlop={8}>
            <Text style={[styles.signOut, { color: colors.textMuted }]}>
              Odjavi se
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    );
  }

  function renderNewMeetingButton() {
    return (
      <PrimaryButton
        label="Novi sastanak"
        onPress={() => {
          resetForm();
          setFormOpen((v) => !v);
        }}
        variant="brand"
      />
    );
  }

  function renderCreateForm() {
    if (!formOpen) return null;

    return (
      <View
        style={[
          styles.formCard,
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
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.bgInput,
              borderColor: colors.borderLight,
              color: colors.text,
            },
          ]}
          placeholder="Naziv sastanka"
          placeholderTextColor={colors.textDim}
          value={title}
          onChangeText={setTitle}
          autoFocus
        />

        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.bgInput,
              borderColor: colors.borderLight,
              color: colors.text,
            },
          ]}
          placeholder="Ucesnici (razdvojeni zarezom)"
          placeholderTextColor={colors.textDim}
          value={participants}
          onChangeText={setParticipants}
        />

        <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
          Trajanje (min)
        </Text>
        <View style={styles.durationRow}>
          {DURATIONS.map((d) => {
            const active = d === duration;
            return (
              <Pressable
                key={d}
                onPress={() => setDuration(d)}
                style={[
                  styles.durationChip,
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
                    styles.durationChipText,
                    {
                      color: active ? colors.brand : colors.textMuted,
                    },
                  ]}
                >
                  {d}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {createError ? (
          <Text style={[styles.error, { color: colors.error }]}>
            {createError}
          </Text>
        ) : null}

        <View style={styles.formActions}>
          <PrimaryButton
            label={creating ? "Kreiranje..." : "Kreiraj i snimi"}
            onPress={() => void handleCreate(true)}
            disabled={creating}
            variant="brand"
            style={styles.formButtonPrimary}
          />
          <PrimaryButton
            label="Kreiraj"
            onPress={() => void handleCreate(false)}
            disabled={creating}
            variant="secondary"
            style={styles.formButtonSecondary}
          />
        </View>
      </View>
    );
  }

  function renderMeetingCard({ item: meeting }: { item: Meeting }) {
    const badgeConfig =
      STATUS_BADGE_MAP[meeting.status] ?? STATUS_BADGE_MAP.draft;
    const badgeBg =
      colors[badgeConfig.bgKey as keyof typeof colors] ?? colors.bgCardHover;
    const badgeColor =
      colors[badgeConfig.colorKey as keyof typeof colors] ?? colors.textMuted;
    const borderColor =
      colors[
        statusBorderColorKey(meeting.status) as keyof typeof colors
      ] ?? colors.border;

    const isProcessing = meeting.status === "processing";

    return (
      <Pressable
        onPress={() => handleCardPress(meeting)}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: colors.bgCard,
            borderLeftColor: borderColor,
            borderLeftWidth: 3,
          },
          !isDark && {
            shadowColor: colors.shadow,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 1,
            shadowRadius: 8,
            elevation: 2,
          },
          pressed && styles.cardPressed,
        ]}
      >
        <View style={styles.cardTopRow}>
          <Text
            style={[styles.cardTitle, { color: colors.text }]}
            numberOfLines={2}
          >
            {meeting.title}
          </Text>
          <View style={styles.badgeRow}>
            {isProcessing && <SpinningIndicator color={badgeColor} />}
            <PulsingBadge config={badgeConfig} bg={badgeBg} color={badgeColor} />
          </View>
        </View>

        <Text style={[styles.cardDate, { color: colors.textDim }]}>
          {formatDate(meeting.startsAt)}
        </Text>

        {meeting.participants.length > 0 ? (
          <View style={styles.cardParticipantsRow}>
            <View style={styles.avatarStack}>
              {meeting.participants.slice(0, 4).map((p, i) => (
                <ParticipantAvatar key={p.id} name={p.name} index={i} />
              ))}
              {meeting.participants.length > 4 ? (
                <View
                  style={[
                    styles.participantAvatar,
                    {
                      backgroundColor: colors.bgCardHover,
                      marginLeft: -6,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.participantAvatarText,
                      { fontSize: 9 },
                    ]}
                  >
                    +{meeting.participants.length - 4}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              style={[styles.cardParticipants, { color: colors.textDim }]}
              numberOfLines={1}
            >
              {meeting.participants.map((p) => p.name).join(", ")}
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  }

  function renderEmpty() {
    if (loading) return null;
    return (
      <View style={styles.emptyState}>
        <View
          style={[
            styles.emptyIcon,
            { backgroundColor: colors.brandBg },
          ]}
        >
          <Text
            style={[styles.emptyIconText, { color: colors.brand }]}
          >
            O3
          </Text>
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          Jos nema sastanaka
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textDim }]}>
          Kreirajte prvi sastanak da zapocnete
        </Text>
        <PrimaryButton
          label="Novi sastanak"
          onPress={() => {
            resetForm();
            setFormOpen(true);
          }}
          variant="brand"
          style={styles.emptyButton}
        />
      </View>
    );
  }

  // --------------------------------------------------
  // Main render
  // --------------------------------------------------

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <FlatList
        data={meetings}
        keyExtractor={(m) => m.id}
        renderItem={renderMeetingCard}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            {renderHeader()}
            {renderNewMeetingButton()}
            {renderCreateForm()}
          </>
        }
        ListEmptyComponent={renderEmpty}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles (layout only -- colors applied inline)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  listContent: {
    padding: 20,
    paddingBottom: 40,
    gap: 0,
  },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  themeToggle: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
  },
  themeToggleText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 15,
    fontWeight: "700",
  },
  signOut: {
    fontSize: 13,
    fontWeight: "600",
  },

  // Form
  formCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 12,
    marginTop: 14,
    marginBottom: 4,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  durationRow: {
    flexDirection: "row",
    gap: 8,
  },
  durationChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  durationChipText: {
    fontSize: 14,
    fontWeight: "600",
  },
  formActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  formButtonPrimary: {
    flex: 1,
  },
  formButtonSecondary: {
    flex: 1,
  },
  error: {
    fontSize: 13,
    lineHeight: 18,
  },

  // Cards
  separator: {
    height: 12,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    gap: 8,
    overflow: "hidden",
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    flex: 1,
  },
  cardDate: {
    fontSize: 13,
  },
  cardParticipantsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  avatarStack: {
    flexDirection: "row",
    alignItems: "center",
  },
  participantAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  participantAvatarText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
  },
  cardParticipants: {
    fontSize: 12,
    flex: 1,
  },

  // Badge
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  // Spinner for processing status
  spinner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },

  // Empty state
  emptyState: {
    alignItems: "center",
    paddingTop: 60,
    gap: 12,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyIconText: {
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
  },
  emptyButton: {
    marginTop: 12,
    paddingHorizontal: 28,
  },
});
