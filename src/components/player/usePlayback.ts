"use client";

import { useEffect, useRef, useState } from "react";

type RepeatMode = "off" | "all" | "one";

export function usePlayback({
  src,
  trackKey,
  autoplay,
  volume,
  muted,
  repeat,
  onEnded,
  onError,
}: {
  src: string | null;
  trackKey: number | null;
  autoplay: boolean;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  onEnded: () => void;
  onError: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  const autoplayRef = useRef(autoplay);
  const repeatRef = useRef(repeat);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    onEndedRef.current = onEnded;
    onErrorRef.current = onError;
    autoplayRef.current = autoplay;
    repeatRef.current = repeat;
  });

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;

    const onTime = () => setTime(audio.currentTime);
    const onMeta = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const ended = () => {
      if (repeatRef.current === "one") {
        audio.currentTime = 0;
        void audio.play().catch(() => setPlaying(false));
        return;
      }
      onEndedRef.current();
    };
    const error = () => {
      setFailed(true);
      setPlaying(false);
      onErrorRef.current();
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", ended);
    audio.addEventListener("error", error);

    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", ended);
      audio.removeEventListener("error", error);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (trackKey == null || !src) {
      audio.pause();
      return;
    }
    /* eslint-disable react-hooks/set-state-in-effect -- reset the clock when the audio source changes */
    setFailed(false);
    setTime(0);
    setDuration(0);
    /* eslint-enable react-hooks/set-state-in-effect */
    audio.src = src;
    audio.load();
    if (autoplayRef.current) {
      void audio.play().catch(() => setPlaying(false));
    }
  }, [src, trackKey]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = muted ? 0 : volume;
  }, [muted, volume]);

  return {
    playing,
    time,
    duration,
    failed,
    play() {
      const audio = audioRef.current;
      if (!audio) return;
      void audio.play().catch(() => setPlaying(false));
    },
    pause() {
      audioRef.current?.pause();
    },
    toggle() {
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.paused) void audio.play().catch(() => setPlaying(false));
      else audio.pause();
    },
    seek(next: number) {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = next;
      setTime(next);
    },
    getTime() {
      return audioRef.current?.currentTime ?? 0;
    },
  };
}
