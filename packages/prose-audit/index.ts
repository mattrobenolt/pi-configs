export const GENRES = ["general", "technical", "email", "academic", "marketing"] as const;

export type Genre = (typeof GENRES)[number];
export type FindingCategory =
  | "assistant-residue"
  | "lexical"
  | "rhetoric"
  | "structure"
  | "formatting"
  | "voice";
export type Severity = "info" | "low" | "medium" | "high";

export interface Finding {
  rule: string;
  category: FindingCategory;
  severity: Severity;
  message: string;
  evidence: string;
  start: number;
  end: number;
  line: number;
  column: number;
  penalty: number;
}

export interface AuditMetrics {
  words: number;
  sentences: number;
  paragraphs: number;
  average_sentence_words: number;
  sentence_word_stddev: number;
  sentence_length_cv: number;
  average_paragraph_words: number;
  paragraph_word_stddev: number;
  paragraph_length_cv: number;
  em_dashes_per_1000_words: number;
  semicolons_per_1000_words: number;
  lexical_diversity: number;
  markdown_headings: number;
  bold_spans: number;
  emoji_markers: number;
  markdown_table_rows: number;
  list_items: number;
  fenced_code_blocks: number;
  horizontal_rules: number;
}

export interface CategoryScore {
  findings: number;
  penalty: number;
}

export interface ProseAuditResult {
  schema_version: 1;
  synthetic_style_score: number | null;
  band: "insufficient" | "low" | "light" | "moderate" | "high" | "very_high";
  confidence: "insufficient" | "low" | "medium" | "high";
  genre: Genre;
  metrics: AuditMetrics;
  categories: Partial<Record<FindingCategory, CategoryScore>>;
  findings: Finding[];
  caveats: string[];
}

interface Span {
  text: string;
  start: number;
  end: number;
}

interface Rule {
  id: string;
  category: FindingCategory;
  pattern: RegExp;
  message: string;
  weight: number;
  genres?: Partial<Record<Genre, number>>;
}

const WORD_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu;
const MINIMUM_SCORABLE_WORDS = 100;

