import jwt from "jsonwebtoken";

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

export function createDeveloperToken(): string {
  const now = Math.floor(Date.now() / 1000);

  // Return cached token if still valid (with 5 min buffer)
  if (cachedToken && tokenExpiry > now + 300) {
    return cachedToken;
  }

  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const privateKey = process.env.APPLE_PRIVATE_KEY;

  if (!teamId || !keyId || !privateKey) {
    throw new Error(
      "Missing Apple Music credentials. Set APPLE_TEAM_ID, APPLE_KEY_ID, and APPLE_PRIVATE_KEY."
    );
  }

  // The private key from .env has literal \n – replace with real newlines
  const key = privateKey.replace(/\\n/g, "\n");

  const exp = now + 15777000; // ~6 months

  cachedToken = jwt.sign({}, key, {
    algorithm: "ES256",
    expiresIn: "180d",
    issuer: teamId,
    header: {
      alg: "ES256",
      kid: keyId,
    },
  });

  tokenExpiry = exp;
  return cachedToken;
}
