import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { PrimaryButton } from "../components/PrimaryButton";
import { useTheme } from "../theme/ThemeContext";
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
  onProfile: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DURATIONS = [15, 30, 45, 60, 90] as const;

type StatusFilter = "all" | "processing" | "ready";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Svi" },
  { key: "processing", label: "Obrada" },
  { key: "ready", label: "Završeni" },
];

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
  processing_chunks: { label: "Transkripcija...", bgKey: "warningBg", colorKey: "warning", pulse: true },
  summarizing: { label: "Rezime...", bgKey: "warningBg", colorKey: "warning", pulse: true },
  ready: {
    label: "Završen",
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
  failed: { label: "Greška", bgKey: "errorBg", colorKey: "error" },
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
    case "processing_chunks":
    case "summarizing":
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
  onProfile,
}: Props) {
  const { colors, isDark } = useTheme();

  // Data
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Search & filter
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

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
  // Filtered meetings (search + status)
  // --------------------------------------------------

  const filteredMeetings = meetings.filter((m) => {
    // Title search (case-insensitive)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      if (!m.title.toLowerCase().includes(q)) return false;
    }
    // Status filter
    if (statusFilter === "processing") {
      return m.status === "processing" || m.status === "recording" || m.status === "draft";
    }
    if (statusFilter === "ready") {
      return m.status === "ready" || m.status === "needs_review" || m.status === "failed";
    }
    return true;
  });

  // --------------------------------------------------
  // Delete meeting
  // --------------------------------------------------

  function handleDeleteMeeting(meeting: Meeting) {
    Alert.alert(
      "Brisanje sastanka",
      `Da li ste sigurni da želite da obrišete ovaj sastanak?\n\n"${meeting.title}"`,
      [
        { text: "Odustani", style: "cancel" },
        {
          text: "Obriši",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteMeeting(token, meeting.id);
              setMeetings((prev) => prev.filter((m) => m.id !== meeting.id));
            } catch {
              Alert.alert("Greška", "Brisanje sastanka nije uspelo.");
            }
          },
        },
      ],
    );
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
        err instanceof Error ? err.message : "Greška pri kreiranju",
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
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Image
            source={{ uri: "/icon-512.png" }}
            style={{ width: 28, height: 28, borderRadius: 6, marginRight: 10 }}
          />
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Sastanci
          </Text>
        </View>
        <View style={styles.headerRight}>
          {/* User avatar — tap to open profile */}
          <Pressable
            onPress={onProfile}
            hitSlop={8}
            style={[styles.avatar, { backgroundColor: colors.brandBg }]}
          >
            <Text style={[styles.avatarText, { color: colors.brand }]}>
              {userInitial(user.fullName)}
            </Text>
          </Pressable>

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

  function renderSearchAndFilter() {
    return (
      <View style={styles.searchFilterContainer}>
        {/* Search bar */}
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: colors.bgInput,
              borderColor: colors.borderLight,
            },
          ]}
        >
          <Text style={[styles.searchIcon, { color: colors.textDim }]}>
            {"\u{1F50D}"}
          </Text>
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Pretraži sastanke..."
            placeholderTextColor={colors.textDim}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
              <Text style={[styles.searchClear, { color: colors.textMuted }]}>
                {"\u2715"}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Status filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterChipsRow}
        >
          {STATUS_FILTERS.map((f) => {
            const active = f.key === statusFilter;
            return (
              <Pressable
                key={f.key}
                onPress={() => setStatusFilter(f.key)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? colors.accent : colors.bgInput,
                    borderColor: active ? colors.accent : colors.borderLight,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    {
                      color: active ? "#FFFFFF" : colors.textMuted,
                    },
                  ]}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
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
          placeholder="Učesnici (razdvojeni zarezom)"
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
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                handleDeleteMeeting(meeting);
              }}
              hitSlop={8}
              style={styles.deleteButton}
            >
              <Text style={[styles.deleteIcon, { color: colors.textMuted }]}>
                {"\u{1F5D1}"}
              </Text>
            </Pressable>
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
          Još nema sastanaka
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textDim }]}>
          Kreirajte prvi sastanak da započnete
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
        data={filteredMeetings}
        keyExtractor={(m) => m.id}
        renderItem={renderMeetingCard}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            {renderHeader()}
            {renderNewMeetingButton()}
            {renderCreateForm()}
            {renderSearchAndFilter()}
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

  // Search & filter
  searchFilterContainer: {
    marginTop: 14,
    marginBottom: 4,
    gap: 10,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  searchIcon: {
    fontSize: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  searchClear: {
    fontSize: 16,
    fontWeight: "600",
    padding: 4,
  },
  filterChipsRow: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 2,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: "700",
  },

  // Delete button on card
  deleteButton: {
    padding: 4,
  },
  deleteIcon: {
    fontSize: 16,
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
