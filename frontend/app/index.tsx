import { View, Text, Pressable, StyleSheet, ScrollView, Platform, ImageBackground, useWindowDimensions } from "react-native";
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
import CharacterStage, { type Outfit, type WItem } from "@/src/components/CharacterStage";

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
  glass: "rgba(10,22,52,0.78)",
  red: "#E31B23",
};

type Streaker = { user_id: string; name: string; picture?: string | null; current_streak: number };
type Xp = { xp: number; level: number; level_xp: number; level_size: number };

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const { user } = useAuth();
  const { settings } = useAppSettings();
  const customBg = absoluteFileUrl(settings.background_url);
  const [unread, setUnread] = useState(0);
  const [theme, setTheme] = useState<{ title: string; subtitle: string; accent: string; id: string } | null>(null);
  const [topStreaks, setTopStreaks] = useState<Streaker[]>([]);
  const [live, setLive] = useState<{ live: boolean; match?: any; minute?: number; multiplier?: number } | null>(null);
  const [xp, setXp] = useState<Xp | null>(null);
  const [wardrobe, setWardrobe] = useState<WItem[]>([]);
  const [outfit, setOutfit] = useState<Outfit>({});
  const tourOn = !!settings.tournament_enabled;
  // The character takes most of the screen; the two rows of tiles sit below it.
  const mascotH = Math.max(300, Math.round(height * 0.5));

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
        setOutfit({});
        return;
      }
      api<Xp>("/me/xp").then(setXp).catch(() => setXp(null));
      // Character picked in the Dressing Room is shown as the lobby mascot.
      api<Outfit>("/me/outfit").then(setOutfit).catch(() => {});
      api<WItem[]>("/wardrobe").then(setWardrobe).catch(() => {});
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
        colors={["rgba(10,40,110,0.45)", "rgba(7,22,55,0.70)", "rgba(7,22,55,0.97)"]}
        locations={[0, 0.55, 1]}
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
              LIVE {live.minute}&apos; · {live.match.home_team} vs {live.match.away_team} · {live.multiplier}X bonus
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

        {/* ---------- Big character ---------- */}
        <Pressable testID="dress-chip" onPress={() => router.push("/dressing-room")} style={styles.dressChip}>
          <Ionicons name="shirt" size={16} color={L.white} />
          <Text style={styles.dressTxt}>GANTI GAYA</Text>
        </Pressable>
        <Pressable testID="hero-mascot" onPress={() => router.push("/dressing-room")} style={[styles.mascot, { height: mascotH }]}>
          {outfit.character_id && wardrobe.some((w) => w.item_id === outfit.character_id) ? (
            <CharacterStage items={wardrobe} outfit={{ character_id: outfit.character_id }} />
          ) : settings.mascot_url ? (
            <Image testID="lobby-mascot" source={absoluteFileUrl(settings.mascot_url)} style={styles.mascotImg} contentFit="contain" />
          ) : HOME_ART.mascot ? (
            <Image source={HOME_ART.mascot} style={styles.mascotImg} contentFit="contain" />
          ) : (
            <Ionicons name="body" size={180} color="rgba(255,255,255,0.88)" />
          )}
        </Pressable>

        {/* ---------- Game modes (1:1 tiles) ---------- */}
        <View style={styles.tileRow}>
          <Pressable
            testID="mode-time-attack-button"
            onPress={() => go("time_attack")}
            style={({ pressed }) => [styles.tile, styles.taCard, pressed && styles.pressed]}
          >
            <LinearGradient colors={["#0E4E7A", "#0A2B57", "#0B1C40"]} style={StyleSheet.absoluteFill} />
            <Text numberOfLines={2} style={styles.tileTitle}>TIME ATTACK</Text>
            <Text numberOfLines={2} style={styles.tileSub}>60 detik • jawab sebanyak mungkin</Text>
            <View style={styles.tileArt}>
              {HOME_ART.timeAttack ? (
                <Image source={HOME_ART.timeAttack} style={StyleSheet.absoluteFill} contentFit="contain" />
              ) : (
                <Ionicons name="timer" size={34} color={L.cyan} />
              )}
            </View>
          </Pressable>

          <Pressable
            testID="mode-classic-button"
            onPress={() => go("classic")}
            style={({ pressed }) => [styles.tile, styles.classicCard, pressed && styles.pressed]}
          >
            <LinearGradient colors={["#4A3A0A", "#6A2A06", "#B04A08"]} style={StyleSheet.absoluteFill} />
            <Text numberOfLines={2} style={styles.tileTitle}>MODE CLASSIC</Text>
            <Text numberOfLines={2} style={styles.tileSub}>10 soal • poin akurasi</Text>
            <View style={styles.tileArt}>
              {HOME_ART.classic ? (
                <Image source={HOME_ART.classic} style={StyleSheet.absoluteFill} contentFit="contain" />
              ) : (
                <Ionicons name="trophy" size={34} color={L.gold} style={styles.goldGlowIcon} />
              )}
            </View>
          </Pressable>

          <Pressable
            testID="mode-f100-button"
            onPress={() => {
              tap();
              router.push("/f100");
            }}
            style={({ pressed }) => [styles.tile, styles.f100Card, pressed && styles.pressed]}
          >
            <LinearGradient colors={["#0F5A3A", "#0A3A2A", "#082418"]} style={StyleSheet.absoluteFill} />
            <Text numberOfLines={2} style={styles.tileTitle}>
              FOOTBALL <Text style={{ color: L.gold }}>100</Text>
            </Text>
            <Text numberOfLines={2} style={styles.tileSub}>Susun 4 jawaban sesuai urutan</Text>
            <View style={styles.f100Slots}>
              {[1, 2, 3, 4].map((n) => (
                <View key={n} style={styles.f100Slot}>
                  <Text style={styles.f100SlotTxt}>{n}</Text>
                </View>
              ))}
            </View>
          </Pressable>
        </View>

        <View style={styles.tileRow}>
          <Pressable
            testID="mode-tournament-button"
            onPress={() => {
              tap();
              router.push("/tournament");
            }}
            style={({ pressed }) => [styles.tile, styles.tourCard, pressed && styles.pressed]}
          >
            <LinearGradient colors={["#7A0F5C", "#3A0A3E", "#1B0830"]} style={StyleSheet.absoluteFill} />
            <Text numberOfLines={2} style={styles.tileTitle}>TOURNAMENT</Text>
            <Text numberOfLines={2} style={styles.tileSub}>{tourOn ? "Dibuka • ayo ikut!" : "Terkunci • belum dibuka admin"}</Text>
            <View style={styles.tileArt}>
              {HOME_ART.tournament ? (
                <Image source={HOME_ART.tournament} style={StyleSheet.absoluteFill} contentFit="contain" />
              ) : (
                <Ionicons name={tourOn ? "trophy" : "lock-closed"} size={32} color={L.gold} />
              )}
            </View>
          </Pressable>

          <View testID="about-card" style={[styles.tile, styles.aboutCard]}>
            <Text numberOfLines={2} style={styles.tileTitle}>TENTANG GAME</Text>
            <Text numberOfLines={5} adjustsFontSizeToFit style={styles.tileSub}>
              UJI KEMAMPUAN KALIAN SEBERAPA TAHU TENTANG LIGA INDONESIA DAN TIMNAS
            </Text>
          </View>

          <Pressable
            testID="streak-champions-card"
            onPress={() => router.push("/leaderboard")}
            style={({ pressed }) => [styles.tile, styles.streakCard, pressed && styles.pressed]}
          >
            <LinearGradient colors={["#5A1A08", "#3A0E06", "#7A2A05"]} style={StyleSheet.absoluteFill} />
            <Text numberOfLines={2} style={styles.tileTitle}>STREAK HARIAN</Text>
            <Text numberOfLines={1} style={styles.tileSub}>Juara hari ini</Text>
            <View style={styles.avatars}>
              {topStreaks.length === 0 ? (
                <Text style={styles.tileSub}>Belum ada streak</Text>
              ) : (
                topStreaks.slice(0, 3).map((u, i) => (
                  <View
                    key={u.user_id}
                    style={[styles.miniCard, i === 0 && styles.miniCardTop, { marginLeft: i === 0 ? 0 : -8, zIndex: 3 - i }]}
                  >
                    {u.picture ? <Image source={u.picture} style={styles.miniImg} /> : <Ionicons name="person" size={14} color={L.white} />}
                    <Text style={styles.miniDays}>{u.current_streak}🔥</Text>
                  </View>
                ))
              )}
            </View>
          </Pressable>
        </View>
      </ScrollView>

      <BottomNav onPlay={() => go("classic")} />
    </ImageBackground>
  );
}

