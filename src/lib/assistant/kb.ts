import MiniSearch from "minisearch";
import kbData from "../../../data/knowledge_base.json";

export interface KnowledgeItem {
  id: string;
  intent: string;
  category: string;
  query: string;
  answer: string;
}

export interface SearchResultItem extends KnowledgeItem {
  score: number;
  match: Record<string, string[]>;
}

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with",
  "by", "from", "up", "about", "into", "over", "after", "is", "am", "are", "was",
  "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "doing",
  "i", "me", "my", "myself", "we", "our", "ours", "you", "your", "yours", "he",
  "him", "his", "she", "her", "it", "its", "they", "them", "their", "what", "which",
  "who", "whom", "this", "that", "these", "those", "how", "when", "where", "why",
  "can", "could", "would", "should", "will"
]);

let miniSearchInstance: MiniSearch<KnowledgeItem> | null = null;

export function getKnowledgeBase(): KnowledgeItem[] {
  return kbData as KnowledgeItem[];
}

export function getMiniSearch(): MiniSearch<KnowledgeItem> {
  if (miniSearchInstance) return miniSearchInstance;

  const data = getKnowledgeBase();

  miniSearchInstance = new MiniSearch<KnowledgeItem>({
    fields: ["query", "intent", "category"],
    storeFields: ["id", "intent", "category", "query", "answer"],
    processTerm: (term) => {
      const lower = term.toLowerCase().trim();
      return STOP_WORDS.has(lower) ? null : lower;
    },
    searchOptions: {
      boost: { query: 3, intent: 2, category: 1 },
      fuzzy: 0.1,
      prefix: true,
    },
  });

  miniSearchInstance.addAll(data);
  return miniSearchInstance;
}

/**
 * Searches the support knowledge base and returns top-k matching documents
 * along with a normalized confidence score (0.0 to 1.0).
 */
export function searchKnowledgeBase(query: string, topK: number = 3): {
  results: SearchResultItem[];
  confidence: number;
  dominantIntent: string | null;
} {
  const ms = getMiniSearch();
  const rawResults = ms.search(query);

  // Check how many non-stop words were actually in the query
  const queryTokens = query
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  if (rawResults.length === 0 || queryTokens.length === 0) {
    return {
      results: [],
      confidence: 0.0,
      dominantIntent: null,
    };
  }

  const results: SearchResultItem[] = rawResults.slice(0, topK).map((r) => ({
    id: r.id,
    intent: r.intent,
    category: r.category,
    query: r.query,
    answer: r.answer,
    score: r.score,
    match: r.match,
  }));

  // How many of the query keywords actually matched in the top result
  const topResult = results[0];
  const matchedTerms = Object.keys(topResult.match || {}).length;
  const matchRatio = Math.min(1.0, matchedTerms / Math.max(1, queryTokens.length));

  // Normalized confidence: combination of match ratio and BM25 score
  // If no meaningful query terms matched, confidence drops below refusal threshold
  let normalizedConfidence = 0.0;
  if (matchedTerms > 0) {
    const scoreFactor = Math.min(1.0, topResult.score / 12.0);
    normalizedConfidence = Number(((matchRatio * 0.6 + scoreFactor * 0.4)).toFixed(2));
  }

  // Determine dominant intent from top retrieved documents
  const intentCounts: Record<string, number> = {};
  for (const r of results) {
    intentCounts[r.intent] = (intentCounts[r.intent] || 0) + 1;
  }
  let dominantIntent: string | null = null;
  let maxCount = 0;
  for (const [intent, count] of Object.entries(intentCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantIntent = intent;
    }
  }

  return {
    results,
    confidence: normalizedConfidence,
    dominantIntent: dominantIntent || results[0]?.intent || null,
  };
}
