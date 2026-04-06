/** Runtime mute flag — overrides env var MUTE_ALL when set via API */
let runtimeMuted: boolean | null = null;

export function isMuted(): boolean {
  if (runtimeMuted !== null) return runtimeMuted;
  return process.env.MUTE_ALL === "true";
}

export function setMuted(value: boolean): void {
  runtimeMuted = value;
  console.log(`🔇 Runtime mute: ${value ? "ON" : "OFF"}`);
}
