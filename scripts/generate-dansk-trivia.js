/**
 * Generate 100 Danish music trivia questions using Haiku + Sonnet fact-check.
 * Output: data/quiz-trivia-dk.json
 *
 * Covers all eras/genres from artists-dk.json.
 * Each question is fact-checked by Sonnet before inclusion.
 *
 * Usage: node scripts/generate-dansk-trivia.js [target-count]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

const OUTPUT_PATH = 'data/quiz-trivia-dk.json';
const TARGET = parseInt(process.argv[2] || '100');
const BATCH_SIZE = 10;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function logSection(t) { console.log(`\n${'─'.repeat(60)}\n${t}\n${'─'.repeat(60)}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function generateBatch(artistsSlice, existingQuestions) {
  const artistList = artistsSlice.map(a =>
    `${a.name}${a.genre ? ` (${a.genre})` : ''}${a.era ? ` [${a.era}]` : ''}`
  ).join('\n');

  const existingSample = existingQuestions.slice(-5).map(q => q.questionText).join('\n');

  const prompt = `You are a Danish music expert generating trivia for a party quiz. BE CONSERVATIVE — only generate trivia you are 100% confident is historically accurate. It's better to generate fewer reliable questions than many unreliable ones.

DANISH ARTISTS TO FOCUS ON (pick 5-8 you know well):
${artistList}

Already generated (do NOT repeat):
${existingSample || '(none)'}

RULES FOR RELIABLE TRIVIA:
1. ONLY use facts you are completely certain about — no guessing band members, years, or song titles
2. Prefer WELL-KNOWN, verifiable facts:
   - "Olsen Brothers won Eurovision 2000" ✅ (well-documented)
   - "Aqua's 'Barbie Girl' was released in 1997" ✅ (verifiable hit)
   - "Volbeat is a metal band from Denmark" ✅ (genre + country)
   - Gossip about specific band members you might not remember ❌
3. If uncertain about a specific fact, DON'T generate that question
4. Stick to these SAFE question types:
   - country-of-origin (easy — just verify country)
   - Famous hit songs ("Which song by X was a major hit in [year]?")
   - Eurovision/Melodi Grand Prix entries (well-documented)
   - Genre classification
   - Famous collaborations (only well-known ones)

AVOID unless 100% sure:
- Specific band member names (often wrong)
- Exact song release years
- Album track listings
- Obscure biographical facts

Generate ${BATCH_SIZE} questions. Prefer QUALITY over quantity — if you can only make 5 reliable ones, return 5.

For EACH question include:
- questionText + 4 plausible options (in English)
- backgroundSong: A real well-known song by the artist (the most famous you know)
- funFact: An actually surprising, verifiable fact

Respond with ONLY a JSON array:
[{
  "questionType": "artist-trivia",
  "questionText": "Which Danish duo won Eurovision in 2000 with 'Fly on the Wings of Love'?",
  "correctAnswer": "Olsen Brothers",
  "options": ["Olsen Brothers", "Michael Learns to Rock", "Aqua", "Me and My"],
  "artistName": "Olsen Brothers",
  "funFact": "The Olsen Brothers were the oldest Eurovision winners at the time at ages 50 and 46.",
  "backgroundSong": "Fly on the Wings of Love",
  "backgroundArtist": "Olsen Brothers",
  "difficulty": "medium"
}]`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',  // Sonnet for better Danish music accuracy
      max_tokens: 8096,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const raw = JSON.parse(jsonMatch[0]);
    return raw.filter(q => q.questionText && q.correctAnswer && q.options?.length >= 4);
  } catch (e) {
    console.error('  Sonnet error:', e.message);
    return [];
  }
}

async function factCheck(questions) {
  const questionList = questions.map((q, i) =>
    `${i + 1}. Q: ${q.questionText}\n   Correct: ${q.correctAnswer}\n   Options: ${q.options.join(', ')}`
  ).join('\n\n');

  const prompt = `Fact-check these Danish music trivia questions. Return a JSON array with ONE object per question containing:
- index: the question number (1-indexed)
- verdict: "ACCEPT" or "REJECT"
- reason: brief explanation (only for REJECT)

Questions:
${questionList}

Accept only if:
- The correct answer is factually accurate
- The band/artist actually exists
- The song/album is real
- No other option could also be correct

Respond with ONLY a JSON array:
[{"index": 1, "verdict": "ACCEPT"}]`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return questions.map(() => ({ verdict: 'ACCEPT' }));

    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('  Sonnet error:', e.message);
    return questions.map(() => ({ verdict: 'ACCEPT' }));
  }
}

async function main() {
  logSection(`🇩🇰 Generating ${TARGET} Danish trivia questions`);

  // Load Danish artists
  const artists = JSON.parse(readFileSync('packages/quiz-engine/src/data/artists-dk.json', 'utf-8'));
  console.log(`Artists in pool: ${artists.length}`);

  // Load existing if any
  let questions = [];
  if (existsSync(OUTPUT_PATH)) {
    questions = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
    console.log(`Existing questions: ${questions.length}`);
  }

  let batchNum = 0;
  while (questions.length < TARGET) {
    batchNum++;
    logSection(`Batch ${batchNum} (${questions.length}/${TARGET} done)`);

    // Shuffle artists and take a slice for variety
    const shuffled = [...artists].sort(() => Math.random() - 0.5);
    const slice = shuffled.slice(0, 25);

    console.log('  Generating with Haiku...');
    const generated = await generateBatch(slice, questions);
    if (generated.length === 0) {
      console.log('  No questions generated — retrying');
      continue;
    }
    console.log(`  Generated: ${generated.length}`);

    console.log('  Fact-checking with Sonnet...');
    const verdicts = await factCheck(generated);
    const accepted = generated.filter((_, i) => verdicts[i]?.verdict === 'ACCEPT');
    const rejected = generated.length - accepted.length;
    console.log(`  Accepted: ${accepted.length}, Rejected: ${rejected}`);

    // Dedup by questionText
    const existingTexts = new Set(questions.map(q => q.questionText));
    const newOnes = accepted.filter(q => !existingTexts.has(q.questionText));

    // Add metadata
    for (const q of newOnes) {
      q.id = Math.random().toString(36).slice(2, 10);
      q.validated = true;
      q.timesUsed = 0;
      q.createdAt = new Date().toISOString();
      q.locale = 'dk';
      questions.push(q);
    }

    // Save after each batch
    writeFileSync(OUTPUT_PATH, JSON.stringify(questions, null, 2));
    console.log(`  Saved: ${questions.length}/${TARGET}`);

    if (questions.length >= TARGET) break;
    await sleep(1000);
  }

  logSection('Done');
  console.log(`Final: ${questions.length} Danish trivia questions`);
  console.log(`Saved to: ${OUTPUT_PATH}`);

  // Show type distribution
  const types = {};
  for (const q of questions) {
    types[q.questionType] = (types[q.questionType] || 0) + 1;
  }
  console.log('\nType distribution:');
  for (const [type, count] of Object.entries(types)) {
    console.log(`  ${type}: ${count}`);
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
