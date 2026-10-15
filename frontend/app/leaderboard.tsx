import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useEffect, useState } from "react";

import { colors, radius, spacing } from "@/src/theme";
import { useAuth } from "@/src/contexts/auth";
import { api } from "@/src/api";

type Entry = {
  user_id: string;
  name: string;
  picture?: string | null;
  score: number;
  mode: string;
  correct: number;
  total: number;
};

const MODES: { key: "classic" | "time_attack"; label: string }[] = [
  { key: "classic", label: "Classic" },
  { key: "time_attack", label: "Time Attack" },
];

export default function Leaderboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [mode, setMode] = useState<"classic" | "time_attack">("classic");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    api<Entry[]>(`/leaderboard?mode=${mode}&limit=50`)
      .then(setEntries)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [mode]);

  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTag}>GLOBAL</Text>
          <Text style={styles.headerTitle}>LEADERBOARD</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {MODES.map((m) => {
          const active = m.key === mode;
          return (
            <Pressable
              key={m.key}
              testID={`tab-${m.key}`}
              onPress={() => setMode(m.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabTxt, active && styles.tabTxtActive]}>{m.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brandPrimary} />
          </View>
        )}
        {!loading && err && (
          <View style={styles.center}>
            <Text style={styles.muted}>Gagal memuat.</Text>
          </View>
        )}
        {!loading && !err && entries.length === 0 && (
          <View style={styles.center}>
            <Ionicons name="podium-outline" size={64} color={colors.muted} />
            <Text style={styles.emptyTitle}>Belum ada pemain</Text>
            <Text style={styles.muted}>Jadilah yang pertama memasang skor!</Text>
          </View>
        )}
        {!loading && podium.length > 0 && (
          <View style={styles.podium}>
            {[1, 0, 2].map((orderIdx, i) => {
              const p = podium[orderIdx];
              if (!p) return <View key={i} style={styles.podiumSlot} />;
              const rank = orderIdx + 1;
              const h = rank === 1 ? 120 : rank === 2 ? 92 : 72;
              const ringColor =
                rank === 1 ? colors.brandSecondary : rank === 2 ? "#C0C0C0" : "#CD7F32";
              return (
                <View key={rank} style={styles.podiumSlot}>
                  <View style={[styles.avatarRing, { borderColor: ringColor }]}>
                    {p.picture ? (
                      <Image source={p.picture} style={styles.podiumAvatar} />
                    ) : (
                      <Ionicons name="person" size={28} color={colors.onSurface} />
                    )}
                  </View>
                  <Text numberOfLines={1} style={styles.podiumName}>{p.name}</Text>
                  <View style={[styles.podiumBar, { height: h, backgroundColor: ringColor }]}>
                    <Text style={styles.podiumRank}>#{rank}</Text>
                    <Text style={styles.podiumScore}>{p.score}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {rest.map((e, idx) => (
          <View key={e.user_id + idx} style={styles.row}>
            <Text style={styles.rank}>#{idx + 4}</Text>
            {e.picture ? (
              <Image source={e.picture} style={styles.rowAvatar} />
            ) : (
              <View style={[styles.rowAvatar, styles.avatarFallback]}>
                <Ionicons name="person" size={18} color={colors.onSurface} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.rowName}>{e.name}</Text>
              <Text style={styles.rowSub}>{e.correct}/{e.total} benar</Text>
            </View>
            <Text style={styles.rowScore}>{e.score}</Text>
          </View>
        ))}
      </ScrollView>

      {!user && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Pressable
            testID="login-button-footer"
            onPress={() => router.push("/login")}
            style={styles.cta}
          >
            <Ionicons name="logo-google" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.ctaTxt}>MASUK UNTUK IKUT LEADERBOARD</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm as number,
  },
  backBtn: { padding: spacing.xs },
  headerTag: { color: colors.muted, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  headerTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "900", letterSpacing: 2 },
  tabs: {
    flexDirection: "row",
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: 4,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: "center" },
  tabActive: { backgroundColor: colors.brandPrimary },
  tabTxt: { color: colors.muted, fontWeight: "700", fontSize: 13 },
  tabTxtActive: { color: colors.onBrandPrimary },
  center: { alignItems: "center", padding: spacing.xxxl, gap: spacing.sm as number },
  emptyTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "800", marginTop: spacing.md },
  muted: { color: colors.muted, fontSize: 13 },
  podium: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: spacing.md as number,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  podiumSlot: { flex: 1, alignItems: "center", gap: spacing.sm as number },
  avatarRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
  },
  podiumAvatar: { width: 58, height: 58, borderRadius: 29 },
  podiumName: { color: colors.onSurface, fontSize: 12, fontWeight: "700", maxWidth: 90 },
  podiumBar: {
    width: "80%",
    alignItems: "center",
    justifyContent: "center",
    borderTopLeftRadius: radius.sm,
    borderTopRightRadius: radius.sm,
    paddingVertical: spacing.sm,
  },
  podiumRank: { color: colors.onBrandSecondary, fontWeight: "900", fontSize: 14 },
  podiumScore: { color: colors.onBrandSecondary, fontWeight: "900", fontSize: 18 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md as number,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rank: { color: colors.muted, fontWeight: "900", fontSize: 14, width: 36 },
  rowAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  rowName: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  rowSub: { color: colors.muted, fontSize: 11, marginTop: 2 },
  rowScore: { color: colors.brandSecondary, fontWeight: "900", fontSize: 18 },
  footer: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cta: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.lg,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm as number,
  },
  ctaTxt: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 13, letterSpacing: 1.5 },
});
