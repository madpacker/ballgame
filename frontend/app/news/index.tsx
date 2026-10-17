import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useCallback, useEffect, useState } from "react";

import { colors, radius, spacing } from "@/src/theme";
import { api } from "@/src/api";
import { absoluteFileUrl, useAppSettings } from "@/src/hooks/useAppSettings";
import { socialUrlFor, socialLabelFor, type SocialPlatform } from "@/src/utils/socials";
import * as Linking from "expo-linking";
import { useAuth } from "@/src/contexts/auth";

type NewsItem = {
  news_id: string;
  title: string;
  excerpt?: string | null;
  cover_url?: string | null;
  author_name?: string | null;
  author_picture?: string | null;
  created_at: string;
};

const PLATFORM_ICON: Record<SocialPlatform, string> = {
  instagram: "logo-instagram",
  tiktok: "logo-tiktok",
  whatsapp: "logo-whatsapp",
  youtube: "logo-youtube",
};

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
  youtube: "YouTube",
};

function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const sec = Math.max(1, Math.floor((now - then) / 1000));
  if (sec < 60) return "baru saja";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} menit lalu`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} hari lalu`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

export default function NewsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { settings, refresh: refreshSettings } = useAppSettings();

  const load = useCallback(async () => {
    try {
      const list = await api<NewsItem[]>("/news");
      setItems(list);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([load(), refreshSettings()]);
      setLoading(false);
    })();
  }, [load, refreshSettings]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(), refreshSettings()]);
    setRefreshing(false);
  }, [load, refreshSettings]);

  const openSocial = async (platform: SocialPlatform, value?: string | null) => {
    const url = socialUrlFor(platform, value);
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {}
  };

  const activeSocials = (Object.keys(PLATFORM_ICON) as SocialPlatform[]).filter(
    (p) => !!settings.socials?.[p],
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTag}>LASKAR SAPE KERAP</Text>
          <Text style={styles.headerTitle}>BERITA UPDATE</Text>
        </View>
        {user?.is_admin && (
          <Pressable
            testID="go-admin-news"
            onPress={() => router.push({ pathname: "/admin", params: { tab: "news" } })}
            style={styles.addBtn}
            hitSlop={8}
          >
            <Ionicons name="create" size={16} color={colors.onBrandSecondary} />
            <Text style={styles.addBtnTxt}>POSTING</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.news_id}
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: insets.bottom + spacing.xl,
          gap: spacing.md,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brandSecondary}
            colors={[colors.brandSecondary]}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: spacing.md }}>
            {(settings.description || activeSocials.length > 0) && (
              <View style={styles.aboutCard}>
                <Text style={styles.aboutTag}>TENTANG ADMIN</Text>
                {settings.description ? (
                  <Text style={styles.aboutBody}>{settings.description}</Text>
                ) : (
                  <Text style={styles.aboutBody}>
                    Ikuti akun resmi admin Cak Mad Quiz untuk update harian seputar Madura
                    United.
                  </Text>
                )}
                {activeSocials.length > 0 && (
                  <View style={styles.socialGrid}>
                    {activeSocials.map((p) => (
                      <Pressable
                        key={p}
                        testID={`social-${p}`}
                        onPress={() => openSocial(p, settings.socials?.[p])}
                        style={({ pressed }) => [
                          styles.socialChip,
                          pressed && { opacity: 0.75 },
                        ]}
                      >
                        <Ionicons name={PLATFORM_ICON[p] as any} size={18} color={colors.brandSecondary} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.socialPlatform}>{PLATFORM_LABEL[p]}</Text>
                          <Text numberOfLines={1} style={styles.socialHandle}>
                            {socialLabelFor(p, settings.socials?.[p]) || ""}
                          </Text>
                        </View>
                        <Ionicons name="open-outline" size={14} color={colors.muted} />
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            )}
            <Text style={styles.sectionTitle}>ARTIKEL TERBARU</Text>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.brandPrimary} />
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Ionicons name="newspaper-outline" size={44} color={colors.muted} />
              <Text style={styles.emptyTitle}>Belum ada berita</Text>
              <Text style={styles.emptyBody}>
                Admin belum memposting artikel. Pantau terus halaman ini untuk update terbaru
                dari Laskar Sape Kerap.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            testID={`news-card-${item.news_id}`}
            onPress={() => router.push({ pathname: "/news/[id]", params: { id: item.news_id } })}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
          >
            {item.cover_url && (
              <Image
                source={absoluteFileUrl(item.cover_url) || ""}
                style={styles.cover}
                contentFit="cover"
                transition={200}
              />
            )}
            <View style={styles.cardBody}>
              <Text numberOfLines={2} style={styles.cardTitle}>
                {item.title}
              </Text>
              {item.excerpt ? (
                <Text numberOfLines={3} style={styles.cardExcerpt}>
                  {item.excerpt}
                </Text>
              ) : null}
              <View style={styles.cardMetaRow}>
                <Ionicons name="time-outline" size={12} color={colors.muted} />
                <Text style={styles.cardMeta}>{timeAgo(item.created_at)}</Text>
                {item.author_name ? (
                  <>
                    <View style={styles.dot} />
                    <Text style={styles.cardMeta}>{item.author_name}</Text>
                  </>
                ) : null}
              </View>
            </View>
          </Pressable>
        )}
      />
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
  headerTag: { color: colors.muted, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  headerTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: 1 },
  addBtn: {
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  addBtnTxt: { color: colors.onBrandSecondary, fontWeight: "900", fontSize: 10, letterSpacing: 1.5 },
  aboutCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md as number,
  },
  aboutTag: { color: colors.muted, fontSize: 11, letterSpacing: 2, fontWeight: "800" },
  aboutBody: { color: colors.onSurface, fontSize: 13, lineHeight: 19 },
  socialGrid: { gap: spacing.sm as number },
  socialChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md as number,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  socialPlatform: { color: colors.onSurface, fontSize: 13, fontWeight: "800" },
  socialHandle: { color: colors.muted, fontSize: 11, marginTop: 2 },
  sectionTitle: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "800",
    marginTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  cover: { width: "100%", height: 180, backgroundColor: colors.surfaceTertiary },
  cardBody: { padding: spacing.lg, gap: spacing.sm as number },
  cardTitle: { color: colors.onSurface, fontWeight: "900", fontSize: 16, lineHeight: 22 },
  cardExcerpt: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19 },
  cardMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.xs,
  },
  cardMeta: { color: colors.muted, fontSize: 11 },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.muted, marginHorizontal: 4 },
  center: { paddingVertical: spacing.xl, alignItems: "center" },
  emptyCard: {
    marginTop: spacing.lg,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm as number,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyTitle: { color: colors.onSurface, fontWeight: "900", fontSize: 15, marginTop: spacing.sm },
  emptyBody: { color: colors.muted, fontSize: 13, textAlign: "center", lineHeight: 19 },
});
