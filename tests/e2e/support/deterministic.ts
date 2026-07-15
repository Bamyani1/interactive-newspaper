import type { ApiMock, BrowserStorageSeed } from "./harness";

export const FIXED_NOW = "2006-04-20T16:00:00.000Z";
export const FIXED_ASK_SESSION_ID = "playwright-audit-session";

export const DEFAULT_STORAGE_SEED: BrowserStorageSeed = {
  localStorage: {
    "transcript-mode": "light",
    "owu-ask-session-id": FIXED_ASK_SESSION_ID,
    "owu-ask-threads": "[]",
  },
  sessionStorage: {},
};

export const EMPTY_ASK_SESSION = {
  turns: [],
  expired: false,
};

export const EXPIRED_ASK_SESSION = {
  turns: [],
  expired: true,
};

export const EMPTY_SEARCH_RESULTS = {
  query: "playwright audit",
  results: [],
  pagination: {
    total: 0,
    limit: 20,
    offset: 0,
    hasMore: false,
  },
};

export const DETERMINISTIC_EDITIONS = {
  editions: [
    { date: "1960-01-13" },
    { date: "1994-01-19" },
    { date: "2006-04-20" },
  ],
  pagination: {
    total: 3,
    limit: 500,
    offset: 0,
    hasMore: false,
  },
};

export const DETERMINISTIC_ASK_META = {
  retrievalTimeMs: 12,
  generationTimeMs: 18,
  totalTimeMs: 30,
  articlesSearched: 0,
  method: "hybrid",
  complexity: "simple",
} as const;

export const DETERMINISTIC_ASK_ANSWER =
  "This answer came from the local Playwright fixture; no live AI request was made.";

export const RETURNING_ASK_QUESTION = "Who edited the paper in 1960?";
export const RETURNING_ASK_ANSWER =
  "The restored local fixture preserves this prior conversation.";

const RETURNING_ASK_TIMESTAMP = Date.parse("2006-04-20T15:00:00.000Z");
export const RETURNING_ASK_TURN = {
  id: "returning-turn",
  question: RETURNING_ASK_QUESTION,
  answer: RETURNING_ASK_ANSWER,
  status: "done",
  sourceArticles: [],
  citations: [],
  meta: DETERMINISTIC_ASK_META,
  confidence: "high",
  requestId: "returning-playwright-request",
  mode: "text",
  createdAt: RETURNING_ASK_TIMESTAMP,
};

export const RETURNING_ASK_SESSION = {
  turns: [
    {
      question: RETURNING_ASK_QUESTION,
      answer: RETURNING_ASK_ANSWER,
      citedArticleIds: [],
      sourceArticles: [],
      timestamp: RETURNING_ASK_TIMESTAMP,
    },
  ],
  expired: false,
};

export const RETURNING_ASK_STORAGE_SEED: BrowserStorageSeed = {
  localStorage: {
    ...DEFAULT_STORAGE_SEED.localStorage,
    "owu-ask-threads": JSON.stringify([
      {
        sessionId: FIXED_ASK_SESSION_ID,
        firstQuestion: RETURNING_ASK_QUESTION,
        turns: [RETURNING_ASK_TURN],
        createdAt: RETURNING_ASK_TIMESTAMP,
        lastUpdatedAt: RETURNING_ASK_TIMESTAMP,
      },
    ]),
  },
  sessionStorage: {},
};

export const SECOND_ASK_SESSION_ID = "playwright-audit-second-thread";
export const SECOND_ASK_QUESTION = "How did students mark the anniversary?";
export const SECOND_ASK_ANSWER =
  "The second archived fixture keeps a separate local thread.";

const SECOND_ASK_TIMESTAMP = Date.parse("2006-04-20T14:00:00.000Z");
export const SECOND_ASK_TURN = {
  id: "second-returning-turn",
  question: SECOND_ASK_QUESTION,
  answer: SECOND_ASK_ANSWER,
  status: "done",
  sourceArticles: [],
  citations: [],
  meta: DETERMINISTIC_ASK_META,
  confidence: "high",
  requestId: "second-returning-playwright-request",
  mode: "text",
  createdAt: SECOND_ASK_TIMESTAMP,
};

