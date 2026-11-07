import { View, Text, Pressable, StyleSheet, TextInput, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useState } from "react";

import { colors, radius, spacing } from "@/src/theme";
import { api, getToken } from "@/src/api";
import { uploadForm } from "@/src/utils/upload";
import { absoluteFileUrl } from "@/src/hooks/useAppSettings";

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;
type League = { key: string; name: string; banner_url?: string | null };

async function pickAndSend(path: string, fields: Record<string, string> = {}) {
  const p = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
  if (p.canceled || !p.assets[0]) return null;
  const a = p.assets[0];
  const token = await getToken();
  const res = await uploadForm(`${BACKEND}/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    fields,
    files: { image: { uri: a.uri, name: a.fileName || "image.png", mimeType: a.mimeType || "image/png" } },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** Admin: league button images + manual club logo when the online database has none. */
export default function LeagueAdmin({ onMsg }: { onMsg: (kind: "ok" | "err", txt: string) => void }) {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [team, setTeam] = useState("");

  const load = useCallback(() => {
    api<League[]>("/leagues").then(setLeagues).catch(() => setLeagues([]));
  }, []);
  useEffect(load, [load]);

  const uploadBanner = async (key: string) => {
    setBusy(key);
    try {
      if (await pickAndSend(`/admin/leagues/${key}/banner`)) {
        onMsg("ok", "Gambar liga tersimpan.");
        load();
      }
    } catch {
      onMsg("err", "Upload gambar liga gagal.");
    } finally {
      setBusy(null);
    }
  };

  const removeBanner = async (key: string) => {
    await api(`/admin/leagues/${key}/banner`, { method: "DELETE" }).catch(() => {});
    load();
  };

  const uploadTeamLogo = async () => {
    if (!team.trim()) return onMsg("err", "Tulis nama klub persis seperti di jadwal.");
    setBusy("team");
    try {
      if (await pickAndSend("/admin/team-logos", { name: team.trim() })) {
        onMsg("ok", `Logo ${team.trim()} tersimpan dan dipakai di semua jadwalnya.`);
        setTeam("");
      }
    } catch {
      onMsg("err", "Upload logo klub gagal.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.label}>GAMBAR TOMBOL LIGA</Text>
      <Text style={styles.hint}>Disarankan gambar lebar (sekitar 4:1). Tanpa gambar, tombol memakai warna bawaan.</Text>
      {leagues.map((lg) => (
        <View key={lg.key} style={styles.row}>
          <View style={styles.thumb}>
            {lg.banner_url ? (
              <Image source={absoluteFileUrl(lg.banner_url)} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <Ionicons name="image" size={20} color={colors.muted} />
            )}
          </View>
          <Text style={styles.name} numberOfLines={1}>{lg.name}</Text>
          <Pressable testID={`league-banner-upload-${lg.key}`} disabled={busy !== null} onPress={() => uploadBanner(lg.key)} style={styles.btn}>
            {busy === lg.key ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={styles.btnTxt}>{lg.banner_url ? "GANTI" : "UPLOAD"}</Text>}
          </Pressable>
          {lg.banner_url ? (
            <Pressable testID={`league-banner-delete-${lg.key}`} onPress={() => removeBanner(lg.key)} style={styles.iconBtn}>
              <Ionicons name="trash" size={18} color={colors.error} />
            </Pressable>
          ) : null}
        </View>
      ))}

      <Text style={[styles.label, { marginTop: spacing.md }]}>LOGO KLUB MANUAL</Text>
      <Text style={styles.hint}>Logo diisi otomatis dari database sepak bola online. Kalau ada klub tanpa logo, upload di sini.</Text>
      <View style={styles.row}>
        <TextInput
          testID="team-logo-name"
          value={team}
          onChangeText={setTeam}
          placeholder="Nama klub, mis. Madura United"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        <Pressable testID="team-logo-upload" disabled={busy !== null} onPress={uploadTeamLogo} style={styles.btn}>
          {busy === "team" ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={styles.btnTxt}>UPLOAD</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  label: { color: colors.muted, fontSize: 11, fontWeight: "900", letterSpacing: 2 },
  hint: { color: colors.muted, fontSize: 11 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  thumb: { width: 84, height: 28, borderRadius: 6, overflow: "hidden", backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  name: { flex: 1, color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  btn: { minHeight: 40, minWidth: 76, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  btnTxt: { color: colors.brandPrimary, fontWeight: "900", fontSize: 11, letterSpacing: 1 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minHeight: 44, backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.onSurface, borderWidth: 1, borderColor: colors.border },
});
