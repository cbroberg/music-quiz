/**
 * E2E Quiz Test — Full flow with Home Controller
 *
 * Uses HC provider (Music.app via osascript) — no Apple Music browser auth needed.
 * Opens /quiz/admin — same page the user uses. One source of truth.
 *
 * Usage: node scripts/e2e-admin-quiz.js
 * Requires: Server running on port 3000
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:3000';
const HEADLESS = process.argv.includes('--headless');
const MUTE = process.argv.includes('--mute');
const getArg = (name, def) => {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : def;
};
const QUESTIONS = parseInt(getArg('questions', '3'));
const TIMER = parseInt(getArg('timer', '5'));
const SOURCE = getArg('source', 'mixed');
const GENRE = getArg('genre', '');
const LABEL = getArg('label', SOURCE);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function getServerLog() { try { return readFileSync('/tmp/quiz-server.log', 'utf-8'); } catch { return ''; } }
function logSection(t) { console.log(`\n${'─'.repeat(50)}\n${t}\n${'─'.repeat(50)}`); }

async function main() {
  console.log('=== E2E Quiz Test (HC provider) ===\n');

  try { const r = await fetch(`${BASE}/health`); if (!r.ok) throw 0; } catch {
    console.error('Server not running on port 3000'); process.exit(1);
  }
  console.log('Server OK');

  // Set provider to Home Controller (no browser auth needed)
  await fetch(`${BASE}/quiz/api/set-provider`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'home-controller' }),
  });
  console.log('Provider set to Home Controller');

  // Set runtime mute (no server restart needed)
  if (MUTE) {
    await fetch(`${BASE}/quiz/api/mute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ muted: true }),
    });
    console.log('🔇 Muted (runtime)');
  }

  try { execSync(`osascript -e 'tell application "System Events" to set miniaturized of every window of every application process whose visible is true to true'`); } catch {}
  await sleep(500);

  const H = 1380, adminW = 1720, playerW = 573;
  const browsers = [];
  const results = { passed: [], failed: [] };
  const pass = (m) => { results.passed.push(m); console.log(`  ✅ ${m}`); };
  const fail = (m) => { results.failed.push(m); console.log(`  ❌ ${m}`); };
  const check = (c, m) => c ? pass(m) : fail(m);

  try {
    logSection('1. Launch browsers');
    const adminBrowser = await chromium.launch({ headless: HEADLESS, args: [`--window-position=0,25`, `--window-size=${adminW},${H}`] });
    const adminCtx = await adminBrowser.newContext({ viewport: { width: adminW - 16, height: H - 80 } });
    const adminPage = await adminCtx.newPage();
    browsers.push(adminBrowser);

    const playerPages = [];
    for (let i = 0; i < 3; i++) {
      const b = await chromium.launch({ headless: HEADLESS, args: [`--window-position=${adminW + i * playerW},25`, `--window-size=${playerW},${H}`] });
      const ctx = await b.newContext({ viewport: { width: playerW - 16, height: H - 80 } });
      playerPages.push(await ctx.newPage());
      browsers.push(b);
    }
    try { execSync(`osascript -e 'tell application "System Events" to tell application process "Ghostty" to set miniaturized of every window to true'`); } catch {}
    const names = ['Christian', 'Nina', 'Viola'];
    console.log('  4 windows launched');

    // ─── Admin + Quiz overlay ───────────────────────────
    logSection('2. Admin → Quiz overlay');
    await adminPage.goto(`${BASE}/quiz/admin`);
    await sleep(2000);

    check((await adminPage.title()).includes('Admin'), 'Admin page loaded');

    // Open quiz overlay
    await adminPage.evaluate(() => showQuizOverlay());
    await sleep(500);

    const overlayVisible = await adminPage.evaluate(() =>
      document.getElementById('quiz-overlay')?.style.display !== 'none'
    );
    check(overlayVisible, 'Quiz overlay visible');

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
    }, { q: String(QUESTIONS), t: String(TIMER), s: SOURCE, g: GENRE });
    await sleep(300);

    await adminPage.click('#qz-btn-create');
    console.log('  Creating game...');

    // Wait for lobby
    try {
      await adminPage.waitForFunction(() => {
        const o = document.getElementById('quiz-overlay');
        return o?.innerHTML.includes('join-code') || o?.innerHTML.includes('Start Quiz');
      }, { timeout: 120000 });
    } catch { fail('Lobby timeout'); throw new Error('No lobby'); }
    await sleep(1500);

    // Check Franky in server log
    const logNow = getServerLog();
    const franky = logNow.includes('Prep music') || logNow.includes('NOW PLAYING') || logNow.includes('New York');
    console.log(`  Franky theme: ${franky ? 'PLAYING' : 'not detected (HC may not be running)'}`);

    const joinCode = await adminPage.evaluate(() =>
      document.querySelector('.join-code')?.textContent?.trim() || ''
    );
    check(!!joinCode, `Join code: ${joinCode}`);
    if (!joinCode) throw new Error('No join code');

    // ─── Players join ───────────────────────────────────
    logSection('3. Players join');
    for (let i = 0; i < 3; i++) {
      await playerPages[i].goto(`${BASE}/quiz/play?code=${joinCode}`);
      await sleep(500);
      await playerPages[i].fill('#join-name', names[i]);
      await playerPages[i].click(`.avatar-btn:nth-child(${i + 1})`);
      await sleep(200);
      await playerPages[i].click('#btn-join');
      await sleep(600);
      console.log(`  ${names[i]} joined`);
    }

    await adminPage.waitForFunction(() => {
      const btn = document.getElementById('qz-btn-start');
      return btn && !btn.disabled;
    }, { timeout: 10000 });
    pass('All 3 joined');

    // ─── Quiz ───────────────────────────────────────────
    logSection('4. Quiz: 3 questions');
    await adminPage.click('#qz-btn-start');

    for (let q = 1; q <= QUESTIONS; q++) {
      try {
        await playerPages[0].waitForSelector('.mc-btn:not(:disabled), #ft-input', { timeout: 30000 });
      } catch { console.log(`  Q${q} didn't appear`); break; }
      await sleep(300);

      let ans = 0;
      for (let i = 0; i < 3; i++) {
        try {
          const btns = await playerPages[i].$$('.mc-btn:not(:disabled)');
          if (btns.length > 0) {
            // Player 0 = Christian always picks first option (smart guess)
            // Players 1-2 = random
            const idx = i === 0 ? 0 : Math.floor(Math.random() * btns.length);
            await btns[idx].click(); ans++;
          }
          else { await playerPages[i].fill('#ft-input', `a${q}`); await playerPages[i].click('#ft-submit-btn'); ans++; }
        } catch {}
        await sleep(100);
      }
      console.log(`  Q${q}: ${ans}/3 answered`);

      if (q < QUESTIONS) {
        try { await adminPage.waitForFunction((qn) => {
          const el = document.getElementById('qz-q-number');
          return !el || !el.textContent || !el.textContent.includes(`Question ${qn} `);
        }, q, { timeout: 30000 }); } catch {}
      } else {
        try { await adminPage.waitForFunction(() =>
          document.getElementById('quiz-overlay')?.innerHTML.includes('Quiz Complete'), { timeout: 30000 }
        ); } catch {}
      }
    }

    // ─── Podium ─────────────────────────────────────────
    logSection('5. Podium');
    await sleep(2000);
    check(await adminPage.evaluate(() =>
      document.getElementById('quiz-overlay')?.innerHTML.includes('song credit') || false
    ), 'Credits on podium');

    console.log('  Champions playing (5s)...');
    await sleep(5000);

    // ─── Back to admin → DJ ─────────────────────────────
    logSection('6. Back to DJ');
    await adminPage.evaluate(() => QuizDisplay.backToAdmin());
    await sleep(1500);

    check(await adminPage.evaluate(() =>
      document.querySelector('.admin-layout')?.style.display !== 'none'
    ), 'Admin visible');
    check(await adminPage.evaluate(() =>
      document.getElementById('tab-dj')?.classList.contains('active')
    ), 'DJ tab active');

    // ─── Players add songs ──────────────────────────────
    logSection('7. DJ: 3 players add songs');
    const searches = ['Come Together Beatles', 'Bohemian Rhapsody Queen', 'Hotel California Eagles'];

    for (let i = 0; i < 3; i++) {
      try { await playerPages[i].waitForSelector('#dj-search', { timeout: 15000 }); }
      catch { console.log(`  ${names[i]} DJ not ready`); }
    }

    const added = [];
    for (let i = 0; i < 3; i++) {
      try {
        await playerPages[i].evaluate(() => { document.getElementById('dj-tab-search')?.click(); });
        await sleep(500);
        await playerPages[i].fill('#dj-search', searches[i]);
        try { await playerPages[i].waitForSelector('.dj-add-btn', { timeout: 8000 }); } catch { continue; }
        await sleep(500);
        const ok = await playerPages[i].evaluate(() => {
          const b = document.querySelector('.dj-add-btn:not(.used)');
          if (b instanceof HTMLElement) { b.click(); return true; }
          return false;
        });
        if (ok) { added.push(names[i]); console.log(`  ${names[i]} added "${searches[i]}"`); }
        await sleep(1500);
      } catch (e) { console.log(`  ${names[i]} error: ${e.message.split('\n')[0]}`); }
    }
    check(added.length === 3, `${added.length}/3 added songs`);

    // ─── Verify ─────────────────────────────────────────
    logSection('8. Verify');
    await sleep(3000);

    const queueInfo = await adminPage.evaluate(() => {
      const items = document.querySelectorAll('.dj-queue-item');
      const songs = []; items.forEach(el => {
        songs.push({ name: el.querySelector('.q-name')?.textContent || '', who: el.querySelector('.q-who')?.textContent?.trim() || '' });
      });
      const mp = document.getElementById('mp-track')?.textContent || '';
      return { songs, mpTrack: mp, creditPills: document.querySelectorAll('.dj-credit-pill').length };
    });

    console.log(`  Mini player: "${queueInfo.mpTrack}"`);
    console.log(`  Queue: ${queueInfo.songs.length} songs`);
    for (const s of queueInfo.songs) console.log(`    "${s.name}" [${s.who}]`);
    console.log(`  Credit pills: ${queueInfo.creditPills}`);

    // Server playback log
    const log = getServerLog();
    const played = log.split('\n').filter(l => l.includes('NOW PLAYING'));
    const djCmds = log.split('\n').filter(l => l.includes('DJ playing'));
    console.log(`  Tracks played: ${played.length}`);
    for (const l of played.slice(-5)) console.log(`    ${l.trim()}`);
    console.log(`  DJ commands: ${djCmds.length}`);
    for (const l of djCmds) console.log(`    ${l.trim()}`);

    check(queueInfo.songs.length >= 2, `Queue has songs`);
    check(queueInfo.creditPills >= 3, `Credit pills shown`);

    // ─── Results ────────────────────────────────────────
    logSection('RESULTS');
    console.log(`\nPASSED: ${results.passed.length}`);
    for (const p of results.passed) console.log(`  ✅ ${p}`);
    if (results.failed.length) { console.log(`\nFAILED: ${results.failed.length}`);
      for (const f of results.failed) console.log(`  ❌ ${f}`); }

    // Keep open in visible mode, close immediately in headless
    if (!HEADLESS) {
      console.log('\n🎵 Browsers staying open — Ctrl+C to close\n');
      await new Promise(() => {});
    }

  } finally {
    for (const b of browsers) { try { await b.close(); } catch {} }
    // Restore MusicKit provider + unmute
    fetch(`${BASE}/quiz/api/set-provider`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'musickit-web' }),
    }).catch(() => {});
    if (MUTE) {
      fetch(`${BASE}/quiz/api/mute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ muted: false }),
      }).catch(() => {});
    }
  }
}

process.on('SIGINT', () => { console.log('\n👋 Closing...'); process.exit(0); });
main().catch(err => { console.error('FATAL:', err); process.exit(1); });
