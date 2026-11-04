import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import type { ReactNode } from "react";

import { radius } from "@/src/theme";
import { absoluteFileUrl } from "@/src/hooks/useAppSettings";

// Futcard tile used by the Store and the profile "Koleksi Kartu" (fixed card palette).
export default function FutCard({ card, footer }: { card: { title: string; image_url?: string | null }; footer?: ReactNode }) {
  const src = absoluteFileUrl(card.image_url);
  return (
    <View style={styles.cell}>
      <View style={styles.art}>
        {src ? <Image source={src} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="person" size={44} color="#AEB9D6" />}
        <LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.75)"]} style={styles.fade} />
        <Text numberOfLines={1} style={styles.title}>{card.title.toUpperCase()}</Text>
      </View>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  cell: { width: "100%", alignItems: "center", gap: 4 },
  art: {
    width: "100%", aspectRatio: 0.8, borderRadius: radius.sm, overflow: "hidden", alignItems: "center",
    justifyContent: "center", backgroundColor: "#1B2B55", borderWidth: 1.5, borderColor: "#F2C24E",
  },
  fade: { position: "absolute", left: 0, right: 0, bottom: 0, height: "40%" },
  title: { position: "absolute", bottom: 6, left: 4, right: 4, textAlign: "center", color: "#FFFFFF", fontWeight: "900", fontSize: 11 },
});
