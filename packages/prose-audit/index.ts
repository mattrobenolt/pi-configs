import type {
  AuditMetrics,
  CategoryScore,
  Finding,
  FindingCategory,
  Genre,
  ProseAuditResult,
  RuleMeta,
} from "./types.ts";
import { GENRES, type FindingConfidence } from "./types.ts";
import {
  countAbstractNouns,
  countContractions,
  countFencedCodeBlocks,
  countHedges,
  countNominalizations,
  maskProtectedText,
  mean,
  median,
  parseStructure,
  percentile,
  properNounTokens,
  round,
  sentenceSpans,
  stddev,
  words,
} from "./text.ts";
import {
  findLocalFindings,
  findRepeatedPhrases,
  findSignificanceDensity,
  findTricolonDensity,
  findVocabularyDensity,
  ruleCatalog as localRuleCatalog,
  GENERATED_RULE_CATALOG,
} from "./rules.ts";
import { findShapeFindings } from "./shape.ts";
import { SHAPE_RULE_CATALOG } from "./catalog.ts";

export { GENRES } from "./types.ts";
export type {
  AuditMetrics,
  CategoryScore,
  Finding,
  FindingCategory,
  Genre,
  ProseAuditResult,
  RuleMeta,
} from "./types.ts";
export function ruleCatalog(): RuleMeta[] {
  return [...localRuleCatalog(), ...GENERATED_RULE_CATALOG, ...SHAPE_RULE_CATALOG];
}

