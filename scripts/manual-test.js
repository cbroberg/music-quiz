/**
 * Semi-Auto Manual Test — Playwright
 *
 * Opens 3 browser windows (Host + 2 players) positioned on ultrawide.
 * Players are pre-filled with names. YOU click everything.
 * Screen recording runs. Press Ctrl+C when done.
 *
 * Usage: node scripts/manual-test.js
 */

import { chromium } from 'playwright';
import { execSync, spawn } from 'node:child_process';

const BASE = 'http://localhost:3000';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let screenRecordProc = null;

function startScreenRecording() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = `recordings/manual-${timestamp}.mov`;
  execSync('mkdir -p recordings');
  const recorder = new URL('../scripts/screen-record/.build/release/screen-record', import.meta.url).pathname;
  console.log(`🎬 Recording → ${outFile}`);
  screenRecordProc = spawn(recorder, [outFile, '--crop'], { stdio: 'ignore' });
  return outFile;
}

async function stopScreenRecording() {
  if (screenRecordProc) {
    console.log('🎬 Stopping recording...');
    const proc = screenRecordProc;
    screenRecordProc = null;
    try { proc.kill('SIGINT'); } catch {}
    await new Promise(resolve => {
      proc.on('exit', resolve);
      setTimeout(resolve, 5000);
    });
    console.log('🎬 Saved.');
  }
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
  console.log('\n🎮 Semi-Auto Manual Test\n');
  console.log('   Host:    left half');
  console.log('   Players: Christian + Nina (right half)');
  console.log('   YOU click everything. Ctrl+C when done.\n');

  // Minimize other windows
  try {
    execSync(`osascript -e 'tell application "System Events" to set miniaturized of every window of every application process whose visible is true to true'`);
  } catch {}
  await sleep(500);

  // Layout: Host left, 2 players stacked right
  const H = 1380;
  const hostW = 1720;
  const playerW = 860;
  const playerH = Math.floor(H / 2);

  const host = await launchWindow(0, 25, hostW, H);
  const p1 = await launchWindow(hostW, 25, playerW, playerH);
  const p2 = await launchWindow(hostW + playerW, 25, playerW, playerH);

  // Re-minimize Ghostty
  try { execSync(`osascript -e 'tell application "System Events" to tell application process "Ghostty" to set miniaturized of every window to true'`); } catch {}

  // Start recording
  const recordingFile = startScreenRecording();
  await sleep(500);

  // Load host
  await host.page.goto(`${BASE}/quiz/host`);
  console.log('📺 Host loaded — create your quiz!\n');

  // Wait for join code to appear (you click Create Game)
  await host.page.waitForFunction(() => {
    const body = document.body.innerHTML;
    return /[A-Z0-9]{6}/.test(body) && body.includes('Start Quiz');
  }, undefined, { timeout: 300000 }); // 5 min timeout — take your time
  await sleep(500);

  const joinCode = await host.page.evaluate(() => {
    const body = document.body.innerHTML;
    const match = body.match(/class="join-code"[^>]*>([A-Z0-9]{6})/);
    if (match) return match[1];
    const all = body.match(/[A-Z0-9]{6}/g) || [];
    return all.find(c => /[A-Z]/.test(c) && /[0-9]/.test(c)) || '';
  });
  console.log(`📺 Join code: ${joinCode}\n`);

  // Auto-fill player names
  const names = ['Christian', 'Nina'];
  const avatarIdx = [0, 1];
  const players = [p1.page, p2.page];

  for (let i = 0; i < 2; i++) {
    await players[i].goto(`${BASE}/quiz/play?code=${joinCode}`);
    await sleep(500);
    await players[i].fill('#join-name', names[i]);
    await players[i].click(`.avatar-btn:nth-child(${avatarIdx[i] + 1})`);
    await sleep(200);
    await players[i].click('#btn-join');
    console.log(`🎵 ${names[i]} joined!`);
    await sleep(500);
  }

  console.log('\n✅ Players joined! Now YOU run the show.');
  console.log('   Click Start Quiz, answer questions, activate DJ Mode...');
  console.log('   Press Ctrl+C when you\'re done.\n');

  // Wait forever — user is in control
  await new Promise(() => {});
}

process.on('SIGINT', async () => {
  await stopScreenRecording();
  console.log('\n👋 Done!');
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await stopScreenRecording();
  process.exit(0);
});

main().catch(err => {
  console.error('💥', err);
  stopScreenRecording();
  process.exit(1);
});
