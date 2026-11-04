import { View, Text, Pressable, StyleSheet, ScrollView, Platform, ImageBackground } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useCallback, useEffect, useState } from "react";
import * as Haptics from "expo-haptics";

import { api } from "@/src/api";
import { spacing, radius } from "@/src/theme";
import { useAuth } from "@/src/contexts/auth";
import { absoluteFileUrl, useAppSettings } from "@/src/hooks/useAppSettings";
import { HOME_ART } from "@/src/data/homeArt";
import BottomNav from "@/src/components/BottomNav";

// Game-lobby palette: a fixed night-stadium look that stays identical in every theme.
const L = {
  night: "#071637",
  white: "#FFFFFF",
  silver: "#DCE6FF",
  muted: "#A9B6D8",
  cyan: "#3FD0FF",
  xp: "#36D1A6",
  gold: "#FFC23A",
  orange: "#FF7A1A",
  purple: "#C2187A",
  glass: "rgba(10,22,52,0.78)",
  red: "#E31B23",
};

type Streaker = { user_id: string; name: string; picture?: string | null; current_streak: number };
type Xp = { xp: number; level: number; level_xp: number; level_size: number };

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { settings } = useAppSettings();
  const customBg = absoluteFileUrl(settings.background_url);
  const [unread, setUnread] = useState(0);
  const [theme, setTheme] = useState<{ title: string; subtitle: string; accent: string; id: string } | null>(null);
  const [topStreaks, setTopStreaks] = useState<Streaker[]>([]);
  const [live, setLive] = useState<{ live: boolean; match?: any; minute?: number; multiplier?: number } | null>(null);
  const [xp, setXp] = useState<Xp | null>(null);
  const tourOn = !!settings.tournament_enabled;

  useEffect(() => {
    api<{ title: string; subtitle: string; accent: string; id: string }>("/weekly-theme")
      .then(setTheme)
      .catch(() => setTheme(null));
    api<Streaker[]>("/top-streaks?limit=5")
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

  // XP refreshes every time the lobby is shown (e.g. right after finishing a game).
  useFocusEffect(
    useCallback(() => {
      if (!user) {
        setXp(null);
        return;
      }
      api<Xp>("/me/xp").then(setXp).catch(() => setXp(null));
    }, [user]),
  );

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

  const tap = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
  };
  const go = (mode: "classic" | "time_attack") => {
    tap();
    router.push({ pathname: "/category", params: { mode } });
  };

  const pct = xp ? Math.min(1, xp.level_xp / xp.level_size) : 0;

  return (
    <ImageBackground
      source={customBg ? { uri: customBg } : require("@/assets/bg/stadium.jpg")}
      style={styles.container}
      resizeMode="cover"
    >
      <LinearGradient
        colors={["rgba(10,40,110,0.55)", "rgba(7,22,55,0.82)", "rgba(7,22,55,0.97)"]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient colors={["rgba(120,190,255,0.40)", "rgba(120,190,255,0)"]} style={styles.floodlight} pointerEvents="none" />

      {/* ---------- Top bar ---------- */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          testID="profile-button"
          onPress={() => router.push(user ? "/profile" : "/login")}
          style={styles.profilePill}
        >
          <View style={styles.avatarRing}>
            {user?.picture ? (
              <Image source={user.picture} style={styles.avatar} />
            ) : (
              <Ionicons name="person" size={26} color={L.white} />
            )}
            <View style={styles.lvBadge}>
              <Text style={styles.lvBadgeTxt}>{xp?.level ?? 1}</Text>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={styles.playerName}>
              {user ? user.name.toUpperCase() : "TAMU · MASUK"}
            </Text>
            <View style={styles.lvRow}>
              <Text style={styles.lvTxt}>LEVEL {xp?.level ?? 1}</Text>
              <Text testID="xp-text" style={styles.xpNum}>
                {xp ? `${xp.level_xp} / ${xp.level_size}` : "0 / 500"}
              </Text>
            </View>
            <View style={styles.xpRow}>
              <Text style={styles.xpLbl}>XP</Text>
              <View style={styles.xpTrack}>
                <View style={[styles.xpFill, { width: `${pct * 100}%` }]} />
              </View>
            </View>
          </View>
        </Pressable>
        <View style={styles.topRight}>
          {user && (
            <Pressable testID="notifications-button" onPress={() => router.push("/notifications")} style={styles.squareBtn}>
              <Ionicons name="notifications" size={22} color={L.silver} />
              {unread > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeTxt}>{unread > 9 ? "9+" : unread}</Text>
                </View>
              )}
            </Pressable>
          )}
          <Pressable testID="settings-button" onPress={() => router.push("/settings")} style={styles.squareBtn}>
            <Ionicons name="settings-sharp" size={24} color={L.silver} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {live?.live && live.match && (
          <Pressable testID="live-boost-banner" onPress={() => router.push("/matches")} style={styles.liveBanner}>
            <View style={styles.liveDot} />
            <Text numberOfLines={1} style={styles.liveTxt}>
              LIVE {live.minute}&apos; · {live.match.home ? "MU vs " + live.match.opponent : live.match.opponent + " vs MU"} · {live.multiplier}X bonus
            </Text>
            <Ionicons name="chevron-forward" size={18} color={L.white} />
          </Pressable>
        )}
        {theme && (
          <Pressable
            testID="weekly-theme-banner"
            onPress={() => router.push({ pathname: "/category", params: { mode: "classic", theme: theme.id } })}
            style={[styles.themeBanner, { borderColor: theme.accent }]}
          >
            <Ionicons name="flame" size={18} color={theme.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.themeTag}>CHALLENGE MINGGU INI</Text>
              <Text numberOfLines={1} style={styles.themeTitle}>{theme.title}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={L.muted} />
          </Pressable>
        )}

        {/* ---------- Bento grid ---------- */}
        <View style={styles.bento}>
          {/* Left column */}
          <View style={styles.col}>
            <View testID="hero-mascot" style={styles.mascot}>
              {HOME_ART.mascot ? (
                <Image source={HOME_ART.mascot} style={StyleSheet.absoluteFill} contentFit="contain" />
              ) : (
                <View style={styles.mascotPh}>
                  <Ionicons name="body" size={120} color="rgba(255,255,255,0.88)" />
                  <View style={styles.goldBall}>
                    <Ionicons name="football" size={44} color={L.gold} />
                  </View>
                </View>
              )}
            </View>

            <Pressable
              testID="mode-tournament-button"
              onPress={() => {
                tap();
                router.push("/tournament");
              }}
              style={({ pressed }) => [styles.card, styles.tourCard, pressed && styles.pressed]}
            >
              <LinearGradient colors={["#7A0F5C", "#3A0A3E", "#1B0830"]} style={StyleSheet.absoluteFill} />
              <Text numberOfLines={1} style={[styles.cardTitle, { fontSize: 17 }]}>TOURNAMENT</Text>
              <View style={styles.rowBetween}>
                <Text style={styles.cardSub}>
                  {tourOn ? "Dibuka · Classic · Time Attack · Royal" : "Terkunci • Tournament belum dibuka admin"}
                </Text>
                <Ionicons name="play-forward" size={22} color="#FF6FB5" />
              </View>
              <View style={styles.tourArt}>
                {HOME_ART.tournament ? (
                  <Image source={HOME_ART.tournament} style={StyleSheet.absoluteFill} contentFit="contain" />
                ) : (
                  <View style={styles.trophyGlow}>
                    <Ionicons name="trophy" size={64} color={L.gold} />
                    {!tourOn && (
                      <View style={styles.lockChip}>
                        <Ionicons name="lock-closed" size={20} color={L.white} />
                      </View>
                    )}
                  </View>
                )}
              </View>
              <Text style={styles.tourAboutTitle}>Tentang Turnamen</Text>
              <Text style={styles.tourAbout}>
                Bersainglah dengan ribuan pemain lain di panggung turnamen bergengsi. Jawab kuis secepat dan setepat
                mungkin, panjat papan peringkat, dan rebut trofi juara serta hadiah eksklusif!
              </Text>
            </Pressable>

            <View testID="about-card" style={[styles.card, styles.aboutCard]}>
              <Text style={styles.aboutTitle}>Tentang Game</Text>
              <Text style={styles.aboutBody}>
                UJI KEMAMPUAN KALIAN SEBERAPA TAHU TENTANG LIGA INDONESIA DAN TIMNAS
              </Text>
            </View>
          </View>

          {/* Right column */}
          <View style={styles.col}>
            <Pressable
              testID="mode-time-attack-button"
              onPress={() => go("time_attack")}
              style={({ pressed }) => [styles.card, styles.taCard, pressed && styles.pressed]}
            >
              <LinearGradient colors={["#0E4E7A", "#0A2B57", "#0B1C40"]} style={StyleSheet.absoluteFill} />
              <Text numberOfLines={1} adjustsFontSizeToFit style={styles.cardTitle}>TIME ATTACK</Text>
              <View style={styles.rowBetween}>
                <Text style={styles.cardSub}>Jump into action and answer as fast as possible!</Text>
                <Ionicons name="play-forward" size={22} color={L.cyan} />
              </View>
              <View style={styles.taArt}>
                {HOME_ART.timeAttack ? (
                  <Image source={HOME_ART.timeAttack} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <View style={styles.taPh}>
                    <Ionicons name="walk" size={56} color="rgba(255,255,255,0.75)" />
                    <Ionicons name="timer" size={64} color={L.cyan} />
                    <Ionicons name="walk" size={56} color="rgba(255,255,255,0.75)" />
                  </View>
                )}
              </View>
              <View style={styles.rowBetween}>
                <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.cardTitle, { fontSize: 15, flex: 1 }]}>TIME ATTACK</Text>
                <Ionicons name="play-forward" size={20} color={L.cyan} />
              </View>
              <Text style={styles.cardSub}>60 detik • jawab sebanyak mungkin</Text>
            </Pressable>

            <Pressable
              testID="mode-classic-button"
              onPress={() => go("classic")}
              style={({ pressed }) => [styles.card, styles.classicCard, pressed && styles.pressed]}
            >
              <LinearGradient colors={["#4A3A0A", "#3A1C06", "#6A1E05"]} style={StyleSheet.absoluteFill} />
              <Text style={[styles.cardTitle, { textAlign: "right" }]}>MODE{"\n"}CLASSIC</Text>
              <View style={styles.classicRow}>
                <View style={styles.classicArt}>
                  {HOME_ART.classic ? (
                    <Image source={HOME_ART.classic} style={StyleSheet.absoluteFill} contentFit="contain" />
                  ) : (
                    <Ionicons name="trophy" size={58} color={L.gold} style={styles.goldGlowIcon} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.classicSubTitle}>Mode Classic</Text>
                  <Text style={styles.classicInfo}>- 10 soal • poin akurasi • ritme santai</Text>
                </View>
              </View>
              <LinearGradient colors={["rgba(255,122,26,0)", "rgba(255,90,0,0.55)"]} style={styles.fire} pointerEvents="none" />
            </Pressable>

            <Pressable
              testID="streak-champions-card"
              onPress={() => router.push("/leaderboard")}
              style={({ pressed }) => [styles.card, styles.streakCard, pressed && styles.pressed]}
            >
              <LinearGradient colors={["#5A1A08", "#3A0E06", "#7A2A05"]} style={StyleSheet.absoluteFill} />
              <Text style={[styles.cardTitle, { fontSize: 16 }]}>JUARA STREAK HARI INI</Text>
              <Text style={styles.cardSub}>Siapa paling rajin main?</Text>
              <View style={styles.streakRow}>
                <Ionicons name="play-forward" size={24} color={L.gold} />
                <View style={styles.avatars}>
                  {topStreaks.length === 0 ? (
                    <Text style={styles.cardSub}>Belum ada streak</Text>
                  ) : (
                    topStreaks.slice(0, 3).map((u, i) => (
                      <View
                        key={u.user_id}
                        style={[styles.miniCard, i === 0 && styles.miniCardTop, { marginLeft: i === 0 ? 0 : -10, zIndex: 3 - i }]}
                      >
                        {u.picture ? (
                          <Image source={u.picture} style={styles.miniImg} />
                        ) : (
                          <Ionicons name="person" size={20} color={L.white} />
                        )}
                        <Text style={styles.miniDays}>{u.current_streak}🔥</Text>
                      </View>
                    ))
                  )}
                </View>
              </View>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <BottomNav onPlay={() => go("classic")} />
    </ImageBackground>
  );
}

