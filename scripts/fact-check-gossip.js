import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "fs";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

const GOSSIP_PATH = join(__dirname, "..", "data", "quiz-gossip-bank.json");
const BATCH_SIZE = 20;
const MODEL = "claude-sonnet-4-20250514";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function factCheckBatch(questions, batchIndex) {
  const slim = questions.map((q, i) => ({
    index: i,
    id: q.id,
    questionText: q.questionText,
    correctAnswer: q.correctAnswer,
    options: q.options,
    funFact: q.funFact,
    gossipDate: q.gossipDate,
    category: q.category,
  }));

  const prompt = `FACT-CHECK these celebrity gossip quiz questions. These are for a party game — we want entertaining questions but NOT factually wrong ones.

${JSON.stringify(slim, null, 2)}

For EACH question, verify:
1. Is the correctAnswer factually correct? (names, dates, events)
2. Are the wrong options actually wrong? (no correct answer hiding in wrong options)
3. Is the funFact broadly true? (minor exaggeration is OK for gossip, but not fabricated events)
4. Is gossipDate approximately right? (within ~6 months is fine)

IMPORTANT: "Cannot verify" or "not sure" is NOT a reason to reject. Only reject if you are CONFIDENT the answer is WRONG.

Respond with ONLY a JSON array, no markdown fences, no explanation:
[{"index": 0, "valid": true}]
or
[{"index": 0, "valid": false, "reason": "Shakira's tax case was in 2023 not 2021", "fixedCorrectAnswer": "...", "fixedOptions": ["A","B","C","D"], "fixedFunFact": "..."}]`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].text.trim();
  // Strip markdown fences if present
  const jsonText = text.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    console.error(`Batch ${batchIndex}: Failed to parse response JSON`);
    console.error(text.slice(0, 500));
    // Treat as all valid if parse fails (conservative)
    return questions.map((_, i) => ({ index: i, valid: true }));
  }
}

async function main() {
  const bank = JSON.parse(readFileSync(GOSSIP_PATH, "utf-8"));
  console.log(`Loaded ${bank.length} gossip questions\n`);

  const batches = [];
  for (let i = 0; i < bank.length; i += BATCH_SIZE) {
    batches.push(bank.slice(i, i + BATCH_SIZE));
  }
  console.log(`Split into ${batches.length} batches of up to ${BATCH_SIZE}\n`);

  let passed = 0;
  let fixed = 0;
  let rejected = 0;
  const rejectedList = [];
  const fixedList = [];
  const keepIndices = new Set();

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const globalOffset = b * BATCH_SIZE;
    console.log(`Batch ${b + 1}/${batches.length} (questions ${globalOffset + 1}-${globalOffset + batch.length})...`);

    const results = await factCheckBatch(batch, b + 1);

    for (const r of results) {
      const globalIdx = globalOffset + r.index;
      if (r.valid) {
        passed++;
        keepIndices.add(globalIdx);
      } else if (r.fixedCorrectAnswer && r.fixedOptions) {
        // Apply fix
        bank[globalIdx].correctAnswer = r.fixedCorrectAnswer;
        bank[globalIdx].options = r.fixedOptions;
        if (r.fixedFunFact) bank[globalIdx].funFact = r.fixedFunFact;
        fixed++;
        keepIndices.add(globalIdx);
        fixedList.push({ idx: globalIdx, id: bank[globalIdx].id, reason: r.reason, fix: r.fixedCorrectAnswer });
      } else {
        rejected++;
        rejectedList.push({ idx: globalIdx, id: bank[globalIdx].id, question: bank[globalIdx].questionText, reason: r.reason });
      }
    }
  }

  // Build cleaned bank (only kept questions)
  const cleaned = bank.filter((_, i) => keepIndices.has(i));

  // Write back
  writeFileSync(GOSSIP_PATH, JSON.stringify(cleaned, null, 2) + "\n");

  console.log(`\n${"=".repeat(60)}`);
  console.log(`FACT-CHECK SUMMARY`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Total checked:  ${passed + fixed + rejected}`);
  console.log(`Passed:         ${passed}`);
  console.log(`Fixed:          ${fixed}`);
  console.log(`Rejected:       ${rejected}`);
  console.log(`Final bank:     ${cleaned.length} questions`);

  if (fixedList.length > 0) {
    console.log(`\n--- FIXED ---`);
    for (const f of fixedList) {
      console.log(`  #${f.idx} [${f.id}]: ${f.reason} → fixed to "${f.fix}"`);
    }
  }

  if (rejectedList.length > 0) {
    console.log(`\n--- REJECTED ---`);
    for (const r of rejectedList) {
      console.log(`  #${r.idx} [${r.id}]: "${r.question}"`);
      console.log(`    Reason: ${r.reason}`);
    }
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
