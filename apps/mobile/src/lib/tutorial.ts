import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'tutorialSeen.v1';

export async function hasSeenTutorial(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === 'true';
  } catch {
    return true;
  }
}

export async function markTutorialSeen(): Promise<void> {
  await AsyncStorage.setItem(KEY, 'true').catch(() => {});
}
