import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";

import { spacing, radius } from "@/src/theme";
import { useAuth } from "@/src/contexts/auth";

// Login is required to play. Fixed night-spotlight palette (identical in every theme).
const C = { night: "#070B1C", white: "#FFFFFF", gold: "#F5C518", sub: "#C9D2E6" };

export default function Login() {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0E2A6B", "#0A1A44", C.night, C.night]} locations={[0, 0.35, 0.6, 1]} style={StyleSheet.absoluteFill} />
      {/* top spotlight */}
      <LinearGradient colors={["rgba(150,200,255,0.55)", "rgba(150,200,255,0)"]} style={styles.spot} pointerEvents="none" />
      <ScrollView contentContainerStyle={[styles.body, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.hero}>
          <View style={styles.logoRing}>
            <Image source={require("@/assets/images/icon.png")} style={styles.logo} contentFit="cover" />
          </View>
        </View>

        <Text style={styles.title}>MASUK KE QUIZ{"\n"}PANDIT FOOTBALL</Text>
        <View style={styles.underline} />
        <Text style={styles.sub}>Simpan skor, naik ke leaderboard global, dan bersaing dengan Pundit Pundit yang lain.</Text>

        <View style={styles.benefits}>
          {[
            { ic: "stats-chart", txt: "Masuk leaderboard global" },
            { ic: "cloud-upload", txt: "Skor otomatis tersimpan" },
            { ic: "share-social", txt: "Bagikan pencapaianmu" },
          ].map((b) => (
            <View key={b.ic} style={styles.benefitRow}>
              <Ionicons name={b.ic as any} size={22} color={C.gold} />
              <Text style={styles.benefitTxt}>{b.txt}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.loginBy}>login by</Text>
        <Pressable testID="google-signin-button" onPress={signIn} style={({ pressed }) => [styles.googleBtn, pressed && { opacity: 0.85 }]}>
          <Ionicons name="logo-google" size={30} color="#EA4335" />
          <Text style={styles.googleTxt}>Google</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.night },
  spot: { position: "absolute", top: 0, left: "15%", right: "15%", height: 320 },
  body: { flexGrow: 1, paddingHorizontal: spacing.xl, justifyContent: "flex-end", gap: spacing.md },
  hero: { alignItems: "center", marginBottom: spacing.xl },
  logoRing: {
    width: 220, height: 220, borderRadius: 110, overflow: "hidden", borderWidth: 6, borderColor: C.white,
    shadowColor: "#7FB2FF", shadowOpacity: 0.8, shadowRadius: 24, shadowOffset: { width: 0, height: 0 }, elevation: 10,
  },
  logo: { width: "100%", height: "100%" },
  title: { color: C.white, fontSize: 30, fontWeight: "900", lineHeight: 36 },
  underline: { width: 56, height: 4, borderRadius: 2, backgroundColor: C.gold },
  sub: { color: C.sub, fontSize: 15, lineHeight: 21 },
  benefits: { gap: spacing.sm, marginTop: spacing.sm },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  benefitTxt: { color: C.white, fontSize: 16 },
  loginBy: { color: C.white, fontSize: 20, fontWeight: "800", textAlign: "center", marginTop: spacing.lg },
  googleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md, backgroundColor: C.white,
    borderRadius: radius.lg, minHeight: 64, shadowColor: C.white, shadowOpacity: 0.4, shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 }, elevation: 6,
  },
  googleTxt: { color: "#1F1F1F", fontSize: 18, fontWeight: "800" },
});