export const THREAD_SWITCH_STORAGE_SEED: BrowserStorageSeed = {
  localStorage: {
    ...DEFAULT_STORAGE_SEED.localStorage,
    "owu-ask-threads": JSON.stringify([
      {
        sessionId: FIXED_ASK_SESSION_ID,
        firstQuestion: RETURNING_ASK_QUESTION,
        turns: [RETURNING_ASK_TURN],
        createdAt: RETURNING_ASK_TIMESTAMP,
        lastUpdatedAt: RETURNING_ASK_TIMESTAMP,
      },
      {
        sessionId: SECOND_ASK_SESSION_ID,
        firstQuestion: SECOND_ASK_QUESTION,
        turns: [SECOND_ASK_TURN],
        createdAt: SECOND_ASK_TIMESTAMP,
        lastUpdatedAt: SECOND_ASK_TIMESTAMP,
      },
    ]),
  },
  sessionStorage: {},
};

export const DELAYED_ASK_QUESTION = "Trace the archive research stages";
export const DELAYED_ASK_PARTIAL_ANSWER =
  "The deterministic stream has started";
export const DELAYED_ASK_ANSWER =
  "The deterministic stream has started and completed locally.";

export const DELAYED_ASK_STREAM_EVENTS = [
  { type: "stage", name: "reformulate", elapsedMs: 5 },
  { type: "stage", name: "retrieve", elapsedMs: 10 },
  { type: "stage", name: "rerank", elapsedMs: 15 },
  { type: "stage", name: "generate", elapsedMs: 20 },
  {
    type: "metadata",
    question: DELAYED_ASK_QUESTION,
    mode: "text",
    requestId: "delayed-playwright-request",
    sourceArticles: [],
    meta: DETERMINISTIC_ASK_META,
  },
  { type: "delta", text: DELAYED_ASK_PARTIAL_ANSWER },
  {
    type: "done",
    answer: DELAYED_ASK_ANSWER,
    citations: [],
    confidence: "high",
    sourceArticles: [],
    sessionId: FIXED_ASK_SESSION_ID,
    followUpQuestions: [],
    meta: DETERMINISTIC_ASK_META,
  },
];

export const VISUAL_ASK_QUESTION =
  "Show photographs connected to the student newspaper.";
export const VISUAL_ASK_ANSWER =
  "The local visual fixture links the archive photographs to two source articles.";
export const VISUAL_ASK_SOURCE_HEADLINE = "Editors Gather in the Newsroom";
const VISUAL_ASK_IMAGE_ONE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='600' viewBox='0 0 800 600'%3E%3Crect width='800' height='600' fill='%23d8c8aa'/%3E%3Cpath d='M90 480 290 180l140 190 110-130 170 240Z' fill='%23584a3b'/%3E%3C/svg%3E";
const VISUAL_ASK_IMAGE_TWO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='600' viewBox='0 0 800 600'%3E%3Crect width='800' height='600' fill='%23ede4d2'/%3E%3Ccircle cx='400' cy='270' r='170' fill='%238b1e1e'/%3E%3C/svg%3E";
const VISUAL_ASK_IMAGE_THREE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='600' viewBox='0 0 800 600'%3E%3Crect width='800' height='600' fill='%23c6b99e'/%3E%3Cpath d='M120 140h560v320H120z' fill='%2329231d'/%3E%3C/svg%3E";
export const VISUAL_ASK_SOURCE_ARTICLES = [
  {
    id: "visual-source-1",
    headline: VISUAL_ASK_SOURCE_HEADLINE,
    editionDate: "1960-01-13",
    category: "Campus",
    summary: "Editors prepared the weekly paper.",
    byline: "By Playwright Fixture",
    bodySnippet: "Editors met around the newsroom desk.",
    distance: 0.1,
    imageUrls: [VISUAL_ASK_IMAGE_ONE, VISUAL_ASK_IMAGE_TWO],
    imageCaptions: ["Reading the archive", "The edition front page"],
  },
  {
    id: "visual-source-2",
    headline: "Printing the Anniversary Edition",
    editionDate: "1960-01-13",
    category: "Features",
    summary: "The anniversary issue went to press.",
    byline: null,
    bodySnippet: "The press room prepared a commemorative edition.",
    distance: 0.2,
    imageUrls: [VISUAL_ASK_IMAGE_THREE],
    imageCaptions: ["Newsprint texture"],
  },
];