const glow = (c: string) => ({ shadowColor: c, shadowOpacity: 0.8, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8 });

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: L.night },
  floodlight: { position: "absolute", top: 0, left: 0, right: 0, height: 260 },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  profilePill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: L.glass,
    borderRadius: radius.lg,
    padding: 6,
    paddingRight: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  avatarRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: L.gold,
    backgroundColor: "#1B2B55",
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  lvBadge: {
    position: "absolute",
    bottom: -4,
    right: -4,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#0B1C40",
    borderWidth: 1.5,
    borderColor: L.gold,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  lvBadgeTxt: { color: L.white, fontSize: 10, fontWeight: "900" },
  playerName: { color: L.white, fontSize: 17, fontWeight: "900", letterSpacing: 0.5 },
  lvRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 1 },
  lvTxt: { color: L.xp, fontSize: 11, fontWeight: "900" },
  xpNum: { color: L.white, fontSize: 11, fontWeight: "800" },
  xpRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  xpLbl: { color: L.xp, fontSize: 10, fontWeight: "900" },
  xpTrack: { flex: 1, height: 7, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.15)", overflow: "hidden" },
  xpFill: { height: "100%", backgroundColor: L.xp, borderRadius: 4 },
  topRight: { flexDirection: "row", gap: spacing.sm },
  squareBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: L.glass,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: L.red,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  bellBadgeTxt: { color: L.white, fontSize: 9, fontWeight: "900" },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.sm },
  liveBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: L.red,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: L.white },
  liveTxt: { flex: 1, color: L.white, fontWeight: "800", fontSize: 12 },
  themeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: L.glass,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  themeTag: { color: L.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1.5 },
  themeTitle: { color: L.white, fontSize: 13, fontWeight: "900" },
  bento: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  col: { flex: 1, gap: spacing.sm },
  card: { borderRadius: radius.lg, borderWidth: 2, overflow: "hidden", padding: spacing.md, gap: 4 },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.92 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 },
  cardTitle: {
    color: L.white,
    fontSize: 20,
    fontWeight: "900",
    fontStyle: "italic",
    letterSpacing: 0,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 1, height: 2 },
    textShadowRadius: 3,
  },
  cardSub: { flex: 1, color: L.silver, fontSize: 11, lineHeight: 15 },
  mascot: { height: 250, alignItems: "center", justifyContent: "flex-end" },
  mascotPh: { alignItems: "center", justifyContent: "flex-end", flex: 1 },
  goldBall: {
    marginTop: -10,
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,194,58,0.18)",
    ...glow("#FFC23A"),
  },
  tourCard: { borderColor: "#E0479E", minHeight: 360, ...glow("#E0479E") },
  tourArt: { height: 150, alignItems: "center", justifyContent: "center", marginVertical: spacing.sm },
  trophyGlow: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,111,181,0.18)",
    ...glow("#FF6FB5"),
  },
  lockChip: {
    position: "absolute",
    bottom: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderWidth: 1.5,
    borderColor: L.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  tourAboutTitle: { color: L.white, fontSize: 15, fontWeight: "900" },
  tourAbout: { color: L.silver, fontSize: 11, lineHeight: 15 },
  aboutCard: { borderColor: "rgba(255,255,255,0.18)", backgroundColor: L.glass },
  aboutTitle: { color: L.white, fontSize: 17, fontWeight: "900" },
  aboutBody: { color: L.silver, fontSize: 12, lineHeight: 17 },
  taCard: { borderColor: L.cyan, minHeight: 330, ...glow(L.cyan) },
  taArt: { flex: 1, minHeight: 150, marginVertical: spacing.sm, borderRadius: radius.md, overflow: "hidden" },
  taPh: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(63,208,255,0.15)",
    borderRadius: radius.md,
  },
  classicCard: { borderColor: L.gold, minHeight: 200, ...glow(L.gold) },
  classicRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  classicArt: { width: 72, height: 80, alignItems: "center", justifyContent: "center" },
  goldGlowIcon: { textShadowColor: L.orange, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 16 },
  classicSubTitle: { color: L.white, fontSize: 13, fontWeight: "900", fontStyle: "italic" },
  classicInfo: { color: L.silver, fontSize: 11, lineHeight: 15, marginTop: 2 },
  fire: { position: "absolute", left: 0, right: 0, bottom: 0, height: "45%" },
  streakCard: { borderColor: L.orange, minHeight: 150, ...glow(L.orange) },
  streakRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  avatars: { flexDirection: "row", alignItems: "center" },
  miniCard: {
    width: 42,
    height: 56,
    borderRadius: 8,
    backgroundColor: "#3B2A7A",
    borderWidth: 1.5,
    borderColor: "#8C7BFF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  miniCardTop: { width: 48, height: 64, borderColor: L.gold, backgroundColor: "#7A1A1A" },
  miniImg: { width: "100%", height: "78%" },
  miniDays: { color: L.white, fontSize: 9, fontWeight: "900" },
});
