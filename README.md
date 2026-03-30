# 🎵 Apple Music MCP Server

A Model Context Protocol (MCP) server for Apple Music. Search the catalog, explore charts, get your Replay top songs, create playlists, and manage your library — all from Claude on iPhone, desktop, or Claude Code.

**Live at:** `https://music.broberg.dk`

## Features

### 20 Tools

#### Catalog Tools (8 — no auth required)

| Tool | Description |
|------|-------------|
| `search_catalog` | Search songs, artists, albums in Apple Music catalog |
| `get_artist_songs` | Get all songs by an artist (full discography) |
| `get_artist_albums` | Get all albums by an artist |
| `get_charts` | Top songs/albums/playlists, optionally by genre |
| `get_genres` | List all available genres (for chart filtering) |
| `get_catalog_playlist` | Get a curated/editorial playlist with tracks |
| `get_song_details` | Full details for songs by ID (artwork, preview URL, release date) |
| `get_album_details` | Full album details with all tracks and editorial notes |

#### Library & Personal Tools (12 — auth required)

| Tool | Description |
|------|-------------|
| `create_playlist` | Create a playlist with tracks in your library |
| `add_tracks_to_playlist` | Add tracks to an existing playlist |
| `list_playlists` | List your Apple Music playlists |
| `get_playlist_tracks` | Get all tracks in a library playlist |
| `add_to_library` | Add songs/albums/playlists to your library |
| `search_library` | Search your personal music library |
| `recently_played` | Your recent listening history (albums/playlists) |
| `recently_played_tracks` | Recently played tracks with full details (up to 50) |
| `heavy_rotation` | Your most frequently played content |
| `recommendations` | Personalized music recommendations |
| `replay` | Apple Music Replay — your top songs/artists/albums for the year |
| `auth_status` | Check if user authorization is active |

### Transport & Auth

The server supports two MCP transports:

| Transport | Endpoint | Auth | Clients |
|-----------|----------|------|---------|
| Streamable HTTP | `/mcp` | OAuth 2.1 (PKCE + DCR) | claude.ai (web + iOS) |
| SSE (legacy) | `/sse` | None | Claude Desktop, Claude Code |

OAuth 2.1 uses JWT tokens that survive server restarts. Dynamic Client Registration allows claude.ai to self-register.

## Quick Start

### 1. Apple Developer Setup

You need an [Apple Developer account](https://developer.apple.com/account) ($99/year).

1. Go to **Certificates, Identifiers & Profiles**
2. Under **Identifiers**, click **+** → choose **Media IDs**
3. Register a new Media ID (e.g., `media.music.dk.broberg`)
4. Enable **MusicKit**, **ShazamKit**, and **Apple Music Feed**
5. Under **Keys**, click **+** → create a new key
6. Enable **MusicKit** and select your Media ID
7. Download the `.p8` private key file
8. Note your **Key ID** and **Team ID**

### 2. Local Development

```bash
git clone https://github.com/cbroberg/apple-music-mcp.git
cd apple-music-mcp
npm install
cp env.example .env
```

Edit `.env` with your credentials. For the private key, convert the `.p8` file to a single line:

```bash
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' AuthKey_XXXXXX.p8
```

Build and run:

```bash
npm run build
npm start
```

Visit `http://localhost:3000/auth` to authorize your Apple Music account.

### 3. Deploy to Fly.io

```bash
fly apps create apple-music-mcp
fly certs add music.broberg.dk

# Set secrets
fly secrets set APPLE_TEAM_ID=xxx APPLE_KEY_ID=xxx
fly secrets set APPLE_PRIVATE_KEY="$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' AuthKey_XXXXXX.p8)"
fly secrets set SERVER_URL=https://music.broberg.dk
fly secrets set JWT_SECRET=$(openssl rand -hex 32)

fly deploy
```

### 4. Connect to claude.ai

1. Go to **Settings** → **Integrations** → **Add integration**
2. Enter URL: `https://music.broberg.dk/mcp`
3. Claude.ai handles the OAuth 2.1 flow automatically
4. Available on web, iPhone, and Android

### 5. Connect to Claude Desktop / Claude Code

Add to your MCP config:

```json
{
  "mcpServers": {
    "apple-music": {
      "url": "https://music.broberg.dk/sse"
    }
  }
}
```

### 6. Authorize Apple Music

Visit `https://music.broberg.dk/auth` and sign in with your Apple Music account. This grants the server permission to create playlists and access personalized features.

> **Note:** The Music User Token is stored in memory. The server runs with `min_machines_running = 1` to preserve it, but it will be lost on deploys. Re-visit `/auth` after deploying.

## Usage Examples

From Claude (iPhone or desktop):

> "What are my top songs according to Apple Music Replay?"

> "Show me my recently played tracks"

> "Search Apple Music for Mew and show me their discography"

> "Create a playlist called 'Chill Vibes' with my 10 most recently played tracks"

> "What are the top 10 songs in Denmark right now?"

> "What does Apple Music recommend for me?"

> "Add this album to my library"

> "Show me the tracks in my 'Road Trip' playlist"

## Architecture

```
┌─────────────┐  Streamable HTTP   ┌──────────────────┐
│  claude.ai   │ ◄───(OAuth 2.1)──► │  MCP Server       │
│  (web/iOS)   │                    │  (Fly.io, arn)    │
├─────────────┤                    │                   │
│  Claude      │  SSE               │  ┌──────────────┐ │
│  Desktop/CC  │ ◄─────────────────► │  │ Apple Music  │ │
└─────────────┘                    │  │ API (REST)   │ │
                                    │  └──────────────┘ │
                                    │                   │
                                    │  OAuth 2.1 (JWT)  │
                                    │  /.well-known/*   │
                                    │  /authorize       │
                                    │  /token           │
                                    │  /register (DCR)  │
                                    └──────────────────┘
                                           │
                                    ┌──────┴──────┐
                                    │ MusicKit JS  │
                                    │ (/auth page) │
                                    └─────────────┘
```

## License

MIT — Christian Broberg / WebHouse ApS
