/**
 * E2E Visual Quiz Test — Playwright
 *
 * 4 separate browser windows on 3440x1440 ultrawide:
 *   Left half:  Host (1720px)
 *   Right half: Christian, Sanne, Mikkel (573px each)
 *
 * Usage: node scripts/e2e-quiz-visual.js
 */

import { chromium } from 'playwright';
import { execSync, spawn } from 'node:child_process';

const BASE = 'http://localhost:3000';
const QUESTIONS = 5;
const TIMER = 15;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let screenRecordProc = null;

function startScreenRecording() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = `recordings/e2e-${timestamp}.mov`;
  execSync('mkdir -p recordings');
  const recorder = new URL('../scripts/screen-record/.build/release/screen-record', import.meta.url).pathname;
  console.log(`🎬 Recording screen + audio → ${outFile}`);
  screenRecordProc = spawn(recorder, [outFile, '--crop'], { stdio: 'ignore' });
  return outFile;
}

function stopScreenRecording() {
  if (screenRecordProc) {
    console.log('🎬 Stopping screen recording...');
    try { screenRecordProc.kill('SIGINT'); } catch {}
    screenRecordProc = null;
  }
}

function minimizeAllWindows() {
  console.log('🪟 Minimizing all windows...');
  execSync(`osascript -e '
    tell application "System Events"
      set appList to name of every application process whose visible is true
      repeat with appName in appList
        try
          tell application process appName
            set miniaturized of every window to true
          end tell
        end try
      end repeat
    end tell
  '`);
}

async function launchWindow(x, y, w, h) {
  const browser = await chromium.launch({
    headless: false,
    args: [`--window-position=${x},${y}`, `--window-size=${w},${h}`],
  });
  const ctx = await browser.newContext({ viewport: { width: w - 16, height: h - 80 } });
  const page = await ctx.newPage();
  return { browser, page };
}

