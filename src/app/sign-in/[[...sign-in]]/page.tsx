import { SignIn } from "@clerk/nextjs";

// Minimal sign-in page. Authentication UI and OTP flows are Clerk-owned;
// the application never implements custom auth screens or OTP handling.
export default function SignInPage() {
  return (
    <main>
      <SignIn />
    </main>
  );
}
