"use client";

import { useState } from "react";
import { beginSpotifyLogin, saveSpotifyClientId, SPOTIFY_REDIRECTS, spotifyClientId } from "@/lib/spotify";
import type { SpotifyStatus } from "./useSpotify";

export function SpotifyMenu({
  connected,
  status,
  onDisconnect,
  onOpen,
}: {
  connected: boolean;
  status: SpotifyStatus;
  onDisconnect: () => void;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");

  return (
    <div className="spotify">
      <button
        className={connected ? "ghost-btn spotify-btn is-on" : "ghost-btn spotify-btn"}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Spotify
      </button>
      {open ? (
        <div className="spotify-panel">
          {connected ? (
            <>
              <p>
                {status === "premium"
                  ? "This Spotify account isn’t Premium, so the page can’t play the full song."
                  : "Full songs play from the Spotify account you just connected."}
              </p>
              {status === "unsupported" ? (
                <button className="ghost-btn" type="button" onClick={onOpen}>
                  Open in Spotify
                </button>
              ) : null}
              <button className="ghost-btn" type="button" onClick={onDisconnect}>
                Disconnect
              </button>
            </>
          ) : (
            <>
              <p>Create an app at the Spotify developer dashboard, then paste its Client ID.</p>
              <p>Add both redirect URIs, and add your account under User Management.</p>
              <ul>
                {SPOTIFY_REDIRECTS.map((uri) => (
                  <li key={uri}>{uri}</li>
                ))}
              </ul>
              <input
                value={clientId}
                placeholder="Client ID"
                aria-label="Spotify Client ID"
                onChange={(event) => setClientId(event.target.value)}
              />
              <button
                className="ghost-btn"
                type="button"
                onClick={() => {
                  const next = clientId.trim() || spotifyClientId();
                  if (!next) return;
                  saveSpotifyClientId(next);
                  void beginSpotifyLogin(next);
                }}
              >
                Connect
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
