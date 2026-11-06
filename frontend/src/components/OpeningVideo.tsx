import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEvent } from "expo";
import { useEffect, useState } from "react";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Opening highlight shown once per app launch. Fixed dark palette (identical in every theme).
export default function OpeningVideo({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  // Browsers block autoplay with sound, so web starts muted with a "tap for sound" button.
  const [muted, setMuted] = useState(Platform.OS === "web");
  const player = useVideoPlayer(require("@/assets/video/opening.mp4"), (p) => {
    p.loop = false;
    p.muted = Platform.OS === "web";
    p.play();
  });
  const { status } = useEvent(player, "statusChange", { status: player.status });

  useEffect(() => {
    const sub = player.addListener("playToEnd", onDone);
    // Safety net: never trap the user if the video can't play.
    const t = setTimeout(onDone, 25000);
    return () => {
      sub.remove();
      clearTimeout(t);
    };
  }, [player, onDone]);

  useEffect(() => {
    if (status === "error") onDone();
    // On web the element must exist before play() works, so start once it's ready.
    if (status === "readyToPlay" && !player.playing) player.play();
  }, [status, onDone, player]);

  return (
    <View style={styles.root} testID="opening-video">
      <View style={StyleSheet.absoluteFill}>
        <VideoView player={player} style={styles.video} contentFit="cover" nativeControls={false} />
      </View>
      <View style={[styles.bar, { top: insets.top + 12 }]}>
        <Pressable
          testID="opening-sound"
          onPress={() => {
            player.muted = !muted;
            setMuted(!muted);
          }}
          style={styles.btn}
        >
          <Ionicons name={muted ? "volume-mute" : "volume-high"} size={18} color="#FFFFFF" />
        </Pressable>
        <Pressable testID="opening-skip" onPress={onDone} style={styles.btn}>
          <Text style={styles.skip}>LEWATI</Text>
          <Ionicons name="play-skip-forward" size={16} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000000", zIndex: 100 },
  // Explicit size: on web the <video> otherwise renders at its native 1080x1920 and looks zoomed in.
  video: { width: "100%", height: "100%" },
  bar: { position: "absolute", right: 16, flexDirection: "row", gap: 8 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  skip: { color: "#FFFFFF", fontWeight: "900", fontSize: 13, letterSpacing: 1 },
});
