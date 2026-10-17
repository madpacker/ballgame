import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Share,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useEffect, useState } from "react";

import { colors, radius, spacing } from "@/src/theme";
import { api } from "@/src/api";
import { absoluteFileUrl } from "@/src/hooks/useAppSettings";

type NewsItem = {
  news_id: string;
  title: string;
  body: string;
  cover_url?: string | null;
  author_name?: string | null;
  author_picture?: string | null;
  created_at: string;
  updated_at?: string | null;
};

export default function NewsDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<NewsItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const n = await api<NewsItem>(`/news/${id}`);
        setItem(n);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const share = async () => {
    if (!item) return;
    try {
      await Share.share({
        title: item.title,
        message: `${item.title}\n\nBaca di Cak Mad Quiz:\ncakmad://news/${item.news_id}`,
      });
    } catch {}
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>ARTIKEL</Text>
        {item ? (
          <Pressable testID="share-news" onPress={share} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="share-social" size={22} color={colors.onSurface} />
          </Pressable>
        ) : (
          <View style={{ width: 32 }} />
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} size="large" />
        </View>
      ) : notFound || !item ? (
        <View style={styles.center}>
          <Ionicons name="document-outline" size={48} color={colors.muted} />
          <Text style={styles.emptyTitle}>Artikel tidak ditemukan</Text>
          <Pressable
            onPress={() => router.replace("/news")}
            style={styles.backCta}
            testID="back-to-list"
          >
            <Text style={styles.backCtaTxt}>KEMBALI KE DAFTAR BERITA</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingBottom: insets.bottom + spacing.xl,
          }}
          showsVerticalScrollIndicator={false}
        >
          {item.cover_url && (
            <Image
              source={absoluteFileUrl(item.cover_url) || ""}
              style={styles.cover}
              contentFit="cover"
              transition={300}
            />
          )}
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <Text style={styles.title}>{item.title}</Text>
            <View style={styles.metaRow}>
              {item.author_picture ? (
                <Image source={item.author_picture} style={styles.authorAvatar} />
              ) : (
                <View style={[styles.authorAvatar, styles.authorAvatarFallback]}>
                  <Ionicons name="person" size={14} color={colors.onSurface} />
                </View>
              )}
              <View>
                <Text style={styles.authorName}>{item.author_name || "Admin Cak Mad"}</Text>
                <Text style={styles.metaDate}>
                  {new Date(item.created_at).toLocaleDateString("id-ID", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  })}
                  {" · "}
                  {new Date(item.created_at).toLocaleTimeString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
            </View>
            <View style={styles.divider} />
            <Text style={styles.body} selectable={Platform.OS !== "web"}>
              {item.body}
            </Text>
          </View>
        </ScrollView>
      )}
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
  headerTitle: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 2,
    textAlign: "center",
  },
  cover: { width: "100%", height: 240, backgroundColor: colors.surfaceTertiary },
  title: { color: colors.onSurface, fontWeight: "900", fontSize: 22, lineHeight: 30 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm as number },
  authorAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceTertiary },
  authorAvatarFallback: { alignItems: "center", justifyContent: "center" },
  authorName: { color: colors.onSurface, fontSize: 13, fontWeight: "800" },
  metaDate: { color: colors.muted, fontSize: 11, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },
  body: { color: colors.onSurface, fontSize: 15, lineHeight: 24 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  emptyTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  backCta: {
    marginTop: spacing.md,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  backCtaTxt: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 12, letterSpacing: 1.5 },
});
