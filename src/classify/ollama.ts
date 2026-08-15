/**
 * Local model client. Ollama on localhost, nothing else.
 *
 * This is the piece that keeps PROBLEM.md section 9's "100% local for daily
 * operation" true: the classifier has no code path to a hosted model, and the
 * base URL defaults to localhost rather than being read from an environment
 * variable that could quietly point elsewhere.
 */

export interface OllamaOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export interface Generation {
  text: string;
  durationMs: number;
}

export class OllamaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaError";
  }
}

export class OllamaClient {
  #base: string;
  #timeoutMs: number;

  constructor(options: OllamaOptions = {}) {
    this.#base = options.baseUrl ?? "http://localhost:11434";
    if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(this.#base)) {
      throw new Error(
        `refusing a non-local model endpoint: ${this.#base}. ` +
          "Daily operation is local-only by design, not by configuration.",
      );
    }
    this.#timeoutMs = options.timeoutMs ?? 300_000;
  }

  /** Models the local daemon has. Used to fail early rather than mid-run. */
  async models(): Promise<string[]> {
    const response = await fetch(`${this.#base}/api/tags`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new OllamaError(`GET /api/tags: HTTP ${response.status}`);
    const body = (await response.json()) as { models?: { name: string }[] };
    return (body.models ?? []).map((m) => m.name);
  }

  /** Deterministic JSON generation. temperature 0 so a re-run reproduces. */
  async generateJson(model: string, prompt: string, maxTokens = 160): Promise<Generation> {
    const started = Date.now();
    const response = await fetch(`${this.#base}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: "json",
        options: { temperature: 0, top_p: 1, seed: 1729, num_predict: maxTokens },
      }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) {
      throw new OllamaError(`POST /api/generate (${model}): HTTP ${response.status}`);
    }
    const body = (await response.json()) as { response?: string; error?: string };
    if (body.error) throw new OllamaError(`${model}: ${body.error}`);
    return { text: (body.response ?? "").trim(), durationMs: Date.now() - started };
  }
}
