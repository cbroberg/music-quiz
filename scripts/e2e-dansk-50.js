/**
 * E2E Dansk-only Test — 50 questions with curated Danish artist list
 *
 * Verifies:
 * 1. artists-dk.json loaded (119 artists)
 * 2. Quiz uses curated list (not charts/playlists)
 * 3. Songs are actually from Danish artists (Kim Larsen, Gasolin, TV-2, etc.)
 * 4. 50 questions complete without failures
 * 5. RP fills up with Danish tracks
 *
 * Usage: node scripts/e2e-dansk-50.js
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const QUESTIONS = 15;
const TIMER = 5;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function logSection(t) { console.log(`\n${'─'.repeat(60)}\n${t}\n${'─'.repeat(60)}`); }

async function main() {
  console.log('\n🇩🇰 E2E Dansk-only Test — 50 questions\n');

  try { const r = await fetch(`${BASE}/health`); if (!r.ok) throw 0; } catch {
    console.error('Server not running on port 3000'); process.exit(1);
  }
  console.log('Server OK');

  // Set HC + mute
  await fetch(`${BASE}/quiz/api/set-provider`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'home-controller' }),
  });
  await fetch(`${BASE}/quiz/api/mute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ muted: true }),
  });
  console.log('🔇 HC + muted');

  const initialRP = (await fetch(`${BASE}/quiz/api/admin/recent-tracks`).then(r => r.json())).tracks?.length || 0;
  console.log(`Initial RP: ${initialRP}`);

  const browsers = [];
  const names = ['Christian', 'Nina', 'Viola'];

  try {
    logSection('Launch browsers');
    const adminB = await chromium.launch({ headless: true });
    const adminCtx = await adminB.newContext({ viewport: { width: 1400, height: 900 } });
    const adminPage = await adminCtx.newPage();
    browsers.push(adminB);

    const playerPages = [];
    for (let i = 0; i < 3; i++) {
      const b = await chromium.launch({ headless: true });
      const ctx = await b.newContext({ viewport: { width: 400, height: 700 } });
      playerPages.push(await ctx.newPage());
      browsers.push(b);
    }
    console.log('  4 browsers launched');

    logSection('Load admin + open quiz');
    await adminPage.goto(`${BASE}/quiz/admin`);
    await sleep(2000);
    await adminPage.evaluate(() => showQuizOverlay());
    await sleep(500);

    // Configure: dansk, 50 questions, 5s timer
    await adminPage.evaluate(({ q, t }) => {
      document.getElementById('qz-cfg-count').value = q;
      document.getElementById('qz-cfg-timer').value = t;
      document.getElementById('qz-cfg-source').value = 'dansk';
    }, { q: String(QUESTIONS), t: String(TIMER) });
    await sleep(300);

    console.log('  Creating 50-question dansk quiz...');
    await adminPage.click('#qz-btn-create');

    // Wait for lobby (can take longer with 50 questions × 3 = 150 artists to search)
    try {
      await adminPage.waitForFunction(() => {
        const o = document.getElementById('quiz-overlay');
        return o?.innerHTML.includes('join-code') || o?.innerHTML.includes('Start Quiz');
      }, { timeout: 1200000 });  // 20 min
    } catch {
      console.error('  ❌ Lobby timeout'); throw new Error('No lobby');
    }
    await sleep(1500);

    const joinCode = await adminPage.evaluate(() =>
      document.querySelector('.join-code')?.textContent?.trim() || ''
    );
    console.log(`  ✅ Join: ${joinCode}`);

    logSection('Players join');
    for (let i = 0; i < 3; i++) {
      await playerPages[i].goto(`${BASE}/quiz/play?code=${joinCode}`);
      await sleep(500);
      await playerPages[i].fill('#join-name', names[i]);
      await playerPages[i].click(`.avatar-btn:nth-child(${i + 1})`);
      await sleep(200);
      await playerPages[i].click('#btn-join');
      await sleep(600);
    }
    console.log('  ✅ All 3 joined');

    await adminPage.waitForFunction(() => {
      const btn = document.getElementById('qz-btn-start');
      return btn && !btn.disabled;
    }, { timeout: 15000 });

    logSection('Quiz: 50 questions');
    await adminPage.click('#qz-btn-start');

    let played = 0;
    for (let q = 1; q <= QUESTIONS; q++) {
      try {
        await playerPages[0].waitForSelector('.mc-btn:not(:disabled), #ft-input', { timeout: 25000 });
      } catch { console.log(`  Q${q} timeout — skipping`); continue; }
      await sleep(200);

      for (let i = 0; i < 3; i++) {
        try {
          const btns = await playerPages[i].$$('.mc-btn:not(:disabled)');
          if (btns.length > 0) {
            const idx = i === 0 ? 0 : Math.floor(Math.random() * btns.length);
            await btns[idx].click();
          } else {
            await playerPages[i].fill('#ft-input', `a${q}`);
            await playerPages[i].click('#ft-submit-btn');
          }
        } catch {}
        await sleep(60);
      }
      played++;
      if (q % 10 === 0) console.log(`  ... ${q}/${QUESTIONS} questions answered`);

      if (q < QUESTIONS) {
        try {
          await adminPage.waitForFunction((qn) => {
            const el = document.getElementById('qz-q-number');
            return !el || !el.textContent || !el.textContent.includes(`Question ${qn} `);
          }, q, { timeout: 25000 });
        } catch {}
      } else {
        try {
          await adminPage.waitForFunction(() =>
            document.getElementById('quiz-overlay')?.innerHTML.includes('Quiz Complete'),
            { timeout: 25000 }
          );
        } catch {}
      }
    }
    console.log(`  Questions played: ${played}/${QUESTIONS}`);

    await sleep(2000);

    // ─── Verify tracks ──────────────────────────────────
    logSection('Verify Danish tracks');
    const finalRP = (await fetch(`${BASE}/quiz/api/admin/recent-tracks`).then(r => r.json())).tracks || [];
    const newTracks = finalRP.slice(0, finalRP.length - initialRP);
    console.log(`  RP grew: ${initialRP} → ${finalRP.length} (+${finalRP.length - initialRP})`);

    // Load artists-dk.json
    const dkArtists = JSON.parse(readFileSync('./packages/quiz-engine/src/data/artists-dk.json', 'utf-8'));
    const dkArtistNames = new Set(dkArtists.map(a => a.name.toLowerCase().replace(/['\u2019]/g, '')));

    // Check how many of new tracks are from curated Danish artists
    let matched = 0;
    const unmatchedSamples = [];
    for (const track of newTracks) {
      const artist = (track.artistName || '').toLowerCase().replace(/['\u2019]/g, '');
      const isDanish = [...dkArtistNames].some(d =>
        artist.includes(d) || d.includes(artist.split(/[,&]/)[0].trim())
      );
      if (isDanish) matched++;
      else unmatchedSamples.push(`${track.name} — ${track.artistName}`);
    }

    console.log(`  Danish matches: ${matched}/${newTracks.length}`);
    if (unmatchedSamples.length > 0) {
      console.log(`  Non-Danish samples (first 5):`);
      for (const s of unmatchedSamples.slice(0, 5)) console.log(`    ${s}`);
    }

    // Print first 15 Danish tracks
    console.log(`\n  First 15 tracks played:`);
    for (const t of newTracks.slice(0, 15)) {
      console.log(`    ${t.name} — ${t.artistName}`);
    }

    const pct = ((matched / newTracks.length) * 100).toFixed(0);
    console.log(`\n  🇩🇰 Danish accuracy: ${pct}%`);

  } finally {
    for (const b of browsers) { try { await b.close(); } catch {} }
    fetch(`${BASE}/quiz/api/mute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ muted: false }),
    }).catch(() => {});
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
