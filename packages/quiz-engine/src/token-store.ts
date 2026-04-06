/**
 * Persists the Apple Music User Token to disk so it survives deploys.
 * Uses a Fly.io volume mounted at /data in production, or a local file in dev.
 */

import fs from "node:fs";
import path from "node:path";

function getTokenPath(): string {
  return process.env.TOKEN_FILE || "/data/music-user-token.json";
}

interface TokenData {
  token: string;
  savedAt: string;
}

export function loadMusicUserToken(): string | null {
  try {
    const raw = fs.readFileSync(getTokenPath(), "utf-8");
    const data: TokenData = JSON.parse(raw);
    if (data.token) {
      console.log(`🔑 Loaded Music User Token from disk (saved ${data.savedAt})`);
      return data.token;
    }
  } catch {
    // File doesn't exist or is invalid — that's fine
  }
  return null;
}

export function saveMusicUserToken(token: string): void {
  const data: TokenData = {
    token,
    savedAt: new Date().toISOString(),
  };
  try {
    const dir = path.dirname(getTokenPath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = getTokenPath() + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, getTokenPath());
    console.log("🔑 Music User Token saved to disk");
  } catch (err) {
    console.error("🔑 Failed to save Music User Token:", err);
  }
}
