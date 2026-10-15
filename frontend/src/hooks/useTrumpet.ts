import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";

// Keep one player per asset per app session; expo-audio is fine with lazy init.
let trumpetPlayer: AudioPlayer | null = null;

function ensurePlayer() {
  if (!trumpetPlayer) {
    try {
      trumpetPlayer = createAudioPlayer(require("@/assets/sounds/trumpet.mp3"));
      trumpetPlayer.volume = 0.9;
    } catch (e) {
      console.warn("trumpet audio init failed", e);
    }
  }
  return trumpetPlayer;
}

export async function playTrumpet() {
  try {
    if (Platform.OS === "web") {
      // Lazy construct and reuse an HTMLAudioElement to avoid autoplay blocks after any user tap.
      const w = window as any;
      if (!w.__cakmad_trumpet) {
        w.__cakmad_trumpet = new Audio(
          // Served by Metro from assets; use require path converted.
          require("@/assets/sounds/trumpet.mp3"),
        );
        w.__cakmad_trumpet.volume = 0.9;
      }
      w.__cakmad_trumpet.currentTime = 0;
      await w.__cakmad_trumpet.play().catch(() => {});
      return;
    }
    const p = ensurePlayer();
    if (!p) return;
    await p.seekTo(0);
    p.play();
  } catch (e) {
    console.warn("playTrumpet failed", e);
  }
}

export function useTrumpet() {
  const ref = useRef(playTrumpet);
  useEffect(() => {
    // Pre-warm on native so the first play has no delay.
    if (Platform.OS !== "web") ensurePlayer();
  }, []);
  return ref.current;
}
