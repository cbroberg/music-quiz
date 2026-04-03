/**
 * E2E Screenshot Quiz Test — 3 Players, No DJ Mode
 *
 * Runs a full quiz with 3 automated players. Screenshots of every question
 * and reveal on host. No DJ Mode — ends at podium.
 * Run multiple times with increasing question counts to grow the question bank.
 *
 * Usage:
 *   node scripts/e2e-screenshot-test-3players.js          # 10 questions
 *   node scripts/e2e-screenshot-test-3players.js 20       # 20 questions
 *   node scripts/e2e-screenshot-test-3players.js 50       # 50 questions
 *   node scripts/e2e-screenshot-test-3players.js 100      # 100 questions
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const QUESTIONS = parseInt(process.argv[2]) || 10;
const TIMER = 15;
const HEADLESS = process.argv.includes('--headless');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = `recordings/e2e-3p-${QUESTIONS}q-${timestamp}`;
mkdirSync(outDir, { recursive: true });

const testLog = [];
const questionLog = []; // Detailed per-question log for validation

function log(msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${msg}`);
  testLog.push({ ts, msg });
}

async function screenshot(page, name) {
  const path = `${outDir}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function main() {
  log(`🎮 E2E 3-Player Quiz — ${QUESTIONS} questions, timer ${TIMER}s\n`);
  log(`📁 Output: ${outDir}`);

  // ─── Launch 4 separate browsers — 3440x1440 ultrawide layout ──
  const H = 1380;
  const hostW = 1720;
  const playerW = 573;

  async function launchWindow(x, y, w, h) {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: HEADLESS ? [] : [`--window-position=${x},${y}`, `--window-size=${w},${h}`],
    });
    const ctx = await browser.newContext({ viewport: { width: HEADLESS ? 1920 : w - 16, height: HEADLESS ? 1080 : h - 80 } });
    const page = await ctx.newPage();
    return { browser, page };
  }

  const host = await launchWindow(0, 25, hostW, H);
  const p1 = await launchWindow(hostW, 25, playerW, H);
  const p2 = await launchWindow(hostW + playerW, 25, playerW, H);
  const p3 = await launchWindow(hostW + playerW * 2, 25, playerW, H);
  log(`🖥️ Mode: ${HEADLESS ? 'headless' : 'visual'} | ${QUESTIONS} questions`);

  const hostPage = host.page;
  const names = ['Christian', 'Nina', 'Viola'];
  const avatarIdx = [0, 3, 6];
  const playerPages = [p1.page, p2.page, p3.page];
  const allBrowsers = [host.browser, p1.browser, p2.browser, p3.browser];

  // ─── Host creates game ─────────────────────────────────
  log('📺 Host: Loading...');
  await hostPage.goto(`${BASE}/quiz/host`);
  await sleep(2000);

  await hostPage.evaluate(({ q, t }) => {
    document.getElementById('cfg-count').value = q;
    document.getElementById('cfg-timer').value = t;
    document.getElementById('cfg-source').value = 'mixed';
    document.getElementById('cfg-type').value = 'mixed';
  }, { q: String(QUESTIONS), t: String(TIMER) });
  await sleep(300);

  log('📺 Creating game...');
  await hostPage.click('#btn-create');
  await sleep(2000);
  await screenshot(hostPage, '00-preparing');

  // Wait for preparation (verified pool: download + verify all songs — can take minutes)
  log('📺 Preparing songs (downloading + verifying)...');
  const prepStart = Date.now();
  // Poll for lobby view with join code
  while (true) {
    const hasCode = await hostPage.evaluate(() => {
      const el = document.querySelector('.join-code');
      return el && el.textContent && el.textContent.trim().length >= 5;
    });
    if (hasCode) break;
    if (Date.now() - prepStart > 300000) throw new Error('Preparation timeout (5 min)');
    await sleep(2000);
    // Log progress if visible
    const progress = await hostPage.evaluate(() => {
      const el = document.getElementById('prepare-status');
      return el?.textContent || '';
    });
    if (progress) log(`   ${progress}`);
  }
  const prepTime = ((Date.now() - prepStart) / 1000).toFixed(1);
  log(`📺 Preparation done in ${prepTime}s`);

  const joinCode = await hostPage.evaluate(() => {
    const el = document.querySelector('.join-code');
    return el?.textContent?.trim() || '';
  });
  log(`📺 Join code: ${joinCode}`);
  await screenshot(hostPage, '01-lobby-empty');

  if (!joinCode) { log('❌ No join code'); process.exit(1); }

  // ─── Players join ──────────────────────────────────────
  for (let i = 0; i < 3; i++) {
    log(`🎵 ${names[i]} joining...`);
    await playerPages[i].goto(`${BASE}/quiz/play?code=${joinCode}`);
    await sleep(800);
    await playerPages[i].fill('#join-name', names[i]);
    await playerPages[i].click(`.avatar-btn:nth-child(${avatarIdx[i] + 1})`);
    await sleep(200);
    await playerPages[i].click('#btn-join');
    await sleep(1000);
  }
  await screenshot(hostPage, '02-lobby-3players');
  log('');

  // ─── Start quiz ────────────────────────────────────────
  log('📺 Starting quiz!');
  await hostPage.waitForFunction(() => {
    const btn = document.getElementById('btn-start');
    return btn && !btn.disabled;
  }, { timeout: 10000 });
  await sleep(500);
  await hostPage.click('#btn-start');
  await sleep(500);

  // ─── Play all questions ────────────────────────────────
  let totalCorrect = [0, 0, 0];
  const quizStart = Date.now();

  for (let q = 1; q <= QUESTIONS; q++) {
    const qStart = Date.now();
    log(`\n── Q${q}/${QUESTIONS} ──`);

    // Wait for question on first player
    try {
      await playerPages[0].waitForSelector('.mc-btn:not(:disabled), #ft-input', { timeout: 60000 });
    } catch {
      log(`   ⚠️ Question ${q} didn't appear — checking state...`);
      await screenshot(hostPage, `Q${String(q).padStart(3,'0')}-host-timeout`);
      await screenshot(playerPages[0], `Q${String(q).padStart(3,'0')}-p1-timeout`);
      break;
    }
    await sleep(300);

    // Screenshot host question
    const qPad = String(q).padStart(3, '0');
    await screenshot(hostPage, `Q${qPad}-host-question`);

    // Read question details from host
    const hostInfo = await hostPage.evaluate(() => {
      return {
        type: document.getElementById('q-type')?.textContent || '',
        number: document.getElementById('q-number')?.textContent || '',
      };
    });

    // Read options from first player
    const playerInfo = await playerPages[0].evaluate(() => {
      const type = document.getElementById('mc-type')?.textContent || '';
      const btns = [...document.querySelectorAll('.mc-btn')].map(b => b.textContent);
      const isFreeText = !!document.getElementById('ft-input');
      return { type, options: btns, isFreeText };
    });

    log(`   Type: ${hostInfo.type}`);
    if (playerInfo.isFreeText) {
      log(`   Mode: Free Text`);
    } else {
      log(`   Options: ${playerInfo.options.join(' | ')}`);
    }

    // All players answer — try MC buttons first, then free-text
    const answers = [];
    for (let i = 0; i < 3; i++) {
      await sleep(300 + Math.random() * 1000);
      try {
        // Try MC buttons
        const btns = await playerPages[i].$$('.mc-btn:not(:disabled)');
        if (btns.length > 0) {
          const idx = Math.floor(Math.random() * btns.length);
          await btns[idx].click();
          answers.push({ player: names[i], answer: playerInfo.options[idx] || `option ${idx}`, type: 'mc' });
        } else {
          // Try free-text
          const ftInput = await playerPages[i].$('#ft-input');
          const ftBtn = await playerPages[i].$('#ft-submit-btn');
          if (ftInput && ftBtn) {
            const texts = ['The Beatles', 'Queen', 'ABBA', 'Led Zeppelin', 'Pink Floyd', 'Nirvana', 'Adele', 'Bob Marley'];
            const text = texts[Math.floor(Math.random() * texts.length)];
            await ftInput.fill(text);
            await ftBtn.click();
            answers.push({ player: names[i], answer: text, type: 'text' });
          } else {
            answers.push({ player: names[i], answer: 'NO_INPUT', type: 'skip' });
          }
        }
      } catch (e) {
        answers.push({ player: names[i], answer: 'FAILED', type: 'error' });
      }
    }
    for (const a of answers) {
      log(`   ${a.player} → ${a.answer}`);
    }

    // Wait for reveal phase (host shows reveal screen)
    try {
      await hostPage.waitForFunction(() => {
        const reveal = document.getElementById('screen-reveal');
        return reveal && (reveal.classList.contains('active') || reveal.style.display !== 'none');
      }, { timeout: 30000 });
      await sleep(1000);
    } catch {
      log(`   ⚠️ Reveal didn't appear`);
    }

    // Screenshot reveal on host
    await screenshot(hostPage, `Q${qPad}-host-reveal`);

    // Read results from all players
    const results = [];
    for (let i = 0; i < 3; i++) {
      try {
        const r = await playerPages[i].evaluate(() => {
          const container = document.querySelector('.result-container');
          return {
            correct: container?.classList.contains('result-correct') || false,
            answer: document.querySelector('.result-answer')?.textContent || '',
            points: document.querySelector('.result-points')?.textContent || '',
          };
        });
        results.push({ player: names[i], ...r });
        if (r.correct) totalCorrect[i]++;
      } catch {
        results.push({ player: names[i], correct: false, answer: '?', points: '' });
      }
    }

    // Read fun fact from host
    const funFact = await hostPage.evaluate(() => {
      const el = document.getElementById('fun-fact');
      return el?.style.display !== 'none' ? el?.textContent : '';
    });

    const qTime = ((Date.now() - qStart) / 1000).toFixed(1);
    for (const r of results) {
      log(`   ${r.correct ? '✅' : '❌'} ${r.player}: ${r.answer} ${r.points}`);
    }
    if (funFact) log(`   💡 ${funFact}`);
    log(`   ⏱ ${qTime}s`);

    questionLog.push({
      question: q,
      hostType: hostInfo.type,
      playerType: playerInfo.type,
      options: playerInfo.options,
      answers,
      results,
      funFact: funFact || null,
      durationMs: Date.now() - qStart,
    });

    // Wait for next question
    if (q < QUESTIONS) {
      try {
        // First wait for current question to leave (result/scoreboard phase)
        await playerPages[0].waitForFunction((qn) => {
          const qnumEl = document.getElementById('mc-qnum') || document.getElementById('ft-qnum');
          const text = qnumEl?.textContent || '';
          // Wait until question number changes (next question arrived)
          return text.includes(`${qn + 1} /`) || text.includes(`${qn + 1}/`);
        }, q, { timeout: 45000 });
      } catch {
        log(`   ⚠️ Timeout waiting for Q${q + 1}`);
        await sleep(2000);
      }
    }
  }

  // ─── Final results ─────────────────────────────────────
  const totalTime = ((Date.now() - quizStart) / 1000).toFixed(0);
  log(`\n🏆 Quiz complete! ${QUESTIONS} questions in ${totalTime}s\n`);

  try {
    await hostPage.waitForFunction(() => {
      return document.body.innerHTML.includes('Quiz Complete') ||
             document.body.innerHTML.includes('DJ Mode');
    }, { timeout: 30000 });
  } catch {}

  // Let Champions play for 10 seconds, screenshot podium
  await sleep(10000);
  await screenshot(hostPage, 'final-host-podium');
  for (let i = 0; i < 3; i++) {
    await screenshot(playerPages[i], `final-${names[i].toLowerCase()}-result`);
  }

  // Read final scores from host
  const finalScores = await hostPage.evaluate(() => {
    const rows = document.querySelectorAll('.score-row, .podium-card');
    return [...rows].map(r => r.textContent?.trim() || '').filter(Boolean);
  });
  log('📊 Final Scores:');
  for (const s of finalScores) log(`   ${s}`);

  log(`\n📊 Accuracy: ${names.map((n, i) => `${n}: ${totalCorrect[i]}/${QUESTIONS}`).join(', ')}`);

  // ─── Fetch server logs ─────────────────────────────────
  log('\n📋 Fetching server logs...');
  try {
    const playLog = await (await fetch(`${BASE}/quiz/api/admin/play-log`)).json();
    const trackLog = await (await fetch(`${BASE}/quiz/api/admin/track-log`)).json();
    writeFileSync(`${outDir}/play-log.json`, JSON.stringify(playLog, null, 2));
    writeFileSync(`${outDir}/track-log.json`, JSON.stringify(trackLog, null, 2));
    log(`   Play log: ${playLog.length} entries`);
    log(`   Track log: ${trackLog.length} entries`);
  } catch (e) {
    log(`   ⚠️ Log fetch failed: ${e.message}`);
  }

  // Check question bank growth
  try {
    const bankRaw = readFileSync('/tmp/quiz-question-bank.json', 'utf-8');
    const bank = JSON.parse(bankRaw);
    log(`   🧠 Question bank: ${bank.length} questions`);
  } catch {}

  // ─── Post-test validation ───────────────────────────────
  log('\n🔍 Post-test validation...');

  // Check for duplicate artists
  const artistCounts = {};
  for (const q of questionLog) {
    const answer = q.results?.[0]?.answer || '';
    // Extract artist from "Song — Artist (Year)" format
    const match = answer.match(/— (.+?) \(/);
    const artist = match?.[1] || 'unknown';
    artistCounts[artist] = (artistCounts[artist] || 0) + 1;
  }
  const dupes = Object.entries(artistCounts).filter(([_, c]) => c > 1);
  if (dupes.length > 0) {
    log('   ⚠️ DUPLICATE ARTISTS:');
    for (const [artist, count] of dupes) log(`      ${artist}: ${count}x`);
  } else {
    log('   ✅ No duplicate artists');
  }

  // Check question type distribution
  const typeCounts = {};
  for (const q of questionLog) {
    typeCounts[q.hostType] = (typeCounts[q.hostType] || 0) + 1;
  }
  log('   📊 Question types:');
  for (const [type, count] of Object.entries(typeCounts)) {
    log(`      ${type || 'trivia'}: ${count}`);
  }

  // Verify no question had "ALL alternatives exhausted"
  try {
    const serverLog = readFileSync('/tmp/quiz-server.log', 'utf-8');
    const exhausted = (serverLog.match(/ALL alternatives exhausted/g) || []).length;
    const mismatches = (serverLog.match(/MISMATCH/g) || []).length;
    const noMusic = (serverLog.match(/no music/gi) || []).length;
    if (exhausted > 0) log(`   ❌ ${exhausted} questions had NO music (alternatives exhausted)`);
    if (mismatches > 0) log(`   ⚠️ ${mismatches} song mismatches`);
    if (exhausted === 0 && mismatches === 0) log('   ✅ All questions played correct music');
  } catch {}

  // Save all logs
  writeFileSync(`${outDir}/test-log.json`, JSON.stringify(testLog, null, 2));
  writeFileSync(`${outDir}/question-log.json`, JSON.stringify(questionLog, null, 2));
  log(`\n✅ Done! ${outDir}`);
  log(`   Screenshots: ${questionLog.length * 2 + 6} files`);
  log(`   Prep time: ${prepTime}s`);
  log(`   Quiz time: ${totalTime}s`);
  log(`   Bank growth: check question-bank.json`);

  await sleep(2000);
  for (const b of allBrowsers) await b.close();
}

main().catch(e => { console.error(e); process.exit(1); });
