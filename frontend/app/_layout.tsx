import { Stack, useRouter, useSegments } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { LogBox, StyleSheet, View, ActivityIndicator } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { AuthProvider, useAuth } from "@/src/contexts/auth";
import { SkinProvider } from "@/src/contexts/skin";
import { colors } from "@/src/theme";
import OpeningVideo from "@/src/components/OpeningVideo";

LogBox.ignoreAllLogs(true);

// Icon preload - preserve for Expo Go android.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@react-native-vector-icons/ionicons");
} catch {}

function RootGate() {
  const { loading, user } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  // Opening highlight video plays once per app launch.
  const [introDone, setIntroDone] = useState(false);
  const finishIntro = useCallback(() => setIntroDone(true), []);

  useEffect(() => {
    if (loading) return;
    const inAuthRoute = segments[0] === "login";
    // Login is required: guests always land on /login; signed-in users never see it.
    if (user && inAuthRoute) router.replace("/");
    else if (!user && !inAuthRoute) router.replace("/login");
  }, [loading, user, segments, router]);

  if (!introDone) return <OpeningVideo onDone={finishIntro} />;

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.brandPrimary} size="large" />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <AuthProvider>
            <SkinProvider>
              <StatusBar style="light" />
              <RootGate />
            </SkinProvider>
          </AuthProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  loading: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
});
