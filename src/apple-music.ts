import { createDeveloperToken } from "./token.js";

const BASE = "https://api.music.apple.com/v1";

interface ArtistResult {
  id: string;
  attributes: { name: string; genreNames?: string[] };
}

interface AlbumResult {
  id: string;
  attributes: {
    name: string;
    artistName: string;
    releaseDate?: string;
    trackCount?: number;
  };
}

interface SongResult {
  id: string;
  attributes: {
    name: string;
    artistName: string;
    albumName: string;
    durationInMillis: number;
    releaseDate?: string;
    trackNumber?: number;
    discNumber?: number;
    url?: string;
  };
}

export class AppleMusicClient {
  private storefront: string;
  private getUserToken: () => string | null;

  constructor(
    storefront: string = "dk",
    getUserToken: () => string | null
  ) {
    this.storefront = storefront;
    this.getUserToken = getUserToken;
  }

  private async request(path: string, options: {
    method?: string;
    body?: unknown;
    requireUserToken?: boolean;
  } = {}): Promise<unknown> {
    const devToken = createDeveloperToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${devToken}`,
      "Content-Type": "application/json",
    };

    if (options.requireUserToken) {
      const userToken = this.getUserToken();
      if (!userToken) {
        throw new Error(
          "Music User Token required. Please authorize at /auth first."
        );
      }
      headers["Music-User-Token"] = userToken;
    }

    const res = await fetch(`${BASE}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Apple Music API ${res.status}: ${text}`);
    }

    if (res.status === 204) return {};
    return res.json();
  }

  // ─── Catalog Search ──────────────────────────────────────

  async searchCatalog(
    term: string,
    types: string[] = ["songs", "artists", "albums"],
    limit: number = 10
  ): Promise<unknown> {
    const params = new URLSearchParams({
      term,
      types: types.join(","),
      limit: String(limit),
    });
    return this.request(
      `/catalog/${this.storefront}/search?${params}`
    );
  }

  // ─── Get Artist ──────────────────────────────────────────

  async getArtist(artistId: string): Promise<ArtistResult> {
    const data = await this.request(
      `/catalog/${this.storefront}/artists/${artistId}`
    ) as { data: ArtistResult[] };
    return data.data[0];
  }

  // ─── Get Artist Albums (paginated) ───────────────────────

  async getArtistAlbums(
    artistId: string,
    limit: number = 100
  ): Promise<AlbumResult[]> {
    const albums: AlbumResult[] = [];
    let url: string | null =
      `/catalog/${this.storefront}/artists/${artistId}/albums?limit=${Math.min(limit, 25)}`;

    while (url && albums.length < limit) {
      const data = (await this.request(url)) as {
        data: AlbumResult[];
        next?: string;
      };
      albums.push(...data.data);
      url = data.next || null;
    }

    return albums;
  }

  // ─── Get Album Tracks ────────────────────────────────────

  async getAlbumTracks(albumId: string): Promise<SongResult[]> {
    const songs: SongResult[] = [];
    let url: string | null =
      `/catalog/${this.storefront}/albums/${albumId}/tracks?limit=100`;

    while (url) {
      const data = (await this.request(url)) as {
        data: SongResult[];
        next?: string;
      };
      songs.push(...data.data);
      url = data.next || null;
    }

    return songs;
  }

  // ─── Get ALL songs by an artist ──────────────────────────

  async getArtistAllSongs(artistId: string): Promise<SongResult[]> {
    const albums = await this.getArtistAlbums(artistId, 200);
    const allSongs: SongResult[] = [];

    for (const album of albums) {
      try {
        const tracks = await this.getAlbumTracks(album.id);
        allSongs.push(...tracks);
      } catch (err) {
        console.error(`Failed to get tracks for album ${album.attributes.name}:`, err);
      }
    }

    // Deduplicate by song name + duration (catches reissues)
    const seen = new Set<string>();
    return allSongs.filter((song) => {
      const key = `${song.attributes.name.toLowerCase()}|${song.attributes.durationInMillis}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ─── Create Playlist ─────────────────────────────────────

  async createPlaylist(
    name: string,
    description: string,
    trackIds: string[]
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      attributes: {
        name,
        description,
      },
    };

    if (trackIds.length > 0) {
      body.relationships = {
        tracks: {
          data: trackIds.map((id) => ({ id, type: "songs" })),
        },
      };
    }

    return this.request("/me/library/playlists", {
      method: "POST",
      body,
      requireUserToken: true,
    });
  }

  // ─── Add Tracks to Playlist ──────────────────────────────

  async addTracksToPlaylist(
    playlistId: string,
    trackIds: string[]
  ): Promise<unknown> {
    return this.request(
      `/me/library/playlists/${playlistId}/tracks`,
      {
        method: "POST",
        body: {
          data: trackIds.map((id) => ({ id, type: "songs" })),
        },
        requireUserToken: true,
      }
    );
  }

  // ─── List User Playlists ─────────────────────────────────

  async listPlaylists(): Promise<unknown> {
    return this.request("/me/library/playlists?limit=100", {
      requireUserToken: true,
    });
  }

  // ─── Check if user token is available ────────────────────

  hasUserToken(): boolean {
    return this.getUserToken() !== null;
  }
}
