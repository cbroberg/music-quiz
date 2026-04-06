/**
 * AI Trivia Question Enricher
 *
 * Uses Claude Haiku to generate creative trivia questions from a pool of artists/songs.
 * Called once at quiz creation time — results are persisted in the global question bank.
 * Questions always have background music from the relevant artist.
 */

import Anthropic from "@anthropic-ai/sdk";
import { saveQuestions } from "./question-bank.js";
import type { QuizType } from "@music-quiz/shared";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    client = new Anthropic({ apiKey });
  }
  return client;
}

export interface ArtistSongPool {
  artists: Array<{ name: string; genres?: string[] }>;
  songs: Array<{ id: string; name: string; artistName: string; albumName: string; releaseYear: string }>;
}

export interface GeneratedTrivia {
  questionType: QuizType;
  questionText: string;
  correctAnswer: string;
  options: string[];
  artistName: string;          // the artist this trivia is about
  funFact: string;
  difficulty: "easy" | "medium" | "hard";
  backgroundSongName: string;  // a song by this artist to play
  backgroundArtist: string;
}

const TRIVIA_TYPES: QuizType[] = ["country-of-origin", "band-members", "artist-trivia", "film-soundtrack", "tv-theme"];

/**
 * Fact-check generated trivia using a smarter model.
 * Rejects questions where the correct answer is wrong.
 * Fixes questions where the answer is right but options are broken.
 */
async function factCheckQuestions(questions: GeneratedTrivia[]): Promise<GeneratedTrivia[]> {
  if (questions.length === 0) return [];

  const questionsJson = questions.map((q, i) => ({
    index: i,
    questionText: q.questionText,
    correctAnswer: q.correctAnswer,
    options: q.options,
    funFact: q.funFact,
  }));

  const prompt = `FACT-CHECK these music trivia questions. You are protecting people from learning wrong information. Be EXTREMELY strict.

${JSON.stringify(questionsJson, null, 2)}

CHECK EACH QUESTION:
1. Is correctAnswer ACTUALLY correct? Example: "Which is NOT a member of The Police?" — verify the answer is truly NOT Sting, Andy Summers, or Stewart Copeland. The Police members ARE: Sting, Andy Summers, Stewart Copeland. ONLY those three.
2. Are ALL wrong options actually wrong? A correct answer must NEVER appear as a wrong option.
3. Is the funFact true? No made-up statistics or events.

CRITICAL: For "NOT a member" questions — the correct answer MUST be someone who is NOT in the band. All other options MUST be actual members.

Respond with ONLY a JSON array:
[{"index": 0, "valid": true, "reason": "all facts correct"}]
or
[{"index": 0, "valid": false, "reason": "Andy Summers IS a member of The Police", "fixedCorrectAnswer": "Mark Knopfler", "fixedOptions": ["Sting", "Andy Summers", "Stewart Copeland", "Mark Knopfler"], "fixedFunFact": "corrected fact if needed"}]

If you cannot confidently fix a wrong question, set valid=false with NO fix. We will discard it.`;

  try {
    const response = await getClient().messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const usage = response.usage;
    console.log(`🧠 Sonnet fact-check tokens: ${usage?.input_tokens || 0} in + ${usage?.output_tokens || 0} out`);

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn("🧠 Fact-check: no JSON response, passing all questions through");
      return questions;
    }

    const checks = JSON.parse(jsonMatch[0]) as Array<{
      index: number;
      valid: boolean;
      reason?: string;
      fixedCorrectAnswer?: string;
      fixedOptions?: string[];
      fixedFunFact?: string;
    }>;

    const validated: GeneratedTrivia[] = [];
    for (const check of checks) {
      const q = questions[check.index];
      if (!q) continue;

      if (check.valid) {
        // Apply any fixes from the checker
        if (check.fixedFunFact) q.funFact = check.fixedFunFact;
        validated.push(q);
      } else if (check.fixedCorrectAnswer && check.fixedOptions?.length === 4) {
        // Checker fixed the question
        q.correctAnswer = check.fixedCorrectAnswer;
        q.options = check.fixedOptions;
        if (check.fixedFunFact) q.funFact = check.fixedFunFact;
        console.log(`🧠 Fact-check fixed Q${check.index}: ${check.reason}`);
        validated.push(q);
      } else {
        console.log(`🧠 Fact-check REJECTED Q${check.index}: ${check.reason}`);
      }
    }

    return validated;
  } catch (err) {
    console.warn("🧠 Fact-check failed, passing all questions through:", err);
    return questions;
  }
}

