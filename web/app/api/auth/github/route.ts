import { redirect } from "next/navigation";

export async function GET() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) return new Response("GitHub OAuth not configured", { status: 500 });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${process.env.SERVER_URL || process.env.NEXT_PUBLIC_URL || "http://localhost:3000"}/api/auth/callback`,
    scope: "user:email",
    state: crypto.randomUUID(),
  });

  redirect(`https://github.com/login/oauth/authorize?${params}`);
}
