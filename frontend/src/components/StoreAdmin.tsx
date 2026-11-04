import { View, Text, Pressable, StyleSheet, TextInput, ActivityIndicator, Platform } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useState } from "react";

import { colors, radius, spacing } from "@/src/theme";
import { api, getToken } from "@/src/api";
import { uploadForm } from "@/src/utils/upload";
import { absoluteFileUrl } from "@/src/hooks/useAppSettings";

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;
type Card = { card_id: string; title: string; image_url?: string | null; price: number; stock: number; active: boolean };

export default function StoreAdmin() {
  const [cards, setCards] = useState<Card[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [img, setImg] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [giftId, setGiftId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ user_id: string; name: string; username?: string; email?: string }[]>([]);

  const search = async (text: string) => {
    setQ(text);
    if (text.trim().length < 2) return setFound([]);
    api<typeof found>(`/admin/users/search?q=${encodeURIComponent(text.trim())}`).then(setFound).catch(() => setFound([]));
  };

  const gift = async (uid: string, name: string) => {
    if (!giftId) return;
    try {
      await api(`/admin/users/${uid}/gift-card`, { method: "POST", body: JSON.stringify({ card_id: giftId }) });
      setMsg({ ok: true, t: `Kartu dikirim ke ${name} 🎁` });
      setGiftId(null);
      setQ("");
      setFound([]);
    } catch (e) {
      setMsg({ ok: false, t: String(e).includes("already_owned") ? `${name} sudah punya kartu ini.` : "Gagal mengirim kartu." });
    }
  };

  const load = useCallback(() => {
    api<Card[]>("/admin/store/cards").then(setCards).catch(() => setCards([]));
  }, []);
  useEffect(load, [load]);

  const reset = () => {
    setEditId(null);
    setTitle("");
    setPrice("");
    setStock("");
    setImg(null);
  };

  const pick = async () => {
    if (Platform.OS !== "web") {
      const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!p.granted) return setMsg({ ok: false, t: "Izin galeri diperlukan." });
    }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (!r.canceled && r.assets[0]) setImg(r.assets[0]);
  };

  const submit = async () => {
    const p = parseInt(price, 10);
    const s = parseInt(stock, 10);
    if (!title.trim() || isNaN(p) || p < 0 || isNaN(s) || s < 0) return setMsg({ ok: false, t: "Isi nama, poin & stok dengan benar." });
    setBusy(true);
    setMsg(null);
    try {
      const token = await getToken();
      const res = await uploadForm(`${BACKEND}/api/admin/store/cards${editId ? `/${editId}` : ""}`, {
        method: editId ? "PUT" : "POST",
        headers: { Authorization: `Bearer ${token}` },
        fields: { title: title.trim(), price: String(p), stock: String(s) },
        files: img ? { image: { uri: img.uri, name: img.fileName || "card.png", mimeType: img.mimeType || "image/png" } } : {},
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg({ ok: true, t: editId ? "Kartu diperbarui." : "Kartu ditambahkan." });
      reset();
      load();
    } catch {
      setMsg({ ok: false, t: "Gagal menyimpan kartu." });
    }
    setBusy(false);
  };

  const edit = (c: Card) => {
    setEditId(c.card_id);
    setTitle(c.title);
    setPrice(String(c.price));
    setStock(String(c.stock));
    setImg(null);
  };

  const del = async (id: string) => {
    await api(`/admin/store/cards/${id}`, { method: "DELETE" }).catch(() => {});
    if (editId === id) reset();
    load();
  };

  const editing = cards.find((c) => c.card_id === editId);
  const preview = img?.uri || absoluteFileUrl(editing?.image_url);

  return (
    <View style={styles.card}>
      <Text style={styles.label}>STORE · FUTCARD ({cards.length})</Text>
      <Pressable testID="store-card-pick" onPress={pick} style={styles.picker}>
        {preview ? <Image source={preview} style={styles.preview} contentFit="cover" /> : <Ionicons name="image" size={28} color={colors.muted} />}
        <Text style={styles.sub}>{preview ? "Ganti foto kartu" : "Pilih foto kartu"}</Text>
      </Pressable>
      <TextInput testID="store-card-title" value={title} onChangeText={setTitle} placeholder="Nama kartu (mis. Madura United)" placeholderTextColor={colors.muted} style={styles.input} maxLength={40} />
      <View style={styles.row}>
        <TextInput testID="store-card-price" value={price} onChangeText={setPrice} placeholder="Poin" keyboardType="number-pad" placeholderTextColor={colors.muted} style={[styles.input, { flex: 1, minWidth: 0 }]} />
        <TextInput testID="store-card-stock" value={stock} onChangeText={setStock} placeholder="Stok" keyboardType="number-pad" placeholderTextColor={colors.muted} style={[styles.input, { flex: 1, minWidth: 0 }]} />
      </View>
      {msg && <Text style={{ color: msg.ok ? colors.success : colors.error, fontWeight: "600" }}>{msg.t}</Text>}
      <View style={styles.row}>
        <Pressable testID="store-card-save" disabled={busy} onPress={submit} style={[styles.btn, { flex: 1 }]}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.btnTxt}>{editId ? "SIMPAN PERUBAHAN" : "TAMBAH KARTU"}</Text>}
        </Pressable>
        {editId && (
          <Pressable testID="store-card-cancel" onPress={reset} style={[styles.btn, styles.btnGhost]}>
            <Text style={styles.ghostTxt}>BATAL</Text>
          </Pressable>
        )}
      </View>
      {giftId && (
        <View testID="gift-panel" style={styles.giftPanel}>
          <Text style={styles.itemTitle}>Hadiahkan “{cards.find((c) => c.card_id === giftId)?.title}” ke user:</Text>
          <TextInput testID="gift-search" value={q} onChangeText={search} placeholder="Cari nama / username / email" placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="none" />
          {found.map((u) => (
            <Pressable key={u.user_id} testID={`gift-user-${u.user_id}`} onPress={() => gift(u.user_id, u.name)} style={styles.item}>
              <Ionicons name="person-circle" size={26} color={colors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{u.name}</Text>
                <Text style={styles.sub}>@{u.username} · {u.email}</Text>
              </View>
              <Text style={{ color: colors.brandPrimary, fontWeight: "900" }}>KIRIM</Text>
            </Pressable>
          ))}
        </View>
      )}
      {cards.map((c) => (
        <View key={c.card_id} testID={`admin-card-${c.card_id}`} style={styles.item}>
          {c.image_url ? <Image source={absoluteFileUrl(c.image_url)} style={styles.thumb} /> : <View style={styles.thumb} />}
          <View style={{ flex: 1 }}>
            <Text style={styles.itemTitle}>{c.title}</Text>
            <Text style={styles.sub}>{c.price.toLocaleString("id-ID")} poin · stok {c.stock}</Text>
          </View>
          <Pressable testID={`admin-card-gift-${c.card_id}`} onPress={() => setGiftId(giftId === c.card_id ? null : c.card_id)} hitSlop={8} style={styles.iconBtn}>
            <Ionicons name="gift" size={20} color={colors.brandPrimary} />
          </Pressable>
          <Pressable testID={`admin-card-edit-${c.card_id}`} onPress={() => edit(c)} hitSlop={8} style={styles.iconBtn}>
            <Ionicons name="create" size={20} color={colors.brandSecondary} />
          </Pressable>
          <Pressable testID={`admin-card-delete-${c.card_id}`} onPress={() => del(c.card_id)} hitSlop={8} style={styles.iconBtn}>
            <Ionicons name="trash" size={20} color={colors.error} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  label: { color: colors.muted, fontSize: 12, letterSpacing: 2, fontWeight: "800" },
  sub: { color: colors.muted, fontSize: 12 },
  picker: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border },
  preview: { width: 56, height: 70, borderRadius: radius.sm },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontSize: 14, minHeight: 44 },
  row: { flexDirection: "row", gap: spacing.sm },
  btn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  btnTxt: { color: colors.onBrandPrimary, fontWeight: "900", letterSpacing: 1 },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
  ghostTxt: { color: colors.onSurface, fontWeight: "800" },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface },
  thumb: { width: 40, height: 50, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  itemTitle: { color: colors.onSurface, fontWeight: "800" },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  giftPanel: { gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary },
});
