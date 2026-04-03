#!/usr/bin/env node
/**
 * Load gossip questions into the gossip bank.
 *
 * Usage: node scripts/load-gossip-bank.js [source-file]
 * Default source: data/gossip-raw-100.json
 *
 * Merges existing gossip-examples.json + source file into quiz-gossip-bank.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const dataDir = join(process.cwd(), "data");
const bankPath = join(dataDir, "quiz-gossip-bank.json");
const examplesPath = join(dataDir, "gossip-examples.json");
const sourceFile = process.argv[2] || join(dataDir, "gossip-raw-100.json");

// Load existing bank
let bank = [];
if (existsSync(bankPath)) {
  bank = JSON.parse(readFileSync(bankPath, "utf-8"));
  console.log(`📦 Existing bank: ${bank.length} questions`);
}

// Track existing questions by text to avoid duplicates
const existingTexts = new Set(bank.map(q => q.questionText));

// Load sources
const sources = [];

// 1. Gossip examples (10 curated)
if (existsSync(examplesPath)) {
  const examples = JSON.parse(readFileSync(examplesPath, "utf-8"));
  sources.push(...examples);
  console.log(`📝 Loaded ${examples.length} from gossip-examples.json`);
}

// 2. Generated gossip
if (existsSync(sourceFile)) {
  const generated = JSON.parse(readFileSync(sourceFile, "utf-8"));
  sources.push(...generated);
  console.log(`📝 Loaded ${generated.length} from ${sourceFile}`);
} else {
  console.error(`❌ Source file not found: ${sourceFile}`);
  process.exit(1);
}

// Merge — skip duplicates
const now = new Date().toISOString();
let added = 0;
for (const q of sources) {
  if (existingTexts.has(q.questionText)) continue;

  // Validate required fields
  if (!q.questionText || !q.correctAnswer || !q.options || q.options.length < 4) {
    console.warn(`⚠️ Skipping invalid question: ${q.questionText?.slice(0, 50)}`);
    continue;
  }

  bank.push({
    id: randomUUID().slice(0, 8),
    questionType: "gossip",
    questionText: q.questionText,
    correctAnswer: q.correctAnswer,
    options: q.options,
    artistName: q.artistName || "Unknown",
    funFact: q.funFact || undefined,
    difficulty: q.difficulty || "medium",
    backgroundSongName: q.backgroundSongName || undefined,
    backgroundArtist: q.backgroundArtist || q.artistName || undefined,
    gossipDate: q.gossipDate || "2024-01",
    category: q.category || "controversy",
    expiresAfter: q.expiresAfter || "2028-01",
    timesUsed: 0,
    createdAt: now,
  });
  existingTexts.add(q.questionText);
  added++;
}

// Write bank
mkdirSync(dataDir, { recursive: true });
writeFileSync(bankPath, JSON.stringify(bank, null, 2));

console.log(`\n✅ Gossip bank: ${added} new + ${bank.length - added} existing = ${bank.length} total`);

// Category breakdown
const cats = {};
for (const q of bank) {
  cats[q.category] = (cats[q.category] || 0) + 1;
}
console.log("\n📊 Categories:");
for (const [cat, count] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${cat}: ${count}`);
}
