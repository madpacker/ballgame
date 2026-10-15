import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "cakmad.local_high";

export type LocalHigh = {
  classic: number;
  time_attack: number;
};

export async function getLocalHigh(): Promise<LocalHigh> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { classic: 0, time_attack: 0 };
    return { classic: 0, time_attack: 0, ...JSON.parse(raw) };
  } catch {
    return { classic: 0, time_attack: 0 };
  }
}

export async function updateLocalHigh(mode: "classic" | "time_attack", score: number) {
  const current = await getLocalHigh();
  if (score > current[mode]) {
    const next = { ...current, [mode]: score };
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
    return next;
  }
  return current;
}
