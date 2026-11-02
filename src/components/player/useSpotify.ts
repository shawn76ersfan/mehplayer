"use client";

import { useEffect, useRef, useState } from "react";
import {
  browserCanPlaySpotify,
  clearSpotifySession,
  findSpotifyTrack,
  hasSpotifySession,
  playSpotifyUri,
  spotifyAccessToken,
  spotifyOpenUrl,
} from "@/lib/spotify";

type RepeatMode = "off" | "all" | "one";

export type SpotifyStatus = "off" | "connecting" | "ready" | "premium" | "unsupported" | "error";

type SpotifyState = {
  paused: boolean;
  position: number;
  duration: number;
};

type SpotifyPlayer = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: (event: "ready" | "not_ready" | "player_state_changed" | "initialization_error" | "authentication_error" | "account_error" | "playback_error", callback: (payload: { device_id?: string; message?: string } & SpotifyState) => void) => void;
  setVolume: (volume: number) => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  togglePlay: () => Promise<void>;
};

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (callback: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyPlayer;
    };
  }
}

function loadSdk() {
  if (window.Spotify) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const previous = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => {
      previous?.();
      resolve();
    };
    if (!document.querySelector("script[data-spotify-sdk]")) {
      const script = document.createElement("script");
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      script.dataset.spotifySdk = "true";
      document.body.appendChild(script);
    }
  });
}

export function useSpotify({
  trackId,
  title,
  album,
  autoplay,
  volume,
  muted,
  repeat,
  onEnded,
}: {
  trackId: number | null;
  title: string;
  album: string;
  autoplay: boolean;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  onEnded: () => void;
}) {
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const deviceRef = useRef<string | null>(null);
  const uriRef = useRef<string | null>(null);
  const loadedRef = useRef<string | null>(null);
  const timeRef = useRef(0);
  const endedRef = useRef(false);
  const intentionalRef = useRef(false);
  const autoplayRef = useRef(autoplay);
  const repeatRef = useRef(repeat);
  const onEndedRef = useRef(onEnded);
  const [status, setStatus] = useState<SpotifyStatus>("off");
  const [connected, setConnected] = useState(false);
  const [match, setMatch] = useState<{ id: number; uri: string | null } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [session, setSession] = useState(0);

  useEffect(() => {
    autoplayRef.current = autoplay;
    repeatRef.current = repeat;
    onEndedRef.current = onEnded;
  });

  useEffect(() => {
    if (!hasSpotifySession()) return;
    let cancelled = false;
    if (!browserCanPlaySpotify()) {
      queueMicrotask(() => {
        if (cancelled) return;
        setConnected(true);
        setStatus("unsupported");
      });
      return () => {
        cancelled = true;
      };
    }

    queueMicrotask(() => {
      if (cancelled) return;
      setConnected(true);
      setStatus("connecting");
    });
    void loadSdk().then(async () => {
      if (cancelled || !window.Spotify) return;
      const player = new window.Spotify.Player({
        name: "Meh",
        volume: muted ? 0 : volume,
        getOAuthToken: (callback) => {
          void spotifyAccessToken().then((token) => {
            if (token) callback(token);
          });
        },
      });
      playerRef.current = player;
      player.addListener("ready", ({ device_id }) => {
        deviceRef.current = device_id ?? null;
        setStatus("ready");
      });
      player.addListener("authentication_error", () => {
        clearSpotifySession();
        setConnected(false);
        setStatus("off");
      });
      player.addListener("account_error", () => setStatus("premium"));
      player.addListener("playback_error", () => setStatus("error"));
      player.addListener("player_state_changed", (state) => {
        if (!state || state.duration == null) {
          setPlaying(false);
          return;
        }
        timeRef.current = state.position / 1000;
        setTime(state.position / 1000);
        setDuration(state.duration / 1000);
        setPlaying(!state.paused);
        const atEnd = state.paused && state.position > 1000 && state.position >= state.duration - 1500;
        if (!atEnd) {
          if (!state.paused) endedRef.current = false;
          return;
        }
        if (endedRef.current || intentionalRef.current) return;
        endedRef.current = true;
        if (repeatRef.current === "one" && uriRef.current) {
          void player.seek(0).then(() => player.resume());
          return;
        }
        onEndedRef.current();
      });
      const ok = await player.connect();
      if (!ok && !cancelled) setStatus("error");
    });

    return () => {
      cancelled = true;
      playerRef.current?.disconnect();
      playerRef.current = null;
      deviceRef.current = null;
    };
    // Reconnect only when the session changes. Volume is applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || status !== "ready") return;
    void player.setVolume(muted ? 0 : volume);
  }, [muted, status, volume]);

  useEffect(() => {
    if (!connected || trackId == null || !album) {
      uriRef.current = null;
      return;
    }
    let cancelled = false;
    uriRef.current = null;
    void findSpotifyTrack(trackId, title, album).then(async (uri) => {
      if (cancelled) return;
      uriRef.current = uri;
      setMatch({ id: trackId, uri });
      if (!uri || !autoplayRef.current || status !== "ready" || !deviceRef.current) return;
      endedRef.current = false;
      intentionalRef.current = false;
      const result = await playSpotifyUri(uri, deviceRef.current);
      if (result === "premium") setStatus("premium");
      if (result === "ok") loadedRef.current = uri;
    });
    return () => {
      cancelled = true;
    };
  }, [album, connected, status, title, trackId]);

  async function start() {
    const uri = uriRef.current;
    const deviceId = deviceRef.current;
    const player = playerRef.current;
    if (!uri || !deviceId || !player) return;
    intentionalRef.current = false;
    endedRef.current = false;
    if (loadedRef.current === uri) {
      await player.resume();
      return;
    }
    const result = await playSpotifyUri(uri, deviceId);
    if (result === "premium") setStatus("premium");
    if (result === "ok") loadedRef.current = uri;
  }

  const resolved = match?.id === trackId ? match.uri : undefined;
  const owns = status === "ready" && trackId != null && resolved !== null;
  const notice =
    status === "premium"
      ? "Spotify Premium is required to play the full song in this page."
      : status === "unsupported"
        ? "This phone can’t run Spotify inside the page. Open the song in Spotify instead."
        : status === "error"
          ? "Spotify couldn’t start. The 30-second preview is still here."
          : status === "connecting"
            ? "Connecting to Spotify…"
            : resolved === null
              ? "Spotify doesn’t have that recording, so this is the 30-second preview."
              : owns
                ? "Full song from your Spotify account."
                : null;

  return {
    connected,
    status,
    owns,
    notice,
    playing,
    time,
    duration,
    failed: status === "error",
    disconnect() {
      playerRef.current?.disconnect();
      clearSpotifySession();
      setConnected(false);
      setStatus("off");
      setSession((value) => value + 1);
    },
    async openExternal() {
      if (trackId == null) return;
      const uri = uriRef.current ?? (await findSpotifyTrack(trackId, title, album));
      if (!uri) return;
      window.open(spotifyOpenUrl(uri), "_blank", "noopener,noreferrer");
    },
    play() {
      void start();
    },
    pause() {
      intentionalRef.current = true;
      void playerRef.current?.pause();
    },
    toggle() {
      if (playing) {
        intentionalRef.current = true;
        void playerRef.current?.pause();
        return;
      }
      void start();
    },
    seek(next: number) {
      timeRef.current = next;
      setTime(next);
      void playerRef.current?.seek(Math.round(next * 1000));
    },
    getTime() {
      return timeRef.current;
    },
  };
}
