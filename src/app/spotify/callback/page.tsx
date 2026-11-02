"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { finishSpotifyLogin } from "@/lib/spotify";

function SpotifyCallback() {
  const params = useSearchParams();
  const error = params.get("error");
  const code = params.get("code");
  const state = params.get("state");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (error || !code || !state) return;
    void finishSpotifyLogin(code, state)
      .then(() => {
        window.location.replace("/");
      })
      .catch(() => setFailed(true));
  }, [code, error, state]);

  const message = error
    ? "Spotify cancelled the login."
    : !code || !state
      ? "Spotify didn’t return a login code."
      : failed
        ? "Spotify didn’t accept the login. Check the Client ID and redirect URI."
        : "Connecting Spotify…";

  return <p>{message}</p>;
}

export default function SpotifyCallbackPage() {
  return (
    <div className="auth-screen">
      <Suspense fallback={<p>Connecting Spotify…</p>}>
        <SpotifyCallback />
      </Suspense>
    </div>
  );
}
