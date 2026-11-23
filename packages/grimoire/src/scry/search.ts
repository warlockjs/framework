/**
 * `scry --search`: ranks the book's features, flows, blocks, pages, screens,
 * routes, mails, jobs, files, exports and tasks for a text, which may be a whole
 * sentence (a commit title, a bug report).
 *
 * Two tiers. Names come first: a candidate whose id or title is the whole query,
 * starts with it, or holds every query word as a whole word ranks above everything
 * else. Below them, a BM25F score ranks every candidate that shares words with the
 * query: whole words only, light stemming, no stop words, over four fields (id and
 * path words 3, export names 2, header sentence 1, written text 1).
 *
 * The index is built once per snapshot and kept in a `WeakMap`, so the MCP server
 * and the dev tab do not rebuild it for each query.
 */
import type { ScryHit, ScryHitType, ScryQuery } from "../contracts/scry";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import type { WrittenFeature, WrittenFlow } from "../contracts/written";

/** An id such as `AC-5` is one word (`ac5`), so it never matches `ac` alone. */
const ID_PATTERN = /\b([a-z]{1,5})-(\d+)\b/gi;

/** Arabic words of five or more letters lose a leading article (`ال`, `وال`, `بال`, `لل`). */
const ARABIC_ARTICLE = /^(?:وال|بال|لل|ال)/u;
const ARABIC_WORD = /^\p{Script=Arabic}+$/u;
const ARTICLE_MIN_LENGTH = 5;

/**
 * Letters without accents or marks, in one form: accents and Arabic vowel marks
 * are dropped (which also unifies alef with hamza), tatweel is dropped, `ى` is
 * `ي` and `ة` is `ه`, upper case is lower case.
 */
function foldText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\p{M}\u0640]/gu, "")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647");
}

/**
 * The words of a text, one tokeniser for the query and the index: `catalog/new-arrivals.service.ts` →
 * `catalog new arrivals service ts`; `AC-5` → `ac5`; `café` → `cafe`; `الشحنة` → `شحنه`.
 */
export function wordsOf(text: string): string[] {
  return foldText(text)
    .replace(ID_PATTERN, "$1$2")
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "")
    .map((word) =>
      word.length >= ARTICLE_MIN_LENGTH && ARABIC_WORD.test(word)
        ? word.replace(ARABIC_ARTICLE, "")
        : word,
    );
}

/**
 * Words that carry no meaning in a sentence and are left out of the query and the
 * index. The set is extendable: add words before the first search of a process.
 */
export const SCRY_STOP_WORDS: Set<string> = new Set([
  ..."the a an and or of to in on for with at by from is are was be been not no only its it their this that these those into through after before when then than so as has have had do does did can will should would via per if but also each any".split(
    " ",
  ),
  // Arabic: in, from, on, to, about, with, this (m, f), that, which (m, f), and, or.
  ...wordsOf("في من على إلى عن مع هذا هذه ذلك الذي التي أو و"),
]);

/** BM25 term saturation. */
const K1 = 1.2;

/** BM25 length normalisation. */
const B = 0.75;

/** Field weights of the BM25F score. */
const WEIGHT = { id: 3, exports: 2, about: 1, body: 1 } as const;

/** File types that rank below code on an equal match, and by how much. */
const LOW_RANK_FILE_TYPES: ReadonlySet<string> = new Set(["spec", "locale", "type"]);
const LOW_RANK_FACTOR = 0.6;

/** Added to the name level of features and flows, so written content ranks above files of the same match. */
const WRITTEN_BOOST = 2;

const TYPE_ORDER: readonly ScryHitType[] = [
  "feature",
  "flow",
  "block",
  "page",
  "screen",
  "route",
  "mail",
  "job",
  "file",
  "export",
  "task",
];

const byText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/** One searchable piece of written text of a feature or flow (a summary, a story, a case, a criterion). */
type BodyPart = { label: string; text: string };

