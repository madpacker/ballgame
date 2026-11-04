import { View, Text, Pressable, StyleSheet, ScrollView, ImageBackground, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";

import { colors, radius, spacing } from "@/src/theme";
import { CATEGORY_COLOR, CATEGORY_DESC, CATEGORY_LABEL, QUIZ_CATEGORY_KEYS, type Category } from "@/src/data/quiz";
import { useAppSettings } from "@/src/hooks/useAppSettings";
import { absolutePhotoUrl } from "@/src/data/questions";
import { api } from "@/src/api";

type CatKey = Category | "all";

// Fixed stadium palette — this screen keeps the same night-stadium look in every theme.
const NIGHT = "#06122B";
const NEON = "#5FB4FF";
const SILVER = "#EAF2FF";
const GOLD = "#FFB01F";
const WHITE = "#FFFFFF";

// Bundled fallbacks until the admin uploads a logo for the category.
const FALLBACK_IMG: Partial<Record<CatKey, any>> = {
  trivia: require("@/assets/logos/mu.png"),
  garuda: require("@/assets/logos/garuda.png"),
};
const FALLBACK_ICON: Record<CatKey, string> = {
  all: "shuffle",
  liga: "trophy",
  bali: "shield",
  trivia: "shield",
  garuda: "shield",
  persebaya: "shield",
  persib: "shield",
  persija: "shield",
};

const ORDER: CatKey[] = ["all", ...QUIZ_CATEGORY_KEYS];
const SPARKS = [
  { top: 60, left: 20, size: 18 },
  { top: 70, left: 6, size: 12 },
  { top: 24, right: 22, size: 16 },
  { top: 96, right: 10, size: 12 },
  { top: 150, left: 34, size: 10 },
  { top: 140, right: 40, size: 10 },
];

export default function CategoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { mode, theme: themeId } = useLocalSearchParams<{ mode: "classic" | "time_attack"; theme?: string }>();
  const [selected, setSelected] = useState<CatKey>("all");
  const { settings } = useAppSettings();
  const logos = settings.category_logos ?? {};
  const [theme, setTheme] = useState<{ title: string; subtitle: string; accent: string } | null>(null);
  const isTA = mode === "time_attack";

  useEffect(() => {
    if (!themeId) return;
    api<{ title: string; subtitle: string; accent: string; id: string }>("/weekly-theme")
      .then((r) => {
        if (r.id === themeId) setTheme({ title: r.title, subtitle: r.subtitle, accent: r.accent });
      })
      .catch(() => setTheme(null));
  }, [themeId]);

  const choose = (k: CatKey) => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setSelected(k);
  };

  const start = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.replace({
      pathname: "/quiz",
      params: { mode: mode ?? "classic", category: selected, ...(themeId ? { theme: themeId } : {}) },
    });
  };

  const renderLogo = (k: CatKey, size: number) => {
    const url = logos[k];
    const src = url ? absolutePhotoUrl(url) : FALLBACK_IMG[k];
    if (src) return <Image source={src} style={{ width: size, height: size }} contentFit="contain" />;
    return <Ionicons name={FALLBACK_ICON[k] as any} size={size * 0.7} color={WHITE} />;
  };

  return (
    <ImageBackground source={require("@/assets/bg/stadium.jpg")} style={styles.container} resizeMode="cover">
      <LinearGradient
        colors={["rgba(6,18,43,0.55)", "rgba(6,18,43,0.80)", "rgba(6,18,43,0.97)"]}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* Floodlight glow */}
      <LinearGradient
        colors={["rgba(95,180,255,0.45)", "rgba(95,180,255,0)"]}
        style={styles.floodlight}
        pointerEvents="none"
      />

      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable testID="back-button" onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={WHITE} />
        </Pressable>
        {SPARKS.map((s, i) => (
          <Ionicons
            key={i}
            name="sparkles"
            size={s.size}
            color={i % 2 ? GOLD : NEON}
            style={[styles.spark, s as any]}
          />
        ))}
        <View style={styles.titleWrap} testID="mode-title">
          <Text style={styles.titleMode}>MODE</Text>
          <View>
            <Text style={[styles.titleBig, styles.titleBigShadow]}>{isTA ? "TIME ATTACK" : "CLASSIC"}</Text>
            <Text style={[styles.titleBig, styles.titleBigFace]}>{isTA ? "TIME ATTACK" : "CLASSIC"}</Text>
          </View>
          <View style={styles.subRow}>
            <Ionicons name="flash" size={20} color={GOLD} />
            <Text style={styles.titleSub}>{isTA ? "60 DETIK" : "10 SOAL"}</Text>
            <Ionicons name="flash" size={20} color={GOLD} />
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {theme && (
          <View style={[styles.themeBanner, { borderColor: theme.accent }]}>
            <Ionicons name="flame" size={20} color={theme.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.themeTag}>CHALLENGE MINGGU INI</Text>
              <Text style={styles.themeTitle}>{theme.title}</Text>
              <Text style={styles.themeSub}>{theme.subtitle}</Text>
            </View>
          </View>
        )}

        <Text style={styles.sectionTitle}>PILIH KATEGORI</Text>

        <View style={styles.grid}>
          {ORDER.map((k, idx) => {
            const active = selected === k;
            const big = idx < 2; // first row: tall feature cards
            const c = CATEGORY_COLOR[k];
            return (
              <Pressable
                key={k}
                testID={`category-${k}`}
                onPress={() => choose(k)}
                style={({ pressed }) => [
                  styles.card,
                  big ? styles.cardBig : styles.cardSmall,
                  { borderColor: active ? WHITE : c, shadowColor: c },
                  active && styles.cardActive,
                  pressed && { transform: [{ scale: 0.97 }] },
                ]}
              >
                <LinearGradient
                  colors={[c + "AA", c + "33", "rgba(6,18,43,0.85)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                {/* glossy top highlight */}
                <LinearGradient
                  colors={["rgba(255,255,255,0.28)", "rgba(255,255,255,0)"]}
                  style={styles.gloss}
                  pointerEvents="none"
                />
                <View style={big ? styles.innerBig : styles.innerSmall}>
                  <View
                    style={[
                      styles.logoTile,
                      big ? styles.logoTileBig : styles.logoTileSmall,
                      { backgroundColor: c + "55", borderColor: c },
                    ]}
                  >
                    {renderLogo(k, big ? 46 : 36)}
                  </View>
                  <View style={big ? undefined : { flex: 1 }}>
                    <Text numberOfLines={2} style={big ? styles.catTitleBig : styles.catTitle}>
                      {CATEGORY_LABEL[k]}
                    </Text>
                    <Text numberOfLines={3} style={styles.catDesc}>
                      {CATEGORY_DESC[k]}
                    </Text>
                  </View>
                </View>
                {active && (
                  <View style={[styles.checkBadge, { backgroundColor: c }]}>
                    <Ionicons name="checkmark" size={16} color={WHITE} />
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          testID="start-match-button"
          onPress={start}
          style={({ pressed }) => [styles.ctaWrap, pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] }]}
        >
          <LinearGradient
            colors={["#3FCF8E", "#17905A", "#0E6B42"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.cta}
          >
            <Text style={styles.ctaText}>MULAI PERTANDINGAN</Text>
            <Ionicons name="play" size={22} color={WHITE} />
          </LinearGradient>
        </Pressable>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: NIGHT },
  floodlight: { position: "absolute", top: 0, left: 0, right: 0, height: 220 },
  header: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, alignItems: "center" },
  backBtn: {
    alignSelf: "flex-start",
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  spark: { position: "absolute", opacity: 0.85 },
  titleWrap: { alignItems: "center", marginTop: -36 },
  titleMode: {
    color: SILVER,
    fontSize: 26,
    fontWeight: "900",
    fontStyle: "italic",
    letterSpacing: 2,
    textShadowColor: NEON,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  titleBig: { fontSize: 52, fontWeight: "900", fontStyle: "italic", letterSpacing: 1, lineHeight: 58 },
  titleBigShadow: {
    position: "absolute",
    top: 4,
    left: 3,
    color: "#0B2F73",
  },
  titleBigFace: {
    color: SILVER,
    textShadowColor: NEON,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  subRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: -2 },
  titleSub: {
    color: GOLD,
    fontSize: 26,
    fontWeight: "900",
    fontStyle: "italic",
    letterSpacing: 1,
    textShadowColor: "#FF4D00",
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 6,
  },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  themeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    backgroundColor: "rgba(6,18,43,0.7)",
  },
  themeTag: { color: SILVER, opacity: 0.7, fontSize: 10, letterSpacing: 2, fontWeight: "800" },
  themeTitle: { color: WHITE, fontWeight: "900", fontSize: 15, marginTop: 2 },
  themeSub: { color: SILVER, opacity: 0.8, fontSize: 12, marginTop: 2 },
  sectionTitle: {
    color: SILVER,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 1,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 1, height: 2 },
    textShadowRadius: 4,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing.md },
  card: {
    width: "48.3%",
    borderRadius: radius.lg,
    borderWidth: 2,
    overflow: "hidden",
    backgroundColor: "rgba(6,18,43,0.6)",
    shadowOpacity: 0.8,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  cardActive: { borderWidth: 2.5 },
  cardBig: { minHeight: 190 },
  cardSmall: { minHeight: 96 },
  gloss: { position: "absolute", top: 0, left: 0, right: 0, height: "45%" },
  innerBig: { padding: spacing.md, gap: spacing.md },
  innerSmall: { flexDirection: "row", alignItems: "center", padding: spacing.sm, gap: spacing.sm, flex: 1 },
  logoTile: { alignItems: "center", justifyContent: "center", borderWidth: 1.5, overflow: "hidden" },
  logoTileBig: { width: 64, height: 64, borderRadius: 16 },
  logoTileSmall: { width: 52, height: 52, borderRadius: 14 },
  catTitleBig: {
    color: WHITE,
    fontWeight: "900",
    fontSize: 19,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },
  catTitle: {
    color: WHITE,
    fontWeight: "900",
    fontSize: 14,
    lineHeight: 17,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },
  catDesc: { color: SILVER, opacity: 0.85, fontSize: 11, lineHeight: 15, marginTop: 2 },
  checkBadge: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: WHITE,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: "rgba(6,18,43,0.92)" },
  ctaWrap: {
    borderRadius: radius.pill,
    shadowColor: "#3FCF8E",
    shadowOpacity: 0.7,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  cta: {
    borderRadius: radius.pill,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
  },
  ctaText: {
    color: WHITE,
    fontWeight: "900",
    fontStyle: "italic",
    fontSize: 20,
    letterSpacing: 1,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 1, height: 2 },
    textShadowRadius: 3,
  },
});