const VISUAL_ASK_TIMESTAMP = Date.parse("2006-04-20T13:00:00.000Z");
export const VISUAL_ASK_TURN = {
  id: "visual-returning-turn",
  question: VISUAL_ASK_QUESTION,
  answer: VISUAL_ASK_ANSWER,
  status: "done",
  sourceArticles: VISUAL_ASK_SOURCE_ARTICLES,
  citations: [
    {
      articleId: "visual-source-1",
      headline: VISUAL_ASK_SOURCE_HEADLINE,
      editionDate: "1960-01-13",
    },
  ],
  meta: DETERMINISTIC_ASK_META,
  confidence: "high",
  requestId: "visual-playwright-request",
  mode: "visual",
  followUpQuestions: ["Which photographs came from the newsroom?"],
  createdAt: VISUAL_ASK_TIMESTAMP,
};

export const VISUAL_ASK_SESSION = {
  turns: [
    {
      question: VISUAL_ASK_QUESTION,
      answer: VISUAL_ASK_ANSWER,
      citedArticleIds: ["visual-source-1", "visual-source-2"],
      sourceArticles: VISUAL_ASK_SOURCE_ARTICLES,
      timestamp: VISUAL_ASK_TIMESTAMP,
    },
  ],
  expired: false,
};

export const VISUAL_ASK_STORAGE_SEED: BrowserStorageSeed = {
  localStorage: {
    ...DEFAULT_STORAGE_SEED.localStorage,
    "owu-ask-threads": JSON.stringify([
      {
        sessionId: FIXED_ASK_SESSION_ID,
        firstQuestion: VISUAL_ASK_QUESTION,
        turns: [VISUAL_ASK_TURN],
        createdAt: VISUAL_ASK_TIMESTAMP,
        lastUpdatedAt: VISUAL_ASK_TIMESTAMP,
      },
    ]),
  },
  sessionStorage: {},
};

export const VISUAL_ASK_EDITION = {
  articles: [
    {
      id: "visual-source-1",
      headline: VISUAL_ASK_SOURCE_HEADLINE,
      byline: "By Playwright Fixture",
      fullText:
        "<p>The editors assembled around the newsroom desk.</p><p>The complete edition remained available to readers.</p>",
      category: "Campus",
      page: 2,
    },
    {
      id: "visual-source-2",
      headline: "Printing the Anniversary Edition",
      byline: null,
      fullText: "<p>The anniversary issue went to press.</p>",
      category: "Features",
      page: 4,
    },
  ],
};

export const DETERMINISTIC_ASK_STREAM = [
  {
    type: "metadata",
    question: "Who edited the paper?",
    mode: "text",
    requestId: "playwright-request",
    sourceArticles: [],
    meta: DETERMINISTIC_ASK_META,
  },
  { type: "delta", text: DETERMINISTIC_ASK_ANSWER },
  {
    type: "done",
    answer: DETERMINISTIC_ASK_ANSWER,
    citations: [],
    confidence: "high",
    sourceArticles: [],
    sessionId: FIXED_ASK_SESSION_ID,
    followUpQuestions: [],
    meta: DETERMINISTIC_ASK_META,
  },
]
  .map((event) => `data: ${JSON.stringify(event)}\n\n`)
  .join("");

export const DETERMINISTIC_ASK_STREAM_MOCK: ApiMock = {
  url: "**/api/ask**",
  method: "POST",
  headers: {
    "x-audit-fixture": "deterministic-ask-stream",
  },
  contentType: "text/event-stream; charset=utf-8",
  text: DETERMINISTIC_ASK_STREAM,
};

export const DEFAULT_API_MOCKS: ApiMock[] = [
  {
    url: "**/api/ask/session**",
    method: "GET",
    json: EMPTY_ASK_SESSION,
  },
  DETERMINISTIC_ASK_STREAM_MOCK,
  // The desktop context sidebar fetches `/api/weather?date=…`, which the real
  // route rate-limits (10/60s). A deterministic default keeps the exhaustive
  // edition sweep from 429ing. Per-date overrides registered inside a test body
  // win via Playwright's LIFO route ordering.
  {
    url: "**/api/weather**",
    method: "GET",
    json: { record: null, reason: "No deterministic audit weather record." },
  },
];
