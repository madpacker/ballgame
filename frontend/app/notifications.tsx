import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useEffect, useState } from "react";

import { colors, radius, spacing } from "@/src/theme";
import { useAuth } from "@/src/contexts/auth";
import { api } from "@/src/api";

type Notification = {
  notification_id: string;
  kind: "follow" | "badge";
  from_user_id?: string | null;
  from_name?: string | null;
  from_picture?: string | null;
  message: string;
  read: boolean;
  created_at: string;
};

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [list, setList] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const items = await api<Notification[]>("/notifications");
        if (active) setList(items);
      } catch {
        if (active) setList([]);
      } finally {
        if (active) setLoading(false);
      }
      // Mark all read after display
      api("/notifications/read-all", { method: "POST" }).catch(() => {});
    })();
    return () => {
      active = false;
    };
  }, [user]);

  if (!user) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>NOTIFIKASI</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.empty}>
          <Ionicons name="notifications-off" size={64} color={colors.muted} />
          <Text style={styles.emptyTitle}>Login dulu</Text>
          <Text style={styles.muted}>Masuk agar notifikasi follower & juara mingguan masuk ke sini.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>NOTIFIKASI</Text>
        <View style={{ width: 32 }} />
      </View>
      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : list.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="notifications-outline" size={64} color={colors.muted} />
          <Text style={styles.emptyTitle}>Belum ada notifikasi</Text>
          <Text style={styles.muted}>Nanti kalau ada yang mem-follow atau kamu menang mingguan, muncul di sini.</Text>
        </View>
      ) : (
        <FlatList
          testID="notifications-list"
          data={list}
          keyExtractor={(n) => n.notification_id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
          renderItem={({ item }) => (
            <View style={[styles.row, !item.read && styles.rowUnread]}>
              <View style={styles.iconWrap}>
                {item.from_picture ? (
                  <Image source={item.from_picture} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Ionicons
                      name={item.kind === "badge" ? "trophy" : "person-add"}
                      size={18}
                      color={item.kind === "badge" ? colors.brandSecondary : colors.onSurface}
                    />
                  </View>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.message}</Text>
                <Text style={styles.rowTime}>{new Date(item.created_at).toLocaleString("id-ID")}</Text>
              </View>
              {!item.read && <View style={styles.dot} />}
            </View>
          )}
        />
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
  headerTitle: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: 2, textAlign: "center" },
  empty: { flex: 1, padding: spacing.xl, alignItems: "center", justifyContent: "center", gap: spacing.md as number },
  emptyTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "900", marginTop: spacing.md },
  muted: { color: colors.muted, fontSize: 13, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md as number,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    borderRadius: radius.md,
  },
  rowUnread: { backgroundColor: colors.brandTertiary + "33" },
  iconWrap: { width: 40, height: 40 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  rowTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "600" },
  rowTime: { color: colors.muted, fontSize: 11, marginTop: 4 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.brandPrimary,
  },
});
