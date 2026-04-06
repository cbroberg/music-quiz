/**
 * Pre-fetch Danish artist top songs and cache to disk.
 * Run this once — engine will load from cache instead of hitting Apple Music API.
 *
 * Output: data/artist-songs-dk.json
 * Usage: node scripts/cache-dansk-songs.js
 */

import { readFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const CACHE_PATH = 'data/artist-songs-dk.json';

async function main() {
  console.log('\n🇩🇰 Pre-caching Danish artist songs\n');

  // Load curated list — flat array
  const artists = JSON.parse(readFileSync('packages/quiz-engine/src/data/artists-dk.json', 'utf-8'));
  console.log(`Artists to fetch: ${artists.length}`);

  // Check server
  try {
    const r = await fetch(`${BASE}/health`);
    if (!r.ok) throw 0;
  } catch {
    console.error('Server not running on port 3000');
    process.exit(1);
  }

  const cache = { generatedAt: new Date().toISOString(), artists: {} };
  let totalSongs = 0;
  let matchedArtists = 0;

  for (let i = 0; i < artists.length; i++) {
    const artist = artists[i];
    const limit = 5;
    try {
      // Use builder search (proxies to Apple Music catalog)
      const searchRes = await fetch(`${BASE}/quiz/api/builder/search?q=${encodeURIComponent(artist.name)}`);
      const data = await searchRes.json();
      const songs = (data.songs || []);

      // Filter for songs that match the artist
      const artistLower = artist.name.toLowerCase().replace(/['\u2019]/g, '');
      const matching = songs.filter(s => {
        const sArtist = (s.artistName || '').toLowerCase().replace(/['\u2019]/g, '');
        return sArtist.includes(artistLower) || artistLower.includes(sArtist.split(/[,&]/)[0].trim());
      }).slice(0, limit);

      if (matching.length > 0) {
        matchedArtists++;
        totalSongs += matching.length;
        cache.artists[artist.name] = matching.map(s => ({
          id: s.id,
          name: s.name,
          artistName: s.artistName,
          albumName: s.albumName || '',
          releaseYear: s.releaseYear || '',
          artworkUrl: s.artworkUrl || '',
        }));
        console.log(`  ${i+1}/${artists.length} ${artist.name} → ${matching.length} songs`);
      } else {
        console.log(`  ${i+1}/${artists.length} ${artist.name} → ⚠️ no match`);
      }
    } catch (e) {
      console.log(`  ${i+1}/${artists.length} ${artist.name} → ❌ ${e.message}`);
    }
  }

  cache.totalSongs = totalSongs;
  cache.matchedArtists = matchedArtists;
  cache.totalArtists = artists.length;

  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  console.log(`\n✅ Cached ${totalSongs} songs from ${matchedArtists}/${artists.length} artists → ${CACHE_PATH}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