/** What a candidate is before it is ranked: the hit without its score. */
type Candidate = {
  hit: Omit<ScryHit, "score" | "matched">;
  /** Name shown to the name tier (an export's own name, a block's `<app>/<page>`). */
  name: string;
  /** Text of the id field of the BM25F score. */
  idText: string;
  exportNames: string[];
  about: string;
  body: BodyPart[];
  /** Whether the BM25F score counts it (exports are found by name and through their file). */
  scored: boolean;
  /** A page or screen file: it outranks helper files on an equal score. */
  pageFile: boolean;
  /** Multiplies the BM25F score: specs, locale files and type files rank below code. */
  factor: number;
};

type Doc = {
  candidate: Candidate;
  /** The name of the candidate as lower-case words, and its last segment, and its title. */
  nameText: string;
  lastText: string;
  nameWords: string[];
  titleText: string;
  titleWords: string[];
  boost: number;
  /** Rank factor of the candidate. */
  factor: number;
  /** Length of the weighted token list (0 when the document is not scored). */
  length: number;
  /** Tokens of the written parts, per part, for the `matched` text. */
  bodyTokens: string[][];
};

type SearchIndex = {
  docs: Doc[];
  postings: Map<string, [number, number][]>;
  idf: Map<string, number>;
  average: number;
};

/** Light stemming: `ies`, `ing`, `ed`, `es` and a plural `s` come off a longer word. */
function stem(word: string): string {
  // Stemming is Latin only.
  if (!/^[a-z0-9]+$/.test(word)) return word;

  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);

  return word;
}

/** The searchable tokens of a text: whole words without stop words, stemmed. */
function tokensOf(text: string): string[] {
  return wordsOf(text)
    .filter((word) => !SCRY_STOP_WORDS.has(word))
    .map(stem);
}

