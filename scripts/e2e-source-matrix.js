/**
 * E2E Source Matrix — 5 quizzes with SAME 3 players across all tests.
 *
 * Goal: Fill up DJ queue and Recently Played by running multiple quizzes
 * in one persistent session.
 *
 * Tests: Mixed, Top Charts, Jazz, Movie Soundtracks, Danish Music, Live Music
 * 20 questions × 5s timer, muted, headless
 *
 * Usage: node scripts/e2e-source-matrix.js
 */

import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:3000';
const QUESTIONS = 20;
const TIMER = 5;

const TESTS = [
  { source: 'mixed', label: 'Mixed' },
  { source: 'charts', label: 'Top Charts' },
  { source: 'charts-genre', genre: '11', label: 'Jazz' },
  { source: 'charts-soundtrack', label: 'Movie Soundtracks' },
  { source: 'dansk', label: 'Danish Music' },
  { source: 'live', label: 'Live Music' },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function logSection(t) { console.log(`\n${'─'.repeat(60)}\n${t}\n${'─'.repeat(60)}`); }

async function main() {
  console.log('\n🎯 E2E Source Matrix — persistent 3-player session\n');

  // Health check
  try { const r = await fetch(`${BASE}/health`); if (!r.ok) throw 0; } catch {
    console.error('Server not running on port 3000'); process.exit(1);
  }

  // Set HC provider + mute
  await fetch(`${BASE}/quiz/api/set-provider`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'home-controller' }),
  });
  await fetch(`${BASE}/quiz/api/mute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ muted: true }),
  });
  console.log('🔇 HC + muted');

  // Snapshot initial state
  const initialTracks = await fetch(`${BASE}/quiz/api/admin/recent-tracks`).then(r => r.json());
  const initialTrackCount = (initialTracks.tracks || []).length;
  console.log(`Initial Recently Played: ${initialTrackCount} tracks`);

  const browsers = [];
  const names = ['Christian', 'Nina', 'Viola'];
  const results = [];

  try {
    // ─── Launch persistent browsers (1 admin + 3 players) ──
    logSection('Launch persistent browsers');

    const adminBrowser = await chromium.launch({ headless: true });
    const adminCtx = await adminBrowser.newContext({ viewport: { width: 1400, height: 900 } });
    const adminPage = await adminCtx.newPage();
    browsers.push(adminBrowser);

    const playerPages = [];
    for (let i = 0; i < 3; i++) {
      const b = await chromium.launch({ headless: true });
      const ctx = await b.newContext({ viewport: { width: 400, height: 700 } });
      playerPages.push(await ctx.newPage());
      browsers.push(b);
    }
    console.log('  4 browsers launched (persistent)');

    // Load admin page
    await adminPage.goto(`${BASE}/quiz/admin`);
    await sleep(2000);
    console.log('  Admin loaded');

    // ─── Run each quiz with same players ──────────────────
    for (let testIdx = 0; testIdx < TESTS.length; testIdx++) {
      const cfg = TESTS[testIdx];
      logSection(`Quiz ${testIdx + 1}/${TESTS.length}: ${cfg.label}`);
      const startTime = Date.now();

      try {
        // Ensure clean setup state before opening overlay (fixes Top Charts timeout bug)
        await adminPage.evaluate(() => {
          const overlay = document.getElementById('quiz-overlay');
          if (overlay) {
            document.querySelectorAll('#quiz-overlay .qz-screen').forEach(s => s.classList.remove('active'));
            const setup = document.getElementById('qz-screen-setup');
            if (setup) setup.classList.add('active');
            const config = document.getElementById('qz-setup-config');
            if (config) config.style.display = '';
            const lobby = document.getElementById('qz-lobby-view');
            if (lobby) lobby.style.display = 'none';
            const createBtn = document.getElementById('qz-btn-create');
            if (createBtn) { createBtn.disabled = false; createBtn.textContent = 'Create Game'; }
          }
          showQuizOverlay();
        });
        await sleep(800);

        // Configure
        await adminPage.evaluate(({ q, t, s, g }) => {
          document.getElementById('qz-cfg-count').value = q;
          document.getElementById('qz-cfg-timer').value = t;
          const src = document.getElementById('qz-cfg-source');
          if (src) src.value = s;
          if (g) {
            const gen = document.getElementById('qz-cfg-genre');
            if (gen) gen.value = g;
            const gc = document.getElementById('qz-genre-container');
            if (gc) gc.style.display = '';
          }
          // Enable gossip in test to verify bank usage
          const gossip = document.getElementById('qz-cfg-include-gossip');
          if (gossip) gossip.checked = true;
        }, { q: String(QUESTIONS), t: String(TIMER), s: cfg.source, g: cfg.genre || '' });
        await sleep(300);

        // Create game
        await adminPage.click('#qz-btn-create');
        console.log('  Creating game...');

        // Wait for lobby
        await adminPage.waitForFunction(() => {
          const o = document.getElementById('quiz-overlay');
          return o?.innerHTML.includes('join-code') || o?.innerHTML.includes('Start Quiz');
        }, { timeout: 180000 });
        await sleep(1500);

        const joinCode = await adminPage.evaluate(() =>
          document.querySelector('.join-code')?.textContent?.trim() || ''
        );
        if (!joinCode) throw new Error('No join code');
        console.log(`  Join: ${joinCode}`);

        // Players join (fresh join each quiz — handles lobby_open signal)
        for (let i = 0; i < 3; i++) {
          try {
            // Check if player is already in a session (from previous quiz)
            const inSession = await playerPages[i].evaluate(() => !!document.querySelector('.mc-btn, #ft-input, .player-lobby, .waiting-room'));
            if (!inSession) {
              await playerPages[i].goto(`${BASE}/quiz/play?code=${joinCode}`);
              await sleep(500);
              // Check if we need to fill join form
              const needsJoin = await playerPages[i].$('#join-name');
              if (needsJoin) {
                await playerPages[i].fill('#join-name', names[i]);
                await playerPages[i].click(`.avatar-btn:nth-child(${i + 1})`);
                await sleep(200);
                await playerPages[i].click('#btn-join');
                await sleep(600);
              }
            }
          } catch (e) {
            console.log(`  ${names[i]} join error: ${e.message.split('\n')[0]}`);
          }
        }

        // Wait for Start enabled
        try {
          await adminPage.waitForFunction(() => {
            const btn = document.getElementById('qz-btn-start');
            return btn && !btn.disabled;
          }, { timeout: 15000 });
        } catch {
          console.log('  Start button never enabled');
        }

        await adminPage.click('#qz-btn-start');
        console.log('  Quiz started');

        // Play 20 questions
        let questionsPlayed = 0;
        for (let q = 1; q <= QUESTIONS; q++) {
          try {
            await playerPages[0].waitForSelector('.mc-btn:not(:disabled), #ft-input', { timeout: 30000 });
          } catch { console.log(`  Q${q} timeout — skipping`); continue; }
          await sleep(200);

          for (let i = 0; i < 3; i++) {
            try {
              const btns = await playerPages[i].$$('.mc-btn:not(:disabled)');
              if (btns.length > 0) {
                // Christian = always first (smart guess); others random
                const idx = i === 0 ? 0 : Math.floor(Math.random() * btns.length);
                await btns[idx].click();
              } else {
                await playerPages[i].fill('#ft-input', `a${q}`);
                await playerPages[i].click('#ft-submit-btn');
              }
            } catch {}
            await sleep(80);
          }
          questionsPlayed++;

          if (q < QUESTIONS) {
            try {
              await adminPage.waitForFunction((qn) => {
                const el = document.getElementById('qz-q-number');
                return !el || !el.textContent || !el.textContent.includes(`Question ${qn} `);
              }, q, { timeout: 20000 });
            } catch {}
          } else {
            try {
              await adminPage.waitForFunction(() =>
                document.getElementById('quiz-overlay')?.innerHTML.includes('Quiz Complete'),
                { timeout: 20000 }
              );
            } catch {}
          }
        }

        console.log(`  Questions played: ${questionsPlayed}/${QUESTIONS}`);
        await sleep(3000);

        // Back to admin (DJ tab)
        await adminPage.evaluate(() => QuizDisplay.backToAdmin());
        await sleep(1500);

        // Players add 2 songs each to DJ
        const searches = [
          [`Come Together Beatles`, `Let It Be Beatles`],
          [`Bohemian Rhapsody Queen`, `We Will Rock You Queen`],
          [`Hotel California Eagles`, `Take It Easy Eagles`],
        ];

        for (let i = 0; i < 3; i++) {
          try {
            await playerPages[i].waitForSelector('#dj-search', { timeout: 10000 });
          } catch { continue; }

          for (const search of searches[i]) {
            try {
              await playerPages[i].evaluate(() => { document.getElementById('dj-tab-search')?.click(); });
              await sleep(300);
              await playerPages[i].fill('#dj-search', search);
              try { await playerPages[i].waitForSelector('.dj-add-btn', { timeout: 5000 }); } catch { continue; }
              await sleep(300);
              await playerPages[i].evaluate(() => {
                const btn = document.querySelector('.dj-add-btn:not(.used)');
                if (btn instanceof HTMLElement) btn.click();
              });
              await sleep(800);
            } catch {}
          }
        }

        await sleep(2000);

        // Collect stats
        const stats = await adminPage.evaluate(() => {
          const queue = document.querySelectorAll('.dj-queue-item').length;
          const pills = document.querySelectorAll('.dj-credit-pill').length;
          return { queue, pills };
        });

        const tracksRes = await fetch(`${BASE}/quiz/api/admin/recent-tracks`).then(r => r.json());
        const trackCount = (tracksRes.tracks || []).length;

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(`  ✓ Done in ${elapsed}s — DJ queue: ${stats.queue}, RP: ${trackCount} tracks`);

        results.push({
          label: cfg.label, source: cfg.source,
          questionsPlayed, elapsed,
          djQueue: stats.queue, rpTracks: trackCount,
          result: questionsPlayed === QUESTIONS ? 'OK' : 'PARTIAL',
        });
      } catch (e) {
        console.log(`  ❌ FAIL: ${e.message.split('\n')[0]}`);
        results.push({ label: cfg.label, source: cfg.source, result: 'FAIL', error: e.message.slice(0, 80) });
        // Try to recover — go back to admin
        try { await adminPage.evaluate(() => QuizDisplay.backToAdmin()); } catch {}
        await sleep(2000);
      }
    }

    // ─── Final stats ────────────────────────────────────
    logSection('FINAL RESULTS');

    const finalTracks = await fetch(`${BASE}/quiz/api/admin/recent-tracks`).then(r => r.json());
    const finalTrackCount = (finalTracks.tracks || []).length;

    const finalQueueInfo = await adminPage.evaluate(() => {
      const queue = document.querySelectorAll('.dj-queue-item').length;
      const pills = document.querySelectorAll('.dj-credit-pill').length;
      const pillTexts = [...document.querySelectorAll('.dj-credit-pill')].map(el => el.textContent.trim());
      return { queue, pills, pillTexts };
    });

    console.log('\nPer-quiz results:');
    console.log('Source               | Result   | Q#    | DJ+ | RP   | Time');
    console.log('-'.repeat(60));
    for (const r of results) {
      const label = (r.label || '').padEnd(20);
      const result = (r.result || 'FAIL').padEnd(8);
      const q = String(r.questionsPlayed || 0).padEnd(5);
      const dj = String(r.djQueue || 0).padEnd(3);
      const rp = String(r.rpTracks || 0).padEnd(4);
      const t = (r.elapsed || '?') + 's';
      console.log(`${label} | ${result} | ${q} | ${dj} | ${rp} | ${t}`);
    }

    console.log(`\nFinal Recently Played: ${finalTrackCount} tracks (started with ${initialTrackCount})`);
    console.log(`Final DJ queue: ${finalQueueInfo.queue} songs`);
    console.log(`Player credits: ${finalQueueInfo.pills} pills`);
    for (const p of finalQueueInfo.pillTexts) console.log(`  ${p}`);

    const passed = results.filter(r => r.result === 'OK').length;
    const failed = results.filter(r => r.result === 'FAIL').length;
    console.log(`\n${passed}/${results.length} passed, ${failed} failed`);

    const rpGrowth = finalTrackCount - initialTrackCount;
    const rpOk = rpGrowth >= 20; // At least 20 new tracks across all quizzes
    console.log(`Recently Played growth: +${rpGrowth} ${rpOk ? '✅' : '❌ (expected 20+)'}`);

    process.exit(failed > 0 || !rpOk ? 1 : 0);

  } finally {
    for (const b of browsers) { try { await b.close(); } catch {} }
    // Unmute, restore MK
    fetch(`${BASE}/quiz/api/mute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ muted: false }),
    }).catch(() => {});
    fetch(`${BASE}/quiz/api/set-provider`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'musickit-web' }),
    }).catch(() => {});
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