async function main() {
  console.log('\n🎮 E2E Quiz Test — 3 players on 3440x1440\n');

  minimizeAllWindows();
  await sleep(500);

  // Layout: Host 1720px left, 3 players 573px each right
  const H = 1380;
  const hostW = 1720;
  const playerW = 573;

  const host = await launchWindow(0, 25, hostW, H);
  const p1 = await launchWindow(hostW, 25, playerW, H);
  const p2 = await launchWindow(hostW + playerW, 25, playerW, H);
  const p3 = await launchWindow(hostW + playerW * 2, 25, playerW, H);

  // Re-minimize Ghostty (may have popped back up from output)
  try { execSync(`osascript -e 'tell application "System Events" to tell application process "Ghostty" to set miniaturized of every window to true'`); } catch {}

  const players = [p1.page, p2.page, p3.page];
  const names = ['Christian', 'Nina', 'Viola'];
  const avatarIdx = [0, 1, 2];
  const djSearches = ['Fleetwood Mac', 'Stevie Wonder', 'Led Zeppelin'];

  // ─── Host creates game ─────────────────────────────────
  console.log('📺 Host: Creating game...');
  await host.page.goto(`${BASE}/quiz/host`);
  await sleep(2000);

  // Start recording AFTER host screen loaded
  const recordingFile = startScreenRecording();
  await sleep(1000);

  // Set values via JS (inputs may be inside custom select wrappers)
  await host.page.evaluate(({ q, t }) => {
    document.getElementById('cfg-count').value = q;
    document.getElementById('cfg-timer').value = t;
    document.getElementById('cfg-source').value = 'mixed';
  }, { q: String(QUESTIONS), t: String(TIMER) });
  await sleep(300);
  await host.page.click('#btn-create');

  // Wait for preparing modal + song download + join code (can take a while)
  console.log('📺 Preparing songs (downloading to library)...');
  await host.page.waitForFunction(() => {
    const body = document.body.innerHTML;
    return /[A-Z0-9]{6}/.test(body) && body.includes('Start Quiz');
  }, { timeout: 120000 }); // 2 min timeout for download
  await sleep(1500);

  const joinCode = await host.page.evaluate(() => {
    const body = document.body.innerHTML;
    const match = body.match(/class="join-code"[^>]*>([A-Z0-9]{6})/);
    if (match) return match[1];
    const all = body.match(/[A-Z0-9]{6}/g) || [];
    return all.find(c => /[A-Z]/.test(c) && /[0-9]/.test(c)) || '';
  });
  console.log(`📺 Join code: ${joinCode}\n`);

  if (!joinCode) { console.error('❌ No join code'); process.exit(1); }

  // ─── Players join ──────────────────────────────────────
  for (let i = 0; i < 3; i++) {
    console.log(`🎵 ${names[i]} joining...`);
    await players[i].goto(`${BASE}/quiz/play?code=${joinCode}`);
    await sleep(500);
    await players[i].fill('#join-name', names[i]);
    await players[i].click(`.avatar-btn:nth-child(${avatarIdx[i] + 1})`);
    await sleep(200);
    await players[i].click('#btn-join');
    await sleep(800);
  }
  console.log('');

  // ─── Start quiz ────────────────────────────────────────
  console.log('📺 Starting quiz!\n');
  await host.page.waitForFunction(() => {
    const btn = document.getElementById('btn-start');
    return btn && !btn.disabled;
  }, { timeout: 15000 });
  await sleep(500);
  await host.page.click('#btn-start');

  // ─── Play questions ────────────────────────────────────
  for (let q = 1; q <= QUESTIONS; q++) {
    console.log(`🎵 Q${q}/${QUESTIONS}`);
    await sleep(4500); // countdown + question appears

    for (let i = 0; i < 3; i++) {
      await sleep(300 + Math.random() * 1500);
      try {
        const btns = await players[i].$$('.mc-btn:not(:disabled)');
        if (btns.length > 0) {
          const idx = Math.floor(Math.random() * btns.length);
          await btns[idx].click();
          console.log(`   ${names[i]} → option ${idx + 1}`);
        } else {
          try {
            await players[i].fill('#ft-input', `answer ${q}`);
            await players[i].click('#ft-submit-btn');
            console.log(`   ${names[i]} → text`);
          } catch {}
        }
      } catch {}
    }

    // Wait for reveal + scoreboard + countdown + buffer
    await sleep(16000);
  }

  // ─── Final results ─────────────────────────────────────
  console.log('\n🏆 Quiz complete!\n');
  await sleep(5000);

  // ─── DJ Mode ───────────────────────────────────────────
  console.log('🎧 Activating DJ Mode...');
  // Click DJ Mode button (may be in different locations)
  await host.page.evaluate(() => {
    for (const btn of document.querySelectorAll('button')) {
      if (btn.textContent.includes('DJ Mode')) { btn.click(); return; }
    }
  });
  await sleep(3000);

  // Players search and add songs
  for (let i = 0; i < 3; i++) {
    console.log(`🎵 ${names[i]} searching "${djSearches[i]}"...`);
    try {
      // Make sure we're on the search tab
      await players[i].evaluate(() => {
        const tab = document.getElementById('dj-tab-search');
        if (tab) tab.click();
      });
      await sleep(300);
      await players[i].fill('#dj-search', djSearches[i]);
      await sleep(2500);

      for (let s = 0; s < 6; s++) {
        const btns = await players[i].$$('.dj-add-btn:not(.used)');
        if (btns.length === 0) break;
        await btns[0].click();
        console.log(`   ${names[i]} added song ${s + 1}`);
        await sleep(400);
      }
    } catch (e) {
      console.log(`   ${names[i]} error: ${e.message}`);
    }
    await sleep(500);
  }

  // Wait for first DJ song to start playing
  console.log('\n🎧 Waiting for music to play...');
  await sleep(5000);

  // ─── Now Playing navigation ────────────────────────────
  console.log('🌐 All players → Now Playing...');
  for (let i = 0; i < 3; i++) {
    try {
      // Click the Now Playing page link in the nav
      const npPageLink = await players[i].$('#dj-np-page-link');
      if (npPageLink) {
        await npPageLink.click();
        console.log(`   ${names[i]} → Now Playing`);
      } else {
        // Fallback: click mini bar
        const npLink = await players[i].$('#dj-np-link');
        if (npLink) { await npLink.click(); console.log(`   ${names[i]} → Now Playing (mini)`); }
      }
      await sleep(1500);
    } catch (e) {
      console.log(`   ${names[i]} Now Playing error: ${e.message}`);
    }
  }
  await sleep(3000);

  // Two players go back to DJ Mode
  console.log('🔙 Christian & Viola → Back to DJ Mode...');
  for (const i of [0, 2]) {
    try {
      const backLink = await players[i].$('a[href*="/quiz/play"]');
      if (backLink) {
        await backLink.click();
        console.log(`   ${names[i]} → Back to DJ Mode`);
      }
      await sleep(2000);
    } catch (e) {
      console.log(`   ${names[i]} back error: ${e.message}`);
    }
  }

  // Wait 10 seconds to observe
  console.log('\n⏳ Waiting 10 seconds...');
  await sleep(10000);

  // ─── Cleanup ───────────────────────────────────────────
  stopScreenRecording();
  await sleep(1000);
  console.log(`\n✅ Done! Recording: ${recordingFile}`);

  // Close all browsers
  console.log('🔒 Closing browsers...');
  for (const b of [host, p1, p2, p3]) {
    try { await b.browser.close(); } catch {}
  }
  process.exit(0);
}

// Ensure recording stops on any exit
process.on('SIGINT', () => { stopScreenRecording(); process.exit(0); });
process.on('SIGTERM', () => { stopScreenRecording(); process.exit(0); });

main().catch(err => {
  console.error('💥', err);
  stopScreenRecording();
  process.exit(1);
});
