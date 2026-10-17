import { View, Text, Pressable, StyleSheet, ScrollView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useEffect, useState } from "react";
import * as Haptics from "expo-haptics";

import { api } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { useAuth } from "@/src/contexts/auth";
import { useSkin } from "@/src/contexts/skin";
import { BACKGROUNDS } from "@/src/data/quiz";
import { getLocalHigh, type LocalHigh } from "@/src/storage/localHigh";
import { absoluteFileUrl, useAppSettings } from "@/src/hooks/useAppSettings";

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { accent } = useSkin();
  const { settings } = useAppSettings();
  const customBg = absoluteFileUrl(settings.background_url);
  const [high, setHigh] = useState<LocalHigh>({ classic: 0, time_attack: 0 });
  const [unread, setUnread] = useState(0);
  const [theme, setTheme] = useState<{ title: string; subtitle: string; accent: string; id: string } | null>(null);
  const [topStreaks, setTopStreaks] = useState<{ user_id: string; name: string; picture?: string | null; current_streak: number }[]>([]);
  const [live, setLive] = useState<{ live: boolean; match?: any; minute?: number; multiplier?: number } | null>(null);

  useEffect(() => {
    getLocalHigh().then(setHigh);
    api<{ title: string; subtitle: string; accent: string; id: string }>("/weekly-theme")
      .then(setTheme)
      .catch(() => setTheme(null));
    api<{ user_id: string; name: string; picture?: string | null; current_streak: number }[]>("/top-streaks?limit=5")
      .then(setTopStreaks)
      .catch(() => setTopStreaks([]));
    const refreshLive = () =>
      api<{ live: boolean; match?: any; minute?: number; multiplier?: number }>("/live-match")
        .then(setLive)
        .catch(() => setLive(null));
    refreshLive();
    const id = setInterval(refreshLive, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!user) {
      setUnread(0);
      return;
    }
    let active = true;
    const refresh = () =>
      api<{ count: number }>("/notifications/unread-count")
        .then((r) => active && setUnread(r.count))
        .catch(() => {});
    refresh();
    const id = setInterval(refresh, 20000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [user]);

  const go = (mode: "classic" | "time_attack") => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    router.push({ pathname: "/category", params: { mode } });
  };

  return (
    <View style={styles.container}>
      <View style={[styles.hero, { paddingTop: insets.top + spacing.md }]}>
        <Image source={customBg || BACKGROUNDS.stadium} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient
          colors={["rgba(15,17,21,0.55)", "rgba(15,17,21,0.95)", colors.surface]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <View style={styles.logoBadge}>
              <Image
                source={require("@/assets/images/icon.png")}
                style={styles.logoImg}
                contentFit="cover"
              />
            </View>
            <View>
              <Text style={styles.brandTitle}>CAK MAD QUIZ</Text>
              <Text style={styles.brandSub}>Laskar Sape Kerap Fan Game</Text>
            </View>
          </View>
          <View style={styles.topRight}>
            {user && (
              <Pressable
                testID="notifications-button"
                onPress={() => router.push("/notifications")}
                hitSlop={10}
                style={styles.bellBtn}
              >
                <Ionicons name="notifications" size={24} color={colors.onSurface} />
                {unread > 0 && (
                  <View style={styles.bellBadge}>
                    <Text style={styles.bellBadgeTxt}>{unread > 9 ? "9+" : unread}</Text>
                  </View>
                )}
              </Pressable>
            )}
            <Pressable
              testID="profile-button"
              onPress={() => router.push("/profile")}
              style={styles.profileBtn}
              hitSlop={10}
            >
              {user?.picture ? (
                <Image source={user.picture} style={styles.avatar} />
              ) : (
                <Ionicons name="person-circle-outline" size={32} color={colors.onSurface} />
              )}
            </Pressable>
          </View>
        </View>

        <View style={styles.highCard}>
          <Text style={styles.highLabel}>SKOR TERTINGGI LOKAL</Text>
          <View style={styles.highRow}>
            <View style={styles.highBox}>
              <Text style={styles.highTag}>Classic</Text>
              <Text style={styles.highValue}>{high.classic}</Text>
            </View>
            <View style={styles.highDivider} />
            <View style={styles.highBox}>
              <Text style={styles.highTag}>Time Attack</Text>
              <Text style={styles.highValue}>{high.time_attack}</Text>
            </View>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionTitle}>PILIH MODE PERTANDINGAN</Text>

        {live?.live && live.match && (
          <Pressable
            testID="live-boost-banner"
            onPress={() => router.push("/matches")}
            style={({ pressed }) => [styles.liveBanner, pressed && { opacity: 0.9 }]}
          >
            <View style={styles.liveDot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.liveTag}>LIVE · MENIT {live.minute}&apos;</Text>
              <Text style={styles.liveTitle}>
                {live.match.home ? "MU vs " + live.match.opponent : live.match.opponent + " vs MU"}
              </Text>
              <Text style={styles.liveSub}>⚡ Semua skor quiz dapat {live.multiplier}X bonus!</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.onBrandPrimary} />
          </Pressable>
        )}

        {theme && (
          <Pressable
            testID="weekly-theme-banner"
            onPress={() => router.push({ pathname: "/category", params: { mode: "classic", theme: theme.id } })}
            style={({ pressed }) => [
              styles.themeBanner,
              { borderColor: theme.accent, backgroundColor: theme.accent + "22" },
              pressed && { opacity: 0.85 },
            ]}
          >
            <View style={[styles.themeIcon, { backgroundColor: theme.accent }]}>
              <Ionicons name="flame" size={22} color={colors.onBrandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.themeTag}>CHALLENGE MINGGU INI</Text>
              <Text style={styles.themeTitle}>{theme.title}</Text>
              <Text style={styles.themeSub}>{theme.subtitle}</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.muted} />
          </Pressable>
        )}

        {user && (user.current_streak ?? 0) > 0 && (
          <View style={styles.streakCard}>
            <View style={styles.streakIcon}>
              <Text style={{ fontSize: 20 }}>🔥</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.streakLabel}>STREAK HARIAN</Text>
              <Text style={styles.streakValue}>{user.current_streak} hari berturut</Text>
            </View>
            <View style={styles.streakRight}>
              <Text style={styles.streakBest}>Rekor: {user.best_streak ?? 0}</Text>
              {(user.current_streak ?? 0) >= 7 ? (
                <Text style={styles.streakBonus}>+150 bonus</Text>
              ) : (user.current_streak ?? 0) >= 3 ? (
                <Text style={styles.streakBonus}>+75 bonus</Text>
              ) : (user.current_streak ?? 0) >= 2 ? (
                <Text style={styles.streakBonus}>+25 bonus</Text>
              ) : null}
            </View>
          </View>
        )}

        <Pressable
          testID="mode-classic-button"
          onPress={() => go("classic")}
          style={({ pressed }) => [styles.modeCard, pressed && styles.cardPressed]}
        >
          <View style={[styles.modeIcon, { backgroundColor: accent.primary }]}>
            <Ionicons name="trophy" size={28} color={accent.onPrimary} />
          </View>
          <View style={styles.modeInfo}>
            <Text style={styles.modeTitle}>MODE CLASSIC</Text>
            <Text style={styles.modeDesc}>10 soal · poin akurasi · ritme santai</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.muted} />
        </Pressable>

        <Pressable
          testID="mode-time-attack-button"
          onPress={() => go("time_attack")}
          style={({ pressed }) => [styles.modeCard, pressed && styles.cardPressed]}
        >
          <View style={[styles.modeIcon, { backgroundColor: accent.secondary }]}>
            <Ionicons name="timer" size={28} color={colors.onBrandSecondary} />
          </View>
          <View style={styles.modeInfo}>
            <Text style={styles.modeTitle}>TIME ATTACK</Text>
            <Text style={styles.modeDesc}>60 detik · jawab sebanyak mungkin</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.muted} />
        </Pressable>

        <View style={styles.quickRow}>
          <Pressable
            testID="news-shortcut"
            onPress={() => router.push("/news")}
            style={styles.quickBtn}
          >
            <Ionicons name="newspaper" size={22} color={colors.brandSecondary} />
            <Text style={styles.quickTxt}>Berita</Text>
          </Pressable>
          <Pressable
            testID="matches-shortcut"
            onPress={() => router.push("/matches")}
            style={styles.quickBtn}
          >
            <Ionicons name="football" size={22} color={colors.brandSecondary} />
            <Text style={styles.quickTxt}>Prediksi</Text>
          </Pressable>
          <Pressable
            testID="leaderboard-shortcut"
            onPress={() => router.push("/leaderboard")}
            style={styles.quickBtn}
          >
            <Ionicons name="podium" size={22} color={colors.brandSecondary} />
            <Text style={styles.quickTxt}>Peringkat</Text>
          </Pressable>
          <Pressable
            testID="profile-shortcut"
            onPress={() => router.push("/profile")}
            style={styles.quickBtn}
          >
            <Ionicons name="person" size={22} color={colors.brandSecondary} />
            <Text style={styles.quickTxt}>{user ? "Profil" : "Masuk"}</Text>
          </Pressable>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Tentang Game</Text>
          <Text style={styles.infoBody}>
            Uji seberapa dalam kamu mengenal Madura United. Tebak foto pemain, lacak
            sejarah klub mereka, dan jawab trivia seputar Laskar Sape Kerap.
          </Text>
        </View>

        {topStreaks.length > 0 && (
          <View style={styles.streakBoardCard}>
            <View style={styles.streakBoardHeader}>
              <Text style={styles.streakBoardTitle}>🔥 JUARA STREAK HARI INI</Text>
              <Text style={styles.streakBoardSub}>Siapa paling rajin main?</Text>
            </View>
            {topStreaks.slice(0, 5).map((u, i) => (
              <View key={u.user_id} style={styles.streakRow}>
                <Text style={[styles.streakRank, i === 0 && { color: colors.brandSecondary }]}>
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                </Text>
                {u.picture ? (
                  <Image source={u.picture} style={styles.streakAvatar} />
                ) : (
                  <View style={[styles.streakAvatar, styles.streakAvatarFallback]}>
                    <Ionicons name="person" size={16} color={colors.onSurface} />
                  </View>
                )}
                <Text numberOfLines={1} style={styles.streakName}>{u.name}</Text>
                <View style={styles.streakDaysPill}>
                  <Text style={styles.streakDaysTxt}>{u.current_streak}🔥</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  hero: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    overflow: "hidden",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.md as number },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: colors.brandSecondary,
  },
  logoText: {
    color: colors.onBrandPrimary,
    fontWeight: "900",
    fontSize: 16,
    letterSpacing: 1,
  },
  logoImg: { width: 64, height: 64 },
  brandTitle: {
    color: colors.onSurface,
    fontWeight: "900",
    fontSize: 18,
    letterSpacing: 2,
  },
  brandSub: { color: colors.muted, fontSize: 11, marginTop: 2, letterSpacing: 0.5 },
  profileBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  topRight: { flexDirection: "row", alignItems: "center", gap: spacing.xs as number },
  bellBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  bellBadgeTxt: { color: colors.onBrandPrimary, fontSize: 10, fontWeight: "900" },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  themeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md as number,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
  },
  themeIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  themeTag: { color: colors.muted, fontSize: 10, letterSpacing: 2, fontWeight: "800" },
  themeTitle: { color: colors.onSurface, fontWeight: "900", fontSize: 16, letterSpacing: 0.5, marginTop: 2 },
  themeSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  streakCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md as number,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  streakIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  streakLabel: { color: colors.muted, fontSize: 10, letterSpacing: 2, fontWeight: "800" },
  streakValue: { color: colors.onSurface, fontWeight: "900", fontSize: 15, marginTop: 2 },
  streakRight: { alignItems: "flex-end" },
  streakBest: { color: colors.muted, fontSize: 11 },
  streakBonus: { color: colors.brandSecondary, fontWeight: "900", fontSize: 12, marginTop: 2 },
  highCard: {
    backgroundColor: "rgba(28,31,38,0.85)",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  highLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "700",
    marginBottom: spacing.md,
  },
  highRow: { flexDirection: "row", alignItems: "center" },
  highBox: { flex: 1 },
  highDivider: { width: 1, height: 40, backgroundColor: colors.border, marginHorizontal: spacing.md },
  highTag: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: spacing.xs },
  highValue: {
    color: colors.brandSecondary,
    fontSize: 40,
    fontWeight: "900",
    letterSpacing: 2,
  },
  content: { padding: spacing.lg, gap: spacing.md as number },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: "800",
    marginBottom: spacing.sm,
  },
  modeCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.md as number,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardPressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  modeIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  modeInfo: { flex: 1 },
  modeTitle: {
    color: colors.onSurface,
    fontWeight: "900",
    fontSize: 16,
    letterSpacing: 1.5,
  },
  modeDesc: { color: colors.muted, fontSize: 13, marginTop: 4 },
  quickRow: { flexDirection: "row", gap: spacing.md as number, marginTop: spacing.sm },
  quickBtn: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
    gap: spacing.xs as number,
  },
  quickTxt: { color: colors.onSurface, fontSize: 13, fontWeight: "600" },
  infoCard: {
    marginTop: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.lg,
  },
  infoTitle: {
    color: colors.onBrandTertiary,
    fontWeight: "800",
    fontSize: 14,
    marginBottom: spacing.xs,
    letterSpacing: 1,
  },
  infoBody: { color: colors.onBrandTertiary, fontSize: 13, lineHeight: 19 },
  streakBoardCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm as number,
  },
  streakBoardHeader: { marginBottom: spacing.sm },
  streakBoardTitle: { color: colors.onSurface, fontWeight: "900", fontSize: 14, letterSpacing: 1.5 },
  streakBoardSub: { color: colors.muted, fontSize: 11, marginTop: 2 },
  streakRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm as number,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  streakRank: { color: colors.muted, fontSize: 16, fontWeight: "900", width: 32 },
  streakAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceTertiary },
  streakAvatarFallback: { alignItems: "center", justifyContent: "center" },
  streakName: { flex: 1, color: colors.onSurface, fontSize: 13, fontWeight: "600" },
  streakDaysPill: {
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  streakDaysTxt: { color: colors.brandSecondary, fontWeight: "900", fontSize: 12 },
  liveBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md as number,
    backgroundColor: colors.error,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.onBrandPrimary,
  },
  liveTag: { color: colors.onBrandPrimary, fontSize: 10, letterSpacing: 2, fontWeight: "900", opacity: 0.9 },
  liveTitle: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 15, marginTop: 2 },
  liveSub: { color: colors.onBrandPrimary, fontSize: 12, marginTop: 2, opacity: 0.95 },
});
