// Dark-first theme filled from /app/design_guidelines.json.
import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const dark = {
  // Surfaces
  surface: "#0F1115",
  onSurface: "#F8F9FA",
  surfaceSecondary: "#1C1F26",
  onSurfaceSecondary: "#E1E4E8",
  surfaceTertiary: "#282C34",
  onSurfaceTertiary: "#C4C9D0",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#0F1115",
  muted: "#8A919E",

  // Brand (Madura United red + gold)
  brand: "#A6192E",
  onBrand: "#FFFFFF",
  brandPrimary: "#C8102E",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#D4AF37",
  onBrandSecondary: "#1A1A1A",
  brandTertiary: "#4A1521",
  onBrandTertiary: "#FFD3D9",

  // Status
  success: "#2E7D32",
  onSuccess: "#FFFFFF",
  warning: "#F57C00",
  onWarning: "#1A1A1A",
  error: "#D32F2F",
  onError: "#FFFFFF",
  info: "#1976D2",
  onInfo: "#FFFFFF",

  // Lines
  border: "#2A2D35",
  borderStrong: "#444955",
  divider: "#1C1F26",
};

export type ThemeColors = typeof dark;

export const defaultScheme = "dark" satisfies ColorScheme;

export const themes: { light?: ThemeColors; dark: ThemeColors } = { dark };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.light ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme =
    (system === "light" || system === "dark") && themes[system] ? (system as ColorScheme) : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.dark };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const colors = dark;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };
