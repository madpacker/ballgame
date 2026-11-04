import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";

import { colors, radius, spacing } from "@/src/theme";
import { uploadForm } from "@/src/utils/upload";
import { getToken } from "@/src/api";
import { useAppSettings } from "@/src/hooks/useAppSettings";
import { absolutePhotoUrl } from "@/src/data/questions";
import { CATEGORY_LABEL, CATEGORY_COLOR, QUIZ_CATEGORY_KEYS, type Category } from "@/src/data/quiz";
import { api } from "@/src/api";

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;
const KEYS: (Category | "all")[] = ["all", ...QUIZ_CATEGORY_KEYS];

export default function CategoryLogosAdmin() {
  const { settings, refresh } = useAppSettings();
  const logos = settings.category_logos ?? {};
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pick = async (key: string) => {
    setErr(null);
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!req.granted) {
          setErr("Izin galeri diperlukan untuk memilih logo.");
          return;
        }
      }
    }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    setBusy(key);
    try {
      const token = await getToken();
      const res = await uploadForm(`${BACKEND}/api/admin/category-logo/${key}`, {
        headers: { Authorization: `Bearer ${token}` },
        files: { image: { uri: a.uri, name: a.fileName || `logo_${key}.png`, mimeType: a.mimeType || "image/png" } },
      });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch {
      setErr("Gagal upload logo.");
    }
    setBusy(null);
  };

  const remove = async (key: string) => {
    setBusy(key);
    try {
      await api(`/admin/category-logo/${key}`, { method: "DELETE" });
      await refresh();
    } catch {}
    setBusy(null);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.label}>LOGO KATEGORI QUIZ</Text>
      <Text style={styles.sub}>Tap kotak untuk upload logo klub (PNG transparan disarankan).</Text>
      {err && <Text style={styles.err}>{err}</Text>}
      <View style={styles.grid}>
        {KEYS.map((k) => {
          const url = logos[k];
          return (
            <View key={k} style={styles.cell}>
              <Pressable
                testID={`catlogo-pick-${k}`}
                onPress={() => pick(k)}
                style={[styles.logoBox, { borderColor: CATEGORY_COLOR[k] }]}
              >
                {busy === k ? (
                  <ActivityIndicator color={colors.brandPrimary} />
                ) : url ? (
                  <Image source={absolutePhotoUrl(url)} style={styles.logo} contentFit="contain" />
                ) : (
                  <Ionicons name="cloud-upload" size={22} color={colors.muted} />
                )}
              </Pressable>
              <Text numberOfLines={1} style={styles.name}>{CATEGORY_LABEL[k]}</Text>
              {url && (
                <Pressable testID={`catlogo-remove-${k}`} onPress={() => remove(k)} hitSlop={8}>
                  <Text style={styles.remove}>Hapus</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  label: { color: colors.muted, fontSize: 12, letterSpacing: 2, fontWeight: "800" },
  sub: { color: colors.muted, fontSize: 12 },
  err: { color: colors.error, fontSize: 12, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.sm },
  cell: { width: 72, alignItems: "center", gap: 4 },
  logoBox: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    borderWidth: 2,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: { width: 54, height: 54 },
  name: { color: colors.onSurface, fontSize: 10, fontWeight: "700", textAlign: "center" },
  remove: { color: colors.error, fontSize: 10, fontWeight: "700" },
});
