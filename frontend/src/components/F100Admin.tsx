import { View, Text, Pressable, StyleSheet, TextInput, ActivityIndicator, Switch, Platform, Alert } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import FoldHeader from "@/src/components/FoldHeader";
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useState } from "react";

import { colors, radius, spacing } from "@/src/theme";
import { api, getToken } from "@/src/api";
import { uploadForm } from "@/src/utils/upload";

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;
type Item = { item_id: string; prompt: string; answers: string[]; wrong: string[]; active: boolean };
const EMPTY = ["", "", "", ""];

export default function F100Admin() {
  const [items, setItems] = useState<Item[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [answers, setAnswers] = useState<string[]>(EMPTY);
  const [wrong, setWrong] = useState<string[]>(EMPTY);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  const load = useCallback(() => {
    api<Item[]>("/admin/f100/items").then(setItems).catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);

  const reset = () => {
    setEditId(null);
    setPrompt("");
    setAnswers(EMPTY);
    setWrong(EMPTY);
    setActive(true);
  };

  const save = async () => {
    const all = [...answers, ...wrong].map((x) => x.trim());
    if (prompt.trim().length < 3 || all.some((x) => !x) || new Set(all.map((x) => x.toLowerCase())).size !== 8)
      return setMsg({ ok: false, t: "Isi pertanyaan + 4 jawaban urut + 4 pengecoh (semua beda)." });
    setBusy(true);
    try {
      await api(`/admin/f100/items${editId ? `/${editId}` : ""}`, {
        method: editId ? "PUT" : "POST",
        body: JSON.stringify({ prompt: prompt.trim(), answers: answers.map((x) => x.trim()), wrong: wrong.map((x) => x.trim()), active }),
      });
      setMsg({ ok: true, t: editId ? "Soal diperbarui." : "Soal ditambahkan." });
      reset();
      load();
    } catch {
      setMsg({ ok: false, t: "Gagal menyimpan soal." });
    }
    setBusy(false);
  };

  const importCsv = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "application/csv", "*/*"], copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.[0]) return;
    const a = picked.assets[0];
    setBusy(true);
    try {
      const token = await getToken();
      const res = await uploadForm(`${BACKEND}/api/admin/f100/import`, {
        headers: { Authorization: `Bearer ${token}` },
        files: { file: { uri: a.uri, name: a.name || "football100.csv", mimeType: a.mimeType || "text/csv" } },
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt);
      const d = JSON.parse(txt) as { created: number; skipped: number; errors: string[] };
      setMsg({ ok: true, t: `Impor: ${d.created} soal ditambahkan, ${d.skipped} dilewati.${d.errors[0] ? " " + d.errors[0] : ""}` });
      if (d.created > 0) setListOpen(true);
      load();
    } catch (e) {
      setMsg({ ok: false, t: `Impor gagal: ${String(e).slice(0, 120)}` });
    }
    setBusy(false);
  };

  const edit = (it: Item) => {
    setEditId(it.item_id);
    setPrompt(it.prompt);
    setAnswers(it.answers);
    setWrong(it.wrong);
    setActive(it.active);
  };

  const del = async (id: string) => {
    await api(`/admin/f100/items/${id}`, { method: "DELETE" }).catch(() => {});
    if (editId === id) reset();
    load();
  };

  const field = (vals: string[], set: (v: string[]) => void, i: number, ph: string, id: string) => (
    <TextInput
      key={id}
      testID={id}
      value={vals[i]}
      onChangeText={(t) => set(vals.map((v, j) => (j === i ? t : v)))}
      placeholder={ph}
      placeholderTextColor={colors.muted}
      style={[styles.input, styles.half]}
    />
  );

  return (
    <View style={styles.card}>
      <Text style={styles.label}>FOOTBALL 100 ({items.length} soal)</Text>
      <Text style={styles.sub}>CSV: prompt, answer_1, answer_2, answer_3, answer_4 (urutan benar), wrong_1..wrong_4, active</Text>
      <Pressable testID="f100-import" disabled={busy} onPress={importCsv} style={[styles.btn, styles.ghost]}>
        <Ionicons name="document-attach" size={16} color={colors.onSurface} />
        <Text style={styles.ghostTxt}>UPLOAD CSV</Text>
      </Pressable>
      <TextInput testID="f100-prompt" value={prompt} onChangeText={setPrompt} placeholder="mis. Urutkan 4 top skor Liga 1 2023/24" placeholderTextColor={colors.muted} style={styles.input} multiline />
      <Text style={styles.sub}>Jawaban benar (urut 1 → 4)</Text>
      <View style={styles.wrap}>{answers.map((_, i) => field(answers, setAnswers, i, `#${i + 1}`, `f100-answer-${i}`))}</View>
      <Text style={styles.sub}>Pilihan pengecoh</Text>
      <View style={styles.wrap}>{wrong.map((_, i) => field(wrong, setWrong, i, `Salah ${i + 1}`, `f100-wrong-${i}`))}</View>
      <View style={styles.row}>
        <Text style={styles.sub}>Aktif</Text>
        <Switch testID="f100-active" value={active} onValueChange={setActive} trackColor={{ false: colors.surfaceTertiary, true: colors.brandPrimary }} />
      </View>
      {msg && <Text testID="f100-msg" style={{ color: msg.ok ? colors.success : colors.error, fontWeight: "600" }}>{msg.t}</Text>}
      <View style={styles.row}>
        <Pressable testID="f100-save" disabled={busy} onPress={save} style={[styles.btn, { flex: 1 }]}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.btnTxt}>{editId ? "SIMPAN PERUBAHAN" : "TAMBAH SOAL"}</Text>}
        </Pressable>
        {editId && (
          <Pressable onPress={reset} style={[styles.btn, styles.ghost]}>
            <Text style={styles.ghostTxt}>BATAL</Text>
          </Pressable>
        )}
      </View>
      <FoldHeader testID="fold-f100" title="DAFTAR SOAL FOOTBALL 100" count={items.length} open={listOpen} onToggle={() => setListOpen((v) => !v)} />
      {listOpen && items.map((it, i) => (
        <View key={it.item_id} testID={`f100-item-${it.item_id}`} style={styles.item}>
          <View style={{ flex: 1 }}>
            <Text style={styles.itemTitle} numberOfLines={2}>{i + 1}. {it.prompt}</Text>
            <Text style={styles.sub} numberOfLines={1}>{it.answers.join(" → ")}{it.active ? "" : " · nonaktif"}</Text>
          </View>
          <Pressable testID={`f100-edit-${it.item_id}`} onPress={() => edit(it)} style={styles.iconBtn}>
            <Ionicons name="create" size={20} color={colors.brandSecondary} />
          </Pressable>
          <Pressable
            testID={`f100-delete-${it.item_id}`}
            onPress={() => {
              if (Platform.OS === "web") {
                if (window.confirm("Hapus soal ini?")) del(it.item_id);
              } else {
                Alert.alert("Hapus soal?", it.prompt, [
                  { text: "Batal", style: "cancel" },
                  { text: "Hapus", style: "destructive", onPress: () => del(it.item_id) },
                ]);
              }
            }}
            style={styles.iconBtn}
          >
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
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontSize: 14, minHeight: 44 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  half: { width: "48%", minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, justifyContent: "space-between" },
  btn: { flexDirection: "row", gap: 6, backgroundColor: colors.brandPrimary, borderRadius: radius.md, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  btnTxt: { color: colors.onBrandPrimary, fontWeight: "900", letterSpacing: 1 },
  ghost: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
  ghostTxt: { color: colors.onSurface, fontWeight: "800" },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface },
  itemTitle: { color: colors.onSurface, fontWeight: "700", fontSize: 13 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
});
