import type { Finding, FindingCategory, Genre, RuleMeta } from "./types.ts";
import { makeFinding } from "./rules.ts";
import {
  ABSTRACT_NOUNS,
  EVALUATIVE_WORDS,
  coefficientOfVariation,
  contentWords,
  countAbstractNouns,
  countFencedCodeBlocks,
  countMatches,
  countNominalizations,
  hasDigit,
  lineColumn,
  properNounTokens,
  round,
  sentenceSpans,
  wordTokens,
  words,
  type Span,
  type Structure,
} from "./text.ts";

const THIN_CUES = new Set([
  ...EVALUATIVE_WORDS,
  "clarity",
  "confidence",
  "consistency",
  "control",
  "courage",
  "discipline",
  "focus",
  "growth",
  "intention",
  "mindset",
  "philosophy",
  "platform",
  "practice",
  "process",
  "story",
  "tool",
  "meaning",
  "purpose",
  "resilience",
  "trust",
]);

const NEGATION_CUES = new Set([
  ...THIN_CUES,
  "bad",
  "big",
  "complex",
  "fast",
  "good",
  "new",
  "old",
  "slow",
]);

const STRONG_RESOLUTION =
  /^(?:that's|that is|the point|the lesson|the answer|the result|the takeaway|the truth|the problem|the fix|the trick)\b/i;
const WEAK_RESOLUTION = /^(?:this is|here's|here is)\b/i;

function resolutionOpener(text: string): boolean {
  if (STRONG_RESOLUTION.test(text)) return true;
  return WEAK_RESOLUTION.test(text) && words(text).length >= 8;
}

function hasThinCue(text: string): boolean {
  return wordTokens(text).some(
    (token) => THIN_CUES.has(token.lower) || ABSTRACT_NOUNS.has(token.lower),
  );
}

const COMMON_PREDICATE_ENDS = new Set([
  "of the",
  "in the",
  "to the",
  "and the",
  "is a",
  "is the",
  "for the",
  "on the",
  "with the",
  "that the",
  "it is",
  "as a",
  "at the",
  "by the",
  "from the",
  "into the",
  "over the",
]);

function shapeFinding(
  text: string,
  id: string,
  category: FindingCategory,
  description: string,
  fix: string,
  weight: number,
  confidence: RuleMeta["confidence"],
  source: string,
  evidence: string,
  start: number,
  end: number,
  genreMultiplier = 1,
): Finding {
  const meta: RuleMeta = {
    id,
    category,
    description,
    fix,
    weight,
    confidence,
    source,
  };
  return makeFinding(text, meta, evidence, start, end, genreMultiplier);
}

function formattingMultiplier(genre: Genre): number {
  return genre === "technical" ? 0.4 : genre === "email" ? 0.7 : 1;
}

function headingLine(heading: { start: number }, text: string): number {
  return lineColumn(text, heading.start).line;
}

function sameBlock(text: string, left: Span, right: Span): boolean {
  const gap = text.slice(left.end, right.start);
  return !/\n\s*\n/.test(gap) && !/\n\s*(?:#{1,6}\s|```|~~~|\|)/.test(gap);
}

function boldSpans(text: string): Span[] {
  return [...text.matchAll(/\*\*[^*\n]+\*\*|__[^_\n]+__/g)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function emojiMatches(text: string): Span[] {
  return [...text.matchAll(/\p{Extended_Pictographic}/gu)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function countCodeFences(text: string): number {
  return countFencedCodeBlocks(text);
}

export function findFormattingFindings(
  text: string,
  structure: Structure,
  genre: Genre,
  wordCount: number,
): Finding[] {
  const findings: Finding[] = [];
  const multiplier = formattingMultiplier(genre);
  const headings = structure.headings;
  const bold = boldSpans(text);
  const emoji = emojiMatches(text);
  const listItems = structure.list_items;
  const tables = structure.table_rows;
  const blockquotes = structure.blockquotes;
  const rules = structure.horizontal_rules;
  const codeFences = countCodeFences(text);

  const boldLabelPatterns = [
    /^(?:\*\*|__)[^*\n]+:\s*(?:\*\*|__)\s+/,
    /^(?:\*\*|__)[^*\n]+(?:\*\*|__)\s*(?::|[-—–])\s+/,
  ];
  const boldLabels = listItems.filter((item) =>
    boldLabelPatterns.some((pattern) => pattern.test(item.text)),
  );
  if (boldLabels.length >= 3) {
    const first = boldLabels[0];
    findings.push(
      shapeFinding(
        text,
        "formatting.bold-label-list",
        "formatting",
        "Uses a repeated bold-label bullet template.",
        "Use prose or a plain list. Do not bold every label.",
        3,
        "high",
        "Wikipedia field guide; slop-guard; slopless",
        text.slice(first.start, first.end).trim(),
        first.start,
        first.end,
        multiplier,
      ),
    );
  }

  if (rules.length >= 3) {
    const first = rules[0];
    findings.push(
      shapeFinding(
        text,
        "formatting.horizontal-rule-overuse",
        "formatting",
        "Uses repeated thematic breaks as mechanical section separators.",
        "Remove the rules and let headings separate sections.",
        2,
        "medium",
        "slop-guard horizontal-rule-overuse",
        first.text,
        first.start,
        first.end,
        multiplier,
      ),
    );
  }

  const emojiHeads = headings.filter((heading) => /\p{Extended_Pictographic}/u.test(heading.text));
  const emojiItems = listItems.filter((item) => /\p{Extended_Pictographic}/u.test(item.text));
  if (emojiHeads.length + emojiItems.length >= 2 || emoji.length >= 3) {
    const first = emojiHeads[0] ?? emojiItems[0] ?? emoji[0];
    findings.push(
      shapeFinding(
        text,
        "formatting.emoji-decoration",
        "formatting",
        "Uses emoji as section or bullet decoration.",
        "Remove the emoji. Use words for status and emphasis.",
        2,
        "high",
        "Wikipedia field guide; slopless",
        first.text,
        first.start,
        first.end,
        genre === "technical" ? 0.5 : genre === "email" ? 0.7 : 1,
      ),
    );
  }

  const presentationSignals = [
    headings.length >= 6,
    bold.length >= 5,
    emoji.length >= 2,
    tables.length >= 6,
    listItems.length >= 5,
    codeFences >= 3,
    rules.length >= 2,
    blockquotes.length >= 4,
  ].filter(Boolean).length;
  if (presentationSignals >= 5) {
    const first = headings[0] ?? bold[0] ?? tables[0] ?? listItems[0];
    findings.push(
      shapeFinding(
        text,
        "formatting.presentation-stack",
        "formatting",
        "Stacks headings, bold emphasis, emoji, tables, and lists into a highly packaged report format.",
        "Keep the format the content needs. Remove decoration that carries nothing.",
        Math.min(5, 3 + (presentationSignals - 4) * 0.7),
        "medium",
        "slop-guard; Wikipedia field guide",
        first.text,
        first.start,
        first.end,
        multiplier,
      ),
    );
  }

  const statusHeadings = headings.filter(
    (heading) =>
      /\p{Extended_Pictographic}/u.test(heading.text) &&
      /\b(?:VULNERABLE|CONFIRMED|VERIFIED|BLOCKED|PASS(?:ED)?|FAIL(?:ED)?|FIX VERIFIED)\b/.test(
        heading.text,
      ),
  );
  if (statusHeadings.length >= 3) {
    const first = statusHeadings[0];
    findings.push(
      shapeFinding(
        text,
        "structure.repeated-status-headings",
        "structure",
        "Repeats verdict-style status headings, making the document read like a generated verification report.",
        "Use neutral headings and put the verdict in the evidence.",
        4,
        "high",
        "Observed generated report pattern",
        statusHeadings
          .slice(0, 4)
          .map((heading) => heading.text.replace(/^#{1,6}\s+/, ""))
          .join(" / "),
        first.start,
        first.end,
        genre === "technical" ? 0.7 : 1,
      ),
    );
  }

  if (headings.length >= 3) {
    const titleCase = headings.filter((heading) => {
      const significant = words(heading.text).filter((word) => word.length > 3);
      return significant.length > 0 && significant.every((word) => /^[A-Z]/.test(word));
    });
    if (titleCase.length / headings.length >= 0.75) {
      const first = titleCase[0];
      findings.push(
        shapeFinding(
          text,
          "formatting.title-case-headings",
          "formatting",
          "Most headings use title case, a common assistant-document default.",
          "Use sentence case unless house style requires title case.",
          1.25,
          "medium",
          "Wikipedia field guide",
          first.text,
          first.start,
          first.end,
          genre === "technical" ? 0.5 : multiplier,
        ),
      );
    }
  }

  const dashCount = (text.match(/—/g) ?? []).length;
  const dashDensity = (dashCount * 1000) / Math.max(wordCount, 1);
  const dashThreshold = genre === "email" ? 6 : 4;
  if (dashCount >= 3 && dashDensity > dashThreshold) {
    const first = text.indexOf("—");
    findings.push(
      shapeFinding(
        text,
        "formatting.em-dash-density",
        "formatting",
        `Uses ${round(dashDensity, 1)} em dashes per 1,000 words; inspect whether the repeated punch-up is earned.`,
        "Replace some dashes with commas, colons, parentheses, or a full stop.",
        1.5,
        "low",
        "Wikipedia field guide; slop-guard",
        "—",
        first,
        first + 1,
        genre === "technical" ? 0.7 : 1,
      ),
    );
  }

  if (listItems.length >= 6) {
    const share = listItems.length / Math.max(structure.non_empty_lines, 1);
    if (share >= 0.4) {
      const first = listItems[0];
      findings.push(
        shapeFinding(
          text,
          "formatting.bullet-density",
          "formatting",
          `Turns ${Math.round(share * 100)}% of the document into bullet lines.`,
          "Use prose where the material is an argument, not a list.",
          2.5,
          "medium",
          "slop-guard bullet-density",
          text.slice(first.start, first.end).trim(),
          first.start,
          first.end,
          genre === "technical" ? 0.4 : multiplier,
        ),
      );
    }
  }

  if (blockquotes.length >= 4) {
    const share = blockquotes.length / Math.max(structure.non_empty_lines, 1);
    if (share >= 0.2) {
      const first = blockquotes[0];
      findings.push(
        shapeFinding(
          text,
          "formatting.blockquote-density",
          "formatting",
          "Uses quoted blocks as a structural substitute for argument.",
          "Quote only what earns quotation. Carry the rest in your own prose.",
          1.5,
          "low",
          "slop-guard blockquote-density",
          first.text,
          first.start,
          first.end,
          multiplier,
        ),
      );
    }
  }

  const colonCount = (text.match(/:/g) ?? []).length;
  const colonDensity = (colonCount * 1000) / Math.max(wordCount, 1);
  if (colonCount >= 3 && colonDensity > 8) {
    const first = text.indexOf(":");
    findings.push(
      shapeFinding(
        text,
        "formatting.colon-density",
        "formatting",
        `Uses ${round(colonDensity, 1)} colons per 1,000 words as a dramatic pause.`,
        "Use a full stop or restructure the sentence.",
        1.25,
        "low",
        "slop-guard colon-density",
        ":",
        first,
        first + 1,
        genre === "technical" ? 0.5 : multiplier,
      ),
    );
  }

  if (bold.length >= 5) {
    const density = (bold.length * 1000) / Math.max(wordCount, 1);
    if (density > 8) {
      const first = bold[0];
      findings.push(
        shapeFinding(
          text,
          "formatting.bold-density",
          "formatting",
          "Bolds terms mechanically across the document.",
          "Reserve bold for a rare callout. Remove emphasis that does not change meaning.",
          1.25,
          "low",
          "Wikipedia field guide",
          first.text,
          first.start,
          first.end,
          genre === "technical" ? 0.3 : multiplier,
        ),
      );
    }
  }

  const keywordBold = bold.filter((span) => {
    const lineStart = text.lastIndexOf("\n", span.start) + 1;
    const before = text.slice(lineStart, span.start);
    const after = text.slice(span.end, span.end + 3);
    return before.trim().length > 12 && !/:\s*$/.test(before) && !/^\s*:/.test(after);
  });
  if (keywordBold.length >= 3) {
    const first = keywordBold[0];
    findings.push(
      shapeFinding(
        text,
        "formatting.keyword-bold",
        "formatting",
        "Bolds keywords inside running prose.",
        "Remove the mid-sentence emphasis. Let the sentence carry the weight.",
        1.75,
        "medium",
        "slop-guard intrasentence-keyword-bold",
        first.text,
        first.start,
        first.end,
        genre === "technical" ? 0.5 : multiplier,
      ),
    );
  }

  const curly = (text.match(/[‘’“”]/g) ?? []).length;
  if (curly >= 4) {
    const first = text.search(/[‘’“”]/);
    findings.push(
      shapeFinding(
        text,
        "formatting.curly-quotes",
        "formatting",
        "Uses curly quotation marks and apostrophes throughout.",
        "Use the document's normal quote style. Do not mix styles.",
        0.5,
        "low",
        "Wikipedia field guide (weak correlation)",
        text.slice(first, first + 1),
        first,
        first + 1,
        multiplier,
      ),
    );
  }

  const tableBlocks = countSmallTables(text, structure);
  if (tableBlocks >= 2) {
    const first = structure.table_rows[0];
    findings.push(
      shapeFinding(
        text,
        "formatting.small-tables",
        "formatting",
        "Uses small tables for material that reads better as prose.",
        "Use prose or a list unless the data is genuinely tabular.",
        1.5,
        "low",
        "Wikipedia field guide; slopless",
        first.text,
        first.start,
        first.end,
        genre === "technical" ? 0.3 : multiplier,
      ),
    );
  }

  const subjectLine = text.match(/^\s*(?:Subject|Re):\s*\S+/m);
  if (subjectLine?.index !== undefined) {
    findings.push(
      shapeFinding(
        text,
        "formatting.subject-line",
        "formatting",
        "Leaves an email subject line inside the body.",
        "Move the subject to the subject field or delete it.",
        2,
        "medium",
        "Wikipedia field guide",
        subjectLine[0].trim(),
        subjectLine.index,
        subjectLine.index + subjectLine[0].length,
        genre === "email" ? 0.2 : 1,
      ),
    );
  }

  return findings;
}

function countSmallTables(text: string, structure: Structure): number {
  let blocks = 0;
  let currentColumns = 0;
  let currentRows = 0;
  let previousLine = -10;
  const flush = () => {
    if (currentColumns === 2 && currentRows >= 2 && currentRows <= 6) blocks += 1;
    currentColumns = 0;
    currentRows = 0;
  };
  for (const row of structure.table_rows) {
    const line = lineColumn(text, row.start).line;
    if (line - previousLine > 1) flush();
    const columns = row.text.split("|").length - 2;
    if (columns > 0) {
      if (currentRows === 0) currentColumns = columns;
      currentRows += 1;
    }
    previousLine = line;
  }
  flush();
  return blocks;
}

export function findStructureFindings(
  text: string,
  structure: Structure,
  paragraphs: Span[],
  genre: Genre,
): Finding[] {
  const findings: Finding[] = [];
  const headings = structure.headings;
  if (headings.length === 0 && paragraphs.length === 0) return findings;

  const editorial = headings.filter((heading) =>
    /\b(?:key insight|killer observation|crucial reframing|where .{0,40} agree|the split|cleanest recommendation|bottom line|verdict|takeaways?|why it matters|what this means|the bigger picture|the real issue|what nobody tells you|the hard truth|a better way|beyond .+|the future of .+|challenges and (?:opportunities|future)|future outlook|final thoughts|lessons learned|awards and recognition)\b/i.test(
      heading.text,
    ),
  );
  if (editorial.length >= 2) {
    const first = editorial[0];
    findings.push(
      shapeFinding(
        text,
        "structure.editorialized-headings",
        "structure",
        "Repeated headings pre-package the interpretation with verdicts, takeaways, or dramatic labels.",
        "Use descriptive headings. Let the reader draw the conclusion.",
        3,
        "high",
        "Observed generated-document pattern; Wikipedia field guide",
        editorial
          .slice(0, 3)
          .map((heading) => heading.text)
          .join(" / "),
        first.start,
        first.end,
        genre === "technical" ? 0.5 : 1,
      ),
    );
  }

  const questionHeadings = headings.filter((heading) => heading.text.trim().endsWith("?"));
  if (questionHeadings.length >= 3) {
    const first = questionHeadings[0];
    findings.push(
      shapeFinding(
        text,
        "structure.question-headings",
        "structure",
        "Uses a run of question headings, a common generated explainer shape.",
        "Turn the questions into claims or use plain section labels.",
        1.5,
        "low",
        "SlopShape 2026 (self-announcing structure)",
        questionHeadings
          .slice(0, 3)
          .map((heading) => heading.text)
          .join(" / "),
        first.start,
        first.end,
        genre === "technical" ? 0.5 : 1,
      ),
    );
  }

  const skipped: number[] = [];
  for (let index = 1; index < headings.length; index += 1) {
    if (headings[index].level - headings[index - 1].level > 1) {
      skipped.push(index);
    }
  }
  if (skipped.length >= 1) {
    const first = headings[skipped[0]];
    findings.push(
      shapeFinding(
        text,
        "structure.heading-skip",
        "structure",
        "Skips heading levels repeatedly.",
        "Use the next heading level or remove the structural break.",
        1.5,
        "medium",
        "Wikipedia field guide",
        `${headings[skipped[0] - 1].text} -> ${first.text}`,
        first.start,
        first.end,
        genre === "technical" ? 0.5 : 1,
      ),
    );
  }

  const headingOnly: number[] = [];
  for (let index = 0; index < headings.length - 1; index += 1) {
    const gap = text.slice(headings[index].end, headings[index + 1].start);
    if (words(gap).length < 4 && headings[index + 1].level <= headings[index].level) {
      headingOnly.push(index);
    }
  }
  if (headingOnly.length >= 2) {
    const first = headings[headingOnly[0]];
    findings.push(
      shapeFinding(
        text,
        "structure.heading-only",
        "structure",
        "Stacks headings with no prose between them.",
        "Add the missing content or collapse the headings.",
        1.5,
        "medium",
        "Wikipedia field guide",
        headings
          .slice(headingOnly[0], headingOnly[0] + 3)
          .map((heading) => heading.text)
          .join(" / "),
        first.start,
        first.end,
        genre === "technical" ? 0.5 : 1,
      ),
    );
  }

  const breaksBeforeHeadings = structure.horizontal_rules.filter((rule) => {
    const ruleLine = lineColumn(text, rule.start).line;
    return headings.some((heading) => {
      const delta = headingLine(heading, text) - ruleLine;
      return delta > 0 && delta <= 2;
    });
  });
  if (breaksBeforeHeadings.length >= 2) {
    const first = breaksBeforeHeadings[0];
    findings.push(
      shapeFinding(
        text,
        "structure.thematic-break-before-heading",
        "structure",
        "Inserts thematic breaks before headings, a Markdown chat artifact.",
        "Remove the rules. Headings already separate sections.",
        1.5,
        "medium",
        "Wikipedia field guide",
        first.text,
        first.start,
        first.end,
        genre === "technical" ? 0.5 : 1,
      ),
    );
  }

  const sections: number[] = [];
  for (let index = 0; index < headings.length; index += 1) {
    const start = headings[index].end;
    const end = headings[index + 1]?.start ?? text.length;
    const count = words(text.slice(start, end)).length;
    if (count >= 20) sections.push(count);
  }
  if (headings.length >= 4 && sections.length >= 3) {
    const cv = coefficientOfVariation(sections);
    if (cv > 0 && cv < 0.35) {
      const first = headings[0];
      findings.push(
        shapeFinding(
          text,
          "structure.uniform-sections",
          "structure",
          `Sections are unusually even in length (CV ${round(cv, 2)}).`,
          "Let sections be as long as the material requires. Cut padding.",
          1.5,
          "low",
          "SlopShape 2026 (tidy, self-announcing structure)",
          first.text,
          first.start,
          first.end,
          genre === "technical" ? 0.5 : 1,
        ),
      );
    }
  }

  const finalParagraph = paragraphs[paragraphs.length - 1];
  if (finalParagraph && paragraphs.length >= 2) {
    const finalWords = words(finalParagraph.text).length;
    const lower = finalParagraph.text.toLowerCase();
    if (
      finalWords <= 110 &&
      /^(?:in conclusion|in summary|to sum up|to summarize|all in all|ultimately|overall)\b/.test(
        lower,
      )
    ) {
      findings.push(
        shapeFinding(
          text,
          "structure.summative-closer",
          "structure",
          "Ends with a formulaic summary rather than the last real point.",
          "Cut the summary. End on the strongest concrete claim.",
          2.5,
          "high",
          "slopless summative-closer; SlopShape 2026",
          finalParagraph.text.slice(0, 160),
          finalParagraph.start,
          finalParagraph.end,
          genre === "technical" ? 0.7 : 1,
        ),
      );
    } else if (finalWords <= 120) {
      const inner = sentenceSpans(finalParagraph.text);
      const firstSentence = inner[0]?.text ?? finalParagraph.text;
      const lastSentence = inner[inner.length - 1]?.text ?? finalParagraph.text;
      const frame =
        /^(?:the takeaway|the bottom line|the lesson|the key insight|the real point)\b/i.test(
          firstSentence,
        ) ||
        /\b(?:the takeaway|the bottom line|the lesson|the key insight|the real point)\b/i.test(
          lastSentence,
        );
      if (frame) {
        findings.push(
          shapeFinding(
            text,
            "structure.summative-closer",
            "structure",
            "Ends by announcing a takeaway instead of stating the result.",
            "Delete the takeaway frame and state the result.",
            2.25,
            "high",
            "slopless summative-closer; SlopShape 2026",
            finalParagraph.text.slice(0, 160),
            finalParagraph.start,
            finalParagraph.end,
            genre === "technical" ? 0.7 : 1,
          ),
        );
      }
    }

    const titleWords = new Set(contentWords(structure.title ?? ""));
    for (const heading of headings) {
      for (const word of contentWords(heading.text)) titleWords.add(word);
    }
    const overlap = [...new Set(contentWords(finalParagraph.text))].filter((word) =>
      titleWords.has(word),
    );
    if (finalWords >= 20 && finalWords <= 120 && overlap.length >= 3) {
      findings.push(
        shapeFinding(
          text,
          "structure.restated-conclusion",
          "structure",
          "The closing paragraph mostly restates the title and headings.",
          "Use the ending for a new conclusion, a caveat, or the next concrete step.",
          1.5,
          "low",
          "SlopShape 2026 (conclusion restates thesis)",
          finalParagraph.text.slice(0, 160),
          finalParagraph.start,
          finalParagraph.end,
          genre === "technical" ? 0.5 : 1,
        ),
      );
    }
  }

  return findings;
}

export function findCadenceFindings(
  text: string,
  sentences: Span[],
  paragraphs: Span[],
  genre: Genre,
  wordCount: number,
): Finding[] {
  const findings: Finding[] = [];
  if (wordCount < 12) return findings;
  const rhythmMultiplier = genre === "technical" || genre === "academic" ? 0.6 : 1;
  const prose = sentences.filter(
    (sentence) =>
      sentence.kind !== "list" &&
      sentence.kind !== "heading" &&
      sentence.kind !== "table" &&
      sentence.kind !== "quote" &&
      /^[A-Z0-9“‘"'(]/u.test(sentence.text),
  );
  const lengths = prose.map((sentence) => words(sentence.text).length);
  const paragraphLengths = paragraphs.map((paragraph) => words(paragraph.text).length);

  if (prose.length >= 12) {
    const cv = coefficientOfVariation(lengths);
    if (cv > 0 && cv < 0.22) {
      const first = prose[0];
      findings.push(
        shapeFinding(
          text,
          "cadence.uniform-sentence-length",
          "cadence",
          `Sentence lengths are unusually uniform in this document (CV ${round(cv, 2)}).`,
          "Vary the sentence length where the thought changes. Do not pad sentences to hit a rhythm.",
          2,
          "medium",
          "slop-guard rhythm; SETEC Voiceprint",
          first.text,
          first.start,
          first.end,
          0.6 * rhythmMultiplier,
        ),
      );
    }
  }

  if (paragraphs.length >= 5) {
    const cv = coefficientOfVariation(paragraphLengths);
    if (cv > 0 && cv < 0.25) {
      const first = paragraphs[0];
      findings.push(
        shapeFinding(
          text,
          "cadence.uniform-paragraph-length",
          "cadence",
          `Paragraph lengths are unusually uniform in this document (CV ${round(cv, 2)}).`,
          "Let paragraphs end where the thought ends.",
          1.5,
          "low",
          "slop-guard paragraph-cv",
          first.text,
          first.start,
          first.end,
          0.5 * rhythmMultiplier,
        ),
      );
    }
  }

  const packed = paragraphs.filter(
    (paragraph) => sentenceSpans(paragraph.text).length >= 10 && words(paragraph.text).length >= 50,
  );
  if (packed.length >= 1) {
    const first = packed[0];
    findings.push(
      shapeFinding(
        text,
        "cadence.overlong-paragraph",
        "cadence",
        `Packs ${sentenceSpans(first.text).length} sentences into one paragraph.`,
        "Break the paragraph where the subject changes.",
        1.25,
        "low",
        "slopless paragraph-length",
        first.text.slice(0, 160),
        first.start,
        first.end,
        rhythmMultiplier,
      ),
    );
  }

  const repeatedStarts = new Map<string, number>();
  const firstByStart = new Map<string, Span>();
  for (const sentence of prose) {
    const tokens = wordTokens(sentence.text).slice(0, 2);
    if (tokens.length < 2) continue;
    const key = tokens.map((token) => token.lower).join(" ");
    repeatedStarts.set(key, (repeatedStarts.get(key) ?? 0) + 1);
    if (!firstByStart.has(key)) firstByStart.set(key, sentence);
  }
  const repeatedStart = [...repeatedStarts.entries()]
    .filter(([key, count]) => count >= 3 && key.length > 4)
    .sort((left, right) => right[1] - left[1])[0];
  if (repeatedStart) {
    const sentence = firstByStart.get(repeatedStart[0]);
    if (sentence) {
      findings.push(
        shapeFinding(
          text,
          "cadence.repeated-sentence-starts",
          "cadence",
          `Starts ${repeatedStart[1]} sentences with “${repeatedStart[0]}”.`,
          "Vary the openings or combine the sentences.",
          1.5,
          "medium",
          "slopless repeated-sentence-starts",
          sentence.text,
          sentence.start,
          sentence.end,
          0.8 * rhythmMultiplier,
        ),
      );
    }
  }

  const predicateEnds = new Map<string, number>();
  const firstByEnd = new Map<string, Span>();
  for (const sentence of prose) {
    const tokens = wordTokens(sentence.text);
    if (tokens.length < 3) continue;
    const key = tokens
      .slice(-2)
      .map((token) => token.lower)
      .join(" ");
    if (COMMON_PREDICATE_ENDS.has(key)) continue;
    predicateEnds.set(key, (predicateEnds.get(key) ?? 0) + 1);
    if (!firstByEnd.has(key)) firstByEnd.set(key, sentence);
  }
  const repeatedEnd = [...predicateEnds.entries()]
    .filter(([, count]) => count >= 3)
    .sort((left, right) => right[1] - left[1])[0];
  if (repeatedEnd) {
    const sentence = firstByEnd.get(repeatedEnd[0]);
    if (sentence) {
      findings.push(
        shapeFinding(
          text,
          "cadence.repeated-predicate-end",
          "cadence",
          `Ends ${repeatedEnd[1]} sentences with “${repeatedEnd[0]}”.`,
          "Vary the endings or cut the repeated formula.",
          1.5,
          "medium",
          "slopless repeated-predicate-end",
          sentence.text,
          sentence.start,
          sentence.end,
          0.8 * rhythmMultiplier,
        ),
      );
    }
  }

  let run: Span[] = [];
  const flushRun = () => {
    if (run.length >= 3) {
      const starts = run.map((sentence) =>
        wordTokens(sentence.text)
          .slice(0, 2)
          .map((token) => token.lower)
          .join(" "),
      );
      const repeatedStart = starts.some(
        (start) => start.length > 3 && starts.filter((value) => value === start).length >= 2,
      );
      const thinCount = run.filter((sentence) => hasThinCue(sentence.text)).length;
      if (!repeatedStart && thinCount < 3) {
        run = [];
        return;
      }
      const first = run[0];
      findings.push(
        shapeFinding(
          text,
          "cadence.punchy-fragment-run",
          "cadence",
          `Runs ${run.length} very short sentences in a row.`,
          "Combine the fragments or vary the rhythm.",
          2.5,
          "medium",
          "slop-guard pithy-fragment; deslopper aphorism",
          run
            .slice(0, 4)
            .map((sentence) => sentence.text)
            .join(" / "),
          first.start,
          run[Math.min(3, run.length - 1)].end,
          rhythmMultiplier,
        ),
      );
    }
    run = [];
  };
  for (let index = 0; index < prose.length; index += 1) {
    const sentence = prose[index];
    if (index > 0 && !sameBlock(text, prose[index - 1], sentence)) flushRun();
    const length = words(sentence.text).length;
    if (length <= 7 && !hasDigit(sentence.text) && properNounTokens(sentence.text).length === 0) {
      run.push(sentence);
    } else {
      flushRun();
    }
  }
  flushRun();

  const setupPairs: Span[] = [];
  for (let index = 0; index < prose.length - 1; index += 1) {
    const first = prose[index];
    const next = prose[index + 1];
    if (!sameBlock(text, first, next)) continue;
    if (words(first.text).length > 7 || hasDigit(first.text)) continue;
    const nextText = next.text.trim();
    if (!resolutionOpener(nextText)) continue;
    if (words(nextText).length > 18 || hasDigit(nextText)) continue;
    if (!hasThinCue(nextText)) continue;
    setupPairs.push(first);
  }
  if (setupPairs.length >= 1) {
    const first = setupPairs[0];
    const index = prose.indexOf(first);
    const next = prose[index + 1] ?? first;
    findings.push(
      shapeFinding(
        text,
        "cadence.setup-resolution",
        "cadence",
        "Pairs a short setup with a polished resolution, then repeats the move.",
        "Cut the setup or make the resolution carry a fact.",
        2.5 + Math.min(1.5, (setupPairs.length - 1) * 0.5),
        "medium",
        "slopless setup-resolution; slop-guard",
        `${first.text} ${next.text}`.slice(0, 200),
        first.start,
        next.end,
        rhythmMultiplier,
      ),
    );
  }

  const last = prose[prose.length - 1];
  if (last && words(last.text).length <= 12 && !hasDigit(last.text)) {
    if (hasThinCue(last.text) || resolutionOpener(last.text)) {
      findings.push(
        shapeFinding(
          text,
          "cadence.aphoristic-closer",
          "cadence",
          "Ends on a short, polished aphorism.",
          "End on the last concrete finding or decision instead.",
          2,
          "medium",
          "slopless closing-aphorism; SlopShape 2026",
          last.text,
          last.start,
          last.end,
          rhythmMultiplier,
        ),
      );
    }
  }

  const kickers: Span[] = [];
  for (const paragraph of paragraphs) {
    const inner = sentenceSpans(paragraph.text);
    const lastSentence = inner[inner.length - 1];
    if (!lastSentence) continue;
    if (words(lastSentence.text).length > 10 || hasDigit(lastSentence.text)) continue;
    const lower = lastSentence.text.toLowerCase();
    if ([...THIN_CUES].some((cue) => lower.includes(cue)) || resolutionOpener(lastSentence.text)) {
      kickers.push(paragraph);
    }
  }
  if (kickers.length >= 3 && kickers.length / Math.max(paragraphs.length, 1) >= 0.5) {
    const first = kickers[0];
    findings.push(
      shapeFinding(
        text,
        "cadence.paragraph-kicker",
        "cadence",
        `Lands ${kickers.length} paragraphs on a short aphoristic kicker.`,
        "Remove the kickers. End paragraphs on the evidence or the next concrete step.",
        2.25,
        "medium",
        "slopless paragraph close; SlopShape 2026",
        first.text.slice(0, 160),
        first.start,
        first.end,
        rhythmMultiplier,
      ),
    );
  }

  const qaPairs: Span[] = [];
  for (let index = 0; index < prose.length - 1; index += 1) {
    const question = prose[index];
    const answer = prose[index + 1];
    if (!sameBlock(text, question, answer)) continue;
    if (!question.text.trimEnd().endsWith("?")) continue;
    if (
      !/\b(?:why (?:does|do|is|are) (?:this|that|it)|what (?:does|do) (?:this|that|it) mean|so what|what['’]s the point)\b/i.test(
        question.text,
      )
    ) {
      continue;
    }
    if (words(answer.text).length > 14 || hasDigit(answer.text)) continue;
    if (!/^(?:because|the answer|it['’]s|it is|simple|actually|exactly|not)\b/i.test(answer.text)) {
      continue;
    }
    qaPairs.push(question);
  }
  if (qaPairs.length >= 1) {
    const first = qaPairs[0];
    const index = prose.indexOf(first);
    const answer = prose[index + 1] ?? first;
    findings.push(
      shapeFinding(
        text,
        "cadence.question-answer",
        "cadence",
        "Stages a rhetorical question and then answers it immediately.",
        "Make the claim directly. Keep the question only if the reader needs to answer it.",
        1.75,
        "low",
        "slopless false-question; slop-guard setup-resolution",
        `${first.text} ${answer.text}`.slice(0, 200),
        first.start,
        answer.end,
        0.8 * rhythmMultiplier,
      ),
    );
  }

  const paragraphStarts = new Map<string, number>();
  const firstParagraphByStart = new Map<string, Span>();
  for (const paragraph of paragraphs) {
    if (!/^[A-Z0-9“‘"'(]/u.test(paragraph.text)) continue;
    const tokens = wordTokens(paragraph.text).slice(0, 2);
    if (tokens.length < 2) continue;
    const key = tokens.map((token) => token.lower).join(" ");
    paragraphStarts.set(key, (paragraphStarts.get(key) ?? 0) + 1);
    if (!firstParagraphByStart.has(key)) firstParagraphByStart.set(key, paragraph);
  }
  const repeatedParagraphStart = [...paragraphStarts.entries()]
    .filter(([key, count]) => count >= 3 && key.length > 4)
    .sort((left, right) => right[1] - left[1])[0];
  if (repeatedParagraphStart) {
    const paragraph = firstParagraphByStart.get(repeatedParagraphStart[0]);
    if (paragraph) {
      findings.push(
        shapeFinding(
          text,
          "cadence.repeated-paragraph-opener",
          "cadence",
          `Starts ${repeatedParagraphStart[1]} paragraphs with “${repeatedParagraphStart[0]}”.`,
          "Vary the paragraph openings or merge the paragraphs.",
          1.25,
          "low",
          "slopless repetition rules",
          paragraph.text.slice(0, 160),
          paragraph.start,
          paragraph.end,
          0.7 * rhythmMultiplier,
        ),
      );
    }
  }

  return findings;
}

export function findNegationReframe(text: string, sentences: Span[], genre: Genre): Finding[] {
  const findings: Finding[] = [];
  const firstPattern =
    /\b(?:is|was|are|were|isn['’]t|wasn['’]t|aren['’]t|weren['’]t)\s+not\s+(?:just|only|about|a|an|the)?\s*[^.!?]{1,90}/iu;
  const secondPattern = /^(?:It|This|That)(?:['’]s| is| was)\s+(?:a|an|the)?\s*[^.!?]{1,90}/iu;
  for (let index = 0; index < sentences.length - 1; index += 1) {
    const first = sentences[index];
    const second = sentences[index + 1];
    if (
      first.kind === "list" ||
      first.kind === "heading" ||
      first.kind === "table" ||
      first.kind === "quote"
    ) {
      continue;
    }
    if (!firstPattern.test(first.text) || !secondPattern.test(second.text)) continue;
    if (hasDigit(first.text) || hasDigit(second.text)) continue;
    if (properNounTokens(second.text).length > 0) continue;
    const combined = `${first.text} ${second.text}`;
    if (
      !wordTokens(combined).some(
        (token) => NEGATION_CUES.has(token.lower) || ABSTRACT_NOUNS.has(token.lower),
      )
    ) {
      continue;
    }
    findings.push(
      shapeFinding(
        text,
        "rhetoric.negation-reframe",
        "rhetoric",
        "Sets up a staged negation and then replaces it with an abstract reframe.",
        "State the positive claim once. Cut the first sentence.",
        3.25,
        "high",
        "Wikipedia field guide; slopless negation-reframe",
        `${first.text} ${second.text}`.slice(0, 220),
        first.start,
        second.end,
        genre === "technical" ? 0.6 : 1,
      ),
    );
    if (findings.length >= 3) break;
  }
  return findings;
}

export function findGroundingFindings(
  text: string,
  masked: string,
  sentences: Span[],
  paragraphs: Span[],
  genre: Genre,
  wordCount: number,
): Finding[] {
  const findings: Finding[] = [];
  const placeholderCitations = [
    ...masked.matchAll(/\[(?:citation needed|source needed|needs citation)\]/giu),
  ];
  for (const match of placeholderCitations) {
    findings.push(
      shapeFinding(
        text,
        "grounding.placeholder-citation",
        "grounding",
        "Leaves a citation placeholder in the text.",
        "Add the source or remove the claim.",
        3,
        "high",
        "Wikipedia field guide; assistant placeholder pattern",
        match[0],
        match.index,
        match.index + match[0].length,
        1,
      ),
    );
  }
  if (wordCount < 60) return findings;

  const digits = (masked.match(/\p{N}/gu) ?? []).length;
  const links = (masked.match(/https?:\/\//g) ?? []).length;
  const codeSpans = (masked.match(/`{1,2}[^`\n]+`{1,2}/g) ?? []).length;
  const citations = countMatches(
    masked,
    /\[[^\]]+\]|\([^)]*\b(?:19|20)\d{2}\b[^)]*\)|\bet al\.|\bdoi:/giu,
  );
  const proper = properNounTokens(masked);
  const concreteMarkers = digits + links + codeSpans + citations + proper.length;
  const abstractCount = countAbstractNouns(masked);
  const abstractRate = (abstractCount * 1000) / Math.max(wordCount, 1);

  if (concreteMarkers < 2 && abstractCount >= 4 && abstractRate > 25) {
    findings.push(
      shapeFinding(
        text,
        "grounding.low-specificity",
        "grounding",
        "Makes abstract claims with almost no names, numbers, dates, links, or examples.",
        "Add one concrete detail: a name, number, date, source, or observed behavior.",
        4,
        "medium",
        "Chakrabarty et al. 2026 slop taxonomy; SlopShape 2026",
        sentences[0]?.text.slice(0, 180) ??
          `${abstractCount} abstract nouns, ${concreteMarkers} concrete markers`,
        sentences[0]?.start ?? 0,
        sentences[0]?.end ?? 0,
        genre === "academic" ? 0.6 : 1,
      ),
    );
  }

  if (abstractRate > 45) {
    findings.push(
      shapeFinding(
        text,
        "grounding.abstract-noun-density",
        "grounding",
        `Uses ${round(abstractRate, 1)} abstract nouns per 1,000 words.`,
        "Replace abstraction with the actors, objects, and actions underneath it.",
        1.5,
        "low",
        "Chakrabarty et al. 2026 slop taxonomy",
        `${abstractCount} abstract nouns in ${wordCount} words`,
        0,
        0,
        genre === "technical" ? 0.4 : genre === "academic" ? 0.5 : 1,
      ),
    );
  }

  const nominalizations = countNominalizations(masked);
  const nominalizationRate = (nominalizations * 1000) / Math.max(wordCount, 1);
  if (wordCount >= 150 && nominalizationRate > 50) {
    findings.push(
      shapeFinding(
        text,
        "grounding.nominalization-density",
        "grounding",
        `Uses ${round(nominalizationRate, 1)} nominalizations per 1,000 words.`,
        "Turn the noun back into the verb: decide, not decision; deploy, not deployment.",
        1.25,
        "low",
        "Reinhart et al. 2025; Biber feature studies",
        `${nominalizations} nominalizations`,
        0,
        0,
        genre === "technical" ? 0.4 : genre === "academic" ? 0.4 : 1,
      ),
    );
  }

  const vagueAttribution =
    /\b(?:experts?|observers?|critics?|researchers?|scholars?|analysts?|industry reports?|several (?:sources|publications|studies)|many (?:people|experts)|some (?:say|argue|believe)|research suggests|studies (?:show|suggest|indicate)|it is widely (?:believed|accepted|known)|according to (?:sources|reports|experts|observers|analysts))\b/giu;
  const citationMarker =
    /\[[^\]]+\]|\([^)]*\b(?:19|20)\d{2}\b[^)]*\)|https?:\/\/|\bet al\.|\bdoi:/iu;
  const attributions: Span[] = [];
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    if (sentence.kind === "list" || sentence.kind === "heading" || sentence.kind === "quote")
      continue;
    if (!vagueAttribution.test(sentence.text)) continue;
    vagueAttribution.lastIndex = 0;
    const paragraph = paragraphs.find(
      (span) => sentence.start >= span.start && sentence.start < span.end,
    );
    const context =
      paragraph?.text ??
      [sentences[index - 1], sentence, sentences[index + 1]]
        .filter((item): item is Span => item !== undefined)
        .map((item) => item.text)
        .join(" ");
    if (citationMarker.test(context)) continue;
    attributions.push(sentence);
    if (attributions.length >= 3) break;
  }
  for (const sentence of attributions) {
    findings.push(
      shapeFinding(
        text,
        "grounding.unsupported-attribution",
        "grounding",
        "Attributes a claim to an unnamed authority and gives no citation.",
        "Name the source and what it says, or remove the attribution.",
        2.5,
        "high",
        "Wikipedia field guide; slopless uncited-authority",
        sentence.text.slice(0, 180),
        sentence.start,
        sentence.end,
        genre === "academic" ? 0.7 : 1,
      ),
    );
  }

  const consensus =
    /\b(?:it is widely (?:accepted|believed|known|understood)|there is (?:broad|wide) consensus|most experts agree|the research is clear|science is clear|decades of research (?:show|shows|have shown))\b/giu;
  const consensusMatches = [...masked.matchAll(consensus)];
  if (consensusMatches.length > 0) {
    const first = consensusMatches[0];
    findings.push(
      shapeFinding(
        text,
        "grounding.unsupported-consensus",
        "grounding",
        "Asserts a broad consensus without naming who holds it.",
        "Name the studies, institutions, or people; otherwise cut the consensus claim.",
        2.25,
        "high",
        "Wikipedia field guide; slopless authority-padding",
        first[0],
        first.index,
        first.index + first[0].length,
        genre === "academic" ? 0.7 : 1,
      ),
    );
  }

  const falseRange = /\bfrom\s+([\p{L}][\p{L}\s-]{2,30}?)\s+to\s+([\p{L}][\p{L}\s-]{2,30}?)\b/giu;
  const abstractRangeSides = new Set([
    "strategy",
    "execution",
    "insight",
    "impact",
    "value",
    "growth",
    "change",
    "clarity",
    "purpose",
    "meaning",
    "innovation",
    "transformation",
    "good",
    "great",
    "idea",
    "ideas",
    "theory",
    "practice",
    "vision",
    "reality",
    "promise",
    "potential",
  ]);
  const ranges: Span[] = [];
  for (const match of masked.matchAll(falseRange)) {
    if (hasDigit(match[0])) continue;
    const left = match[1].toLowerCase();
    const right = match[2].toLowerCase();
    if (
      [...abstractRangeSides].some((word) => left.includes(word)) &&
      [...abstractRangeSides].some((word) => right.includes(word))
    ) {
      ranges.push({
        text: text.slice(match.index, match.index + match[0].length),
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    if (ranges.length >= 2) break;
  }
  for (const range of ranges) {
    findings.push(
      shapeFinding(
        text,
        "grounding.false-range",
        "grounding",
        "Uses a 'from X to Y' range for abstract nouns that are not on a real scale.",
        "State the two claims and the relationship between them.",
        2,
        "medium",
        "Wikipedia field guide",
        range.text,
        range.start,
        range.end,
        genre === "technical" ? 0.5 : 1,
      ),
    );
  }

  const vagueConnections = [
    ...masked.matchAll(
      /\b(?:associated with|in connection with|connected (?:with|to)|in association with)\b/giu,
    ),
  ];
  let unsupportedConnections = 0;
  for (const match of vagueConnections) {
    const sentence = sentences.find((span) => match.index >= span.start && match.index < span.end);
    if (!sentence) continue;
    if (properNounTokens(sentence.text).length > 0 || citationMarker.test(sentence.text)) continue;
    unsupportedConnections += 1;
  }
  if (unsupportedConnections >= 2) {
    const first = vagueConnections[0];
    findings.push(
      shapeFinding(
        text,
        "grounding.vague-connection",
        "grounding",
        "Uses repeated vague association instead of stating a relationship.",
        "State the actual relationship: role, date, action, or source.",
        1.5,
        "low",
        "Wikipedia Signs of AI writing, Oct 2026",
        first[0],
        first.index,
        first.index + first[0].length,
        1,
      ),
    );
  }

  return findings;
}

export function findShapeFindings(
  text: string,
  masked: string,
  structure: Structure,
  sentences: Span[],
  paragraphs: Span[],
  genre: Genre,
  wordCount: number,
): Finding[] {
  return [
    ...findFormattingFindings(text, structure, genre, wordCount),
    ...findStructureFindings(text, structure, paragraphs, genre),
    ...findNegationReframe(text, sentences, genre),
    ...findCadenceFindings(text, sentences, paragraphs, genre, wordCount),
    ...findGroundingFindings(text, masked, sentences, paragraphs, genre, wordCount),
  ];
}
