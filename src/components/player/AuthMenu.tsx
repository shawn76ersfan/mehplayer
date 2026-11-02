"use client";

import { Show, SignInButton, UserButton } from "@clerk/nextjs";

export function AuthMenu() {
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className="ghost-btn" type="button">
            Sign in
          </button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </>
  );
}
