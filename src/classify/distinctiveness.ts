/**
 * Distinctiveness: does this reply belong to *this* thread, or to any thread?
 *
 * **Why this is computed and not asked.** Two flags in the contribution prompt
 * — `restates_without_adding` and `interchangeable` — fired on zero messages
 * out of 43, twice, under two different phrasings. Demanding evidence fixed
 * the third degenerate flag and did nothing for these: asked to name the thing
 * a reply could not be separated from, a model will always find some noun in
 * the thread and answer charitably. The two properties whose "true" is
 * unflattering are the two a model will not report.
 *
 * They are also the two that do not need one. "Could this reply be pasted into
 * a different thread on this list without looking out of place" is a question
 * about word distributions, and word distributions can be measured:
 *
 *     distinctiveness = similarity(reply, rest of its own thread)
 *                     - similarity(reply, messages from other threads)
 *
 * A reply that engages with what is being discussed here shares vocabulary
 * with its own thread and not with the rest of the list, so the difference is
 * positive. A reply made of list-general language — agent, protocol, interop,
 * the ecosystem, the community, important considerations — is equally close to
 * everything, so the difference goes to zero. It can also go *negative*, when
 * a reply is closer to the list at large than to the conversation it is
 * sitting in, and that is the sharpest available form of the operator's
 * complaint.
 *
 * **This produces a distribution by construction.** It is a difference of two
 * similarities, so it cannot collapse to a constant the way a model's yes/no
 * did — and if it ever does, that is visible in the spread rather than hidden
 * behind a plausible label.
 *
 * **It is not a provenance signal.** A person writing list-general prose
 * scores exactly the same as anything else writing it. The measure is of how
 * specific a message is to its conversation, which is a property of the text
 * and of nothing else.
 *
 * TF-IDF with cosine similarity rather than embeddings, deliberately: the
 * embedding cache measures semantic closeness, and two messages saying
 * different things about the same subject are semantically close. Shared
 * *terms* are what "this belongs to this conversation" actually rests on.
 */

/** Words carrying no topical information, plus mailing-list furniture. */
const STOP = new Set(
  ("a about above after again against all am an and any are as at be because been before being below " +
    "between both but by can cannot could did do does doing down during each few for from further had has " +
    "have having he her here hers him his how i if in into is it its itself just me more most my no nor not " +
    "of off on once only or other our out over own same she should so some such than that the their them " +
    "then there these they this those through to too under until up very was we were what when where which " +
    "while who whom why will with would you your yours " +
    "hi hello thanks thank regards best cheers wrote sent subject re fwd list ietf mailing email message " +
    "think would like also see would well one two get make made use used using")
    .split(" ")
    .filter(Boolean),
);

export interface Document {
  message_id: string;
  thread_id: string;
  text: string;
}

export interface Distinctiveness {
  message_id: string;
  /** Mean cosine similarity to the other messages in its own thread. */
  similarity_to_own_thread: number;
  /** Mean cosine similarity to messages sampled from other threads. */
  similarity_to_other_threads: number;
  /**
   * own - other. Positive means the reply is more like its own conversation
   * than like the list in general; at or below zero it would sit as well in
   * some other thread as in this one.
   */
  distinctiveness: number;
  /** Content terms after stopwords. Below ~10 the measure is noise. */
  terms: number;
}

/** Content terms, lowercased, stopwords and short tokens dropped. */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter((t) => !STOP.has(t));
}

function tfidf(docs: string[][], idf: Map<string, number>): Map<string, number>[] {
  return docs.map((tokens) => {
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    const vector = new Map<string, number>();
    let norm = 0;
    for (const [term, count] of counts) {
      // Sublinear term frequency: a message repeating one word twenty times
      // should not be twenty times as much about it.
      const weight = (1 + Math.log(count)) * (idf.get(term) ?? 0);
      if (weight <= 0) continue;
      vector.set(term, weight);
      norm += weight * weight;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) for (const [term, weight] of vector) vector.set(term, weight / norm);
    return vector;
  });
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  // Walk the shorter vector; both are already L2-normalised.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let total = 0;
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other !== undefined) total += weight * other;
  }
  return total;
}

/** How many other-thread messages each document is compared against. */
export const COMPARISON_SAMPLE = 40;
/** Below this many content terms, the similarities are noise. */
export const MIN_TERMS = 10;

/**
 * Score every document against its own thread and against the rest of the list.
 *
 * The comparison sample is drawn by a fixed stride over the other-thread
 * documents rather than at random, so a re-run reproduces exactly — the same
 * requirement that puts `temperature: 0` on the model calls.
 */
export function distinctiveness(documents: Document[]): Distinctiveness[] {
  const tokenised = documents.map((d) => terms(d.text));

  const documentFrequency = new Map<string, number>();
  for (const tokens of tokenised) {
    for (const term of new Set(tokens)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const total = documents.length;
  const idf = new Map(
    [...documentFrequency].map(([term, count]) => [term, Math.log((1 + total) / (1 + count)) + 1]),
  );
  const vectors = tfidf(tokenised, idf);

  const byThread = new Map<string, number[]>();
  documents.forEach((d, i) => {
    const own = byThread.get(d.thread_id) ?? [];
    own.push(i);
    byThread.set(d.thread_id, own);
  });

  return documents.map((doc, index) => {
    const vector = vectors[index]!;
    const own = (byThread.get(doc.thread_id) ?? []).filter((i) => i !== index);

    const ownSimilarity = own.length
      ? own.reduce((sum, i) => sum + cosine(vector, vectors[i]!), 0) / own.length
      : 0;

    const others: number[] = [];
    const stride = Math.max(1, Math.floor(total / COMPARISON_SAMPLE));
    for (let i = 0; i < total && others.length < COMPARISON_SAMPLE; i += stride) {
      if (documents[i]!.thread_id !== doc.thread_id) others.push(i);
    }
    const otherSimilarity = others.length
      ? others.reduce((sum, i) => sum + cosine(vector, vectors[i]!), 0) / others.length
      : 0;

    return {
      message_id: doc.message_id,
      similarity_to_own_thread: Number(ownSimilarity.toFixed(4)),
      similarity_to_other_threads: Number(otherSimilarity.toFixed(4)),
      distinctiveness: Number((ownSimilarity - otherSimilarity).toFixed(4)),
      terms: tokenised[index]!.length,
    };
  });
}
