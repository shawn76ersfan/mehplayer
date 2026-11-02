"use client";

import { Suspense, useDeferredValue, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { formatClock, formatRelease } from "@/lib/format";
import { readPersisted, writePersisted, type RepeatMode } from "@/lib/storage";
import { AuthMenu } from "./AuthMenu";
import { SpotifyMenu } from "./SpotifyMenu";
import { usePlayback } from "./usePlayback";
import { useSpotify } from "./useSpotify";

type Album = {
  collectionId: number;
  title: string;
  credit: string;
  releaseDate: string;
  year: number;
  artworkUrl: string;
  primary: string;
  secondary: string;
  ink: string;
};

type Track = {
  collectionId: number;
  trackId: number;
  title: string;
  previewUrl: string;
  durationMs: number;
  trackNumber: number;
  discNumber: number;
  explicit: boolean;
  albumTitle?: string;
};

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function buildClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function randomTrack(tracks: Track[], currentId?: number) {
  const pool = tracks.filter((track) => track.trackId !== currentId);
  const source = pool.length > 0 ? pool : tracks;
  return source[Math.floor(Math.random() * source.length)];
}

function subscribeToInstallHint() {
  return () => {};
}

function useIosInstallHint() {
  return useSyncExternalStore(
    subscribeToInstallHint,
    () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const browser = navigator as Navigator & { standalone?: boolean };
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches || Boolean(browser.standalone);
      return ios && !standalone;
    },
    () => false,
  );
}

