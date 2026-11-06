import { View, StyleSheet } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";

import { absoluteFileUrl } from "@/src/hooks/useAppSettings";

export type WItem = { item_id: string; kind: "character" | "top" | "bottom" | "shoes"; name: string; image_url: string; back_url?: string | null };
export type Outfit = { character_id?: string; top_id?: string; bottom_id?: string; shoes_id?: string };

// Body regions (fractions of the stage) where transparent clothing PNGs are layered.
const ZONES = {
  top: { top: "17%", height: "38%", left: "14%", right: "14%" },
  bottom: { top: "48%", height: "38%", left: "22%", right: "22%" },
  shoes: { top: "86%", height: "13%", left: "22%", right: "22%" },
} as const;

export function resolveOutfit(items: WItem[], o: Outfit) {
  const by = (id?: string) => items.find((i) => i.item_id === id);
  return { character: by(o.character_id), top: by(o.top_id), bottom: by(o.bottom_id), shoes: by(o.shoes_id) };
}

/** Full-body character with clothing layers. `back` shows the rear view (used while rotated). */
export default function CharacterStage({
  items,
  outfit,
  back = false,
}: {
  items: WItem[];
  outfit: Outfit;
  back?: boolean;
}) {
  const r = resolveOutfit(items, outfit);
  const base = r.character ? absoluteFileUrl(back && r.character.back_url ? r.character.back_url : r.character.image_url) : null;
  if (!base) {
    return (
      <View style={styles.empty}>
        <Ionicons name="body" size={140} color="rgba(255,255,255,0.85)" />
      </View>
    );
  }
  return (
    <View style={styles.stage}>
      <Image source={base} style={StyleSheet.absoluteFill} contentFit="contain" />
      {(["bottom", "shoes", "top"] as const).map((k) => {
        const it = r[k];
        if (!it) return null;
        const src = absoluteFileUrl(back && it.back_url ? it.back_url : it.image_url);
        return <Image key={k} source={src} style={[styles.layer, ZONES[k] as any]} contentFit="contain" />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, width: "100%" },
  layer: { position: "absolute" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
});
