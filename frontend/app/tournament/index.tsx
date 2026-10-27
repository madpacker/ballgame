import { View, Text, Pressable, StyleSheet, ScrollView, Platform, RefreshControl } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useCallback, useState } from "react";
import * as Haptics from "expo-haptics";

import { colors, radius, spacing } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/contexts/auth";

type BoardStat = { score: number; games: number; rank: number | null };
type Me = { enabled: boolean; royal_points: number; boards: Record<"classic" | "time_attack" | "royal", BoardStat> };

const MODES = [
  {
    key: "t_classic",
    board: "classic",
    icon: "trophy",
    title: "CLASSIC",
    desc: "20 soal campuran · 20 detik/soal · poin akurasi + kecepatan",
    rule: "Poin KUMULATIF — terus bertambah tiap main",
  },
  {
    key: "t_time_attack",
    board: "time_attack",
    icon: "timer",
    title: "TIME ATTACK",
    desc: "90 detik · jawab sebanyak mungkin · 100 poin/benar",
    rule: "HIGH SCORE — hanya skor terbaik yang dihitung",
  },
  {
    key: "royal",
    board: "royal",
    icon: "ribbon",
    title: "ROYAL",
    desc: "Selesaikan misi harian & kumpulkan poin loyalitas",
    rule: "Like, komentar, main & kirim video",
  },
] as const;

export default function TournamentHub() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api<{ enabled: boolean }>("/tournament/status");
      setEnabled(s.enabled);
    } catch {
      setEnabled(false);
    }
    if (user) {
      api<Me>("/tournament/me").then(setMe).catch(() => setMe(null));
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const open = (key: string) => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    if (!user) {
      router.push("/login");
      return;
    }
    if (key === "royal") router.push("/tournament/royal");
    else router.push({ pathname: "/quiz", params: { mode: key, category: "tournament" } });
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTag}>MODE KOMPETISI</Text>
          <Text style={styles.headerTitle}>TOURNAMENT</Text>
        </View>
        <Pressable
          testID="tournament-leaderboard-button"
          onPress={() => router.push("/tournament/leaderboard")}
          hitSlop={10}
          style={styles.iconBtn}
        >
          <Ionicons name="podium" size={24} color={colors.brandSecondary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        {enabled === false ? (
          <View testID="tournament-locked" style={styles.lockedCard}>
            <Ionicons name="lock-closed" size={48} color={colors.brandSecondary} />
            <Text style={styles.lockedTitle}>Tournament belum dibuka</Text>
            <Text style={styles.lockedBody}>
              Admin akan membuka Tournament segera. Pantau terus dan siapkan dirimu, Laskar Sape Kerap!
            </Text>
          </View>
        ) : (
          <>
            {user && me && (
              <View style={styles.statRow}>
                <Stat label="CLASSIC" value={me.boards.classic.score} rank={me.boards.classic.rank} />
                <Stat label="TIME ATTACK" value={me.boards.time_attack.score} rank={me.boards.time_attack.rank} />
                <Stat label="ROYAL 👑" value={me.royal_points} rank={me.boards.royal.rank} />
              </View>
            )}
            {!user && (
              <Pressable testID="tournament-login-cta" onPress={() => router.push("/login")} style={styles.loginCard}>
                <Ionicons name="log-in" size={20} color={colors.brandSecondary} />
                <Text style={styles.loginTxt}>Masuk dulu untuk ikut Tournament & masuk peringkat.</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            )}
          </>
        )}

        <Text style={styles.sectionTitle}>PILIH KATEGORI</Text>
        {MODES.map((m) => {
          const locked = enabled !== true;
          return (
            <Pressable
              key={m.key}
              testID={`tournament-mode-${m.key}`}
              disabled={locked}
              onPress={() => open(m.key)}
              style={({ pressed }) => [styles.modeCard, locked && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
            >
              <View style={[styles.modeIcon, m.key === "royal" && { backgroundColor: colors.brandSecondary }]}>
                <Ionicons
                  name={m.icon as any}
                  size={26}
                  color={m.key === "royal" ? colors.onBrandSecondary : colors.onBrandPrimary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modeTitle}>{m.title}</Text>
                <Text style={styles.modeDesc}>{m.desc}</Text>
                <Text style={styles.modeRule}>{m.rule}</Text>
              </View>
              <Ionicons name={locked ? "lock-closed" : "chevron-forward"} size={20} color={colors.muted} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, rank }: { label: string; value: number; rank: number | null }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statRank}>{rank ? `#${rank}` : "—"}</Text>
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
    gap: spacing.sm,
  },
  iconBtn: { padding: spacing.xs, minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  headerTag: { color: colors.muted, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  headerTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "900", letterSpacing: 2 },
  content: { padding: spacing.lg, gap: spacing.md },
  sectionTitle: { color: colors.muted, fontSize: 12, letterSpacing: 2, fontWeight: "800", marginTop: spacing.sm },
  lockedCard: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.brandTertiary,
    borderWidth: 1,
    borderColor: colors.brandSecondary,
  },
  lockedTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "900" },
  lockedBody: { color: colors.onBrandTertiary, fontSize: 13, textAlign: "center", lineHeight: 19 },
  statRow: { flexDirection: "row", gap: spacing.sm },
  statCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  statLabel: { color: colors.muted, fontSize: 10, letterSpacing: 1, fontWeight: "800" },
  statValue: { color: colors.brandSecondary, fontSize: 22, fontWeight: "900", marginTop: 4 },
  statRank: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700", marginTop: 2 },
  loginCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  loginTxt: { flex: 1, color: colors.onSurface, fontSize: 13 },
  modeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  modeTitle: { color: colors.onSurface, fontWeight: "900", fontSize: 16, letterSpacing: 1.5 },
  modeDesc: { color: colors.muted, fontSize: 12, marginTop: 4, lineHeight: 17 },
  modeRule: { color: colors.brandSecondary, fontSize: 11, marginTop: 4, fontWeight: "700" },
});
