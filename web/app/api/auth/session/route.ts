import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  return Response.json({
    isLoggedIn: session.isLoggedIn || false,
    name: session.name,
    avatarUrl: session.avatarUrl,
  });
}