const LOCAL_RULES: Rule[] = [
  {
    id: "assistant.self-disclosure",
    category: "assistant-residue",
    pattern:
      /\b(?:as an? (?:AI|large language) (?:assistant|model)|I (?:cannot|can't) (?:browse|access|provide)|my (?:training|knowledge) (?:data|cutoff))\b/giu,
    message: "Contains assistant self-disclosure or capability boilerplate.",
    weight: 8,
  },
  {
    id: "assistant.offer-more",
    category: "assistant-residue",
    pattern:
      /\b(?:I hope this helps|let me know if|would you like (?:me )?to|is there anything else|feel free to (?:ask|reach out)|here(?:'s| is) a (?:breakdown|summary|revised version))\b/giu,
    message: "Contains conversational residue from an assistant response.",
    weight: 6,
    genres: { email: 0.45 },
  },
  {
    id: "assistant.agreement",
    category: "assistant-residue",
    pattern: /(?:^|[.!?]\s+)(?:Absolutely|Certainly|Of course|You're absolutely right)[,!.]/gmu,
    message: "Uses a canned assistant acknowledgement.",
    weight: 4,
    genres: { email: 0.5 },
  },
  {
    id: "assistant.placeholder",
    category: "assistant-residue",
    pattern:
      /\[(?:insert|your|name|email|company|date|details?|example)[^\]]*\]|<(?:insert|your|name|email|company|date|details?)[^>]*>/giu,
    message: "Contains fill-in-the-blank placeholder text.",
    weight: 7,
    genres: { email: 0.15, technical: 0.5 },
  },
  {
    id: "lexical.ai-vocabulary",
    category: "lexical",
    pattern:
      /\b(?:delv(?:e|es|ed|ing)|tapestry|intrica(?:te|cies)|underscor(?:e|es|ed|ing)|showcas(?:e|es|ed|ing)|pivotal|multifaceted|meticulous(?:ly)?|camaraderie|palpable|amidst|unravel(?:s|ed|ing)?|interplay|ever-evolving)\b/giu,
    message: "Uses vocabulary empirically or observationally overrepresented in LLM prose.",
    weight: 1.25,
    genres: { academic: 0.8 },
  },
  {
    id: "lexical.inflated-significance",
    category: "lexical",
    pattern:
      /\b(?:stands as|serves as) (?:a |an )?(?:testament|reminder|beacon|pivotal|crucial)|\b(?:indelible mark|enduring legacy|broader (?:context|landscape|conversation|trend)|evolving landscape|key turning point|setting the stage for)\b/giu,
    message: "Inflates the subject's significance with a stock phrase.",
    weight: 3,
    genres: { marketing: 0.55 },
  },
  {
    id: "lexical.promotional",
    category: "lexical",
    pattern:
      /\b(?:boasts? (?:a|an)|nestled (?:in|within)|rich cultural heritage|natural beauty|diverse array|groundbreaking (?:approach|solution|work)|seamless(?:ly)? (?:integrates?|connects?|experience)|unlock(?:s|ing)? (?:the )?(?:power|potential)|redefine(?:s|d)? what(?:'s| is) possible)\b/giu,
    message: "Uses stock promotional or travel-guide phrasing.",
    weight: 2.5,
    genres: { marketing: 0.35 },
  },
  {
    id: "lexical.canned-transition",
    category: "lexical",
    pattern:
      /(?:^|\n|[.!?]\s+)(?:Additionally|Moreover|Furthermore|Notably|Importantly|Crucially|Consequently|In summary|In conclusion|Overall),/gmu,
    message: "Uses a canned sentence-opening transition.",
    weight: 1.25,
    genres: { academic: 0.7 },
  },
  {
    id: "lexical.didactic-disclaimer",
    category: "lexical",
    pattern:
      /\b(?:it is|it's) (?:important|critical|crucial|worthwhile) to (?:note|remember|consider|recognize|understand)\b/giu,
    message: "Uses a stock didactic disclaimer.",
    weight: 2.5,
  },
  {
    id: "rhetoric.editorial-hype",
    category: "rhetoric",
    pattern:
      /\b(?:killer (?:observation|insight|feature)|crucial reframing|game-changing (?:insight|shift|approach)|cleanest (?:recommendation|solution)|the real breakthrough)\b/giu,
    message: "Uses editorial hype where a neutral description may carry the argument better.",
    weight: 1.5,
    genres: { marketing: 0.45 },
  },
  {
    id: "rhetoric.negative-parallelism",
    category: "rhetoric",
    pattern:
      /\b(?:not (?:only|just|merely|simply)\b[^.!?;\n]{1,120}\bbut (?:also )?|isn't just\b[^.!?;\n]{1,120}(?:[—,:;]|\bit's\b)|is not just\b[^.!?;\n]{1,120}(?:[—,:;]|\bit is\b)|more than (?:just|simply|merely)\b)/giu,
    message:
      "Uses a negative-parallelism setup that often performs emphasis instead of adding information.",
    weight: 3.25,
  },
  {
    id: "rhetoric.no-no-just",
    category: "rhetoric",
    pattern: /\bno [^.!?\n,]{1,50},\s+no [^.!?\n,]{1,50},\s+just\b/giu,
    message: "Uses the formulaic 'no X, no Y, just Z' construction.",
    weight: 3,
  },
  {
    id: "rhetoric.vague-attribution",
    category: "rhetoric",
    pattern:
      /\b(?:experts?|observers?|critics?|researchers?|scholars?|industry (?:reports?|leaders?|experts?)|several (?:sources|publications|studies)) (?:have )?(?:argue|argues|note|notes|suggest|suggests|believe|believes|cite|cites|indicate|indicates)\b/giu,
    message: "Attributes a claim to a vague or unnamed authority.",
    weight: 3,
    genres: { academic: 0.75 },
  },
  {
    id: "rhetoric.performative-depth",
    category: "rhetoric",
    pattern:
      /\b(?:at its core|at the heart of|fundamentally,|this (?:underscores|highlights|reflects|symbolizes|demonstrates) (?:the )?(?:importance|significance|need|complexity)|offers? valuable insights? into)\b/giu,
    message: "Signals depth or significance without necessarily supplying it.",
    weight: 2.5,
    genres: { academic: 0.8 },
  },
  {
    id: "rhetoric.participial-tail",
    category: "rhetoric",
    pattern:
      /,\s+(?:highlighting|underscoring|emphasizing|showcasing|reflecting|symbolizing|demonstrating|ensuring|fostering|cultivating|contributing to)\b[^.!?\n]{0,140}[.!?]?/giu,
    message:
      "Appends a present-participial clause that may add generic significance rather than evidence.",
    weight: 2.25,
    genres: { academic: 0.8 },
  },
  {
    id: "rhetoric.copula-avoidance",
    category: "rhetoric",
    pattern:
      /\b(?:serves as|stands as|functions as|operates as|holds the distinction of being|plays a (?:key|crucial|pivotal|vital) role in)\b/giu,
    message: "Uses an inflated construction where a direct copula may be clearer.",
    weight: 1.5,
    genres: { marketing: 0.6 },
  },
  {
    id: "structure.future-challenges",
    category: "structure",
    pattern:
      /\bdespite (?:its|these|the) [^.!?\n]{0,80}\b(?:faces?|remain|persists?) (?:several |numerous |significant )?challenges\b|\bdespite these challenges\b[^.!?\n]{0,160}\b(?:continue|future|potential|poised|positioned)\b/giu,
    message: "Uses the stock challenges-to-optimistic-outlook structure.",
    weight: 3,
  },
  {
    id: "structure.scope-announcement",
    category: "structure",
    pattern:
      /\b(?:there are (?:several|three|four|a number of) (?:key |main )?(?:factors|reasons|ways|areas|considerations)|the following (?:section|sections|points) (?:explore|outline|examine|highlight)|this (?:article|section|essay|report) (?:will )?(?:explore|delve into|examine|discuss))\b/giu,
    message: "Announces structure instead of moving directly into the substance.",
    weight: 2,
    genres: { academic: 0.55 },
  },
];

function words(text: string): string[] {
  return text.match(WORD_PATTERN) ?? [];
}

function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function maskProtectedText(text: string): string {
  const chars = text.split("");
  const mask = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      if (chars[index] !== "\n") chars[index] = " ";
    }
  };

  for (const match of text.matchAll(/```[\s\S]*?```|~~~[\s\S]*?~~~/g)) {
    mask(match.index, match.index + match[0].length);
  }
  let diffStart = text.search(/^diff --git /m);
  while (diffStart >= 0) {
    const separator = text.indexOf("\n━", diffStart);
    const diffEnd = separator >= 0 ? separator : text.length;
    mask(diffStart, diffEnd);
    const next = text.slice(diffEnd).search(/^diff --git /m);
    diffStart = next >= 0 ? diffEnd + next : -1;
  }
  for (const match of text.matchAll(/`[^`\n]+`/g)) {
    mask(match.index, match.index + match[0].length);
  }
  for (const match of text.matchAll(/https?:\/\/[^\s)>\]]+/g)) {
    mask(match.index, match.index + match[0].length);
  }

  return chars.join("");
}

function sentenceSpans(text: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  const boundary = /[.!?]+(?:["'’”)]*)?(?=\s+|$)|\n{2,}/g;

  for (const match of text.matchAll(boundary)) {
    const end = match.index + match[0].length;
    const raw = text.slice(start, end);
    const leading = raw.search(/\S/);
    if (leading >= 0) {
      const trimmed = raw.trimEnd();
      const spanStart = start + leading;
      const spanEnd = start + trimmed.length;
      const value = text.slice(spanStart, spanEnd);
      if (words(value).length >= 2 && !/^(?:#{1,6}\s|\s*[-*+]\s+\*\*[^*]+\*\*:?)\s*/.test(value)) {
        spans.push({ text: value, start: spanStart, end: spanEnd });
      }
    }
    start = end;
  }

  const tail = text.slice(start);
  const leading = tail.search(/\S/);
  if (leading >= 0) {
    const spanStart = start + leading;
    const value = text.slice(spanStart).trimEnd();
    if (words(value).length >= 2 && !/^(?:#{1,6}\s|\s*[-*+]\s+\*\*[^*]+\*\*:?)\s*/.test(value)) {
      spans.push({ text: value, start: spanStart, end: spanStart + value.length });
    }
  }

  return spans;
}

function paragraphSpans(text: string): Span[] {
  const spans: Span[] = [];
  const separator = /\n\s*\n/g;
  let start = 0;

  for (const match of text.matchAll(separator)) {
    appendParagraph(text, start, match.index, spans);
    start = match.index + match[0].length;
  }
  appendParagraph(text, start, text.length, spans);
  return spans;
}

function appendParagraph(text: string, start: number, end: number, spans: Span[]): void {
  const raw = text.slice(start, end);
  const leading = raw.search(/\S/);
  if (leading < 0) return;
  const spanStart = start + leading;
  const value = text.slice(spanStart, end).trimEnd();
  if (words(value).length >= 3 && !/^(?:#{1,6}\s|[-*_]{3,}\s*$)/m.test(value)) {
    spans.push({ text: value, start: spanStart, end: spanStart + value.length });
  }
}

function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  const lastBreak = before.lastIndexOf("\n");
  return { line, column: offset - lastBreak };
}

function severityFor(penalty: number): Severity {
  if (penalty >= 5) return "high";
  if (penalty >= 2.5) return "medium";
  if (penalty >= 1) return "low";
  return "info";
}

function makeFinding(
  text: string,
  rule: string,
  category: FindingCategory,
  message: string,
  evidence: string,
  start: number,
  end: number,
  penalty: number,
): Finding {
  const position = lineColumn(text, start);
  return {
    rule,
    category,
    severity: severityFor(penalty),
    message,
    evidence: evidence.replace(/\s+/g, " ").trim().slice(0, 240),
    start,
    end,
    line: position.line,
    column: position.column,
    penalty: round(penalty, 2),
  };
}

function localFindings(text: string, masked: string, genre: Genre): Finding[] {
  const findings: Finding[] = [];
  for (const rule of LOCAL_RULES) {
    const multiplier = rule.genres?.[genre] ?? 1;
    for (const match of masked.matchAll(rule.pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      findings.push(
        makeFinding(
          text,
          rule.id,
          rule.category,
          rule.message,
          text.slice(start, end),
          start,
          end,
          rule.weight * multiplier,
        ),
      );
    }
  }
  return findings;
}

function regexLineSpans(text: string, pattern: RegExp): Span[] {
  return [...text.matchAll(pattern)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function formattingFindings(text: string, genre: Genre, wordCount: number): Finding[] {
  const findings: Finding[] = [];
  const formattingMultiplier = genre === "technical" ? 0.25 : genre === "email" ? 0.6 : 1;
  const boldBullets = regexLineSpans(text, /^\s*[-*+]\s+\*\*[^*\n]{2,80}(?::\*\*|\*\*:)[ \t]+/gm);
  if (boldBullets.length >= 3) {
    const first = boldBullets[0];
    findings.push(
      makeFinding(
        text,
        "formatting.bold-label-list",
        "formatting",
        "Uses a repeated bold-label bullet template.",
        first.text,
        first.start,
        first.end,
        3 * formattingMultiplier,
      ),
    );
  }

  const horizontalRules = regexLineSpans(text, /^\s*(?:---+|___+|\*\*\*+)\s*$/gm);
  if (horizontalRules.length >= 2) {
    const first = horizontalRules[0];
    findings.push(
      makeFinding(
        text,
        "formatting.horizontal-rule-overuse",
        "formatting",
        "Uses repeated thematic breaks as mechanical section separators.",
        first.text,
        first.start,
        first.end,
        2.5 * formattingMultiplier,
      ),
    );
  }

  const headings = regexLineSpans(text, /^#{1,6}\s+[^\n]+$/gm);
  const boldSpans = regexLineSpans(text, /\*\*[^*\n]+\*\*/g);
  const emojiMarkers = regexLineSpans(text, /[✅❌⚠]/gu);
  const tableRows = regexLineSpans(text, /^\|.*\|\s*$/gm);
  const bulletItems = regexLineSpans(text, /^\s*[-*+]\s+/gm);
  const numberedItems = regexLineSpans(text, /^\s*\d+[.)]\s+/gm);
  const codeFences = regexLineSpans(text, /^(?:```|~~~)/gm);
  const presentationSignals = [
    headings.length >= 6,
    boldSpans.length >= 5,
    emojiMarkers.length >= 3,
    tableRows.length >= 6,
    bulletItems.length + numberedItems.length >= 5,
    codeFences.length >= 6,
    horizontalRules.length >= 2,
  ].filter(Boolean).length;
  if (presentationSignals >= 4) {
    const first = headings[0] ?? boldSpans[0] ?? tableRows[0];
    findings.push(
      makeFinding(
        text,
        "formatting.presentation-stack",
        "formatting",
        "Stacks headings, bold emphasis, status emoji, tables, and lists into a highly packaged report format.",
        first.text,
        first.start,
        first.end,
        7,
      ),
    );
  }

  const statusHeadings = headings.filter(
    (heading) =>
      /[✅❌⚠]/u.test(heading.text) &&
      /\b(?:VULNERABLE|CONFIRMED|VERIFIED|BLOCKED|PASS(?:ED)?|FAIL(?:ED)?)\b/.test(heading.text),
  );
  if (statusHeadings.length >= 3) {
    const first = statusHeadings[0];
    findings.push(
      makeFinding(
        text,
        "structure.repeated-status-headings",
        "structure",
        "Repeats verdict-style status headings, making the document read like a generated verification report.",
        statusHeadings
          .slice(0, 4)
          .map((heading) => heading.text.replace(/^#{1,6}\s+/, ""))
          .join(" / "),
        first.start,
        first.end,
        4.5,
      ),
    );
  }

  const editorialHeadings = headings.filter((heading) =>
    /\b(?:key insight|killer observation|crucial reframing|where .{0,40} agree|the split|cleanest recommendation|bottom line|verdict|takeaways?)\b/i.test(
      heading.text,
    ),
  );
  if (editorialHeadings.length >= 3) {
    const first = editorialHeadings[0];
    findings.push(
      makeFinding(
        text,
        "structure.editorialized-headings",
        "structure",
        "Repeated headings pre-package the interpretation with verdicts, takeaways, or dramatic labels.",
        editorialHeadings
          .slice(0, 3)
          .map((heading) => heading.text.replace(/^#{1,6}\s+/, ""))
          .join(" / "),
        first.start,
        first.end,
        5,
      ),
    );
  }

  if (headings.length >= 3) {
    const titleCase = headings.filter((heading) => {
      const content = heading.text.replace(/^#{1,6}\s+/, "");
      const significant = words(content).filter((word) => word.length > 3);
      return significant.length > 0 && significant.every((word) => /^[A-Z]/.test(word));
    });
    if (titleCase.length / headings.length >= 0.75) {
      const first = titleCase[0];
      findings.push(
        makeFinding(
          text,
          "formatting.title-case-headings",
          "formatting",
          "Most headings use title case, a common assistant-document default.",
          first.text,
          first.start,
          first.end,
          1.75 * formattingMultiplier,
        ),
      );
    }
  }

  const emDashes = [...text.matchAll(/—/g)];
  const dashDensity = (emDashes.length * 1000) / Math.max(wordCount, 1);
  const dashThreshold = genre === "email" ? 6 : 4;
  if (emDashes.length >= 3 && dashDensity > dashThreshold) {
    const first = emDashes[0];
    findings.push(
      makeFinding(
        text,
        "formatting.em-dash-density",
        "formatting",
        `Uses ${round(dashDensity, 1)} em dashes per 1,000 words; inspect whether the repeated punch-up is earned.`,
        "—",
        first.index,
        first.index + 1,
        1.75 * (genre === "technical" ? 0.7 : 1),
      ),
    );
  }

  return findings;
}

function tricolonFindings(text: string, sentences: Span[], genre: Genre): Finding[] {
  const matches: Span[] = [];
  const pattern =
    /\b[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2},\s+[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2},\s+(?:and|or)\s+[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,3}/giu;
  for (const sentence of sentences) {
    const match = pattern.exec(sentence.text);
    pattern.lastIndex = 0;
    if (match) {
      matches.push({
        text: match[0],
        start: sentence.start + match.index,
        end: sentence.start + match.index + match[0].length,
      });
    }
  }

  if (matches.length < 3) return [];
  const multiplier = genre === "marketing" ? 0.7 : 1;
  return matches
    .slice(0, 5)
    .map((match) =>
      makeFinding(
        text,
        "rhetoric.tricolon-density",
        "rhetoric",
        "Repeated three-part lists create a mechanically comprehensive cadence.",
        match.text,
        match.start,
        match.end,
        0.9 * multiplier,
      ),
    );
}

function rhythmFindings(
  text: string,
  sentences: Span[],
  paragraphs: Span[],
  sentenceCv: number,
  paragraphCv: number,
): Finding[] {
  const findings: Finding[] = [];
  if (sentences.length >= 12 && sentenceCv > 0 && sentenceCv < 0.22) {
    const first = sentences[0];
    findings.push(
      makeFinding(
        text,
        "voice.uniform-sentence-length",
        "voice",
        `Sentence lengths are unusually uniform in this document (CV ${round(sentenceCv, 2)}).`,
        first.text,
        first.start,
        first.end,
        2,
      ),
    );
  }
  if (paragraphs.length >= 5 && paragraphCv > 0 && paragraphCv < 0.25) {
    const first = paragraphs[0];
    findings.push(
      makeFinding(
        text,
        "voice.uniform-paragraph-length",
        "voice",
        `Paragraph lengths are unusually uniform in this document (CV ${round(paragraphCv, 2)}).`,
        first.text,
        first.start,
        first.end,
        1.75,
      ),
    );
  }
  return findings;
}

function repeatedPhraseFindings(text: string, masked: string, wordCount: number): Finding[] {
  if (wordCount < 180) return [];
  const tokenMatches = [...masked.matchAll(WORD_PATTERN)];
  const occurrences = new Map<string, Array<{ start: number; end: number }>>();
  const ignored = new Set(["this", "that", "with", "from", "have", "will", "would", "could"]);

  for (let index = 0; index <= tokenMatches.length - 5; index += 1) {
    const slice = tokenMatches.slice(index, index + 5);
    const phraseWords = slice.map((token) => token[0].toLowerCase());
    if (phraseWords.filter((word) => !ignored.has(word)).length < 3) continue;
    const rawPhrase = masked.slice(
      slice[0].index,
      slice[slice.length - 1].index + slice[slice.length - 1][0].length,
    );
    if (/[\\/_]/.test(rawPhrase)) continue;
    const phrase = phraseWords.join(" ");
    const positions = occurrences.get(phrase) ?? [];
    positions.push({
      start: slice[0].index,
      end: slice[slice.length - 1].index + slice[slice.length - 1][0].length,
    });
    occurrences.set(phrase, positions);
  }

  const repeated = [...occurrences.entries()]
    .filter(([, positions]) => positions.length >= 3)
    .sort((left, right) => right[1].length - left[1].length)[0];
  if (!repeated) return [];
  const [phrase, positions] = repeated;
  const first = positions[0];
  return [
    makeFinding(
      text,
      "structure.repeated-phrase",
      "structure",
      `Repeats the five-word phrase “${phrase}” ${positions.length} times.`,
      text.slice(first.start, first.end),
      first.start,
      first.end,
      Math.min(3, 1.25 + positions.length * 0.35),
    ),
  ];
}

function computeMetrics(text: string, masked: string): AuditMetrics {
  const allWords = words(masked);
  const sentences = sentenceSpans(masked);
  const paragraphs = paragraphSpans(masked);
  const sentenceLengths = sentences.map((sentence) => words(sentence.text).length);
  const paragraphLengths = paragraphs.map((paragraph) => words(paragraph.text).length);
  const averageSentence = mean(sentenceLengths);
  const sentenceStddev = stddev(sentenceLengths);
  const averageParagraph = mean(paragraphLengths);
  const paragraphStddev = stddev(paragraphLengths);
  const normalizedWords = allWords.map((word) => word.toLowerCase());

  return {
    words: allWords.length,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    average_sentence_words: round(averageSentence),
    sentence_word_stddev: round(sentenceStddev),
    sentence_length_cv: round(averageSentence === 0 ? 0 : sentenceStddev / averageSentence),
    average_paragraph_words: round(averageParagraph),
    paragraph_word_stddev: round(paragraphStddev),
    paragraph_length_cv: round(averageParagraph === 0 ? 0 : paragraphStddev / averageParagraph),
    em_dashes_per_1000_words: round(
      ((text.match(/—/g)?.length ?? 0) * 1000) / Math.max(allWords.length, 1),
    ),
    semicolons_per_1000_words: round(
      ((text.match(/;/g)?.length ?? 0) * 1000) / Math.max(allWords.length, 1),
    ),
    lexical_diversity: round(
      normalizedWords.length === 0 ? 0 : new Set(normalizedWords).size / normalizedWords.length,
    ),
    markdown_headings: (text.match(/^#{1,6}\s+[^\n]+$/gm) ?? []).length,
    bold_spans: (text.match(/\*\*[^*\n]+\*\*/g) ?? []).length,
    emoji_markers: (text.match(/[✅❌⚠]/gu) ?? []).length,
    markdown_table_rows: (text.match(/^\|.*\|\s*$/gm) ?? []).length,
    list_items: (text.match(/^\s*(?:[-*+]|\d+[.)])\s+/gm) ?? []).length,
    fenced_code_blocks: Math.floor((text.match(/^(?:```|~~~)/gm) ?? []).length / 2),
    horizontal_rules: (text.match(/^\s*(?:---+|___+|\*\*\*+)\s*$/gm) ?? []).length,
  };
}

function weightedPenalty(findings: Finding[]): number {
  const byRule = new Map<string, Finding[]>();
  for (const finding of findings) {
    const group = byRule.get(finding.rule) ?? [];
    group.push(finding);
    byRule.set(finding.rule, group);
  }

  let total = 0;
  for (const group of byRule.values()) {
    const penalties = group.map((finding) => finding.penalty).sort((a, b) => b - a);
    const factors = [1, 0.7, 0.45, 0.3, 0.2];
    for (let index = 0; index < Math.min(penalties.length, factors.length); index += 1) {
      total += penalties[index] * factors[index];
    }
  }
  return total;
}

function categoryScores(findings: Finding[]): Partial<Record<FindingCategory, CategoryScore>> {
  const result: Partial<Record<FindingCategory, CategoryScore>> = {};
  for (const finding of findings) {
    const current = result[finding.category] ?? { findings: 0, penalty: 0 };
    current.findings += 1;
    current.penalty = round(current.penalty + finding.penalty, 2);
    result[finding.category] = current;
  }
  return result;
}

function confidenceFor(wordCount: number): ProseAuditResult["confidence"] {
  if (wordCount < MINIMUM_SCORABLE_WORDS) return "insufficient";
  if (wordCount < 250) return "low";
  if (wordCount < 750) return "medium";
  return "high";
}

function bandFor(score: number | null): ProseAuditResult["band"] {
  if (score === null) return "insufficient";
  if (score < 20) return "low";
  if (score < 40) return "light";
  if (score < 60) return "moderate";
  if (score < 80) return "high";
  return "very_high";
}

export function auditProse(text: string, options: { genre?: Genre } = {}): ProseAuditResult {
  const genre = options.genre ?? "general";
  if (!GENRES.includes(genre)) throw new Error(`Unsupported genre: ${genre}`);

  const masked = maskProtectedText(text);
  const metrics = computeMetrics(text, masked);
  const sentences = sentenceSpans(masked);
  const paragraphs = paragraphSpans(masked);
  const findings = [
    ...localFindings(text, masked, genre),
    ...formattingFindings(text, genre, metrics.words),
    ...tricolonFindings(text, sentences, genre),
    ...rhythmFindings(
      text,
      sentences,
      paragraphs,
      metrics.sentence_length_cv,
      metrics.paragraph_length_cv,
    ),
    ...repeatedPhraseFindings(text, masked, metrics.words),
  ].sort((left, right) => left.start - right.start || right.penalty - left.penalty);

  const score =
    metrics.words < MINIMUM_SCORABLE_WORDS
      ? null
      : Math.round(
          100 *
            (1 -
              Math.exp(-((weightedPenalty(findings) * 1000) / Math.max(metrics.words, 250)) / 30)),
        );

  const caveats = [
    "The synthetic style score measures observed prose patterns; it is not a probability of AI authorship.",
    "Rules are genre-sensitive but not yet calibrated against a held-out corpus.",
  ];
  if (metrics.words < 250) {
    caveats.push(
      "Short passages provide weak distributional evidence; interpret the result cautiously.",
    );
  }

  return {
    schema_version: 1,
    synthetic_style_score: score,
    band: bandFor(score),
    confidence: confidenceFor(metrics.words),
    genre,
    metrics,
    categories: categoryScores(findings),
    findings,
    caveats,
  };
}