const glow = (c: string) => ({ shadowColor: c, shadowOpacity: 0.8, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 8 });

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
  dressChip: {
    alignSelf: "flex-start",
    marginLeft: "18%",
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    borderWidth: 1.5,
    borderColor: L.cyan,
  },
  dressTxt: { color: L.white, fontSize: 13, fontWeight: "900", letterSpacing: 0.5 },
  mascot: { width: "100%", alignItems: "center", justifyContent: "flex-end" },
  mascotImg: { width: "100%", height: "100%" },
  tileRow: { flexDirection: "row", gap: spacing.sm },
  tile: { flex: 1, aspectRatio: 1, borderRadius: radius.md, borderWidth: 2, overflow: "hidden", padding: spacing.sm, gap: 2 },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.92 },
  tileTitle: {
    color: L.white,
    fontSize: 13,
    lineHeight: 15,
    fontWeight: "900",
    fontStyle: "italic",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 1, height: 2 },
    textShadowRadius: 3,
  },
  tileSub: { color: L.silver, fontSize: 10, lineHeight: 13 },
  tileArt: { flex: 1, alignItems: "center", justifyContent: "center" },
  goldGlowIcon: { textShadowColor: L.orange, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 16 },
  taCard: { borderColor: L.cyan, ...glow(L.cyan) },
  classicCard: { borderColor: L.gold, ...glow(L.gold) },
  f100Card: { borderColor: L.xp, ...glow(L.xp) },
  f100Slots: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3 },
  f100Slot: { width: 20, height: 22, borderRadius: 5, borderWidth: 1.5, borderColor: L.gold, alignItems: "center", justifyContent: "center" },
  f100SlotTxt: { color: L.gold, fontSize: 10, fontWeight: "900" },
  tourCard: { borderColor: "#E0479E", ...glow("#E0479E") },
  aboutCard: { borderColor: "rgba(255,255,255,0.25)", backgroundColor: L.glass },
  streakCard: { borderColor: L.orange, ...glow(L.orange) },
  avatars: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  miniCard: {
    width: 28,
    height: 38,
    borderRadius: 6,
    backgroundColor: "#3B2A7A",
    borderWidth: 1.5,
    borderColor: "#8C7BFF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  miniCardTop: { width: 32, height: 44, borderColor: L.gold, backgroundColor: "#7A1A1A" },
  miniImg: { width: "100%", height: "74%" },
  miniDays: { color: L.white, fontSize: 8, fontWeight: "900" },
});
