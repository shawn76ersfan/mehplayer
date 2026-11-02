export type RepeatMode = "off" | "all" | "one";

export type Persisted = {
  collectionId: number | null;
  trackId: number | null;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  favorites: number[];
  savedAt: number;
};

const KEY = "meh-player";

export function readPersisted(): Persisted | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Persisted;
  } catch {
    return null;
  }
}

export function writePersisted(value: Persisted) {
  localStorage.setItem(KEY, JSON.stringify(value));
}
