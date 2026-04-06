/**
 * AI Answer Evaluator
 *
 * Uses Claude API (haiku) to evaluate free-text quiz answers.
 * Generous with spelling, abbreviations, and partial matches.
 * Batch-evaluates all player answers in a single API call.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AnswerEvaluation } from "@music-quiz/shared";

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

export async function evaluateAnswers(
  correctAnswer: string,
  questionType: string,
  playerAnswers: Array<{ playerId: string; answer: string; timeMs: number }>,
): Promise<AnswerEvaluation[]> {
  if (playerAnswers.length === 0) return [];

  // Build evaluation prompt
  const typeHints: Record<string, string> = {
    "guess-the-artist": "Accept the artist's common name, abbreviations, first name for solo artists, band nicknames. E.g. 'Stones' = 'The Rolling Stones', 'Bruce' = 'Bruce Springsteen'.",
    "guess-the-song": "Accept the song title without parenthetical content, feat. credits, or subtitle. E.g. 'Bohemian' = 'Bohemian Rhapsody' is NOT enough, but 'bohemian rhapsody' = 'Bohemian Rhapsody' is fine.",
    "guess-the-album": "Accept the album name without deluxe/remaster/edition suffixes.",
    "guess-the-year": "Accept answers within ±2 years of the correct year.",
    "intro-quiz": "Player must get both song AND artist approximately correct. Accept partial if they got one of them right.",
    "country-of-origin": "Accept the country in any language or common abbreviation. E.g. 'UK' = 'United Kingdom', 'US' = 'USA' = 'United States', 'Sverige' = 'Sweden'.",
    "band-members": "Accept common nicknames for band members. Must match the specific member asked about.",
    "artist-trivia": "Accept reasonable variations. Be generous with dates (±1 year) and name spelling.",
    "film-soundtrack": "Accept the film title without 'The' prefix, sequel numbers in any format. E.g. 'Rocky 4' = 'Rocky IV'.",
    "tv-theme": "Accept the show name without 'The' prefix or subtitle. E.g. 'Friends' = 'Friends: The One Where...'.",
    "gossip": "Accept reasonable variations of names, couple pairings in any order. Be generous — this is celebrity gossip, not a test.",
  };

  const hint = typeHints[questionType] || "Be generous with spelling and abbreviations.";

  const answersBlock = playerAnswers
    .map((a, i) => `${i + 1}. Player "${a.playerId}": "${a.answer}"`)
    .join("\n");

  const prompt = `You are evaluating music quiz answers. Be generous with spelling mistakes and abbreviations.

Correct answer: "${correctAnswer}"
Question type: ${questionType}
${hint}

Player answers:
${answersBlock}

Evaluate each answer. Respond with ONLY a JSON array, no other text:
[{"index": 0, "correct": true/false, "explanation": "brief reason"}]

The index matches the player order (0-based). Keep explanations under 15 words.`;

  try {
    const client = getClient();
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";

    // Parse JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array in AI response");

    const evaluations = JSON.parse(jsonMatch[0]) as Array<{ index: number; correct: boolean; explanation?: string }>;

    return playerAnswers.map((pa, i) => {
      const ev = evaluations.find((e) => e.index === i);
      return {
        playerId: pa.playerId,
        isCorrect: ev?.correct ?? false,
        confidence: ev ? 0.9 : 0.5,
        explanation: ev?.explanation,
      };
    });
  } catch (err) {
    console.error("🤖 AI evaluation error:", err);
    throw err;
  }
}
