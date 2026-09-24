import { CUT_RETENTION_DAYS } from '@app/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { CutTile } from '@/components/cuts/cut-tile';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteCuts, fetchCuts, fetchOverlays, thumbnailUrls, type Cut } from '@/lib/cuts';
import { ensurePhotosPermission, saveCutToCameraRoll } from '@/lib/save';

const COLUMNS = 3;
const GAP = Spacing.two;
const SIDE = Spacing.four;

type Section = { key: string; date: string; cuts: Cut[] };

/** Cuts grouped by the batch they came from, newest batch first. */
function sections(cuts: Cut[]): Section[] {
  const groups = new Map<string, Cut[]>();
  for (const cut of cuts) {
    const key = cut.batch_id ?? cut.id;
    groups.set(key, [...(groups.get(key) ?? []), cut]);
  }
  return [...groups.entries()].map(([key, group]) => ({
    key,
    date: new Date(group[0].created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    cuts: group,
  }));
}

export default function CutsScreen() {
  const theme = useTheme();
  const window = useWindowDimensions();
  const [cuts, setCuts] = useState<Cut[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState<{ batch: string; done: number; total: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await fetchCuts();
      setCuts(list);
      setThumbs(await thumbnailUrls(list));
    } catch (err) {
      console.warn('Could not load cuts', err);
      setCuts((c) => c ?? []);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const tileSize = (window.width - SIDE * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  function confirmDelete() {
    const chosen = (cuts ?? []).filter((c) => selected.has(c.id));
    if (chosen.length === 0) return;
    Alert.alert(
      chosen.length === 1 ? 'Delete this cut?' : `Delete ${chosen.length} cuts?`,
      'They’ll be removed for good. Anything already saved to your camera roll stays there.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteCuts(chosen);
              setCuts((c) => (c ?? []).filter((x) => !selected.has(x.id)));
              stopSelecting();
            } catch (err) {
              Alert.alert("Couldn't delete", err instanceof Error ? err.message : 'Please try again.');
              load();
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  }

  async function saveAll(section: Section) {
    if (!(await ensurePhotosPermission())) {
      Alert.alert('Allow access to Photos', 'We need permission to save videos to your camera roll.');
      return;
    }
    setSaving({ batch: section.key, done: 0, total: section.cuts.length });
    const failed: number[] = [];
    try {
      const overlays = await fetchOverlays(section.cuts.map((c) => c.id));
      // One at a time: renders queue anyway, and phones dislike parallel 100 MB downloads.
      for (const [i, cut] of section.cuts.entries()) {
        try {
          await saveCutToCameraRoll({ id: cut.id, outputPath: cut.output_path, overlays: overlays[cut.id] ?? null });
        } catch (err) {
          console.warn(`Could not save ${cut.id}`, err);
          failed.push(i + 1);
        }
        setSaving((s) => s && { ...s, done: i + 1 });
      }
      const saved = section.cuts.length - failed.length;
      Alert.alert(
        failed.length ? `Saved ${saved} of ${section.cuts.length}` : 'Saved',
        failed.length
          ? `Couldn’t save ${failed.length === 1 ? 'one video' : `${failed.length} videos`}. Try those again from their previews.`
          : `All ${section.cuts.length} videos are in your camera roll.`,
      );
    } catch (err) {
      Alert.alert("Couldn't save", err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSaving(null);
    }
  }

  const list = cuts ?? [];

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Cuts</ThemedText>
          {list.length > 0 && (
            <Pressable onPress={() => (selecting ? stopSelecting() : setSelecting(true))} hitSlop={10}>
              <ThemedText type="linkPrimary">{selecting ? 'Cancel' : 'Select'}</ThemedText>
            </Pressable>
          )}
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }>
          {cuts !== null && list.length === 0 && (
            <View style={styles.empty}>
              <ThemedText themeColor="textSecondary">
                Finished edits show up here. Add videos on the Batch tab to get started.
              </ThemedText>
              <Button title="Go to Batch" variant="secondary" onPress={() => router.navigate('/')} />
            </View>
          )}

          {list.length > 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              Cuts are kept for {CUT_RETENTION_DAYS} days. Save the ones you want to keep.
            </ThemedText>
          )}

          {sections(list).map((section) => (
            <View key={section.key} style={styles.section}>
              <View style={styles.sectionHeader}>
                <ThemedText type="smallBold">
                  {section.date} · {section.cuts.length} {section.cuts.length === 1 ? 'cut' : 'cuts'}
                </ThemedText>
                {!selecting && (
                  <Pressable disabled={!!saving} onPress={() => saveAll(section)} hitSlop={8}>
                    <ThemedText type="linkPrimary" style={saving && styles.dim}>
                      {saving?.batch === section.key
                        ? `Saving ${Math.min(saving.done + 1, saving.total)} of ${saving.total}…`
                        : section.cuts.length === 1
                          ? 'Save'
                          : 'Save all'}
                    </ThemedText>
                  </Pressable>
                )}
              </View>
              <View style={styles.grid}>
                {section.cuts.map((cut) => (
                  <CutTile
                    key={cut.id}
                    cut={cut}
                    thumbnail={cut.thumbnail_path ? thumbs[cut.thumbnail_path] : undefined}
                    size={tileSize}
                    selecting={selecting}
                    selected={selected.has(cut.id)}
                    onPress={() =>
                      selecting ? toggle(cut.id) : router.push({ pathname: '/cut/[id]', params: { id: cut.id } })
                    }
                    onLongPress={() => {
                      setSelecting(true);
                      toggle(cut.id);
                    }}
                  />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>

        {selecting && (
          <View style={[styles.actionBar, { backgroundColor: theme.background, borderColor: theme.border }]}>
            <Button
              title={selected.size ? `Delete ${selected.size}` : 'Delete'}
              variant="danger"
              disabled={selected.size === 0}
              loading={deleting}
              onPress={confirmDelete}
            />
          </View>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SIDE,
    paddingTop: Spacing.two,
  },
  content: { padding: SIDE, paddingBottom: BottomTabInset + Spacing.six, gap: Spacing.four },
  empty: { gap: Spacing.three, paddingTop: Spacing.five },
  section: { gap: Spacing.two },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  dim: { opacity: 0.5 },
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: BottomTabInset,
    padding: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
