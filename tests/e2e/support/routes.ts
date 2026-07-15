export interface AuditRoute {
  name: string;
  path: string;
  acceptedStatuses?: number[];
  firstPaint: FirstPaintExpectation;
}

export interface FirstPaintExpectation {
  selector: string;
  expectedText?: string | RegExp;
}

export const FIRST_PAINT = {
  landing: {
    selector: "h1.cinema-title",
    expectedText: "The Transcript Archive",
  },
  ask: {
    selector: 'textarea[aria-label="Ask a question"]',
    expectedText: "Ask a question about OWU history",
  },
  search: {
    selector: "main h1",
    expectedText: "Search the Archive",
  },
  edition: {
    selector: ".edition-feed-surface h2",
    expectedText: "The Transcript",
  },
  about: {
    selector: "main h1",
    expectedText: "The Transcript Archive",
  },
  contact: {
    selector: "main h1",
    expectedText: "Reach the Archive Team",
  },
  notFound: {
    selector: "main h1",
    expectedText: "Page Not Found",
  },
  primitives: {
    selector: "main h1",
    expectedText: "Primitive component library",
  },
} satisfies Record<string, FirstPaintExpectation>;

export const CRITICAL_ROUTES: AuditRoute[] = [
  { name: "landing", path: "/", firstPaint: FIRST_PAINT.landing },
  { name: "ask", path: "/ask", firstPaint: FIRST_PAINT.ask },
  { name: "search", path: "/search", firstPaint: FIRST_PAINT.search },
  {
    name: "edition-redirect",
    path: "/edition",
    firstPaint: FIRST_PAINT.edition,
  },
];

export const STATIC_AUDIT_ROUTES: AuditRoute[] = [
  ...CRITICAL_ROUTES,
  {
    name: "ask-deep-link",
    path: "/ask?q=Who%20edited%20the%20paper%3F",
    firstPaint: FIRST_PAINT.ask,
  },
  { name: "about", path: "/about", firstPaint: FIRST_PAINT.about },
  { name: "contact", path: "/contact", firstPaint: FIRST_PAINT.contact },
  {
    name: "global-not-found",
    path: "/__audit-missing-route",
    acceptedStatuses: [404],
    firstPaint: FIRST_PAINT.notFound,
  },
  {
    name: "development-primitives",
    path: "/dev/primitives",
    // `/dev/primitives` returns HTTP 200 in development but calls `notFound()`
    // in a production build, so its accepted status and first paint depend on
    // the server mode the sweep runs against.
    acceptedStatuses:
      process.env.PLAYWRIGHT_SERVER_MODE === "production" ? [404] : [200],
    firstPaint:
      process.env.PLAYWRIGHT_SERVER_MODE === "production"
        ? FIRST_PAINT.notFound
        : FIRST_PAINT.primitives,
  },
];

export const DEEP_TEST_EDITIONS = [
  "1960-01-13",
  "1994-01-19",
  "2006-04-20",
] as const;

export interface TransitionCase {
  name: string;
  from: string;
  to: string;
  linkName: RegExp;
  fromFirstPaint: FirstPaintExpectation;
  toFirstPaint: FirstPaintExpectation;
}

export const PRIMARY_TRANSITIONS: TransitionCase[] = [
  {
    name: "landing-to-ask",
    from: "/",
    to: "/ask",
    linkName: /ask the archive/i,
    fromFirstPaint: FIRST_PAINT.landing,
    toFirstPaint: FIRST_PAINT.ask,
  },
  {
    name: "landing-to-edition",
    from: "/",
    to: "/edition/2006-04-20",
    linkName: /open this issue/i,
    fromFirstPaint: FIRST_PAINT.landing,
    toFirstPaint: FIRST_PAINT.edition,
  },
  {
    name: "ask-to-search",
    from: "/ask",
    to: "/search",
    linkName: /search the archive/i,
    fromFirstPaint: FIRST_PAINT.ask,
    toFirstPaint: FIRST_PAINT.search,
  },
  {
    name: "search-to-ask",
    from: "/search",
    to: "/ask",
    linkName: /ask the archive/i,
    fromFirstPaint: FIRST_PAINT.search,
    toFirstPaint: FIRST_PAINT.ask,
  },
  {
    name: "edition-to-ask",
    from: "/edition/1960-01-13",
    to: "/ask",
    linkName: /ask the archive/i,
    fromFirstPaint: FIRST_PAINT.edition,
    toFirstPaint: FIRST_PAINT.ask,
  },
  {
    name: "edition-to-search",
    from: "/edition/1960-01-13",
    to: "/search",
    linkName: /search the archive/i,
    fromFirstPaint: FIRST_PAINT.edition,
    toFirstPaint: FIRST_PAINT.search,
  },
  {
    name: "edition-to-landing",
    from: "/edition/1960-01-13",
    to: "/",
    linkName: /return to landing page/i,
    fromFirstPaint: FIRST_PAINT.edition,
    toFirstPaint: FIRST_PAINT.landing,
  },
  {
    name: "about-to-contact",
    from: "/about",
    to: "/contact",
    linkName: /^contact$/i,
    fromFirstPaint: FIRST_PAINT.about,
    toFirstPaint: FIRST_PAINT.contact,
  },
  {
    name: "contact-to-about",
    from: "/contact",
    to: "/about",
    linkName: /^about$/i,
    fromFirstPaint: FIRST_PAINT.contact,
    toFirstPaint: FIRST_PAINT.about,
  },
];