/** The last segment of an id (`catalog/new-arrivals` → `new-arrivals`). */
function lastSegment(id: string): string {
  const parts = id.split(/[\s/#]+/).filter((part) => part !== "");

  return parts[parts.length - 1] ?? id;
}

/** The slug of a block name (`New arrivals` → `new-arrivals`). */
function slug(text: string): string {
  return wordsOf(text).join("-");
}

function flowBody(flow: WrittenFlow): BodyPart[] {
  return [
    ...(flow.summary === null ? [] : [{ label: "summary", text: flow.summary }]),
    { label: "who", text: flow.who.value },
    ...flow.story.map((step) => ({ label: `story ${step.index}`, text: step.text })),
    ...flow.cases.map((item) => ({
      label: `case ${item.question}`,
      text: `${item.question} ${item.answer} ${item.criteria.join(" ")}`,
    })),
    ...flow.criteria.map((item) => ({ label: item.id, text: `${item.id} ${item.text}` })),
  ];
}

function featureBody(feature: WrittenFeature): BodyPart[] {
  const readme = feature.readme;

  if (readme === null) return [];

  return [
    ...(readme.summary === null ? [] : [{ label: "summary", text: readme.summary }]),
    ...(readme.why === null ? [] : [{ label: "why", text: readme.why }]),
    ...readme.audience.map((item) => ({ label: "audience", text: item.value })),
  ];
}

/** The written app id of a site, or its own id. */
function siteApp(snapshot: GrimoireSnapshot, site: string): string {
  const match = Object.values(snapshot.apps).find((app) => app.site?.id === site);

  return match?.app ?? site;
}

/** The written app id of a mobile app, or its own id. */
function mobileApp(snapshot: GrimoireSnapshot, mobile: string): string {
  const match = Object.values(snapshot.apps).find((app) => app.mobile?.id === mobile);

  return match?.app ?? mobile;
}

/** The app a file belongs to: the mobile app that owns it, else the site or mobile root that holds it. */
function appOfFile(
  snapshot: GrimoireSnapshot,
  file: { file: string; mobileApp: string | null },
): string | undefined {
  if (file.mobileApp !== null) return mobileApp(snapshot, file.mobileApp);

  let best: { app: string; length: number } | undefined;

  for (const match of Object.values(snapshot.apps)) {
    const root = match.site?.root ?? match.mobile?.root;

    if (root === undefined || root === "" || root === ".") continue;
    if (file.file !== root && !file.file.startsWith(`${root}/`)) continue;
    if (best === undefined || root.length > best.length) {
      best = { app: match.app, length: root.length };
    }
  }

  return best?.app;
}

function candidates(snapshot: GrimoireSnapshot): Candidate[] {
  const facts = snapshot.book.facts;
  const list: Candidate[] = [];
  const pageFiles = new Set<string>([
    ...facts.pages.map((page) => page.file),
    ...facts.mobile.flatMap((app) => app.screens.map((screen) => screen.file)),
  ]);

  const add = (hit: Candidate["hit"], extra: Partial<Omit<Candidate, "hit">> = {}): void => {
    list.push({
      hit,
      name: extra.name ?? hit.id,
      idText: extra.idText ?? hit.id,
      exportNames: extra.exportNames ?? [],
      about: extra.about ?? hit.detail ?? "",
      body: extra.body ?? [],
      scored: extra.scored ?? true,
      pageFile: extra.pageFile ?? false,
      factor: extra.factor ?? 1,
    });
  };

  for (const feature of snapshot.written.features) {
    add(
      { type: "feature", id: feature.id, detail: feature.readme?.title.value ?? null },
      { body: featureBody(feature) },
    );

    for (const flow of feature.flows) {
      add(
        { type: "flow", id: flow.ref, detail: flow.heading?.value ?? null },
        { body: flowBody(flow) },
      );
    }
  }

  for (const app of snapshot.written.apps) {
    const appId = app.id.value;
    const rows = [
      ...app.layouts.flatMap((layout) => layout.blocks.map((row) => ({ page: layout.id, row }))),
      ...[...app.pages, ...app.screens].flatMap((page) =>
        page.blocks.map((row) => ({ page: page.id, row })),
      ),
    ];

    for (const { page, row } of rows) {
      // A block is found through its page and its text, never through the slug of its whole text.
      add(
        {
          type: "block",
          id: `${appId}/${page}/${slug(row.block)}`,
          detail: row.flow ?? row.block,
          app: appId,
        },
        { name: `${appId}/${page}`, idText: `${appId}/${page}`, about: row.block },
      );
    }
  }

  for (const page of facts.pages) {
    const app = siteApp(snapshot, page.site);

    add({ type: "page", id: `${app} ${page.route}`, detail: page.file, app });
  }

  for (const mobile of facts.mobile) {
    const app = mobileApp(snapshot, mobile.id);

    for (const screen of mobile.screens) {
      add({ type: "screen", id: `${app} ${screen.route}`, detail: screen.file, app });
    }
  }

  for (const route of facts.routes ?? []) {
    if (route.isPage) continue;

    add({ type: "route", id: `${route.method} ${route.path}`, detail: route.name });
  }

  for (const thing of facts.named) {
    if (thing.type !== "mail" && thing.type !== "job") continue;

    add({ type: thing.type, id: thing.name, detail: thing.file });
  }

  for (const file of facts.files) {
    const app = appOfFile(snapshot, file);

    add(
      {
        type: "file",
        id: file.file,
        detail: file.about,
        ...(app === undefined ? {} : { app }),
      },
      {
        exportNames: file.exports
          .filter((entry) => entry.name !== "default" && entry.name !== "*")
          .map((entry) => entry.name),
        pageFile: pageFiles.has(file.file),
        factor: LOW_RANK_FILE_TYPES.has(file.type) ? LOW_RANK_FACTOR : 1,
      },
    );

    for (const entry of file.exports) {
      if (entry.name === "default" || entry.name === "*") continue;

      add(
        { type: "export", id: `${file.file}#${entry.name}`, detail: entry.about },
        { name: entry.name, scored: false },
      );
    }
  }

  for (const task of [
    ...snapshot.collected.tasksIndex.open,
    ...snapshot.collected.tasksIndex.done,
  ]) {
    add({ type: "task", id: task.id, detail: task.title });
  }

  // The first candidate of a type and id wins.
  const seen = new Set<string>();

  return list.filter((item) => {
    const key = `${item.hit.type} ${item.hit.id}`;

    if (seen.has(key)) return false;

    seen.add(key);

    return true;
  });
}

function buildIndex(snapshot: GrimoireSnapshot): SearchIndex {
  const docs: Doc[] = [];
  const postings = new Map<string, [number, number][]>();
  let scoredCount = 0;
  let totalLength = 0;

  for (const candidate of candidates(snapshot)) {
    const nameWords = wordsOf(candidate.name);
    const titleWords = wordsOf(candidate.hit.detail ?? "");
    const bodyTokens = candidate.body.map((part) => tokensOf(part.text));
    const doc: Doc = {
      candidate,
      nameText: nameWords.join(" "),
      lastText: wordsOf(lastSegment(candidate.name)).join(" "),
      nameWords,
      titleText: titleWords.join(" "),
      titleWords,
      factor: candidate.factor,
      boost: candidate.hit.type === "feature" || candidate.hit.type === "flow" ? WRITTEN_BOOST : 0,
      length: 0,
      bodyTokens,
    };

    if (candidate.scored) {
      const frequency = new Map<string, number>();
      const count = (tokens: string[], weight: number): void => {
        for (const token of tokens) {
          frequency.set(token, (frequency.get(token) ?? 0) + weight);
          doc.length += weight;
        }
      };

      count(tokensOf(candidate.idText), WEIGHT.id);
      count(tokensOf(candidate.exportNames.join(" ")), WEIGHT.exports);
      count(tokensOf(candidate.about), WEIGHT.about);

      for (const tokens of bodyTokens) count(tokens, WEIGHT.body);

      for (const [token, weighted] of frequency) {
        const list = postings.get(token) ?? [];

        list.push([docs.length, weighted]);
        postings.set(token, list);
      }

      scoredCount++;
      totalLength += doc.length;
    }

    docs.push(doc);
  }

  const idf = new Map<string, number>();

  for (const [token, list] of postings) {
    idf.set(token, Math.log(1 + (scoredCount - list.length + 0.5) / (list.length + 0.5)));
  }

  return { docs, postings, idf, average: scoredCount === 0 ? 1 : totalLength / scoredCount };
}

const indexes = new WeakMap<GrimoireSnapshot, SearchIndex>();

function indexOf(snapshot: GrimoireSnapshot): SearchIndex {
  let index = indexes.get(snapshot);

  if (index === undefined) {
    index = buildIndex(snapshot);
    indexes.set(snapshot, index);
  }

  return index;
}

/**
 * The name level of a candidate for the query, or 0: the whole query is the name
 * or the title (7), starts it (6), every word is a whole word of the name or of the
 * title (5), or the words are spread over both (4).
 */
function nameLevel(doc: Doc, query: string, words: readonly string[]): number {
  if (doc.nameText === query || doc.lastText === query || doc.titleText === query) return 7;
  if (
    doc.nameText.startsWith(query) ||
    doc.lastText.startsWith(query) ||
    doc.titleText.startsWith(query)
  ) {
    return 6;
  }

  if (
    words.every((word) => doc.nameWords.includes(word)) ||
    words.every((word) => doc.titleWords.includes(word))
  ) {
    return 5;
  }

  return words.every((word) => doc.nameWords.includes(word) || doc.titleWords.includes(word))
    ? 4
    : 0;
}

/** The written part that holds most of the query tokens, as `label: text`, or `undefined`. */
function matchedPart(doc: Doc, tokens: readonly string[]): string | undefined {
  let best = 0;
  let found: BodyPart | undefined;

  doc.bodyTokens.forEach((partTokens, position) => {
    const count = tokens.filter((token) => partTokens.includes(token)).length;

    if (count > best) {
      best = count;
      found = doc.candidate.body[position];
    }
  });

  if (found === undefined) return undefined;

  const text = found.text.replace(/\s+/g, " ").trim();

  return `${found.label}: ${text.length > 90 ? `${text.slice(0, 89)}…` : text}`;
}

export type SearchOutcome = {
  /** How many candidates matched, per type, before the limit cut the list. */
  counts: Partial<Record<ScryHitType, number>>;
  /** Best first. */
  hits: ScryHit[];
  /** The best hit is not a name match and holds fewer than half of the query's distinct words. */
  weak: boolean;
};

/**
 * Rank the book for a search query. A query of stop words only matches nothing.
 * Hits are in score order; on an equal score written content comes first, then a
 * page or screen file before helper files, then the type, then the id.
 */
export function searchSnapshot(
  snapshot: GrimoireSnapshot,
  query: Extract<ScryQuery, { type: "search" }>,
): SearchOutcome {
  const index = indexOf(snapshot);
  const words = wordsOf(query.text);
  const queryText = words.join(" ");
  const tokens = [...new Set(tokensOf(query.text))];
  const outcome: SearchOutcome = { counts: {}, hits: [], weak: false };

  if (tokens.length === 0) return outcome;

  // BM25F over the terms of the query.
  const bm25 = new Map<number, number>();

  for (const token of tokens) {
    const list = index.postings.get(token);
    const idf = index.idf.get(token);

    if (list === undefined || idf === undefined) continue;

    for (const [position, weighted] of list) {
      const length = index.docs[position]?.length ?? 0;
      const part =
        ((idf * weighted * (K1 + 1)) / (weighted + K1 * (1 - B + (B * length) / index.average))) *
        (index.docs[position]?.factor ?? 1);

      bm25.set(position, (bm25.get(position) ?? 0) + part);
    }
  }

  const levels = new Map<number, number>();

  index.docs.forEach((doc, position) => {
    const level = nameLevel(doc, queryText, words);

    if (level > 0) levels.set(position, level);
  });

  // Name matches score above every BM25F score; the BM25F score orders them inside a level.
  let highest = 0;

  for (const value of bm25.values()) highest = Math.max(highest, value);

  const offset = highest + 1;
  const matched = new Set([...bm25.keys(), ...levels.keys()]);
  const ranked: { doc: Doc; score: number; named: boolean }[] = [];

  for (const position of matched) {
    const doc = index.docs[position];

    if (doc === undefined) continue;
    if (query.app !== undefined && doc.candidate.hit.app !== query.app) continue;

    const level = levels.get(position);
    const score = bm25.get(position) ?? 0;

    ranked.push(
      level === undefined
        ? { doc, score, named: false }
        : { doc, score: offset + level + doc.boost + score / offset, named: true },
    );
  }

  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      Number(right.doc.boost > 0) - Number(left.doc.boost > 0) ||
      Number(right.doc.candidate.pageFile) - Number(left.doc.candidate.pageFile) ||
      TYPE_ORDER.indexOf(left.doc.candidate.hit.type) -
        TYPE_ORDER.indexOf(right.doc.candidate.hit.type) ||
      byText(left.doc.candidate.hit.id, right.doc.candidate.hit.id),
  );

  const best = ranked[0];

  if (best !== undefined && !best.named) {
    const position = index.docs.indexOf(best.doc);
    const held = tokens.filter((token) =>
      index.postings.get(token)?.some(([at]) => at === position),
    ).length;

    outcome.weak = held * 2 < tokens.length;
  }

  for (const { doc } of ranked) {
    const type = doc.candidate.hit.type;

    outcome.counts[type] = (outcome.counts[type] ?? 0) + 1;
  }

  for (const { doc, score, named } of ranked.slice(0, query.limit ?? 20)) {
    // A feature or flow found by its written text shows the part that matched.
    const part = named || doc.boost === 0 ? undefined : matchedPart(doc, tokens);

    outcome.hits.push({
      ...doc.candidate.hit,
      score,
      ...(part === undefined ? {} : { matched: part }),
    });
  }

  return outcome;
}
