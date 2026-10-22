import type { Finding, FindingCategory, FindingConfidence, Genre, RuleMeta } from "./types.ts";
import { lineColumn, round, wordTokens, WORD_PATTERN, type Span } from "./text.ts";

interface RuleSpec {
  meta: RuleMeta;
  pattern: RegExp;
  maxFindings: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function flexiblePhrase(value: string): string {
  return escapeRegExp(value).replace(/'/g, "['’]").replace(/\s+/g, "\\s+");
}

function phrasePattern(values: readonly string[], flags = "giu"): RegExp {
  const parts = [...values]
    .sort((left, right) => right.length - left.length)
    .map((value) => {
      const start = /^[\p{L}\p{N}]/u.test(value) ? "(?<![\\p{L}\\p{N}])" : "";
      const end = /[\p{L}\p{N}]$/u.test(value) ? "(?![\\p{L}\\p{N}])" : "";
      return `${start}(?:${flexiblePhrase(value)})${end}`;
    });
  return new RegExp(parts.join("|"), flags);
}

function rule(
  id: string,
  category: FindingCategory,
  description: string,
  fix: string,
  weight: number,
  confidence: FindingConfidence,
  source: string,
  pattern: RegExp,
  genres?: Partial<Record<Genre, number>>,
  maxFindings = 12,
): RuleSpec {
  return {
    meta: { id, category, description, fix, weight, confidence, source, genres },
    pattern,
    maxFindings,
  };
}

// Empirical AI vocabulary. These are the words that keep showing up in
// cross-corpus comparisons; individual hits stay cheap. Density is scored
// separately in findVocabularyDensity.
const AI_VOCABULARY = [
  "amidst",
  "bolster",
  "bolstered",
  "bolstering",
  "boasts",
  "boasted",
  "boasting",
  "camaraderie",
  "crucial",
  "delve",
  "delved",
  "delving",
  "delves",
  "enduring",
  "ever-evolving",
  "garner",
  "garnered",
  "garnering",
  "garners",
  "intricacies",
  "intricate",
  "interplay",
  "meticulous",
  "meticulously",
  "multifaceted",
  "palpable",
  "pivotal",
  "realm",
  "realms",
  "showcase",
  "showcased",
  "showcases",
  "showcasing",
  "tapestries",
  "tapestry",
  "testament",
  "testaments",
  "underscore",
  "underscored",
  "underscores",
  "underscoring",
  "unravel",
  "unraveled",
  "unraveling",
  "unravelled",
  "unravelling",
  "unravels",
  "valuable",
  "vibrant",
];

// Weak/era vocabulary. These words are ordinary on their own, so they only
// contribute to a density finding. The GPT-6 set follows the Wikipedia
// field-guide update from mid-2026.
const WEAK_AI_VOCABULARY = [
  "additionally",
  "align",
  "aligned",
  "aligning",
  "aligns",
  "causal",
  "challenge",
  "challenges",
  "clearer",
  "comprehensive",
  "correlate",
  "correlated",
  "correlates",
  "correlating",
  "dependable",
  "echoed",
  "emphasize",
  "emphasized",
  "emphasizes",
  "emphasizing",
  "empirical",
  "enhance",
  "enhanced",
  "enhances",
  "enhancing",
  "foster",
  "fostered",
  "fostering",
  "fosters",
  "highlight",
  "highlighted",
  "highlighting",
  "highlights",
  "key",
  "landscape",
  "leverage",
  "leverages",
  "leveraged",
  "leveraging",
  "matters",
  "moreover",
  "practical",
  "prioritize",
  "prioritized",
  "prioritizes",
  "prioritizing",
  "quietly",
  "realm",
  "steady",
  "universally",
  "valuable",
  "vital",
];

const AI_VOCABULARY_SET = new Set(AI_VOCABULARY);
const WEAK_AI_VOCABULARY_SET = new Set(WEAK_AI_VOCABULARY);

const SENTENCE_START = "(?:^|[.!?]\\s+|\\n\\s*)";

export const LOCAL_RULES: RuleSpec[] = [
  rule(
    "assistant.self-disclosure",
    "assistant-residue",
    "Contains assistant self-disclosure or capability boilerplate.",
    "Delete the meta statement and start with the actual claim.",
    8,
    "high",
    "Common assistant residue",
    /\b(?:as an? (?:AI|large language) (?:assistant|model)|as a language model|I (?:cannot|can't) (?:browse|access|provide)|my (?:training|knowledge) (?:data|cutoff))\b/giu,
  ),
  rule(
    "assistant.offer-more",
    "assistant-residue",
    "Contains conversational residue from an assistant response.",
    "Remove the offer, acknowledgement, or menu. End on the content.",
    6,
    "high",
    "Common assistant residue",
    phrasePattern([
      "I hope this helps",
      "hope this helps",
      "let me know if",
      "would you like me to",
      "is there anything else",
      "feel free to ask",
      "feel free to reach out",
      "happy to help",
      "here's a breakdown",
      "here is a breakdown",
      "here's a summary",
      "here is a summary",
      "here's a revised version",
      "here is a revised version",
    ]),
    { email: 0.45 },
  ),
  rule(
    "assistant.agreement",
    "assistant-residue",
    "Uses a canned assistant acknowledgement.",
    "Delete the praise. Answer the point directly.",
    4,
    "high",
    "Common assistant residue",
    /(?:^|[.!?]\s+)(?:Absolutely|Certainly|Of course|You're absolutely right|Great question|Excellent point)[,!.]/gmu,
    { email: 0.5 },
  ),
  rule(
    "assistant.placeholder",
    "assistant-residue",
    "Contains fill-in-the-blank placeholder text.",
    "Replace the placeholder with the real value or remove the slot.",
    7,
    "high",
    "Common assistant residue",
    /\[(?:insert|your|name|email|company|date|details?|example|citation|source)[^\]]*\]|<(?:insert|your|name|email|company|date|details?)[^>]*>/giu,
    { email: 0.15, technical: 0.5 },
  ),
  rule(
    "assistant.response-wrapper",
    "assistant-residue",
    "Frames the text as a response or revision rather than authored prose.",
    "Delete the wrapper. Keep the revised text itself.",
    5,
    "high",
    "Assistant response artifacts",
    phrasePattern([
      "below is a revised",
      "below is the revised",
      "here's a version",
      "here is a version",
      "here's the updated",
      "here is the updated",
      "I've updated",
      "I have updated",
      "I rewrote",
      "I've rewritten",
      "I have rewritten",
      "this version keeps",
      "this version preserves",
    ]),
  ),
  rule(
    "assistant.cutoff-disclaimer",
    "assistant-residue",
    "Contains a knowledge-cutoff or capability disclaimer.",
    "Remove the disclaimer. State what is known and cite the source or date.",
    7,
    "high",
    "Assistant response artifacts",
    phrasePattern([
      "as of my knowledge cutoff",
      "as of my last knowledge update",
      "based on the information available",
      "based on the information provided",
      "based on available information",
      "I don't have access to real-time",
      "I cannot browse",
      "I can't browse",
      "my training data",
      "my knowledge cutoff",
    ]),
  ),
  rule(
    "assistant.source-gap",
    "assistant-residue",
    "Speculates about missing sources instead of naming the evidence.",
    "Name the source, date, or gap directly; do not guess that a record likely exists.",
    6,
    "high",
    "Wikipedia Signs of AI writing, Oct 2026",
    phrasePattern([
      "not widely documented",
      "not widely available",
      "in the provided sources",
      "in the available sources",
      "based on available sources",
      "likely exists",
      "probably documented",
      "the available sources do not",
      "no public record was found",
    ]),
  ),
  rule(
    "assistant.menu",
    "assistant-residue",
    "Offers a menu of possible next actions instead of finishing the thought.",
    "Delete the menu. Pick the useful next action or stop.",
    4,
    "high",
    "Assistant response artifacts",
    phrasePattern([
      "here are some options",
      "here are a few options",
      "would you prefer",
      "I can also",
      "if you'd like, I can",
      "shall I",
      "I can adapt this",
      "I can make this",
    ]),
    { email: 0.5 },
  ),

  rule(
    "lexical.ai-vocabulary",
    "lexical",
    "Uses vocabulary empirically overrepresented in LLM prose.",
    "Replace the word with the concrete action, object, or measurement.",
    0.75,
    "medium",
    "Juzek & Ward 2025; Reinhart et al. 2025; Wikipedia field guide",
    phrasePattern(AI_VOCABULARY),
    { academic: 0.8 },
  ),
  rule(
    "lexical.inflated-significance",
    "lexical",
    "Inflates the subject's significance with a stock phrase.",
    "Cut the significance claim. State what happened and why it matters.",
    2.75,
    "high",
    "Wikipedia Signs of AI writing, Oct 2026",
    phrasePattern([
      "stands as a",
      "serves as a",
      "is a testament",
      "is a reminder",
      "a pivotal moment",
      "a crucial role",
      "a key role",
      "underscores the importance",
      "highlights the significance",
      "reflects broader",
      "symbolizing its",
      "contributing to the broader",
      "setting the stage for",
      "marking a pivotal",
      "represents a shift",
      "key turning point",
      "evolving landscape",
      "focal point",
      "indelible mark",
      "deeply rooted",
      "enduring legacy",
      "broader context",
      "broader conversation",
      "broader trend",
      "raises important questions",
      "sparked debate",
      "generated debate",
      "prompted broader reflection",
      "shaped emerging policy discussions",
    ]),
    { marketing: 0.55, academic: 0.75 },
  ),
  rule(
    "lexical.promotional",
    "lexical",
    "Uses stock promotional or travel-guide phrasing.",
    "Replace the advertisement with a neutral description or a fact.",
    2.2,
    "high",
    "Wikipedia Signs of AI writing, Oct 2026",
    phrasePattern([
      "boasts a",
      "boasts an",
      "nestled in",
      "nestled within",
      "rich cultural heritage",
      "natural beauty",
      "diverse array",
      "groundbreaking approach",
      "groundbreaking solution",
      "groundbreaking work",
      "renowned for",
      "in the heart of",
      "commitment to excellence",
      "commitment to innovation",
      "unlock the power",
      "unlock the potential",
      "redefine what's possible",
      "redefines what's possible",
      "breathtaking",
      "stunning",
      "captivating",
      "profound impact",
      "seamless experience",
      "seamlessly integrates",
      "seamlessly connects",
    ]),
    { marketing: 0.35, technical: 0.6 },
  ),
  rule(
    "lexical.corporate-speak",
    "lexical",
    "Uses corporate abstraction where a plain verb or object would do.",
    "Name the action or object. Cut the abstraction.",
    1.5,
    "medium",
    "slopless; deslopper; proselint tradition",
    phrasePattern([
      "best-in-class",
      "circle back",
      "core competency",
      "deep dive",
      "game changer",
      "game-changing",
      "holistic approach",
      "leverage existing",
      "leverage our",
      "leverage the",
      "leverage your",
      "low-hanging fruit",
      "move the needle",
      "next-generation",
      "operationalize",
      "paradigm shift",
      "stakeholder alignment",
      "synergy",
      "synergies",
      "take it to the next level",
      "thought leadership",
      "value-add",
      "world-class",
    ]),
    { technical: 0.4, marketing: 0.5 },
  ),
  rule(
    "lexical.canned-transition",
    "lexical",
    "Uses a canned sentence-opening transition.",
    "Delete the transition or show the relationship through the content.",
    1,
    "medium",
    "Wikipedia field guide; slop-guard",
    new RegExp(
      `${SENTENCE_START}(?:Additionally|Moreover|Furthermore|Notably|Importantly|Crucially|Consequently|In summary|In conclusion|Overall|Ultimately|That said|More importantly|Equally important|In essence|Put simply|Simply put),`,
      "gimu",
    ),
    { academic: 0.6 },
  ),
  rule(
    "lexical.didactic-disclaimer",
    "lexical",
    "Uses a stock didactic disclaimer.",
    "Delete the throat-clearing. State the claim directly.",
    2,
    "high",
    "Wikipedia field guide; slopless",
    phrasePattern([
      "it is important to note",
      "it's important to note",
      "it is critical to note",
      "it's critical to note",
      "it is crucial to note",
      "it's crucial to note",
      "it is worth noting",
      "it's worth noting",
      "it is worth remembering",
      "it's worth remembering",
      "it bears mentioning",
      "it should be noted",
      "it must be noted",
      "needless to say",
      "one must consider",
      "it is essential to understand",
      "it's essential to understand",
    ]),
  ),
  rule(
    "lexical.stock-opener",
    "lexical",
    "Opens with a stock framing device instead of the point.",
    "Cut the frame. Start with the claim, fact, or scene.",
    2.25,
    "high",
    "slopless; slop-guard; Wikipedia field guide",
    phrasePattern([
      "in today's fast-paced world",
      "in today's fast-paced",
      "in a world where",
      "now more than ever",
      "at the end of the day",
      "when all is said and done",
      "it goes without saying",
      "let's be honest",
      "let me be honest",
      "let me be clear",
      "to be honest",
      "to be clear",
      "here's the thing",
      "here's the kicker",
      "here's the deal",
      "here's what changed",
      "here's what happened",
      "here's why",
      "the fact of the matter is",
      "the simple truth is",
      "the hard truth is",
      "make no mistake",
      "the bottom line is",
      "the key takeaway is",
      "the future belongs to",
      "the path forward is clear",
      "the answer is simple",
      "the answer is straightforward",
      "it's simple",
      "it is simple",
      "let's dive in",
      "let's break this down",
      "let's explore",
      "let's unpack",
      "imagine a world",
      "picture this",
      "you might be wondering",
      "you may be wondering",
    ]),
  ),
  rule(
    "lexical.cliche",
    "lexical",
    "Uses a well-worn cliché.",
    "Replace the cliché with the specific claim.",
    1.5,
    "medium",
    "slopless; slop-guard; deslopper",
    phrasePattern([
      "a testament to",
      "at a crossroads",
      "avoid at all costs",
      "change the game",
      "dive deep",
      "every cloud has a silver lining",
      "from good to great",
      "in the grand scheme of things",
      "it is what it is",
      "last but not least",
      "level the playing field",
      "light at the end of the tunnel",
      "moving the goalposts",
      "needle in a haystack",
      "only time will tell",
      "paradigm shift",
      "push the envelope",
      "reinvent the wheel",
      "the elephant in the room",
      "the tip of the iceberg",
      "think outside the box",
      "tip of the iceberg",
      "when it rains it pours",
      "work smarter not harder",
    ]),
  ),
  rule(
    "lexical.notability",
    "lexical",
    "Emphasizes coverage, recognition, or media presence instead of the substance.",
    "Name the source and what it says. Cut the notability padding.",
    2,
    "medium",
    "Wikipedia Signs of AI writing, Oct 2026",
    phrasePattern([
      "independent coverage",
      "local media outlets",
      "regional media outlets",
      "national media outlets",
      "trade publications",
      "music outlets",
      "business outlets",
      "tech outlets",
      "featured in",
      "profiled in",
      "active social media presence",
      "maintains a strong digital presence",
      "maintains an active social media",
      "written by a leading expert",
      "recognized by",
      "was identified by",
    ]),
    { marketing: 0.6, technical: 0.6 },
  ),
  rule(
    "lexical.false-simplicity",
    "lexical",
    "Announces that the answer is simple instead of making it simple.",
    "Cut the simplicity claim. Show the mechanism or the result.",
    1.5,
    "medium",
    "slopless simplicity rules",
    phrasePattern([
      "basically",
      "in essence",
      "it all comes down to",
      "it boils down to",
      "it's just",
      "it is just",
      "just a matter of",
      "merely a",
      "nothing more than",
      "simply put",
      "put simply",
      "the basic rule is simple",
      "the lesson is simple",
      "the point is simple",
      "the real answer is simple",
      "the simple answer is",
      "the whole trick",
    ]),
    { academic: 0.7 },
  ),
  rule(
    "lexical.superlative",
    "lexical",
    "Reaches for a superlative or marketing adjective.",
    "State the measurable property instead of the superlative.",
    1.75,
    "medium",
    "slop-guard; deslopper",
    phrasePattern([
      "best-in-class",
      "cutting-edge",
      "game-changing",
      "groundbreaking",
      "next-generation",
      "revolutionary",
      "state-of-the-art",
      "unparalleled",
      "unprecedented",
      "world-class",
      "seamless",
      "robust",
      "powerful",
      "elegant",
      "intuitive",
    ]),
    { technical: 0.45, marketing: 0.5 },
  ),

  rule(
    "rhetoric.negative-parallelism",
    "rhetoric",
    "Uses a negative-parallelism setup that often performs emphasis instead of adding information.",
    "Make the positive claim once. Cut the staged negation.",
    3.25,
    "high",
    "Wikipedia field guide; Reinhart et al. 2025",
    /\b(?:not (?:only|just|merely|simply)\b[^.!?;\n]{1,140}\bbut (?:also )?|isn['’]?t just\b[^.!?;\n]{1,140}(?:[—,:;]|\bit['’]s\b)|is not just\b[^.!?;\n]{1,140}(?:[—,:;]|\bit is\b)|more than (?:just|simply|merely)\b|not (?:a|an) [^.!?;,\n]{1,45}[,;—]\s*(?:but )?(?:a|an)\b)/giu,
    undefined,
    8,
  ),
  rule(
    "rhetoric.no-no-just",
    "rhetoric",
    "Uses the formulaic 'no X, no Y, just Z' construction.",
    "State what the thing is. Cut the incantation.",
    3,
    "high",
    "Wikipedia field guide",
    /\bno [^.!?\n,]{1,50},\s*no [^.!?\n,]{1,50},\s*just\b/giu,
  ),
  rule(
    "rhetoric.x-rather-than-y",
    "rhetoric",
    "Uses a reversed contrast frame that often replaces an argument with a slogan.",
    "State both claims plainly and explain why one wins.",
    2.25,
    "medium",
    "Wikipedia Signs of AI writing, Oct 2026 (Grok pattern)",
    /\b(?:prioritiz(?:e|es|ed|ing)|focus(?:es|ed|ing)? on|emphasiz(?:e|es|ed|ing)|favor(?:s|ed|ing)?|opt(?:s|ed|ing)? for|choos(?:e|es|ing)|it['’]s|it is|this is)\b[^.!?;\n]{0,80}\b(?:rather than|instead of)\b/giu,
  ),
  rule(
    "rhetoric.vague-attribution",
    "rhetoric",
    "Attributes a claim to a vague or unnamed authority.",
    "Name the source and what it says, or cut the attribution.",
    2.5,
    "high",
    "Wikipedia field guide; slop-guard",
    new RegExp(
      [
        "\\b(?:experts?|observers?|critics?|researchers?|scholars?|analysts?|industry (?:reports?|leaders?|experts?)|several (?:sources|publications|studies)|many (?:people|experts)|some (?:say|argue|believe)|sources (?:say|suggest|indicate))",
        "\\s+(?:have\\s+)?(?:argue|argues|argued|note|notes|noted|suggest|suggests|suggested|believe|believes|believed|cite|cites|cited|indicate|indicates|indicated|say|says|said|agree|agrees|show|shows|shown)\\b",
        "|\\b(?:research|studies|data|evidence)\\s+(?:suggests?|shows?|indicates?|has shown|have shown)\\b",
        "|\\bit is (?:widely )?(?:believed|accepted|known|understood|thought)\\b",
        "|\\baccording to (?:sources|reports|experts|observers|analysts)\\b",
      ].join(""),
      "giu",
    ),
    { academic: 0.7 },
  ),
  rule(
    "rhetoric.performative-depth",
    "rhetoric",
    "Signals depth or significance without necessarily supplying it.",
    "Replace the significance label with the mechanism, evidence, or consequence.",
    2.2,
    "medium",
    "Wikipedia field guide; slopless",
    phrasePattern([
      "at its core",
      "at the heart of",
      "speaks to the",
      "is a reminder that",
      "serves as a reminder",
      "raises important questions about",
      "invites us to",
      "challenges us to",
      "forces us to reconsider",
      "sheds light on",
      "paints a picture of",
      "tells a story about",
      "offers valuable insights",
      "provides valuable insights",
      "valuable insights into",
      "is more than just",
      "goes beyond",
      "the deeper issue",
      "the bigger picture",
      "the real story",
      "what this really means",
    ]),
    { academic: 0.8 },
  ),
  rule(
    "rhetoric.participial-tail",
    "rhetoric",
    "Appends a present-participial clause that may add generic significance rather than evidence.",
    "Cut the trailing clause or turn it into a fact.",
    1.8,
    "medium",
    "Reinhart et al. 2025; Wikipedia field guide",
    /,\s+(?:highlighting|underscoring|emphasizing|showcasing|reflecting|symbolizing|demonstrating|ensuring|fostering|cultivating|contributing to|enabling|allowing|creating|offering|providing|reinforcing|signaling|positioning|solidifying|cementing|shaping|driving|supporting|helping|making|leaving|prompting|raising|inviting|challenging)\b[^.!?\n]{0,160}[.!?]?/giu,
    { academic: 0.8, technical: 0.5 },
  ),
  rule(
    "rhetoric.copula-avoidance",
    "rhetoric",
    "Uses an inflated construction where a direct copula may be clearer.",
    "Use is, are, or has. Cut the costume.",
    1.25,
    "medium",
    "Wikipedia field guide",
    phrasePattern([
      "serves as a",
      "serves as an",
      "stands as a",
      "stands as an",
      "functions as a",
      "functions as an",
      "operates as a",
      "operates as an",
      "holds the distinction of being",
      "plays a key role",
      "plays a crucial role",
      "plays a pivotal role",
      "plays a vital role",
      "constitutes a",
      "marks a significant",
      "marks a pivotal",
      "represents a significant",
      "refers to",
    ]),
    { marketing: 0.6 },
  ),
  rule(
    "rhetoric.false-question",
    "rhetoric",
    "Ends on a question that asserts its own answer.",
    "Make the claim directly. Keep the question only if the reader must answer it.",
    1.5,
    "low",
    "slopless false-question; Wikipedia field guide",
    /\b(?:(?:isn['’]t|aren['’]t|wasn['’]t|weren['’]t|don['’]t|doesn['’]t|didn['’]t|can['’]t|won['’]t|shouldn['’]t)\s+(?:that|this|it|we|you|they)\b[^?]{0,70}\?|what['’]s not to (?:love|like)\b|who wouldn['’]t\b)/giu,
  ),
  rule(
    "rhetoric.universalizing-claim",
    "rhetoric",
    "Generalizes to everyone, most people, or no one without evidence.",
    "Name the actual population, sample, or condition.",
    1.5,
    "medium",
    "slopless universalizing-claims; Wikipedia field guide",
    /\b(?:(?:everyone|everybody|no one|nobody|we all|all of us|most (?:people|teams|companies|organizations|developers|founders|users|writers|readers|businesses)))\b[^.!?;\n]{0,80}\b(?:knows?|wants?|needs?|believes?|understands?|agrees?|expects?|assumes?|struggles?|forgets?|ignores?|underestimates?|deserves?|craves?)\b|\b(?:it['’]s no secret|it goes without saying|common knowledge|everyone agrees|there is broad consensus|most experts agree)\b/giu,
  ),
  rule(
    "rhetoric.softening",
    "rhetoric",
    "Stacks hedges or vague qualifiers instead of making a precise claim.",
    "Commit to the claim, or state the exact uncertainty.",
    1.25,
    "medium",
    "slopless softening-language",
    phrasePattern([
      "may potentially",
      "could possibly",
      "might perhaps",
      "it is possible that",
      "it's possible that",
      "there is a chance that",
      "in some cases",
      "in some people",
      "to some extent",
      "more research is needed",
      "it remains unclear",
      "does not necessarily imply",
      "not necessarily",
      "generally considered",
      "widely regarded as",
    ]),
    { academic: 0.5 },
  ),
  rule(
    "rhetoric.less-more",
    "rhetoric",
    "Uses a 'less X, more Y' aphorism instead of a concrete claim.",
    "State the change and the evidence for it.",
    2,
    "medium",
    "slopless contrastive-aphorism",
    /\b(?:less|fewer) [^.!?;,\n]{1,45},\s*(?:more|and more) [^.!?;,\n]{1,70}/giu,
  ),

  rule(
    "structure.future-challenges",
    "structure",
    "Uses the stock challenges-to-optimistic-outlook structure.",
    "State the specific constraint and the actual plan; cut the forced uplift.",
    2.75,
    "high",
    "Wikipedia field guide; slopless formulaic-challenges",
    /\bdespite (?:its|these|the) [^.!?\n]{0,80}\b(?:faces?|remain|persists?) (?:several |numerous |significant |many )?challenges\b|\bdespite these challenges\b[^.!?\n]{0,180}\b(?:continue|future|potential|poised|positioned|thrive|evolve)\b|\bnot without (?:its )?challenges\b/giu,
  ),
  rule(
    "structure.scope-announcement",
    "structure",
    "Announces structure or a learning journey instead of moving into the substance.",
    "Cut the roadmap. Start with the first real point.",
    2.25,
    "high",
    "slopless generic-signposting; SlopShape 2026",
    phrasePattern([
      "in this post, we'll",
      "in this post, we will",
      "in this article, we'll",
      "in this article, we will",
      "in this guide, we'll",
      "in this guide, we will",
      "in this section, we'll",
      "in this section, we will",
      "this post explores",
      "this article explores",
      "this guide explores",
      "this post examines",
      "this article examines",
      "this guide examines",
      "this post covers",
      "this article covers",
      "this guide covers",
      "here's what you'll learn",
      "here is what you will learn",
      "we'll cover",
      "we will cover",
      "the following sections",
      "there are three key",
      "there are several key",
      "there are a number of",
      "by the end of this",
    ]),
    { academic: 0.55 },
  ),
];

export interface VocabularyDensityOptions {
  words: number;
  windowWords?: number;
}

export function findLocalFindings(text: string, masked: string, genre: Genre): Finding[] {
  const findings: Finding[] = [];
  for (const spec of LOCAL_RULES) {
    const multiplier = spec.meta.genres?.[genre] ?? 1;
    let count = 0;
    for (const match of masked.matchAll(spec.pattern)) {
      if (count >= spec.maxFindings) break;
      const raw = match[0];
      const leading = raw.search(/[\p{L}\p{N}“‘"'(]/u);
      if (leading < 0) continue;
      const start = match.index + leading;
      const end = match.index + raw.length;
      if (end <= start) continue;
      const evidence = text.slice(start, end).replace(/\s+/g, " ").trim();
      if (!evidence) continue;
      if (
        spec.meta.id === "lexical.ai-vocabulary" &&
        /^underscor/i.test(evidence) &&
        /\b(?:characters?|symbols?|bases?|digits?|marks?|fonts?)\b/i.test(
          masked.slice(Math.max(0, start - 80), Math.min(masked.length, end + 80)),
        )
      ) {
        continue;
      }
      findings.push(makeFinding(text, spec.meta, evidence, start, end, multiplier));
      count += 1;
    }
  }
  return findings;
}

export function makeFinding(
  text: string,
  meta: RuleMeta,
  evidence: string,
  start: number,
  end: number,
  genreMultiplier: number,
): Finding {
  const position = lineColumn(text, start);
  const penalty = round(meta.weight * genreMultiplier, 2);
  return {
    rule: meta.id,
    category: meta.category,
    severity: severityFor(penalty),
    confidence: meta.confidence,
    message: meta.description,
    fix: meta.fix,
    source: meta.source,
    evidence: evidence.replace(/\s+/g, " ").trim().slice(0, 240),
    start,
    end,
    line: position.line,
    column: position.column,
    penalty,
  };
}

export function severityFor(penalty: number): Finding["severity"] {
  if (penalty >= 5) return "high";
  if (penalty >= 2.5) return "medium";
  if (penalty >= 1) return "low";
  return "info";
}

interface VocabHit {
  word: string;
  start: number;
  end: number;
}

function insideMarkdownBlock(text: string, offset: number): boolean {
  const lineStart = text.lastIndexOf("\n", offset) + 1;
  const line = text.slice(
    lineStart,
    text.indexOf("\n", offset) < 0 ? text.length : text.indexOf("\n", offset),
  );
  return /^\s*(?:\||>)/.test(line);
}

function insideDoubleQuotes(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 120), start);
  const after = text.slice(end, end + 120);
  const open = Math.max(before.lastIndexOf('"'), before.lastIndexOf("“"));
  if (open < 0) return false;
  const close = Math.min(
    after.indexOf('"') < 0 ? Number.POSITIVE_INFINITY : after.indexOf('"'),
    after.indexOf("”") < 0 ? Number.POSITIVE_INFINITY : after.indexOf("”"),
  );
  return close !== Number.POSITIVE_INFINITY;
}

export function findVocabularyDensity(text: string, masked: string, genre: Genre): Finding[] {
  const tokens = wordTokens(masked);
  const hits: VocabHit[] = [];
  for (const token of tokens) {
    if (AI_VOCABULARY_SET.has(token.lower) || WEAK_AI_VOCABULARY_SET.has(token.lower)) {
      if (insideDoubleQuotes(masked, token.start, token.end)) continue;
      if (insideMarkdownBlock(masked, token.start)) continue;
      hits.push({ word: token.lower, start: token.start, end: token.end });
    }
  }
  if (hits.length < 3) return [];

  const windowWordFloor = 120;
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < hits.length; index += 1) {
    const first = hits[index];
    const window = hits.filter(
      (hit) => hit.start >= first.start && hit.start <= first.start + 1800,
    );
    const distinct = [...new Set(window.map((hit) => hit.word))];
    const strongDistinct = distinct.filter((word) => AI_VOCABULARY_SET.has(word)).length;
    const weakDistinct = distinct.length - strongDistinct;
    const enough =
      strongDistinct >= 2
        ? distinct.length >= 3
        : strongDistinct === 1
          ? weakDistinct >= 3
          : weakDistinct >= 4;
    if (!enough) continue;
    const key = distinct.slice(0, 6).sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);

    const wordsAfter = tokens.filter(
      (token) => token.start >= first.start && token.start < first.start + 1800,
    ).length;
    const localRate = (distinct.length * 1000) / Math.max(wordsAfter, windowWordFloor);
    const penalty = genre === "academic" ? 2 : 3;
    const finding = makeFinding(
      text,
      {
        id: "lexical.ai-vocabulary-density",
        category: "lexical",
        description: `Clusters ${distinct.length} stock AI words in a short span (${distinct.slice(0, 6).join(", ")}).`,
        fix: "Replace the cluster with concrete nouns, verbs, and measurements.",
        weight: penalty,
        confidence: "medium",
        source: "Juzek & Ward 2025; Wikipedia field guide; slopless density rules",
      },
      distinct.slice(0, 6).join(", "),
      first.start,
      first.end,
      1,
    );
    finding.penalty = round(penalty + Math.min(1.5, localRate / 40), 2);
    finding.severity = severityFor(finding.penalty);
    findings.push(finding);
    if (findings.length >= 3) break;
  }
  return findings;
}

export function findSignificanceDensity(text: string, masked: string): Finding[] {
  const pattern = new RegExp(
    `(?:^|[.!?]\\s+|\\n\\s*)(?:Notably|Importantly|Crucially|Significantly|Interestingly|Remarkably|Curiously|Tellingly|Strikingly|It's worth noting|It is worth noting|It's important to note|It is important to note),`,
    "gimu",
  );
  const matches = [...masked.matchAll(pattern)];
  if (matches.length < 3) return [];
  const wordCount = (masked.match(WORD_PATTERN) ?? []).length;
  const rate = (matches.length * 1000) / Math.max(wordCount, 1);
  if (rate < 3) return [];
  const first = matches[0];
  const leading = first[0].search(/[A-Za-z]/);
  const start = first.index + Math.max(0, leading);
  const meta: RuleMeta = {
    id: "rhetoric.significance-density",
    category: "rhetoric",
    description: `Sprinkles ${matches.length} significance signposts through ${wordCount} words.`,
    fix: "Cut the signposts. Let the facts carry the emphasis.",
    weight: 2.5,
    confidence: "high",
    source: "slopless significance-density",
  };
  return [makeFinding(text, meta, first[0].trim(), start, first.index + first[0].length, 1)];
}

export function findRepeatedPhrases(
  text: string,
  masked: string,
  wordCount: number,
  genre: Genre,
): Finding[] {
  if (wordCount < 180) return [];
  const tokens = wordTokens(masked);
  const ignored = new Set([
    "this",
    "that",
    "with",
    "from",
    "have",
    "will",
    "would",
    "could",
    "they",
  ]);
  const occurrences = new Map<string, Array<{ start: number; end: number }>>();

  for (let size = 8; size >= 4; size -= 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const slice = tokens.slice(index, index + size);
      const phraseWords = slice.map((token) => token.lower);
      if (phraseWords.filter((word) => !ignored.has(word)).length < 3) continue;
      if (phraseWords.filter((word) => /\p{L}{2,}/u.test(word)).length < 3) continue;
      const raw = masked.slice(slice[0].start, slice[slice.length - 1].end);
      if (/[\\/_|]/.test(raw)) continue;
      const lineStart = masked.lastIndexOf("\n", slice[0].start) + 1;
      const lineEnd = masked.indexOf("\n", slice[0].start);
      const line = masked.slice(lineStart, lineEnd < 0 ? masked.length : lineEnd);
      if (/^\s*(?:\||>)/.test(line)) continue;
      const phrase = phraseWords.join(" ");
      const positions = occurrences.get(phrase) ?? [];
      positions.push({ start: slice[0].start, end: slice[slice.length - 1].end });
      occurrences.set(phrase, positions);
    }
  }

  const repeated = [...occurrences.entries()]
    .map(([phrase, positions]) => {
      const first = positions[0];
      const close = positions.filter((position) => position.start - first.start <= 2000);
      return [phrase, close] as const;
    })
    .filter(([, positions]) => positions.length >= 3)
    .sort((left, right) => {
      const leftScore = left[1].length * left[0].length;
      const rightScore = right[1].length * right[0].length;
      return rightScore - leftScore;
    })
    .slice(0, 2);

  return repeated.map(([phrase, positions]) => {
    const first = positions[0];
    const meta: RuleMeta = {
      id: "structure.repeated-phrase",
      category: "structure",
      description: `Repeats the phrase “${phrase}” ${positions.length} times.`,
      fix: "Vary the wording or cut the repetition; keep the one instance that carries the point.",
      weight: Math.min(3.5, 1.25 + positions.length * 0.35),
      confidence: "medium",
      source: "slop-guard phrase-reuse; slopless repetition rules",
    };
    const multiplier = genre === "technical" ? 0.4 : genre === "academic" ? 0.6 : 1;
    return makeFinding(
      text,
      meta,
      text.slice(first.start, first.end),
      first.start,
      first.end,
      multiplier,
    );
  });
}

export function findTricolonDensity(text: string, sentences: Span[], genre: Genre): Finding[] {
  const matches: Span[] = [];
  const pattern =
    /\b[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2},\s+[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2},\s+(?:and|or)\s+[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,3}/giu;
  for (const sentence of sentences) {
    if (sentence.kind === "list" || sentence.kind === "heading" || sentence.kind === "quote")
      continue;
    for (const match of sentence.text.matchAll(pattern)) {
      matches.push({
        text: match[0],
        start: sentence.start + match.index,
        end: sentence.start + match.index + match[0].length,
      });
    }
  }
  if (matches.length < 3) return [];
  const multiplier = genre === "marketing" ? 0.7 : genre === "technical" ? 0.6 : 1;
  return matches.slice(0, 5).map((match) =>
    makeFinding(
      text,
      {
        id: "rhetoric.tricolon-density",
        category: "rhetoric",
        description: "Repeated three-part lists create a mechanically comprehensive cadence.",
        fix: "Break the triple. Keep the items that carry distinct information.",
        weight: 0.9 * multiplier,
        confidence: "low",
        source: "Wikipedia field guide; slop-guard structural pattern",
      },
      match.text,
      match.start,
      match.end,
      1,
    ),
  );
}

export function ruleCatalog(): RuleMeta[] {
  return LOCAL_RULES.map((spec) => spec.meta);
}

export const GENERATED_RULE_CATALOG: RuleMeta[] = [
  {
    id: "lexical.ai-vocabulary-density",
    category: "lexical",
    description: "Clusters stock AI vocabulary in a short span.",
    fix: "Replace the cluster with concrete nouns, verbs, and measurements.",
    weight: 3,
    confidence: "medium",
    source: "Juzek & Ward 2025; Wikipedia field guide; slopless density rules",
  },
  {
    id: "rhetoric.significance-density",
    category: "rhetoric",
    description: "Sprinkles significance signposts through the document.",
    fix: "Cut the signposts. Let the facts carry the emphasis.",
    weight: 2.5,
    confidence: "high",
    source: "slopless significance-density",
  },
  {
    id: "rhetoric.tricolon-density",
    category: "rhetoric",
    description: "Repeats three-part lists.",
    fix: "Break the triple. Keep the items that carry distinct information.",
    weight: 0.9,
    confidence: "low",
    source: "Wikipedia field guide; slop-guard structural pattern",
  },
  {
    id: "structure.repeated-phrase",
    category: "structure",
    description: "Repeats a four-to-eight-word phrase.",
    fix: "Vary the wording or cut the repetition.",
    weight: 1.6,
    confidence: "medium",
    source: "slop-guard phrase-reuse; slopless repetition rules",
  },
];
