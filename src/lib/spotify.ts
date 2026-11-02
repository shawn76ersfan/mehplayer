const CLIENT_KEY = "meh-spotify-client";
const TOKEN_KEY = "meh-spotify-tokens";
const VERIFIER_KEY = "meh-spotify-verifier";
const STATE_KEY = "meh-spotify-state";

const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-modify-playback-state",
  "user-read-playback-state",
].join(" ");

export const SPOTIFY_REDIRECTS = [
  "http://localhost:3000/spotify/callback",
  "https://mehplayer.vercel.app/spotify/callback",
];

type Tokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type SpotifyTrack = {
  uri: string;
  name: string;
  album: { name: string };
  artists: Array<{ name: string }>;
};

const found = new Map<number, string | null>();

export function spotifyClientId() {
  if (typeof window === "undefined") return process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID ?? "";
  return localStorage.getItem(CLIENT_KEY) || process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID || "";
}

export function saveSpotifyClientId(clientId: string) {
  localStorage.setItem(CLIENT_KEY, clientId.trim());
}

export function spotifyRedirectUri() {
  return `${window.location.origin}/spotify/callback`;
}

export function hasSpotifySession() {
  return Boolean(readTokens()?.refreshToken);
}

export function clearSpotifySession() {
  localStorage.removeItem(TOKEN_KEY);
  found.clear();
}

function readTokens(): Tokens | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Tokens;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeTokens(tokens: Tokens) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

function randomUrlSafe(bytes: number) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let text = "";
  for (const value of buffer) text += String.fromCharCode(value);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function codeChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let text = "";
  for (const value of new Uint8Array(digest)) text += String.fromCharCode(value);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function beginSpotifyLogin(clientId: string) {
  const verifier = randomUrlSafe(64);
  const state = randomUrlSafe(16);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("redirect_uri", spotifyRedirectUri());
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", await codeChallenge(verifier));
  window.location.assign(url.toString());
}

export async function finishSpotifyLogin(code: string, state: string) {
  const expected = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  if (!verifier || !expected || expected !== state) {
    throw new Error("Spotify sent back a login this page didn’t start.");
  }
  const clientId = spotifyClientId();
  if (!clientId) throw new Error("The Spotify Client ID is missing.");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: spotifyRedirectUri(),
    client_id: clientId,
    code_verifier: verifier,
  });
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error("Spotify didn’t accept the login.");
  const json = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  writeTokens({
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  });
}

export async function spotifyAccessToken() {
  const tokens = readTokens();
  const clientId = spotifyClientId();
  if (!tokens || !clientId) return null;
  if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: clientId,
    }),
  });
  if (!response.ok) {
    clearSpotifySession();
    return null;
  }
  const json = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  const next = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  writeTokens(next);
  return next.accessToken;
}

function cleanTitle(title: string) {
  return title
    .replace(/\s*[([{]feat\.[^)\]]*[)\]}]/gi, "")
    .replace(/\s+feat\..*$/i, "")
    .trim();
}

function compact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function search(token: string, query: string) {
  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", "6");
  url.searchParams.set("q", query);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) return [];
  const json = (await response.json()) as { tracks?: { items?: SpotifyTrack[] } };
  return json.tracks?.items ?? [];
}

export async function findSpotifyTrack(trackId: number, title: string, album: string) {
  if (found.has(trackId)) return found.get(trackId) ?? null;
  const token = await spotifyAccessToken();
  if (!token) return null;
  const name = cleanTitle(title);
  const albumQuery = `track:"${name}" album:"${album}"`;
  let items = await search(token, albumQuery);
  if (items.length === 0) items = await search(token, `track:"${name}" artist:Kanye`);
  const albumKey = compact(album);
  const ranked = items
    .map((item) => {
      const albumName = compact(item.album.name);
      const artists = item.artists.map((artist) => compact(artist.name)).join(" ");
      let score = 0;
      if (albumName === albumKey) score += 4;
      else if (albumName.includes(albumKey) || albumKey.includes(albumName)) score += 2;
      if (artists.includes("kanye") || artists.includes("ye")) score += 2;
      if (compact(item.name) === compact(name)) score += 2;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score);
  const uri = ranked[0]?.score ? ranked[0].item.uri : null;
  found.set(trackId, uri);
  return uri;
}

export async function playSpotifyUri(uri: string, deviceId: string) {
  const token = await spotifyAccessToken();
  if (!token) return "auth" as const;
  const response = await fetch(
    `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uris: [uri] }),
    },
  );
  if (response.ok || response.status === 204) return "ok" as const;
  const json = (await response.json().catch(() => null)) as { error?: { reason?: string } } | null;
  if (json?.error?.reason === "PREMIUM_REQUIRED") return "premium" as const;
  return "error" as const;
}

export function spotifyOpenUrl(uri: string) {
  const id = uri.split(":").pop();
  return id ? `https://open.spotify.com/track/${id}` : "https://open.spotify.com";
}

export function browserCanPlaySpotify() {
  return !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}
