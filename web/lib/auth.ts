import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  email?: string;
  name?: string;
  avatarUrl?: string;
  isLoggedIn: boolean;
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET || "dev-secret-must-be-at-least-32-chars-long!!",
  cookieName: "music-session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
  },
};

export const ALLOWED_EMAIL = process.env.GITHUB_ALLOWED_EMAIL || "cb@webhouse.dk";

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}
