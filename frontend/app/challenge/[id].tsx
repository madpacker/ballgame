import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useEffect, useState } from "react";

import { colors, radius, spacing } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/contexts/auth";
import { BACKGROUNDS } from "@/src/data/quiz";

type Challenge = {
  challenge_id: string;
  from_user_id: string;
  from_name: string;
  from_picture?: string | null;
  score_to_beat: number;
  mode: string;
  category: string;
  theme_id?: string | null;
};

export default function ChallengeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [c, setC] = useState<Challenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!id) return;
    api<Challenge>(`/challenges/${id}`)
      .then(setC)
      .catch(() => setErr(true))
      .finally(() => setLoading(false));
  }, [id]);

  const accept = () => {
    if (!c) return;
    if (!user) {
      router.push("/login");
      return;
    }
    router.push({
      pathname: "/quiz",
      params: {
        mode: c.mode,
        category: c.category,
        ...(c.theme_id ? { theme: c.theme_id } : {}),
        challenge: c.challenge_id,
      },
    });
  };

  return (
    <View style={styles.container}>
      <Image source={BACKGROUNDS.stadium} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient
        colors={["rgba(15,17,21,0.4)", "rgba(15,17,21,0.92)", colors.surface]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.body, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl }]}>
        <Pressable testID="close-challenge" onPress={() => router.replace("/")} hitSlop={10} style={styles.close}>
          <Ionicons name="close" size={26} color={colors.onSurface} />
        </Pressable>

        {loading && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brandPrimary} />
          </View>
        )}

        {!loading && err && (
          <View style={styles.center}>
            <Ionicons name="warning" size={56} color={colors.error} />
            <Text style={styles.title}>Tantangan tidak ditemukan</Text>
            <Text style={styles.sub}>Link mungkin sudah tidak berlaku atau salah.</Text>
            <Pressable testID="go-home-btn" onPress={() => router.replace("/")} style={styles.cta}>
              <Text style={styles.ctaTxt}>KEMBALI KE BERANDA</Text>
            </Pressable>
          </View>
        )}

        {!loading && c && (
          <View style={{ flex: 1, justifyContent: "flex-end", gap: spacing.lg as number }}>
            <View style={styles.topTag}>
              <Ionicons name="flash" size={16} color={colors.onBrandSecondary} />
              <Text style={styles.topTagTxt}>REMATCH CHALLENGE</Text>
            </View>

            <View style={styles.heroBlock}>
              {c.from_picture ? (
                <Image source={c.from_picture} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Ionicons name="person" size={32} color={colors.onSurface} />
                </View>
              )}
              <Text style={styles.fromName}>{c.from_name}</Text>
              <Text style={styles.sub}>menantangmu untuk mengalahkan</Text>
              <Text testID="score-to-beat" style={styles.scoreBig}>{c.score_to_beat}</Text>
              <Text style={styles.sub}>
                {c.mode === "classic" ? "MODE CLASSIC · 10 SOAL" : "MODE TIME ATTACK · 60 DETIK"}
              </Text>
            </View>

            <View style={styles.rules}>
              <View style={styles.ruleRow}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={styles.ruleTxt}>Mode sama, kategori sama</Text>
              </View>
              <View style={styles.ruleRow}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={styles.ruleTxt}>Kalahkan skor → penantang dapat notifikasi</Text>
              </View>
              <View style={styles.ruleRow}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={styles.ruleTxt}>Skor juga masuk leaderboard mingguan</Text>
              </View>
            </View>

            <Pressable testID="accept-challenge" onPress={accept} style={styles.cta}>
              <Ionicons name="flash" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.ctaTxt}>TERIMA TANTANGAN</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  body: { flex: 1, paddingHorizontal: spacing.xl },
  close: { position: "absolute", top: spacing.lg, right: spacing.lg, zIndex: 2, padding: spacing.xs },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md as number, padding: spacing.lg },
  topTag: {
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 6,
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    alignItems: "center",
  },
  topTagTxt: { color: colors.onBrandSecondary, fontWeight: "900", fontSize: 11, letterSpacing: 1.5 },
  heroBlock: { alignItems: "center", gap: spacing.sm as number },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandTertiary },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  fromName: { color: colors.onSurface, fontWeight: "900", fontSize: 22, marginTop: spacing.sm },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "900", marginTop: spacing.md },
  sub: { color: colors.muted, fontSize: 13, textAlign: "center", letterSpacing: 1 },
  scoreBig: {
    color: colors.brandSecondary,
    fontSize: 88,
    fontWeight: "900",
    letterSpacing: 4,
    marginVertical: spacing.sm,
  },
  rules: { gap: spacing.sm as number, paddingVertical: spacing.md },
  ruleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm as number },
  ruleTxt: { color: colors.onSurfaceSecondary, fontSize: 14 },
  cta: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm as number,
  },
  ctaTxt: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 15, letterSpacing: 2 },
});
