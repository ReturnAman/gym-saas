import { requireCurrentUser } from "@/lib/server/auth";

// Minimal protected application page.
//
// Authentication is enforced server-side: requireCurrentUser() redirects
// unauthenticated visitors to /sign-in before any application data is read
// or rendered. No client-side auth state is trusted.
export default async function AppPage() {
  const user = await requireCurrentUser();

  return (
    <main>
      <h1>Signed in</h1>
      <p>Application user ID: {user.id}</p>
    </main>
  );
}