export function Player() {
  const artist = useQuery(api.catalog.getArtist, { key: "kanye-west" });
  const albums = useQuery(api.catalog.listAlbums, { artistKey: "kanye-west" });
  const { isAuthenticated } = useConvexAuth();
  const server = useQuery(api.library.getState, isAuthenticated ? {} : "skip");
  const savePlayback = useMutation(api.library.savePlayback);
  const toggleFavoriteMutation = useMutation(api.library.toggleFavorite);
  const ensureFavorite = useMutation(api.library.ensureFavorite);

  const [collectionId, setCollectionId] = useState<number | null>(null);
  const [current, setCurrent] = useState<Track | null>(null);
  const [autoplay, setAutoplay] = useState(false);
  const [view, setView] = useState<"album" | "liked">("album");
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<number[]>([]);
  const [volume, setVolume] = useState(0.9);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [drag, setDrag] = useState(0);
  const [hint, setHint] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const iosHint = useIosInstallHint();

  const albumList = (albums ?? []) as Album[];
  const activeCollectionId =
    albumList.length > 0 &&
    (collectionId == null || !albumList.some((album) => album.collectionId === collectionId))
      ? albumList[0].collectionId
      : collectionId;

  const albumTracks = useQuery(
    api.catalog.tracksForAlbum,
    activeCollectionId == null ? "skip" : { collectionId: activeCollectionId },
  ) as Track[] | undefined;

  const searchTerm = search.trim();
  const deferredTerm = useDeferredValue(searchTerm);
  const searchResults = useQuery(
    api.catalog.searchTracks,
    deferredTerm.length > 0 ? { term: deferredTerm } : "skip",
  ) as Track[] | undefined;

  const likedResult = useQuery(
    api.catalog.tracksByIds,
    view === "liked" && favorites.length ? { trackIds: favorites.slice(0, 80) } : "skip",
  ) as Track[] | undefined;

  const liked = (likedResult ?? [])
    .slice()
    .sort((a, b) => favorites.indexOf(a.trackId) - favorites.indexOf(b.trackId));

  const pendingTrack = useRef<number | null>(null);
  const edge = useRef<"first" | "last" | null>(null);
  const playOnArrival = useRef(false);
  const history = useRef<Track[]>([]);
  const interacted = useRef(false);
  const didSync = useRef(false);
  const skipPersist = useRef(true);
  const errorSkips = useRef(0);
  const dragRef = useRef<{ id: number; x: number; y: number; locked: boolean } | null>(null);
  const playbackRef = useRef<ReturnType<typeof usePlayback> | null>(null);
  const stepRef = useRef<(direction: 1 | -1) => void>(() => {});
  const stateRef = useRef({
    current: null as Track | null,
    albumTracks: [] as Track[],
    liked: [] as Track[],
    albums: [] as Album[],
    collectionId: null as number | null,
    view: "album" as "album" | "liked" | "search",
    searchTracks: [] as Track[],
    shuffle: false,
    repeat: "off" as RepeatMode,
  });

  const palette =
    albumList.find((album) => album.collectionId === current?.collectionId) ??
    albumList.find((album) => album.collectionId === activeCollectionId) ??
    null;

  const mode = searchTerm.length > 0 ? "search" : view;
  const multiDisc = mode === "album" && (albumTracks ?? []).some((track) => track.discNumber > 1);
  const queue = mode === "search" ? (searchResults ?? []) : mode === "liked" ? liked : (albumTracks ?? []);

  useEffect(() => {
    stateRef.current = {
      current,
      albumTracks: albumTracks ?? [],
      liked,
      albums: albumList,
      collectionId: activeCollectionId,
      view: mode,
      searchTracks: searchResults ?? [],
      shuffle,
      repeat,
    };
  });

  const spotify = useSpotify({
    trackId: current?.trackId ?? null,
    title: current?.title ?? "",
    album: palette?.title ?? "",
    autoplay,
    volume,
    muted,
    repeat,
    onEnded: () => stepRef.current(1),
  });
  const preview = usePlayback({
    src: spotify.owns ? null : (current?.previewUrl ?? null),
    trackKey: current?.trackId ?? null,
    autoplay,
    volume,
    muted,
    repeat,
    onEnded: () => stepRef.current(1),
    onError: () => {
      if (spotify.owns || errorSkips.current >= 4) return;
      errorSkips.current += 1;
      stepRef.current(1);
    },
  });
  const playback = spotify.owns ? spotify : preview;

  function remember(track: Track | null) {
    if (!track) return;
    history.current.push(track);
    if (history.current.length > 60) history.current.shift();
  }

  function step(direction: 1 | -1) {
    const snapshot = stateRef.current;
    const source =
      snapshot.view === "liked"
        ? snapshot.liked
        : snapshot.view === "search"
          ? snapshot.searchTracks
          : snapshot.albumTracks;
    if (!snapshot.current || source.length === 0) return;
    interacted.current = true;

    if (direction === -1 && history.current.length > 0) {
      const previous = history.current.pop();
      if (previous) {
        setAutoplay(true);
        setCurrent(previous);
      }
      return;
    }

    if (snapshot.shuffle && direction === 1) {
      const pick = randomTrack(source, snapshot.current.trackId);
      remember(snapshot.current);
      setAutoplay(true);
      setCurrent(pick);
      return;
    }

    const index = source.findIndex((track) => track.trackId === snapshot.current?.trackId);
    const nextIndex = index + direction;
    if (nextIndex >= 0 && nextIndex < source.length) {
      if (direction === 1) remember(snapshot.current);
      setAutoplay(true);
      setCurrent(source[nextIndex]);
      return;
    }

    if (snapshot.view === "liked" || snapshot.view === "search") {
      if (snapshot.repeat === "all" && source.length > 0) {
        const wrapped = direction === 1 ? source[0] : source[source.length - 1];
        if (direction === 1) remember(snapshot.current);
        setAutoplay(true);
        setCurrent(wrapped);
      }
      return;
    }

    if (snapshot.albums.length === 0 || snapshot.collectionId == null) return;
    const albumIndex = snapshot.albums.findIndex(
      (album) => album.collectionId === snapshot.collectionId,
    );
    let nextAlbum = albumIndex + direction;
    if (nextAlbum < 0 || nextAlbum >= snapshot.albums.length) {
      if (snapshot.repeat !== "all") return;
      nextAlbum = direction === 1 ? 0 : snapshot.albums.length - 1;
    }
    if (direction === 1) remember(snapshot.current);
    edge.current = direction === 1 ? "first" : "last";
    playOnArrival.current = true;
    setAutoplay(true);
    setView("album");
    setCollectionId(snapshot.albums[nextAlbum].collectionId);
  }

  useEffect(() => {
    playbackRef.current = playback;
    stepRef.current = step;
  });

  function back() {
    interacted.current = true;
    if ((playbackRef.current?.getTime() ?? 0) > 3) {
      playbackRef.current?.seek(0);
      return;
    }
    step(-1);
  }

  function chooseAlbum(id: number) {
    interacted.current = true;
    setView("album");
    setAutoplay(true);
    if (id === activeCollectionId && albumTracks && albumTracks.length > 0) {
      remember(current);
      setCurrent(albumTracks[0]);
      return;
    }
    remember(current);
    edge.current = "first";
    playOnArrival.current = true;
    setCollectionId(id);
  }

  function chooseTrack(track: Track) {
    interacted.current = true;
    if (current && current.trackId !== track.trackId) remember(current);
    setAutoplay(true);
    setCollectionId(track.collectionId);
    setCurrent(track);
  }

  function cycleRepeat() {
    setRepeat((mode) => (mode === "off" ? "all" : mode === "all" ? "one" : "off"));
  }

  function onFavorite(trackId: number) {
    setFavorites((currentFavorites) =>
      currentFavorites.includes(trackId)
        ? currentFavorites.filter((id) => id !== trackId)
        : [trackId, ...currentFavorites],
    );
    if (isAuthenticated) void toggleFavoriteMutation({ trackId });
  }

  useEffect(() => {
    const saved = readPersisted();
    if (!saved) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setVolume(saved.volume ?? 0.9);
    setMuted(saved.muted ?? false);
    setShuffle(saved.shuffle ?? false);
    setRepeat(saved.repeat ?? "off");
    setFavorites(saved.favorites ?? []);
    if (saved.collectionId) setCollectionId(saved.collectionId);
    /* eslint-enable react-hooks/set-state-in-effect */
    pendingTrack.current = saved.trackId;
  }, []);

  useEffect(() => {
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    writePersisted({
      collectionId: activeCollectionId,
      trackId: current?.trackId ?? null,
      volume,
      muted,
      shuffle,
      repeat,
      favorites,
      savedAt: Date.now(),
    });
  }, [activeCollectionId, current?.trackId, favorites, muted, repeat, shuffle, volume]);

  useEffect(() => {
    if (!albumTracks?.length || activeCollectionId == null) return;
    if (albumTracks[0].collectionId !== activeCollectionId) return;
    const wanted = pendingTrack.current;
    const end = edge.current;
    if (current != null && wanted == null && !end) return;
    pendingTrack.current = null;
    edge.current = null;
    let index = 0;
    if (end === "last") index = albumTracks.length - 1;
    else if (wanted != null) {
      const found = albumTracks.findIndex((track) => track.trackId === wanted);
      if (found >= 0) index = found;
    }
    if (playOnArrival.current) setAutoplay(true);
    playOnArrival.current = false;
    setCurrent(albumTracks[index]);
  }, [albumTracks, activeCollectionId, current]);

  useEffect(() => {
    if (!isAuthenticated || server === undefined || server === null || didSync.current) return;
    didSync.current = true;
    const remoteIds = server.favoriteTrackIds;
    /* eslint-disable react-hooks/set-state-in-effect */
    setFavorites((local) => {
      const merged = Array.from(new Set([...remoteIds, ...local]));
      for (const trackId of merged) {
        if (!remoteIds.includes(trackId)) void ensureFavorite({ trackId });
      }
      return merged;
    });
    const remote = server.playback;
    const saved = readPersisted();
    if (!remote || interacted.current) return;
    if (saved && saved.savedAt > remote.updatedAt) return;
    setVolume(remote.volume);
    setMuted(remote.muted);
    setShuffle(remote.shuffle);
    setRepeat(remote.repeat);
    pendingTrack.current = remote.trackId;
    setCollectionId(remote.collectionId);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [ensureFavorite, isAuthenticated, server]);

  useEffect(() => {
    if (!isAuthenticated || !current || collectionId == null) return;
    const timer = window.setTimeout(() => {
      void savePlayback({
        collectionId: current.collectionId,
        trackId: current.trackId,
        volume,
        muted,
        shuffle,
        repeat,
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [collectionId, current, isAuthenticated, muted, repeat, savePlayback, shuffle, volume]);

  useEffect(() => {
    if (playback.playing) errorSkips.current = 0;
  }, [playback.playing]);

  useEffect(() => {
    if (!current) return;
    const row = document.getElementById(`track-${current.trackId}`);
    const scroller = row?.closest(".queue");
    if (!row || !(scroller instanceof HTMLElement)) return;
    if (scroller.scrollHeight <= scroller.clientHeight + 8) return;
    const rowRect = row.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    if (rowRect.top < box.top) scroller.scrollTop -= box.top - rowRect.top;
    else if (rowRect.bottom > box.bottom) scroller.scrollTop += rowRect.bottom - box.bottom;
  }, [current, view]);

  useEffect(() => {
    if (!palette) return;
    document.documentElement.style.background = palette.secondary;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", palette.secondary);
  }, [palette]);

  useEffect(() => {
    if (!current || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: palette?.credit ?? artist?.name ?? "Kanye West",
      album: palette?.title ?? "",
      artwork: palette?.artworkUrl
        ? [{ src: palette.artworkUrl, sizes: "512x512", type: "image/jpeg" }]
        : [],
    });
    const bind = (action: MediaSessionAction, handler: () => void) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        return;
      }
    };
    bind("play", () => playbackRef.current?.play());
    bind("pause", () => playbackRef.current?.pause());
    bind("nexttrack", () => stepRef.current(1));
    bind("previoustrack", () => {
      if ((playbackRef.current?.getTime() ?? 0) > 3) playbackRef.current?.seek(0);
      else stepRef.current(-1);
    });
  }, [artist?.name, current, palette?.artworkUrl, palette?.credit, palette?.title]);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js");
    }
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("input, textarea")) return;
      if (event.code === "Space" && target.closest("button, a")) return;
      if (event.code === "Space") {
        event.preventDefault();
        interacted.current = true;
        setAutoplay(true);
        playbackRef.current?.toggle();
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        stepRef.current(1);
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        if ((playbackRef.current?.getTime() ?? 0) > 3) playbackRef.current?.seek(0);
        else stepRef.current(-1);
      } else if (event.code === "ArrowUp") {
        event.preventDefault();
        setMuted(false);
        setVolume((value) => Math.min(1, value + 0.05));
      } else if (event.code === "ArrowDown") {
        event.preventDefault();
        setVolume((value) => {
          const next = Math.max(0, value - 0.05);
          if (next === 0) setMuted(true);
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const years = albumList.length
    ? `${albumList[0].year} — ${albumList[albumList.length - 1].year}`
    : "Kanye West";
  const shownVolume = muted ? 0 : volume;
  const seekMax = playback.duration || 30;
  const repeatLabel =
    repeat === "one" ? "Repeat one preview" : repeat === "all" ? "Repeat all" : "Repeat off";

  return (
    <div
      className="shell"
      style={{
        ["--wash" as string]: palette?.primary ?? "#d4b15a",
        ["--bg" as string]: palette?.secondary ?? "#090909",
        ["--ink" as string]: palette?.ink ?? "#f6f1e8",
      }}
    >
      <header className="topbar">
        <div className="brand">
          meh
          <small>kanye west</small>
        </div>
        <div className="artist">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/portrait.jpg"
            alt="Kanye West"
            title="Kanye West. Photo: David Shankbone, CC BY 3.0"
          />
          <div className="artist-copy">
            <strong>{artist?.name ?? "Kanye West"}</strong>
            <span>{years}</span>
          </div>
        </div>
        <div className="actions">
          {installPrompt ? (
            <button
              className="ghost-btn"
              type="button"
              onClick={() => {
                void installPrompt.prompt();
                setInstallPrompt(null);
              }}
            >
              Install
            </button>
          ) : null}
          <SpotifyMenu
            connected={spotify.connected}
            status={spotify.status}
            onDisconnect={spotify.disconnect}
            onOpen={() => void spotify.openExternal()}
          />
          <Suspense fallback={<span className="auth-slot" />}>
            <AuthMenu />
          </Suspense>
        </div>
      </header>

      <div className="stage">
        <aside className="rail" aria-label="Albums">
          <p className="rail-label">Albums</p>
          {(albums === undefined ? [] : albumList).map((album) => (
            <button
              className={buildClasses(
                "album",
                album.collectionId === (current?.collectionId ?? activeCollectionId) && "is-active",
              )}
              key={album.collectionId}
              type="button"
              onClick={() => chooseAlbum(album.collectionId)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={album.artworkUrl} alt="" />
              <span className="album-copy">
                <strong>{album.title}</strong>
                <em>{album.year}</em>
              </span>
            </button>
          ))}
          {artist?.imageCredit ? <p className="portrait-credit">Portrait: {artist.imageCredit}</p> : null}
        </aside>

        <section className="deck">
          {albums === undefined ? (
            <div className="skeleton" />
          ) : albums.length === 0 ? (
            <div className="empty">
              <h1>meh</h1>
              <p>The shelf is still syncing.</p>
            </div>
          ) : current && palette ? (
            <>
              <div
                className={buildClasses("art-frame", drag !== 0 && "is-dragging")}
                onPointerDown={(event) => {
                  dragRef.current = {
                    id: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    locked: false,
                  };
                }}
                onPointerMove={(event) => {
                  const gesture = dragRef.current;
                  if (!gesture || gesture.id !== event.pointerId) return;
                  const dx = event.clientX - gesture.x;
                  const dy = event.clientY - gesture.y;
                  if (!gesture.locked) {
                    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                    if (Math.abs(dy) > Math.abs(dx)) {
                      dragRef.current = null;
                      return;
                    }
                    gesture.locked = true;
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }
                  setDrag(dx);
                }}
                onPointerUp={(event) => {
                  const gesture = dragRef.current;
                  if (!gesture || gesture.id !== event.pointerId) return;
                  const dx = event.clientX - gesture.x;
                  const dy = event.clientY - gesture.y;
                  dragRef.current = null;
                  setDrag(0);
                  if (!gesture.locked) {
                    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
                      interacted.current = true;
                      setAutoplay(true);
                      playback.toggle();
                    }
                    return;
                  }
                  setHint(false);
                  if (dx <= -64) step(1);
                  else if (dx >= 64) back();
                }}
                onPointerCancel={() => {
                  dragRef.current = null;
                  setDrag(0);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={palette.artworkUrl}
                  alt={`${palette.title} cover`}
                  draggable={false}
                  style={{ transform: `translate3d(${drag}px, 0, 0) rotate(${drag / 30}deg)` }}
                />
              </div>
              {hint ? <p className="swipe-hint">Swipe the cover for the next song</p> : null}
              <div className="meta">
                <p className="kicker">
                  <span>{palette.title}</span>
                  <i>{formatRelease(palette.releaseDate)}</i>
                </p>
                <h1 className="track-title">{current.title}</h1>
                <p className="credit">
                  {palette.credit}
                  {current.explicit ? <em className="explicit">E</em> : null}
                </p>
              </div>
              <div className="transport">
                <input
                  className="seek"
                  type="range"
                  min={0}
                  max={seekMax}
                  step={0.1}
                  value={Math.min(playback.time, seekMax)}
                  aria-label="Preview position"
                  style={{
                    background: `linear-gradient(to right, var(--ink) ${(playback.time / seekMax) * 100}%, color-mix(in srgb, var(--ink) 22%, transparent) ${(playback.time / seekMax) * 100}%)`,
                  }}
                  onChange={(event) => playback.seek(Number(event.target.value))}
                />
                <div className="times">
                  <span>{formatClock(playback.time)}</span>
                  <span>{spotify.owns ? "Spotify" : "Preview"}</span>
                  <span>{formatClock(seekMax)}</span>
                </div>
                <div className="controls">
                  <button
                    className={buildClasses("icon-btn", shuffle && "is-on")}
                    type="button"
                    aria-pressed={shuffle}
                    aria-label={shuffle ? "Shuffle on" : "Shuffle off"}
                    onClick={() => setShuffle((value) => !value)}
                  >
                    <ShuffleIcon />
                  </button>
                  <button className="icon-btn" type="button" aria-label="Previous" onClick={back}>
                    <SkipIcon direction="back" />
                  </button>
                  <button
                    className="play"
                    type="button"
                    aria-label={playback.playing ? "Pause" : "Play"}
                    onClick={() => {
                      interacted.current = true;
                      setAutoplay(true);
                      playback.toggle();
                    }}
                  >
                    {playback.playing ? <PauseIcon /> : <PlayIcon />}
                  </button>
                  <button className="icon-btn" type="button" aria-label="Next" onClick={() => step(1)}>
                    <SkipIcon direction="forward" />
                  </button>
                  <button
                    className={buildClasses("icon-btn", repeat !== "off" && "is-on")}
                    type="button"
                    aria-label={repeatLabel}
                    onClick={cycleRepeat}
                  >
                    <RepeatIcon mode={repeat} />
                  </button>
                </div>
                <div className="volume">
                  <button
                    className="icon-btn"
                    type="button"
                    aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
                    onClick={() => setMuted((value) => !value)}
                  >
                    <VolumeIcon level={shownVolume} />
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={shownVolume}
                    aria-label="Volume"
                    style={{
                      background: `linear-gradient(to right, var(--ink) ${shownVolume * 100}%, color-mix(in srgb, var(--ink) 22%, transparent) ${shownVolume * 100}%)`,
                    }}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setVolume(next);
                      setMuted(next === 0);
                    }}
                  />
                </div>
                {spotify.notice ? <p className="fine">{spotify.notice}</p> : null}
                {!spotify.notice && playback.failed ? (
                  <p className="fine">That preview didn’t load. Skipping ahead.</p>
                ) : null}
                {!spotify.notice && !playback.failed && iosHint ? (
                  <p className="fine">On iPhone, Share, then Add to Home Screen.</p>
                ) : null}
                {!spotify.notice && !playback.failed && !iosHint ? (
                  <p className="fine">30-second Apple preview. Connect Spotify to play the full song.</p>
                ) : null}
              </div>
            </>
          ) : (
            <div className="skeleton" />
          )}
        </section>

        <aside className="queue">
          <form
            className="search"
            role="search"
            onSubmit={(event) => event.preventDefault()}
          >
            <input
              type="search"
              value={search}
              placeholder="Search every album"
              aria-label="Search songs"
              onChange={(event) => setSearch(event.target.value)}
            />
            {search ? (
              <button className="search-clear" type="button" aria-label="Clear search" onClick={() => setSearch("")}>
                ×
              </button>
            ) : null}
          </form>
          <div className="queue-head">
            <button
              className={buildClasses("tab", mode === "album" && "is-on")}
              type="button"
              onClick={() => {
                setSearch("");
                setView("album");
                if (current) setCollectionId(current.collectionId);
              }}
            >
              {palette?.title ?? "Album"}
            </button>
            <button
              className={buildClasses("tab", mode === "liked" && "is-on")}
              type="button"
              onClick={() => {
                setSearch("");
                setView("liked");
              }}
            >
              Liked
            </button>
          </div>
          <div className="queue-list">
            {mode === "liked" && favorites.length === 0 ? (
              <p className="empty-copy">Hearts stay on this device until you sign in.</p>
            ) : null}
            {mode === "search" && searchResults === undefined ? (
              <p className="empty-copy">Searching…</p>
            ) : null}
            {mode === "search" && searchResults && searchResults.length === 0 ? (
              <p className="empty-copy">No songs match.</p>
            ) : null}
            {queue.map((track) => {
              const active = track.trackId === current?.trackId;
              const number = multiDisc ? `${track.discNumber}.${track.trackNumber}` : track.trackNumber;
              return (
                <div className={buildClasses("track", active && "is-active")} key={track.trackId}>
                  <button
                    id={`track-${track.trackId}`}
                    type="button"
                    onClick={() => chooseTrack(track)}
                  >
                    <span>{active && playback.playing ? <Bars /> : mode === "search" ? "" : number}</span>
                    <strong>
                      {track.title}
                      {mode === "search" && track.albumTitle ? <small>{track.albumTitle}</small> : null}
                    </strong>
                    <em>{formatClock(track.durationMs / 1000)}</em>
                  </button>
                  <button
                    className={buildClasses("heart", favorites.includes(track.trackId) && "is-on")}
                    type="button"
                    aria-label={favorites.includes(track.trackId) ? "Remove like" : "Like"}
                    aria-pressed={favorites.includes(track.trackId)}
                    onClick={() => onFavorite(track.trackId)}
                  >
                    <HeartIcon filled={favorites.includes(track.trackId)} />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 5h3.5v14H7V5Zm6.5 0H17v14h-3.5V5Z" fill="currentColor" />
    </svg>
  );
}

function SkipIcon({ direction }: { direction: "back" | "forward" }) {
  const path =
    direction === "forward"
      ? "M5 5v14l11-7L5 5Zm12 0h2.5v14H17V5Z"
      : "M19 5 8 12 19 19V5ZM4.5 5H7v14H4.5V5Z";
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

function ShuffleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 7h4.5l3.2 4M21 7h-4.2M17.5 4.5 21 7l-3.5 2.5M3 17h4.5l8.3-10H21M17.5 19.5 21 17l-3.5-2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RepeatIcon({ mode }: { mode: RepeatMode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M17 3 21 6.5 17 10M4 11V9.5A3.5 3.5 0 0 1 7.5 6H21M7 21 3 17.5 7 14M20 13v1.5A3.5 3.5 0 0 1 16.5 18H3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {mode === "one" ? (
        <text x="12" y="14.5" textAnchor="middle" fontSize="7" fill="currentColor" fontFamily="sans-serif">
          1
        </text>
      ) : null}
    </svg>
  );
}

function VolumeIcon({ level }: { level: number }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9h3.5L12 5.5v13L7.5 15H4V9Z" fill="currentColor" />
      {level === 0 ? (
        <path d="m15 10 4 4m0-4-4 4" stroke="currentColor" strokeWidth="1.6" />
      ) : (
        <path
          d={level < 0.45 ? "M15 9.5a3.5 3.5 0 0 1 0 5" : "M15 8a6 6 0 0 1 0 8M17.5 5.5a9 9 0 0 1 0 13"}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 19s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function Bars() {
  return (
    <span className="bars" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
