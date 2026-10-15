import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { LogBox, StyleSheet, View, ActivityIndicator } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { AuthProvider, useAuth } from "@/src/contexts/auth";
import { SkinProvider } from "@/src/contexts/skin";
import { colors } from "@/src/theme";

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

  useEffect(() => {
    if (loading) return;
    const inAuthRoute = segments[0] === "login";
    // Public screens: tabs, quiz, result. Login is gated so users can play without login,
    // but when they reach leaderboard-only actions we push to /login manually.
    // Just handle the case: if the user comes from /login after signing in, send home.
    if (user && inAuthRoute) {
      router.replace("/");
    }
  }, [loading, user, segments, router]);

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
