import { FONTS, type FontKey } from '@app/shared';

/**
 * The same TTFs the worker renders with, so the preview matches the saved
 * video. Metro needs literal require() calls, hence the explicit list.
 */
const FILES: Record<FontKey, number> = {
  'montserrat-black': require('@expo-google-fonts/montserrat/900Black/Montserrat_900Black.ttf'),
  'montserrat-extrabold': require('@expo-google-fonts/montserrat/800ExtraBold/Montserrat_800ExtraBold.ttf'),
  'inter-semibold': require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
  'poppins-bold': require('@expo-google-fonts/poppins/700Bold/Poppins_700Bold.ttf'),
  'playfair-bold': require('@expo-google-fonts/playfair-display/700Bold/PlayfairDisplay_700Bold.ttf'),
  pacifico: require('@expo-google-fonts/pacifico/400Regular/Pacifico_400Regular.ttf'),
  'courier-bold': require('@expo-google-fonts/courier-prime/700Bold/CourierPrime_700Bold.ttf'),
};

/** For expo-font's useFonts: family name -> file. */
export const FONT_SOURCES = Object.fromEntries(
  (Object.keys(FILES) as FontKey[]).map((key) => [FONTS[key].family, FILES[key]]),
);

export function fontFamily(key: FontKey): string {
  return FONTS[key].family;
}
