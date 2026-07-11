// Shared helpers for the daily generators: fetch retry with backoff +
// timeouts, and the upgrade-only work decision. Dependency-free; the pure
// parts are unit-tested in test/lib.test.mjs.

export const LLM_TIMEOUT = 20000; // chat/completions can exceed 8s
export const SOURCE_TIMEOUT = 8000; // HN / arXiv / facts API

// Exponential backoff schedule: 1s, 2s, 4s, ...
export function retryDelay(attempt, base = 1000) {
  return base * 2 ** attempt;
}

// Retry transient failures only — a 4xx (except 408/429) won't improve.
export function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

// fetch with a per-attempt AbortSignal timeout and backoff between attempts.
// `sleep`/`fetchImpl` are injectable so tests run without delays or network.
export async function fetchWithRetry(url, options = {}, opts = {}) {
  const {
    attempts = 3,
    timeoutMs = LLM_TIMEOUT,
    baseDelayMs = 1000,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    fetchImpl = fetch,
  } = opts;

  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(retryDelay(attempt - 1, baseDelayMs));
    let res;
    try {
      res = await fetchImpl(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      lastErr = err; // network error / timeout — retryable
      continue;
    }
    if (res.ok) return res;
    const body = await res.text().catch(() => "");
    const err = new Error(
      `${url} -> ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`
    );
    if (!isRetryableStatus(res.status)) throw err;
    lastErr = err;
  }
  throw lastErr;
}

// Upgrade-only work decision. Every generator run follows this — either cron,
// workflow_dispatch, or local — which makes re-runs idempotent and means a
// retry can never DOWNGRADE an entry that already came from the best source.
//   "generate": no entry for today (or forced) -> full run incl. bank fallback
//   "retry":    entry exists at a lower tier   -> attempt upgrade; on failure
//               KEEP the existing entry (no write)
//   "skip":     entry already at the best tier -> do nothing, write nothing
export function planWork(existingSource, bestSource, force = false) {
  if (force || existingSource == null) return "generate";
  return existingSource === bestSource ? "skip" : "retry";
}

export function isForced(env = process.env) {
  return env.FORCE_REGENERATE === "1";
}
