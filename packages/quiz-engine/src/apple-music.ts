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

    if (res.status === 202 || res.status === 204) return {};
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

  // ─── Get Artist Top Songs ─────────────────────────────────

  async getArtistTopSongs(artistId: string, limit: number = 20): Promise<SongResult[]> {
    const data = await this.request(
      `/catalog/${this.storefront}/artists/${artistId}/view/top-songs?limit=${limit}`
    ) as { data?: SongResult[] };
    return data.data || [];
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

  // ─── Charts / Top Songs ──────────────────────────────────

  async getCharts(
    types: string[] = ["songs", "albums", "playlists"],
    genre?: string,
    limit: number = 25
  ): Promise<unknown> {
    const params = new URLSearchParams({
      types: types.join(","),
      limit: String(limit),
    });
    if (genre) params.set("genre", genre);
    return this.request(
      `/catalog/${this.storefront}/charts?${params}`
    );
  }

  // ─── Get Genres ──────────────────────────────────────────

  async getGenres(): Promise<unknown> {
    return this.request(
      `/catalog/${this.storefront}/genres?limit=100`
    );
  }

  // ─── Get Song by ID ──────────────────────────────────────

  async getSong(songId: string): Promise<unknown> {
    return this.request(
      `/catalog/${this.storefront}/songs/${songId}`
    );
  }

  // ─── Get Multiple Songs by IDs ───────────────────────────

  async getSongs(songIds: string[]): Promise<unknown> {
    const params = new URLSearchParams({
      ids: songIds.join(","),
    });
    return this.request(
      `/catalog/${this.storefront}/songs?${params}`
    );
  }

  // ─── Get Album by ID ────────────────────────────────────

  async getAlbum(albumId: string): Promise<unknown> {
    return this.request(
      `/catalog/${this.storefront}/albums/${albumId}`
    );
  }

  // ─── Get Catalog Playlist ────────────────────────────────

  async getCatalogPlaylist(playlistId: string): Promise<unknown> {
    return this.request(
      `/catalog/${this.storefront}/playlists/${playlistId}?include=tracks`
    );
  }

  // ─── Recommendations (personalized) ──────────────────────

  async getRecommendations(limit: number = 10): Promise<unknown> {
    return this.request(
      `/me/recommendations?limit=${limit}`,
      { requireUserToken: true }
    );
  }

  // ─── Recently Played ────────────────────────────────────

  async getRecentlyPlayed(limit: number = 10): Promise<unknown> {
    return this.request(
      `/me/recent/played?limit=${limit}`,
      { requireUserToken: true }
    );
  }

  // ─── Heavy Rotation ─────────────────────────────────────

  async getHeavyRotation(limit: number = 10): Promise<unknown> {
    return this.request(
      `/me/history/heavy-rotation?limit=${limit}`,
      { requireUserToken: true }
    );
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

  // ─── Search User Library ─────────────────────────────────

  async searchLibrary(
    term: string,
    types: string[] = ["library-songs", "library-albums", "library-artists"],
    limit: number = 25
  ): Promise<unknown> {
    const params = new URLSearchParams({
      term,
      types: types.join(","),
      limit: String(limit),
    });
    return this.request(
      `/me/library/search?${params}`,
      { requireUserToken: true }
    );
  }

  // ─── Recently Played Tracks (track-level detail) ─────────

  async getRecentlyPlayedTracks(limit: number = 10): Promise<unknown> {
    // API max per request is 10, max total is 50
    if (limit <= 10) {
      return this.request(
        `/me/recent/played/tracks?limit=${limit}`,
        { requireUserToken: true }
      );
    }
    // Paginate to get up to 50
    const all: unknown[] = [];
    for (let offset = 0; offset < Math.min(limit, 50); offset += 10) {
      const batch = Math.min(10, limit - offset);
      const data = await this.request(
        `/me/recent/played/tracks?limit=${batch}&offset=${offset}`,
        { requireUserToken: true }
      ) as { data?: unknown[] };
      if (data.data) all.push(...data.data);
      if (!data.data || data.data.length < batch) break;
    }
    return { data: all };
  }

  // ─── Apple Music Replay (annual top songs/artists) ──────

  async getReplay(): Promise<unknown> {
    return this.request("/me/replay", { requireUserToken: true });
  }

  // ─── Get Library Playlist Tracks ────────────────────────

  async getPlaylistTracks(playlistId: string): Promise<unknown> {
    const tracks: unknown[] = [];
    let url: string | null =
      `/me/library/playlists/${playlistId}/tracks?limit=100`;

    while (url) {
      const data = (await this.request(url, {
        requireUserToken: true,
      })) as { data: unknown[]; next?: string };
      tracks.push(...data.data);
      url = data.next || null;
    }

    return { data: tracks };
  }

  // ─── Add to Library ─────────────────────────────────────

  async addToLibrary(ids: { songs?: string[]; albums?: string[]; playlists?: string[] }): Promise<unknown> {
    const params = new URLSearchParams();
    if (ids.songs?.length) params.set("ids[songs]", ids.songs.join(","));
    if (ids.albums?.length) params.set("ids[albums]", ids.albums.join(","));
    if (ids.playlists?.length) params.set("ids[playlists]", ids.playlists.join(","));

    return this.request(`/me/library?${params}`, {
      method: "POST",
      requireUserToken: true,
    });
  }

  // ─── Get Song Details (catalog) ─────────────────────────

  async getSongDetails(songIds: string[]): Promise<unknown> {
    return this.request(
      `/catalog/${this.storefront}/songs?ids=${songIds.join(",")}`
    );
  }

  // ─── Get Album Details (catalog) ────────────────────────

  async getAlbumDetails(albumId: string): Promise<unknown> {
    return this.request(
      `/catalog/${this.storefront}/albums/${albumId}?include=tracks`
    );
  }

  // ─── Check if user token is available ────────────────────

  hasUserToken(): boolean {
    return this.getUserToken() !== null;
  }
}