export async function generateTriviaQuestions(
  pool: ArtistSongPool,
  count: number,
): Promise<GeneratedTrivia[]> {
  if (count <= 0 || pool.artists.length === 0) return [];

  const artistList = pool.artists.map(a =>
    `${a.name}${a.genres?.length ? ` (${a.genres.join(", ")})` : ""}`
  ).join(", ");

  const songList = pool.songs.slice(0, 20).map(s =>
    `"${s.name}" by ${s.artistName} (${s.albumName}, ${s.releaseYear})`
  ).join("\n");

  const prompt = `You are generating music trivia for a fun party quiz game. This is a PARTY — keep it fun, surprising, and entertaining. Not a boring exam!

Available artists: ${artistList}

Available songs:
${songList}

Generate exactly ${count} trivia questions. Mix these types:
- country-of-origin: "Which country does [artist] come from?" — plausible country options
- band-members: "Who is the [role] of [band]?" or "Which of these is NOT a member of [band]?" — use real member names
- artist-trivia: Creative facts — real name, first hit, Grammy count, famous collabs, record-breaking facts
- film-soundtrack: "Which film features the song [song]?" — use well-known soundtrack songs (can be from artists above OR famous soundtracks)
- tv-theme: "Which TV show uses [song] as its theme?" — famous TV themes

CRITICAL RULES:
- For EACH question: include a "backgroundSong" field with a real song by the relevant artist (pick from the available songs list when possible, otherwise name a well-known song by that artist)
- The backgroundSong is what plays during the question — it should be from the artist the question is about
- ALL 4 options must be plausible. No obviously wrong answers.
- funFact must be a surprising, party-worthy one-liner shown after the answer is revealed
- Vary the question types — don't repeat the same type twice in a row

Respond with ONLY a JSON array, no other text:
[{
  "questionType": "country-of-origin",
  "questionText": "Which country is Miles Davis from?",
  "correctAnswer": "United States",
  "options": ["United States", "United Kingdom", "Jamaica", "France"],
  "artistName": "Miles Davis",
  "funFact": "Miles Davis once turned down an invitation to the White House because he felt he'd already contributed enough to American culture",
  "backgroundSong": "So What",
  "backgroundArtist": "Miles Davis",
  "difficulty": "easy"
}]`;

  try {
    const response = await getClient().messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const usage = response.usage;
    console.log(`🧠 Haiku tokens: ${usage?.input_tokens || 0} in + ${usage?.output_tokens || 0} out`);

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error("🧠 AI enricher: no JSON array in response");
      return [];
    }

    const raw = JSON.parse(jsonMatch[0]) as Array<{
      questionType: string;
      questionText: string;
      correctAnswer: string;
      options: string[];
      artistName: string;
      funFact: string;
      backgroundSong: string;
      backgroundArtist: string;
      difficulty: string;
    }>;

    const results: GeneratedTrivia[] = raw
      .filter(q => q.questionText && q.correctAnswer && q.options?.length >= 4)
      .map(q => ({
        questionType: (TRIVIA_TYPES.includes(q.questionType as QuizType) ? q.questionType : "artist-trivia") as QuizType,
        questionText: q.questionText,
        correctAnswer: q.correctAnswer,
        options: q.options.slice(0, 4),
        artistName: q.artistName || "Unknown",
        funFact: q.funFact || "",
        backgroundSongName: q.backgroundSong || "",
        backgroundArtist: q.backgroundArtist || q.artistName || "",
        difficulty: (["easy", "medium", "hard"].includes(q.difficulty) ? q.difficulty : "medium") as "easy" | "medium" | "hard",
      }));

    // Fact-check: validate all questions
    const validated = await factCheckQuestions(results);

    // NOTE: Do NOT persist here — engine.ts banks only trivia that are
    // matched with a playable song and actually used in a quiz
    console.log(`🧠 AI enricher: ${results.length} generated → ${validated.length} passed fact-check`);
    return validated;
  } catch (err) {
    console.error("🧠 AI enricher error:", err);
    return [];
  }
}
