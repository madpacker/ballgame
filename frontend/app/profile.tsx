import { View, Text, Pressable, StyleSheet, ScrollView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useEffect, useState } from "react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { colors, radius, spacing } from "@/src/theme";
import { useAuth } from "@/src/contexts/auth";
import { useSkin, SKINS, type SkinKey } from "@/src/contexts/skin";
import { getLocalHigh, type LocalHigh } from "@/src/storage/localHigh";
import { api } from "@/src/api";
import { useAppSettings } from "@/src/hooks/useAppSettings";
import { socialUrlFor, socialLabelFor, type SocialPlatform } from "@/src/utils/socials";
import * as Linking from "expo-linking";

type Badge = {
  badge_id: string;
  week_key: string;
  mode: string;
  rank: number;
  score: number;
};

export default function Profile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { skin, setSkin, championUnlocked, championUntil } = useSkin();
  const { settings } = useAppSettings();
  const [high, setHigh] = useState<LocalHigh>({ classic: 0, time_attack: 0 });
  const [badges, setBadges] = useState<Badge[]>([]);

  useEffect(() => {
    getLocalHigh().then(setHigh);
  }, []);

  useEffect(() => {
    if (user) {
      api<Badge[]>("/me/badges").then(setBadges).catch(() => setBadges([]));
    } else {
      setBadges([]);
    }
  }, [user]);

  const copyCode = async () => {
    if (!user) return;
    await Clipboard.setStringAsync(user.username);
    if (Platform.OS !== "web") Haptics.selectionAsync();
  };

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
          {user?.is_admin && (
            <View style={styles.adminBadge}>
              <Ionicons name="shield-checkmark" size={12} color={colors.onBrandSecondary} />
              <Text style={styles.adminBadgeTxt}>ADMIN</Text>
            </View>
          )}
          {user && (
            <Pressable testID="copy-username-btn" onPress={copyCode} style={styles.codePill}>
              <Text style={styles.codeTxt}>{user.username}</Text>
              <Ionicons name="copy" size={14} color={colors.brandSecondary} />
            </Pressable>
          )}
        </View>

        <View style={styles.statGrid}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>HIGH · CLASSIC</Text>
            <Text style={styles.statValue}>{high.classic}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>HIGH · TIME ATTACK</Text>
            <Text style={styles.statValue}>{high.time_attack}</Text>
          </View>
        </View>

        <Pressable
          testID="friends-link"
          onPress={() => router.push("/friends")}
          style={styles.linkRow}
        >
          <Ionicons name="people" size={22} color={colors.brandSecondary} />
          <Text style={styles.linkTxt}>Teman</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>

        {user && (
          <View style={styles.skinCard}>
            <Text style={styles.skinLabel}>TEMA JERSEY QUIZ</Text>
            <View style={styles.skinRow}>
              {(Object.keys(SKINS) as SkinKey[]).map((k) => {
                const s = SKINS[k];
                const active = skin === k;
                const locked = k === "champion" && !championUnlocked;
                return (
                  <Pressable
                    key={k}
                    testID={`skin-${k}`}
                    onPress={() => !locked && setSkin(k)}
                    style={[
                      styles.skinChip,
                      active && styles.skinChipActive,
                      locked && { opacity: 0.5 },
                    ]}
                  >
                    <View style={[styles.skinSwatch, { backgroundColor: s.primary }]} />
                    <Text style={styles.skinName}>{s.emoji ?? ""}{s.label.split(" · ")[0]}</Text>
                    {active && !locked && (
                      <Ionicons name="checkmark-circle" size={14} color={colors.brandSecondary} />
                    )}
                    {locked && (
                      <Ionicons name="lock-closed" size={12} color={colors.muted} />
                    )}
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.skinHint}>
              {SKINS[skin].description}
              {championUnlocked && championUntil && skin !== "champion" ? ` · Skin CHAMPION masih aktif sampai ${new Date(championUntil).toLocaleDateString("id-ID")}` : ""}
              {!championUnlocked ? " · Menangkan leaderboard mingguan untuk membuka skin CHAMPION 👑" : ""}
            </Text>
          </View>
        )}

        {user && (user.current_streak ?? 0) > 0 && (
          <View style={styles.streakCard}>
            <Text style={{ fontSize: 24 }}>🔥</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.skinLabel}>STREAK HARIAN</Text>
              <Text style={styles.streakVal}>
                {user.current_streak} hari · rekor {user.best_streak ?? 0}
              </Text>
            </View>
          </View>
        )}

        {user && badges.length > 0 && (
          <View style={styles.badgeCard}>
            <Text style={styles.skinLabel}>PIAGAM MINGGUAN · {badges.length}</Text>
            <View style={styles.badgeGrid}>
              {badges.slice(0, 6).map((b) => (
                <View key={b.badge_id} style={styles.badge}>
                  <Text style={styles.badgeEmoji}>
                    {b.rank === 1 ? "🥇" : b.rank === 2 ? "🥈" : "🥉"}
                  </Text>
                  <Text style={styles.badgeMode}>
                    {b.mode === "classic" ? "Classic" : "Time Attack"}
                  </Text>
                  <Text style={styles.badgeWeek}>{b.week_key}</Text>
                  <Text style={styles.badgeScore}>{b.score}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <Pressable
          testID="news-link"
          onPress={() => router.push("/news")}
          style={styles.linkRow}
        >
          <Ionicons name="newspaper" size={22} color={colors.brandSecondary} />
          <Text style={styles.linkTxt}>Berita Update</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>

        {(settings.description ||
          !!settings.socials?.instagram ||
          !!settings.socials?.tiktok ||
          !!settings.socials?.whatsapp ||
          !!settings.socials?.youtube) && (
          <View style={styles.socialCard}>
            <Text style={styles.skinLabel}>IKUTI ADMIN</Text>
            {settings.description ? (
              <Text style={styles.socialDesc}>{settings.description}</Text>
            ) : null}
            <View style={styles.socialRow}>
              {(["instagram", "tiktok", "whatsapp", "youtube"] as SocialPlatform[]).map((p) => {
                const value = settings.socials?.[p];
                if (!value) return null;
                const url = socialUrlFor(p, value);
                const label = socialLabelFor(p, value);
                const icon =
                  p === "instagram"
                    ? "logo-instagram"
                    : p === "tiktok"
                      ? "logo-tiktok"
                      : p === "whatsapp"
                        ? "logo-whatsapp"
                        : "logo-youtube";
                return (
                  <Pressable
                    key={p}
                    testID={`profile-social-${p}`}
                    onPress={() => url && Linking.openURL(url).catch(() => {})}
                    style={({ pressed }) => [
                      styles.socialBtn,
                      pressed && { opacity: 0.75 },
                    ]}
                  >
                    <Ionicons name={icon as any} size={22} color={colors.brandSecondary} />
                    <Text numberOfLines={1} style={styles.socialLabel}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        <Pressable
          testID="leaderboard-link"
          onPress={() => router.push("/leaderboard")}
          style={styles.linkRow}
        >
          <Ionicons name="podium" size={22} color={colors.brandSecondary} />
          <Text style={styles.linkTxt}>Leaderboard</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>

        {user?.is_admin && (
          <Pressable
            testID="admin-link"
            onPress={() => router.push("/admin")}
            style={styles.linkRow}
          >
            <Ionicons name="shield-checkmark" size={22} color={colors.brandSecondary} />
            <Text style={styles.linkTxt}>Database Pemain (Admin)</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.muted} />
          </Pressable>
        )}

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
  adminBadge: {
    flexDirection: "row",
    gap: 4,
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  adminBadgeTxt: { color: colors.onBrandSecondary, fontWeight: "900", fontSize: 10, letterSpacing: 1.5 },
  codePill: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm as number,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  codeTxt: { color: colors.brandSecondary, fontWeight: "900", fontSize: 14, letterSpacing: 2 },
  skinCard: {
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  skinLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "700",
    marginBottom: spacing.md,
  },
  skinRow: { flexDirection: "row", gap: spacing.sm as number },
  skinChip: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  skinChipActive: { borderColor: colors.brandSecondary, backgroundColor: colors.brandTertiary },
  skinSwatch: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  skinName: { color: colors.onSurface, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  skinHint: { color: colors.muted, fontSize: 12, marginTop: spacing.md },
  badgeCard: {
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm as number },
  badge: {
    width: "31%",
    backgroundColor: colors.brandTertiary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
  },
  badgeEmoji: { fontSize: 24 },
  badgeMode: { color: colors.onBrandTertiary, fontSize: 10, fontWeight: "800", marginTop: 2 },
  badgeWeek: { color: colors.muted, fontSize: 9, marginTop: 2 },
  badgeScore: { color: colors.brandSecondary, fontWeight: "900", fontSize: 14, marginTop: 2 },
  streakCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md as number,
    padding: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  streakVal: { color: colors.onSurface, fontWeight: "900", fontSize: 15, marginTop: 2 },
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
  socialCard: {
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md as number,
  },
  socialDesc: { color: colors.onSurface, fontSize: 13, lineHeight: 19 },
  socialRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm as number },
  socialBtn: {
    flexGrow: 1,
    minWidth: "47%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm as number,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  socialLabel: { flex: 1, color: colors.onSurface, fontSize: 12, fontWeight: "700" },
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
