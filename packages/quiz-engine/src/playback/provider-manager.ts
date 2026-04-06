/**
 * Playback Provider Manager
 *
 * Manages the active playback provider and fallback chain.
 * The quiz engine calls this instead of sendHomeCommand directly.
 */

import type { PlaybackProvider } from "./types.js";
import { HomeControllerProvider } from "./home-controller.js";
import { MusicKitWebProvider } from "./musickit-web.js";

export type ProviderType = "musickit-web" | "home-controller" | "preview";

// Singleton instances
const homeController = new HomeControllerProvider();
const musickitWeb = new MusicKitWebProvider();

const providers: Record<string, PlaybackProvider> = {
  "home-controller": homeController,
  "musickit-web": musickitWeb,
};

let activeProviderType: ProviderType = "home-controller";

/** Set the active provider type */
export function setActiveProvider(type: ProviderType): void {
  activeProviderType = type;
  console.log(`🎵 Active playback provider: ${type}`);
}

/** Get the active provider type */
export function getActiveProviderType(): ProviderType {
  return activeProviderType;
}

/**
 * Get the best available provider.
 * Falls back through the chain: active → home-controller → null
 */
export function getProvider(): PlaybackProvider {
  // Try active provider first
  const active = providers[activeProviderType];
  if (active?.isAvailable()) return active;

  // Fallback to home controller
  if (activeProviderType !== "home-controller" && homeController.isAvailable()) {
    console.log(`🎵 Fallback: ${activeProviderType} unavailable, using home-controller`);
    return homeController;
  }

  // Return active provider even if unavailable (methods will no-op)
  return active || homeController;
}

/** Get the MusicKit Web provider instance (for setting up WS bridge) */
export function getMusicKitWebProvider(): MusicKitWebProvider {
  return musickitWeb;
}

/** Get the Home Controller provider instance */
export function getHomeControllerProvider(): HomeControllerProvider {
  return homeController;
}
