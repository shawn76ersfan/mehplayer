import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";

export default function SignInPage() {
  return (
    <div className="auth-screen">
      <Suspense>
        <SignIn />
      </Suspense>
    </div>
  );
}
