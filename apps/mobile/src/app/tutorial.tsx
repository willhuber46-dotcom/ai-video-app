import { router } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { markTutorialSeen } from '@/lib/tutorial';

const SLIDES: { ios: SFSymbol; android: AndroidSymbol; title: string; body: string }[] = [
  {
    ios: 'video.fill',
    android: 'videocam',
    title: 'Film or pick your videos',
    body: 'Record right in the Create tab, or add up to 10 videos from your camera roll on the Batch tab.',
  },
  {
    ios: 'wand.and.stars',
    android: 'auto_fix_high',
    title: 'Pick a mode',
    body: 'Talking, No Talking, Voiceover, Before & After or Unboxing / ASMR. Each video can have its own.',
  },
  {
    ios: 'bell.badge.fill',
    android: 'notifications_active',
    title: 'We do the editing',
    body: 'Pauses, retakes and slow parts get cut. Close the app if you like: we’ll notify you when your videos are ready.',
  },
  {
    ios: 'textformat',
    android: 'text_fields',
    title: 'Make it yours, then post',
    body: 'Add captions, text and zooms, change anything you don’t like, and save to your camera roll.',
  },
];

/** Shown once on first launch; Settings → Replay tutorial opens it again. */
export default function TutorialScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const [scroller, setScroller] = useState<ScrollView | null>(null);
  const last = page === SLIDES.length - 1;

  function finish() {
    void markTutorialSeen();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function next() {
    if (last) return finish();
    scroller?.scrollTo({ x: width * (page + 1), animated: true });
    setPage(page + 1);
  }

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex}>
        <View style={styles.top}>
          <Pressable accessibilityRole="button" onPress={finish} hitSlop={12}>
            <ThemedText themeColor="textSecondary">Skip</ThemedText>
          </Pressable>
        </View>

        <ScrollView
          ref={setScroller}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}>
          {SLIDES.map((slide) => (
            <View key={slide.title} style={[styles.slide, { width }]}>
              <View style={[styles.icon, { backgroundColor: theme.backgroundElement }]}>
                <SymbolView name={{ ios: slide.ios, android: slide.android }} size={56} tintColor={theme.accent} />
              </View>
              <ThemedText type="subtitle" style={styles.center}>
                {slide.title}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.center}>
                {slide.body}
              </ThemedText>
            </View>
          ))}
        </ScrollView>

        <View style={styles.bottom}>
          <View style={styles.dots}>
            {SLIDES.map((s, i) => (
              <View
                key={s.title}
                style={[styles.dot, { backgroundColor: i === page ? theme.accent : theme.backgroundSelected }]}
              />
            ))}
          </View>
          <Button title={last ? 'Get started' : 'Next'} onPress={next} />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { alignItems: 'flex-end', paddingHorizontal: Spacing.four, paddingTop: Spacing.two },
  slide: { justifyContent: 'center', alignItems: 'center', padding: Spacing.five, gap: Spacing.three },
  icon: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  bottom: { padding: Spacing.four, gap: Spacing.four },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.two },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
