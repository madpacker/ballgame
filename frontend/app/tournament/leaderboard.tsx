import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useCallback, useEffect, useState } from "react";

import { colors, radius, spacing } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/contexts/auth";

type Board = "classic" | "time_attack" | "royal";
type Entry = { user_id: string; name: string; picture?: string | null; score: number; games: number };

const TABS: { key: Board; label: string; hint: string }[] = [
  { key: "classic", label: "Classic", hint: "Total poin kumulatif dari semua permainan" },
  { key: "time_attack", label: "Time Attack", hint: "Skor tertinggi dalam 90 detik" },
  { key: "royal", label: "Royal", hint: "Total poin loyalitas dari misi" },
];

export default function TournamentLeaderboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [board, setBoard] = useState<Board>("classic");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setEntries(await api<Entry[]>(`/tournament/leaderboard?board=${board}&limit=100`));
    } catch {
      setEntries([]);
    }
  }, [board]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const tab = TABS.find((t) => t.key === board)!;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTag}>TOURNAMENT</Text>
          <Text style={styles.headerTitle}>PERINGKAT</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => {
          const active = t.key === board;
          return (
            <Pressable
              key={t.key}
              testID={`tboard-tab-${t.key}`}
              onPress={() => setBoard(t.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabTxt, active && styles.tabTxtActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>{tab.hint}</Text>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={colors.brandPrimary}
          />
        }
      >
        {loading ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xxl }} />
        ) : entries.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="podium-outline" size={56} color={colors.muted} />
            <Text style={styles.emptyTitle}>Belum ada peserta</Text>
            <Text style={styles.muted}>Jadilah yang pertama di papan peringkat ini!</Text>
          </View>
        ) : (
          entries.map((e, i) => {
            const mine = user?.user_id === e.user_id;
            return (
              <View
                key={e.user_id}
                testID={`tboard-row-${i}`}
                style={[styles.row, mine && { borderColor: colors.brandSecondary, backgroundColor: colors.brandTertiary }]}
              >
                <Text style={[styles.rank, i < 3 && { color: colors.brandSecondary }]}>
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                </Text>
                {e.picture ? (
                  <Image source={e.picture} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Ionicons name="person" size={18} color={colors.onSurface} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={styles.name}>
                    {e.name}
                    {mine ? " (Kamu)" : ""}
                  </Text>
                  {board !== "royal" && <Text style={styles.sub}>{e.games}x main</Text>}
                </View>
                <Text style={styles.score}>{e.score}</Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
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
  hint: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: spacing.sm },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 13, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    marginBottom: spacing.sm,
  },
  rank: { color: colors.muted, fontWeight: "900", fontSize: 16, width: 36 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceTertiary },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  name: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  sub: { color: colors.muted, fontSize: 11, marginTop: 2 },
  score: { color: colors.brandSecondary, fontWeight: "900", fontSize: 18 },
});
