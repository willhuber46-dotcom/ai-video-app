import type { VideoPlayer } from 'expo-video';
import { useEffect, useState } from 'react';

/**
 * Current playback time from the player's timeUpdate events, plus a seek that
 * updates it right away (no events arrive while paused).
 */
export function usePlayerTime(player: VideoPlayer): [number, (t: number) => void] {
  const [time, setTime] = useState(0);
  useEffect(() => {
    const sub = player.addListener('timeUpdate', (e) => setTime(e.currentTime));
    return () => sub.remove();
  }, [player]);
  const seek = (t: number) => {
    player.seekBy(t - player.currentTime);
    setTime(t);
  };
  return [time, seek];
}

export function usePlayerPlaying(player: VideoPlayer): boolean {
  const [playing, setPlaying] = useState(player.playing);
  useEffect(() => {
    const sub = player.addListener('playingChange', (e) => setPlaying(e.isPlaying));
    return () => sub.remove();
  }, [player]);
  return playing;
}

export function useVideoDuration(player: VideoPlayer): number {
  const [duration, setDuration] = useState(player.duration);
  useEffect(() => {
    const sub = player.addListener('sourceLoad', (e) => setDuration(e.duration));
    return () => sub.remove();
  }, [player]);
  return duration;
}