const MINIMUM_SCORABLE_WORDS = 60;

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function computeMetrics(text: string, masked: string): AuditMetrics {
  const structure = parseStructure(masked);
  const sentences = sentenceSpans(masked);
  const paragraphs = structure.paragraphs;
  const allWords = words(masked);
  const sentenceLengths = sentences.map((sentence) => words(sentence.text).length);
  const paragraphLengths = paragraphs.map((paragraph) => words(paragraph.text).length);
  const averageSentence = mean(sentenceLengths);
  const sentenceStddev = stddev(sentenceLengths);
  const averageParagraph = mean(paragraphLengths);
  const paragraphStddev = stddev(paragraphLengths);
  const normalizedWords = allWords.map((word) => word.toLowerCase());
  const wordCount = Math.max(allWords.length, 1);
  const abstractCount = countAbstractNouns(masked);
  const nominalizations = countNominalizations(masked);
  const hedges = countHedges(masked);
  const contractions = countContractions(masked);

  return {
    words: allWords.length,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    average_sentence_words: round(averageSentence),
    sentence_word_stddev: round(sentenceStddev),
    sentence_length_cv: round(averageSentence === 0 ? 0 : sentenceStddev / averageSentence),
    sentence_length_median: round(median(sentenceLengths)),
    sentence_length_p90: round(percentile(sentenceLengths, 0.9)),
    short_sentence_share: round(
      sentenceLengths.filter((length) => length <= 8).length / Math.max(sentenceLengths.length, 1),
    ),
    long_sentence_share: round(
      sentenceLengths.filter((length) => length >= 35).length / Math.max(sentenceLengths.length, 1),
    ),
    average_paragraph_words: round(averageParagraph),
    paragraph_word_stddev: round(paragraphStddev),
    paragraph_length_cv: round(averageParagraph === 0 ? 0 : paragraphStddev / averageParagraph),
    em_dashes_per_1000_words: round(((masked.match(/—/g) ?? []).length * 1000) / wordCount),
    semicolons_per_1000_words: round(((masked.match(/;/g) ?? []).length * 1000) / wordCount),
    colons_per_1000_words: round(((masked.match(/:/g) ?? []).length * 1000) / wordCount),
    question_marks_per_1000_words: round(((masked.match(/\?/g) ?? []).length * 1000) / wordCount),
    commas_per_1000_words: round(((masked.match(/,/g) ?? []).length * 1000) / wordCount),
    contraction_rate_per_1000_words: round((contractions * 1000) / wordCount),
    hedge_rate_per_1000_words: round((hedges * 1000) / wordCount),
    nominalization_rate_per_1000_words: round((nominalizations * 1000) / wordCount),
    abstract_noun_rate_per_1000_words: round((abstractCount * 1000) / wordCount),
    lexical_diversity: round(
      normalizedWords.length === 0 ? 0 : new Set(normalizedWords).size / normalizedWords.length,
    ),
    markdown_headings: structure.headings.length,
    bold_spans: (text.match(/\*\*[^*\n]+\*\*|__[^_\n]+__/g) ?? []).length,
    emoji_markers: (text.match(/\p{Extended_Pictographic}/gu) ?? []).length,
    curly_quotes: (text.match(/[‘’“”]/g) ?? []).length,
    markdown_table_rows: structure.table_rows.length,
    list_items: structure.list_items.length,
    fenced_code_blocks: countFencedCodeBlocks(text),
    horizontal_rules: structure.horizontal_rules.length,
    blockquote_lines: structure.blockquotes.length,
    links: countMatches(text, /https?:\/\//g),
    code_spans: countMatches(text, /`{1,2}[^`\n]+`{1,2}/g),
    digits: (masked.match(/\p{N}/gu) ?? []).length,
    proper_nouns: properNounTokens(masked).length,
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
  const confidenceFactor = (finding: Finding): number =>
    finding.confidence === "high" ? 1 : finding.confidence === "medium" ? 0.8 : 0.45;
  for (const group of byRule.values()) {
    const penalties = group
      .map((finding) => finding.penalty * confidenceFactor(finding))
      .sort((a, b) => b - a);
    const factors = [1, 0.7, 0.45, 0.3, 0.2];
    for (let index = 0; index < Math.min(penalties.length, factors.length); index += 1) {
      total += penalties[index] * factors[index];
    }
  }

  const categories = new Set(findings.map((finding) => finding.category));
  if (categories.size >= 3) {
    total *= 1 + Math.min(0.18, (categories.size - 2) * 0.04);
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

function scoreFor(findings: Finding[], wordCount: number): number | null {
  if (wordCount < MINIMUM_SCORABLE_WORDS) return null;
  const penalty = weightedPenalty(findings);
  const density = (penalty * 1000) / Math.max(wordCount, 250);
  const score = 100 * (1 - Math.exp(-density / 30));
  return Math.round(Math.max(0, Math.min(100, score)));
}

export function auditProse(text: string, options: { genre?: Genre } = {}): ProseAuditResult {
  const genre = options.genre ?? "general";
  if (!GENRES.includes(genre)) throw new Error(`Unsupported genre: ${genre}`);

  const masked = maskProtectedText(text);
  const structure = parseStructure(masked);
  const sentences = sentenceSpans(masked);
  const paragraphs = structure.paragraphs;
  const metrics = computeMetrics(text, masked);

  const findings = [
    ...findLocalFindings(text, masked, genre),
    ...findVocabularyDensity(text, masked, genre),
    ...findSignificanceDensity(text, masked),
    ...findTricolonDensity(text, sentences, genre),
    ...findShapeFindings(text, masked, structure, sentences, paragraphs, genre, metrics.words),
    ...findRepeatedPhrases(text, masked, metrics.words, genre),
  ].sort((left, right) => left.start - right.start || right.penalty - left.penalty);

  const score = scoreFor(findings, metrics.words);
  const caveats = [
    "The synthetic style score measures observed prose patterns; it is not a probability of AI authorship.",
    "Genre profiles and rule weights are heuristic; structural findings describe document shape, not provenance.",
    "A clean score does not certify human authorship, and a high score does not prove machine authorship.",
  ];
  if (metrics.words < 250) {
    caveats.push(
      "Short passages provide weak distributional evidence; interpret the score cautiously.",
    );
  }

  return {
    schema_version: 2,
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

export type { FindingConfidence };
