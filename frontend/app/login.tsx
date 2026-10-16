import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";

import { colors, radius, spacing } from "@/src/theme";
import { useAuth } from "@/src/contexts/auth";
import { BACKGROUNDS } from "@/src/data/quiz";

export default function Login() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn } = useAuth();

  return (
    <View style={styles.container}>
      <Image source={BACKGROUNDS.stadium} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient
        colors={["rgba(15,17,21,0.4)", "rgba(15,17,21,0.9)", colors.surface]}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.body, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
        <Pressable testID="close-login" onPress={() => router.back()} hitSlop={10} style={styles.close}>
          <Ionicons name="close" size={26} color={colors.onSurface} />
        </Pressable>

        <View style={styles.heroBlock}>
          <View style={styles.logo}>
            <Image
              source={require("@/assets/images/icon.png")}
              style={{ width: 56, height: 56 }}
              contentFit="cover"
            />
          </View>
          <Text style={styles.title}>MASUK KE CAK MAD QUIZ</Text>
          <Text style={styles.sub}>
            Simpan skor, naik ke leaderboard global, dan bersaing dengan fans Madura United lain.
          </Text>
        </View>

        <View style={styles.benefits}>
          {[
            { ic: "podium", txt: "Masuk leaderboard global" },
            { ic: "cloud-upload", txt: "Skor otomatis tersimpan" },
            { ic: "share-social", txt: "Bagikan pencapaianmu" },
          ].map((b) => (
            <View key={b.ic} style={styles.benefitRow}>
              <Ionicons name={b.ic as any} size={18} color={colors.brandSecondary} />
              <Text style={styles.benefitTxt}>{b.txt}</Text>
            </View>
          ))}
        </View>

        <Pressable testID="google-signin-button" onPress={signIn} style={styles.googleBtn}>
          <Ionicons name="logo-google" size={20} color={colors.onBrandPrimary} />
          <Text style={styles.googleTxt}>LANJUT DENGAN GOOGLE</Text>
        </Pressable>

        <Pressable testID="skip-login" onPress={() => router.replace("/")} style={styles.skipBtn}>
          <Text style={styles.skipTxt}>Main tanpa login</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  body: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: "flex-end",
    gap: spacing.lg as number,
  },
  close: { position: "absolute", top: spacing.lg, right: spacing.lg, padding: spacing.xs, zIndex: 2 },
  heroBlock: { gap: spacing.md as number, marginBottom: spacing.lg },
  logo: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  logoTxt: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 20, letterSpacing: 1 },
  title: { color: colors.onSurface, fontSize: 26, fontWeight: "900", letterSpacing: 1 },
  sub: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20 },
  benefits: { gap: spacing.sm as number, marginBottom: spacing.md },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm as number },
  benefitTxt: { color: colors.onSurfaceSecondary, fontSize: 14 },
  googleBtn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.lg,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm as number,
  },
  googleTxt: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 14, letterSpacing: 2 },
  skipBtn: { paddingVertical: spacing.md, alignItems: "center" },
  skipTxt: { color: colors.muted, fontSize: 13, textDecorationLine: "underline" },
});
