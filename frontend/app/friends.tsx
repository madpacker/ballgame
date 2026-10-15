import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, ActivityIndicator, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import QRCode from "react-native-qrcode-svg";
import { useEffect, useState } from "react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { colors, radius, spacing } from "@/src/theme";
import { useAuth } from "@/src/contexts/auth";
import { api } from "@/src/api";

type Friend = {
  user_id: string;
  username: string;
  name: string;
  picture?: string | null;
};

export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; txt: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await api<Friend[]>("/friends");
      setFriends(list);
    } catch {
      setFriends([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) refresh();
    else setLoading(false);
  }, [user]);

  if (!user) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>TEMAN</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.loginState}>
          <Ionicons name="people-outline" size={64} color={colors.muted} />
          <Text style={styles.emptyTitle}>Masuk dulu</Text>
          <Text style={styles.muted}>
            Fitur teman memerlukan akun agar kode username-mu bisa dibagikan.
          </Text>
          <Pressable
            testID="go-login"
            onPress={() => router.push("/login")}
            style={styles.primary}
          >
            <Ionicons name="logo-google" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.primaryTxt}>LANJUT DENGAN GOOGLE</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const submit = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setAdding(true);
    setMsg(null);
    const body = trimmed.includes("@")
      ? { email: trimmed }
      : { code: trimmed.toUpperCase() };
    try {
      await api("/friends/follow", { method: "POST", body: JSON.stringify(body) });
      setMsg({ kind: "ok", txt: "Teman berhasil ditambahkan." });
      setInput("");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refresh();
    } catch (e: any) {
      setMsg({ kind: "err", txt: "User tidak ditemukan atau kode salah." });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setAdding(false);
    }
  };

  const unfollow = async (f: Friend) => {
    await api("/friends/unfollow", { method: "POST", body: JSON.stringify({ code: f.username }) }).catch(() => {});
    refresh();
  };

  const copyCode = async () => {
    await Clipboard.setStringAsync(user.username);
    setMsg({ kind: "ok", txt: "Kode tersalin ke clipboard." });
    if (Platform.OS !== "web") Haptics.selectionAsync();
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>TEMAN</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 60, gap: spacing.lg }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.myCard}>
          <View style={styles.qrWrap}>
            <QRCode
              value={`cakmad://friend/${user.username}`}
              size={140}
              backgroundColor="#FFFFFF"
              color="#0F1115"
            />
          </View>
          <Text style={styles.myLabel}>KODE USERNAME-MU</Text>
          <Pressable testID="copy-code-button" onPress={copyCode} style={styles.codePill}>
            <Text style={styles.codeTxt}>{user.username}</Text>
            <Ionicons name="copy" size={16} color={colors.brandSecondary} />
          </Pressable>
          <Text style={styles.myHint}>Bagikan kode ini ke temanmu agar mereka bisa follow balik.</Text>
        </View>

        <View style={styles.addCard}>
          <Text style={styles.addLabel}>TAMBAH TEMAN</Text>
          <View style={styles.addRow}>
            <TextInput
              testID="friend-input"
              value={input}
              onChangeText={setInput}
              placeholder="Kode MU-XXXXXX atau email"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.input}
            />
            <Pressable
              testID="follow-button"
              onPress={submit}
              disabled={adding || !input.trim()}
              style={[styles.addBtn, (!input.trim() || adding) && { opacity: 0.5 }]}
            >
              {adding ? (
                <ActivityIndicator size="small" color={colors.onBrandPrimary} />
              ) : (
                <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
              )}
            </Pressable>
          </View>
          {msg && (
            <Text style={[styles.msg, msg.kind === "err" ? styles.msgErr : styles.msgOk]}>
              {msg.txt}
            </Text>
          )}
        </View>

        <View>
          <Text style={styles.sectionLabel}>MENGIKUTI · {friends.length}</Text>
          {loading && <ActivityIndicator color={colors.brandPrimary} />}
          {!loading && friends.length === 0 && (
            <Text style={styles.muted}>Belum ada teman. Tambah dari kolom di atas.</Text>
          )}
          {friends.map((f) => (
            <View key={f.user_id} style={styles.friendRow}>
              {f.picture ? (
                <Image source={f.picture} style={styles.friendAvatar} />
              ) : (
                <View style={[styles.friendAvatar, styles.friendAvatarFallback]}>
                  <Ionicons name="person" size={18} color={colors.onSurface} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.friendName}>{f.name}</Text>
                <Text style={styles.friendCode}>{f.username}</Text>
              </View>
              <Pressable testID={`unfollow-${f.username}`} onPress={() => unfollow(f)} hitSlop={10}>
                <Ionicons name="close-circle" size={22} color={colors.muted} />
              </Pressable>
            </View>
          ))}
        </View>
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
  loginState: { flex: 1, padding: spacing.xl, alignItems: "center", justifyContent: "center", gap: spacing.md as number },
  emptyTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "900", marginTop: spacing.md },
  muted: { color: colors.muted, fontSize: 13, textAlign: "center" },
  primary: {
    marginTop: spacing.lg,
    flexDirection: "row",
    gap: spacing.sm as number,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    alignItems: "center",
  },
  primaryTxt: { color: colors.onBrandPrimary, fontWeight: "900", letterSpacing: 1.5 },
  myCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    gap: spacing.sm as number,
  },
  qrWrap: {
    padding: spacing.md,
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  myLabel: { color: colors.muted, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  codePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm as number,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  codeTxt: { color: colors.brandSecondary, fontWeight: "900", fontSize: 18, letterSpacing: 3 },
  myHint: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: spacing.xs },
  addCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  addRow: { flexDirection: "row", gap: spacing.sm as number, alignItems: "center" },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: radius.md,
    color: colors.onSurface,
    fontSize: 14,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  msg: { marginTop: spacing.sm, fontSize: 12 },
  msgOk: { color: colors.success },
  msgErr: { color: colors.error },
  sectionLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "700",
    marginBottom: spacing.md,
  },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md as number,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  friendAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary },
  friendAvatarFallback: { alignItems: "center", justifyContent: "center" },
  friendName: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  friendCode: { color: colors.brandSecondary, fontSize: 12, fontWeight: "700", marginTop: 2, letterSpacing: 1 },
});
