import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Share,
  Platform,
  TextInput,
  KeyboardAvoidingView,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useCallback, useEffect, useState } from "react";
import * as Haptics from "expo-haptics";

import { colors, radius, spacing } from "@/src/theme";
import { api } from "@/src/api";
import { absoluteFileUrl } from "@/src/hooks/useAppSettings";
import { useAuth } from "@/src/contexts/auth";

type NewsItem = {
  news_id: string;
  title: string;
  body: string;
  cover_url?: string | null;
  author_name?: string | null;
  author_picture?: string | null;
  created_at: string;
  updated_at?: string | null;
  like_count: number;
  comment_count: number;
  liked: boolean;
};

type Comment = {
  comment_id: string;
  news_id: string;
  user_id: string;
  name: string;
  picture?: string | null;
  body: string;
  created_at: string;
};

function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const sec = Math.max(1, Math.floor((now - then) / 1000));
  if (sec < 60) return "baru saja";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} j`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} h`;
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
  });
}

export default function NewsDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<NewsItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);

  const loadNews = useCallback(async () => {
    if (!id) return;
    try {
      const n = await api<NewsItem>(`/news/${id}`);
      setItem(n);
    } catch {
      setNotFound(true);
    }
  }, [id]);

  const loadComments = useCallback(async () => {
    if (!id) return;
    try {
      const cs = await api<Comment[]>(`/news/${id}/comments`);
      setComments(cs);
    } catch {
      setComments([]);
    }
  }, [id]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadNews(), loadComments()]);
      setLoading(false);
    })();
  }, [loadNews, loadComments]);

  const toggleLike = async () => {
    if (!user) {
      Alert.alert("Masuk dulu", "Login dulu untuk memberi like.", [
        { text: "Nanti" },
        { text: "Masuk", onPress: () => router.push("/login") },
      ]);
      return;
    }
    if (!item || likeBusy) return;
    setLikeBusy(true);
    // Optimistic update
    const prevLiked = item.liked;
    const prevCount = item.like_count;
    setItem({
      ...item,
      liked: !prevLiked,
      like_count: prevCount + (prevLiked ? -1 : 1),
    });
    if (Platform.OS !== "web")
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const res = await api<{ liked: boolean; like_count: number }>(
        `/news/${item.news_id}/like`,
        { method: "POST" },
      );
      setItem((prev) =>
        prev
          ? { ...prev, liked: res.liked, like_count: res.like_count }
          : prev,
      );
    } catch {
      // revert
      setItem((prev) =>
        prev ? { ...prev, liked: prevLiked, like_count: prevCount } : prev,
      );
    } finally {
      setLikeBusy(false);
    }
  };

  const sendComment = async () => {
    if (!user) {
      Alert.alert("Masuk dulu", "Login dulu untuk berkomentar.", [
        { text: "Nanti" },
        { text: "Masuk", onPress: () => router.push("/login") },
      ]);
      return;
    }
    const text = commentDraft.trim();
    if (!text || !item || posting) return;
    setPosting(true);
    try {
      const c = await api<Comment>(`/news/${item.news_id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: text }),
      });
      setComments((prev) => [c, ...prev]);
      setItem((prev) =>
        prev ? { ...prev, comment_count: prev.comment_count + 1 } : prev,
      );
      setCommentDraft("");
      if (Platform.OS !== "web")
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch {
      Alert.alert("Gagal", "Komentar gagal terkirim. Coba lagi.");
    } finally {
      setPosting(false);
    }
  };

  const removeComment = (c: Comment) => {
    Alert.alert("Hapus komentar?", c.body.slice(0, 80), [
      { text: "Batal", style: "cancel" },
      {
        text: "Hapus",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/news/comments/${c.comment_id}`, { method: "DELETE" });
            setComments((prev) =>
              prev.filter((x) => x.comment_id !== c.comment_id),
            );
            setItem((prev) =>
              prev
                ? { ...prev, comment_count: Math.max(0, prev.comment_count - 1) }
                : prev,
            );
          } catch {
            Alert.alert("Gagal", "Komentar tidak bisa dihapus.");
          }
        },
      },
    ]);
  };

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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
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
        <>
          <ScrollView
            contentContainerStyle={{ paddingBottom: spacing.xl }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
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
                  </Text>
                </View>
              </View>

              {/* Reactions bar */}
              <View style={styles.reactionsRow}>
                <Pressable
                  testID="like-button"
                  onPress={toggleLike}
                  disabled={likeBusy}
                  style={({ pressed }) => [
                    styles.reactionBtn,
                    item.liked && styles.reactionBtnActive,
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <Ionicons
                    name={item.liked ? "heart" : "heart-outline"}
                    size={20}
                    color={item.liked ? colors.brandPrimary : colors.onSurface}
                  />
                  <Text
                    testID="like-count"
                    style={[
                      styles.reactionTxt,
                      item.liked && { color: colors.brandPrimary },
                    ]}
                  >
                    {item.like_count}
                  </Text>
                </Pressable>
                <View style={styles.reactionBtn}>
                  <Ionicons name="chatbubble-outline" size={18} color={colors.onSurface} />
                  <Text style={styles.reactionTxt}>{item.comment_count}</Text>
                </View>
                <Pressable
                  testID="share-reaction"
                  onPress={share}
                  style={({ pressed }) => [styles.reactionBtn, pressed && { opacity: 0.75 }]}
                >
                  <Ionicons name="share-outline" size={18} color={colors.onSurface} />
                  <Text style={styles.reactionTxt}>Bagikan</Text>
                </Pressable>
              </View>

              <View style={styles.divider} />
              <Text style={styles.body} selectable={Platform.OS !== "web"}>
                {item.body}
              </Text>

              {/* Comments */}
              <View style={styles.divider} />
              <Text style={styles.commentsTitle}>
                KOMENTAR · {item.comment_count}
              </Text>
              {comments.length === 0 ? (
                <View style={styles.emptyComments}>
                  <Ionicons name="chatbubbles-outline" size={28} color={colors.muted} />
                  <Text style={styles.emptyCommentsTxt}>
                    Belum ada komentar. Jadi yang pertama!
                  </Text>
                </View>
              ) : (
                comments.map((c) => {
                  const canDelete =
                    user && (user.user_id === c.user_id || user.is_admin);
                  return (
                    <View key={c.comment_id} style={styles.comment}>
                      {c.picture ? (
                        <Image source={c.picture} style={styles.commentAvatar} />
                      ) : (
                        <View
                          style={[styles.commentAvatar, styles.authorAvatarFallback]}
                        >
                          <Ionicons name="person" size={14} color={colors.onSurface} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <View style={styles.commentHeader}>
                          <Text style={styles.commentName} numberOfLines={1}>
                            {c.name}
                          </Text>
                          <Text style={styles.commentTime}>{timeAgo(c.created_at)}</Text>
                          {canDelete && (
                            <Pressable
                              testID={`delete-comment-${c.comment_id}`}
                              onPress={() => removeComment(c)}
                              hitSlop={6}
                            >
                              <Ionicons
                                name="trash-outline"
                                size={14}
                                color={colors.muted}
                              />
                            </Pressable>
                          )}
                        </View>
                        <Text style={styles.commentBody}>{c.body}</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </ScrollView>

          {/* Composer */}
          <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.sm }]}>
            <TextInput
              testID="comment-input"
              value={commentDraft}
              onChangeText={setCommentDraft}
              placeholder={user ? "Tulis komentar..." : "Login untuk berkomentar"}
              placeholderTextColor={colors.muted}
              style={styles.composerInput}
              multiline
              maxLength={1000}
              editable={!!user}
            />
            <Pressable
              testID="send-comment"
              onPress={sendComment}
              disabled={!commentDraft.trim() || posting || !user}
              style={({ pressed }) => [
                styles.sendBtn,
                (!commentDraft.trim() || posting || !user) && { opacity: 0.4 },
                pressed && { opacity: 0.7 },
              ]}
            >
              {posting ? (
                <ActivityIndicator color={colors.onBrandPrimary} />
              ) : (
                <Ionicons name="send" size={18} color={colors.onBrandPrimary} />
              )}
            </Pressable>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
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
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  body: { color: colors.onSurface, fontSize: 15, lineHeight: 24 },
  reactionsRow: {
    flexDirection: "row",
    gap: spacing.sm as number,
    marginTop: spacing.xs,
  },
  reactionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    minHeight: 40,
  },
  reactionBtnActive: {
    borderColor: colors.brandPrimary,
    backgroundColor: colors.brandTertiary,
  },
  reactionTxt: {
    color: colors.onSurface,
    fontWeight: "800",
    fontSize: 13,
  },
  commentsTitle: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "800",
    marginTop: spacing.sm,
  },
  emptyComments: {
    alignItems: "center",
    paddingVertical: spacing.lg,
    gap: spacing.sm as number,
  },
  emptyCommentsTxt: { color: colors.muted, fontSize: 13 },
  comment: {
    flexDirection: "row",
    gap: spacing.sm as number,
    paddingVertical: spacing.sm,
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceTertiary,
  },
  commentHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm as number,
    marginBottom: 2,
  },
  commentName: { color: colors.onSurface, fontWeight: "800", fontSize: 13, flex: 1 },
  commentTime: { color: colors.muted, fontSize: 11 },
  commentBody: { color: colors.onSurface, fontSize: 14, lineHeight: 20 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm as number,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  composerInput: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.onSurface,
    fontSize: 14,
    maxHeight: 110,
    minHeight: 42,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
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
