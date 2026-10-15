import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useEffect, useState } from "react";

import { colors, radius, spacing } from "@/src/theme";
import { useAuth } from "@/src/contexts/auth";
import { getLocalHigh, type LocalHigh } from "@/src/storage/localHigh";

export default function Profile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [high, setHigh] = useState<LocalHigh>({ classic: 0, time_attack: 0 });

  useEffect(() => {
    getLocalHigh().then(setHigh);
  }, []);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>PROFIL</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 60, gap: spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.avatarWrap}>
            {user?.picture ? (
              <Image source={user.picture} style={styles.avatar} />
            ) : (
              <Ionicons name="person" size={48} color={colors.onSurface} />
            )}
          </View>
          <Text style={styles.name}>{user?.name ?? "Tamu"}</Text>
          <Text style={styles.email}>{user?.email ?? "Belum login"}</Text>
        </View>

        <View style={styles.statGrid}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>HIGH SCORE · CLASSIC</Text>
            <Text style={styles.statValue}>{high.classic}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>HIGH SCORE · TIME ATTACK</Text>
            <Text style={styles.statValue}>{high.time_attack}</Text>
          </View>
        </View>

        <Pressable
          testID="leaderboard-link"
          onPress={() => router.push("/leaderboard")}
          style={styles.linkRow}
        >
          <Ionicons name="podium" size={22} color={colors.brandSecondary} />
          <Text style={styles.linkTxt}>Lihat Leaderboard</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>

        {user ? (
          <Pressable testID="logout-button" onPress={signOut} style={styles.dangerBtn}>
            <Ionicons name="log-out" size={20} color={colors.error} />
            <Text style={styles.dangerTxt}>Keluar</Text>
          </Pressable>
        ) : (
          <Pressable
            testID="login-button"
            onPress={() => router.push("/login")}
            style={styles.cta}
          >
            <Ionicons name="logo-google" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.ctaTxt}>MASUK DENGAN GOOGLE</Text>
          </Pressable>
        )}
      </ScrollView>
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
  headerTitle: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: 2, textAlign: "center" },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  avatar: { width: 84, height: 84, borderRadius: 42 },
  name: { color: colors.onSurface, fontSize: 20, fontWeight: "900" },
  email: { color: colors.muted, fontSize: 13, marginTop: 4 },
  statGrid: { flexDirection: "row", gap: spacing.md as number },
  stat: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statLabel: { color: colors.muted, fontSize: 10, letterSpacing: 1.5, fontWeight: "700" },
  statValue: { color: colors.brandSecondary, fontSize: 28, fontWeight: "900", marginTop: spacing.xs },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md as number,
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  linkTxt: { flex: 1, color: colors.onSurface, fontSize: 14, fontWeight: "600" },
  cta: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.lg,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm as number,
  },
  ctaTxt: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 14, letterSpacing: 2 },
  dangerBtn: {
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.md,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm as number,
  },
  dangerTxt: { color: colors.error, fontWeight: "800", fontSize: 14, letterSpacing: 1 },
});
