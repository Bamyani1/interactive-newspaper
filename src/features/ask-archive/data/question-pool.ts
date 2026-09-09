// Deterministic day-of-year rotation for archive research prompts.
//
// The prompt metadata lets the UI explain *how* a question uses the archive,
// while QUESTION_POOL keeps the simple string API used by deep links and the
// chat submission flow.

export const QUESTION_LENSES = [
  "Compare eras",
  "Student voices",
  "Campus life",
  "In the photographs",
] as const;

export type QuestionLens = (typeof QUESTION_LENSES)[number];

export interface ArchiveQuestionPrompt {
  question: string;
  lens: QuestionLens;
}

export const QUESTION_PROMPTS = [
  {
    lens: "Compare eras",
    question: "How did students describe the cost of college in the 1950s compared with the 2000s?",
  },
  {
    lens: "Compare eras",
    question: "How did coverage of women’s athletics change after Title IX?",
  },
  {
    lens: "Compare eras",
    question: "How did The Transcript’s language around mental health change over the decades?",
  },
  {
    lens: "Compare eras",
    question: "Compare student reactions to national elections in the 1960s and the 1990s.",
  },
  {
    lens: "Compare eras",
    question: "How did campus debates over race and equality change from the 1960s to the 1990s?",
  },
  {
    lens: "Compare eras",
    question: "Which campus traditions survived from 1950 to 2006—and which disappeared?",
  },
  {
    lens: "Student voices",
    question: "What did students praise—and criticize—about campus life in the 1970s?",
  },
  {
    lens: "Student voices",
    question: "What arguments did students make for and against the Vietnam War?",
  },
  {
    lens: "Student voices",
    question: "How did students push back against dorm rules, curfews, and dress codes?",
  },
  {
    lens: "Student voices",
    question: "What did women students say about equality on campus after Title IX?",
  },
  {
    lens: "Student voices",
    question: "How did students respond to rising tuition and financial pressure?",
  },
  {
    lens: "Student voices",
    question: "What do letters to the editor reveal about the campus debates of their day?",
  },
  {
    lens: "Campus life",
    question: "What did a typical Friday night look like for OWU students in the 1950s?",
  },
  {
    lens: "Campus life",
    question: "How did computers first enter campus life, and what did students think of them?",
  },
  {
    lens: "Campus life",
    question: "What were students eating, wearing, and listening to in the 1980s?",
  },
  {
    lens: "Campus life",
    question: "How did Homecoming change between the 1950s and the 1990s?",
  },
  {
    lens: "Campus life",
    question: "What did first-year students worry about across different decades?",
  },
  {
    lens: "Campus life",
    question: "Which Delaware businesses mattered most to students—and why?",
  },
  {
    lens: "In the photographs",
    question: "Show me photographs of student protests and explain what was happening.",
  },
  {
    lens: "In the photographs",
    question: "Find photographs that capture everyday dorm life across the decades.",
  },
  {
    lens: "In the photographs",
    question: "Show how campus fashion changed from the 1950s to the 1990s.",
  },
  {
    lens: "In the photographs",
    question: "Find images of Homecoming traditions that no longer exist.",
  },
  {
    lens: "In the photographs",
    question: "Show how sports photography changed as women’s varsity teams expanded.",
  },
  {
    lens: "In the photographs",
    question: "Find photographs of campus spaces that look very different today.",
  },
] as const satisfies readonly ArchiveQuestionPrompt[];

export const QUESTION_POOL: readonly string[] = QUESTION_PROMPTS.map(({ question }) => question);

const PROMPT_BY_QUESTION = new Map<string, ArchiveQuestionPrompt>(
  QUESTION_PROMPTS.map((prompt) => [prompt.question, prompt])
);

export function getQuestionPrompt(question: string): ArchiveQuestionPrompt | undefined {
  return PROMPT_BY_QUESTION.get(question);
}

// Monotonic day counter — year * 366 + day-of-year — so the index
// keeps advancing across year boundaries instead of resetting.
function dayIndex(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return date.getUTCFullYear() * 366 + Math.floor((date.getTime() - start) / 86_400_000);
}

/** Single deterministic question for the given day — drives the homepage teaser. */
export function pickDailyQuestion(date: Date): string {
  return QUESTION_POOL[dayIndex(date) % QUESTION_POOL.length];
}

/**
 * Three daily prompts drawn from three distinct research lenses. Rotating the
 * lens order as well as the prompt keeps the surface fresh without producing
 * three near-identical fact-retrieval questions.
 *
 * Drawing one prompt per lens is also what guarantees the three are distinct,
 * so `exclude` never has to be defended against emptying a lens: each holds
 * six prompts and `exclude` can remove at most one.
 */
export function pickSuggestions(date: Date, exclude?: string): string[] {
  const idx = dayIndex(date);
  const lensStart = idx % QUESTION_LENSES.length;

  return [0, 1, 2].map((offset) => {
    const lens = QUESTION_LENSES[(lensStart + offset) % QUESTION_LENSES.length];
    const candidates = QUESTION_PROMPTS.filter(
      (prompt) => prompt.lens === lens && prompt.question !== exclude
    );
    return candidates[(idx + offset * 2) % candidates.length].question;
  });
}
