import { NextRequest, NextResponse } from "next/server";
import { getSession, ALLOWED_EMAIL } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });

  // Exchange code for access token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    return NextResponse.json({ error: "Failed to get token" }, { status: 401 });
  }

  // Get user info + emails
  const [userRes, emailsRes] = await Promise.all([
    fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    }),
    fetch("https://api.github.com/user/emails", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    }),
  ]);

  const user = await userRes.json();
  const emails: Array<{ email: string; primary: boolean }> = await emailsRes.json();
  const primaryEmail = emails.find((e) => e.primary)?.email || emails[0]?.email;

  if (!primaryEmail || primaryEmail.toLowerCase() !== ALLOWED_EMAIL.toLowerCase()) {
    return NextResponse.redirect(new URL("/login?error=unauthorized", req.url));
  }

  // Create session
  const session = await getSession();
  session.email = primaryEmail;
  session.name = user.name || user.login;
  session.avatarUrl = user.avatar_url;
  session.isLoggedIn = true;
  await session.save();

  return NextResponse.redirect(new URL("/", req.url));
}
