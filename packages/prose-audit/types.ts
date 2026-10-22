export const GENRES = ["general", "technical", "email", "academic", "marketing"] as const;

export type Genre = (typeof GENRES)[number];

export type FindingCategory =
  | "assistant-residue"
  | "lexical"
  | "rhetoric"
  | "structure"
  | "formatting"
  | "cadence"
  | "grounding"
  | "voice";

export type Severity = "info" | "low" | "medium" | "high";
export type FindingConfidence = "low" | "medium" | "high";

export interface Finding {
  rule: string;
  category: FindingCategory;
  severity: Severity;
  confidence: FindingConfidence;
  message: string;
  fix: string;
  source: string;
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
  sentence_length_median: number;
  sentence_length_p90: number;
  short_sentence_share: number;
  long_sentence_share: number;
  average_paragraph_words: number;
  paragraph_word_stddev: number;
  paragraph_length_cv: number;
  em_dashes_per_1000_words: number;
  semicolons_per_1000_words: number;
  colons_per_1000_words: number;
  question_marks_per_1000_words: number;
  commas_per_1000_words: number;
  contraction_rate_per_1000_words: number;
  hedge_rate_per_1000_words: number;
  nominalization_rate_per_1000_words: number;
  abstract_noun_rate_per_1000_words: number;
  lexical_diversity: number;
  markdown_headings: number;
  bold_spans: number;
  emoji_markers: number;
  curly_quotes: number;
  markdown_table_rows: number;
  list_items: number;
  fenced_code_blocks: number;
  horizontal_rules: number;
  blockquote_lines: number;
  links: number;
  code_spans: number;
  digits: number;
  proper_nouns: number;
}

export interface CategoryScore {
  findings: number;
  penalty: number;
}

export interface ProseAuditResult {
  schema_version: 2;
  synthetic_style_score: number | null;
  band: "insufficient" | "low" | "light" | "moderate" | "high" | "very_high";
  confidence: "insufficient" | "low" | "medium" | "high";
  genre: Genre;
  metrics: AuditMetrics;
  categories: Partial<Record<FindingCategory, CategoryScore>>;
  findings: Finding[];
  caveats: string[];
}

export interface RuleMeta {
  id: string;
  category: FindingCategory;
  description: string;
  fix: string;
  weight: number;
  confidence: FindingConfidence;
  source: string;
  genres?: Partial<Record<Genre, number>>;
}
