import test from "node:test";
import assert from "node:assert/strict";

import {
  retryDelay,
  isRetryableStatus,
  fetchWithRetry,
  planWork,
  isForced,
} from "../scripts/lib.mjs";

test("retryDelay backs off exponentially", () => {
  assert.equal(retryDelay(0), 1000);
  assert.equal(retryDelay(1), 2000);
  assert.equal(retryDelay(2), 4000);
  assert.equal(retryDelay(1, 100), 200);
});

test("isRetryableStatus retries transient statuses only", () => {
  for (const s of [408, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryableStatus(s), true, String(s));
  }
  for (const s of [400, 401, 403, 404, 422]) {
    assert.equal(isRetryableStatus(s), false, String(s));
  }
});

function fakeRes(status, body = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

function recorder() {
  const slept = [];
  return { slept, sleep: async (ms) => slept.push(ms) };
}

test("fetchWithRetry returns the first ok response without sleeping", async () => {
  const { slept, sleep } = recorder();
  let calls = 0;
  const res = await fetchWithRetry(
    "http://x",
    {},
    { sleep, fetchImpl: async () => (calls++, fakeRes(200)) }
  );
  assert.equal(res.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(slept, []);
});

test("fetchWithRetry retries a 500 then succeeds, with backoff", async () => {
  const { slept, sleep } = recorder();
  const responses = [fakeRes(500, "boom"), fakeRes(200)];
  const res = await fetchWithRetry(
    "http://x",
    {},
    { sleep, fetchImpl: async () => responses.shift() }
  );
  assert.equal(res.status, 200);
  assert.deepEqual(slept, [1000]);
});

test("fetchWithRetry throws immediately on a non-retryable status", async () => {
  const { slept, sleep } = recorder();
  let calls = 0;
  await assert.rejects(
    fetchWithRetry(
      "http://x",
      {},
      { sleep, fetchImpl: async () => (calls++, fakeRes(401, "no")) }
    ),
    /401/
  );
  assert.equal(calls, 1);
  assert.deepEqual(slept, []);
});

test("fetchWithRetry retries network errors and rethrows the last one", async () => {
  const { slept, sleep } = recorder();
  let calls = 0;
  await assert.rejects(
    fetchWithRetry(
      "http://x",
      {},
      {
        sleep,
        fetchImpl: async () => {
          calls++;
          throw new TypeError("fetch failed");
        },
      }
    ),
    /fetch failed/
  );
  assert.equal(calls, 3);
  assert.deepEqual(slept, [1000, 2000]);
});

test("fetchWithRetry attaches a timeout signal to each attempt", async () => {
  let seen;
  await fetchWithRetry(
    "http://x",
    { method: "POST" },
    {
      sleep: async () => {},
      fetchImpl: async (url, options) => {
        seen = options;
        return fakeRes(200);
      },
    }
  );
  assert.equal(seen.method, "POST");
  assert.ok(seen.signal instanceof AbortSignal);
});

test("planWork: generate when no entry exists", () => {
  assert.equal(planWork(undefined, "llm"), "generate");
  assert.equal(planWork(null, "api"), "generate");
});

test("planWork: retry lower tiers, skip the best tier", () => {
  assert.equal(planWork("fallback", "llm"), "retry");
  assert.equal(planWork("seed", "llm"), "retry");
  assert.equal(planWork("llm", "llm"), "skip");
  // nuggets tiers
  assert.equal(planWork("bank", "api"), "retry");
  assert.equal(planWork("builtin", "api"), "retry");
  assert.equal(planWork("api", "api"), "skip");
  assert.equal(planWork("pool", "llm"), "retry");
});

test("planWork: force always regenerates", () => {
  assert.equal(planWork("llm", "llm", true), "generate");
});

test("isForced reads FORCE_REGENERATE=1", () => {
  assert.equal(isForced({ FORCE_REGENERATE: "1" }), true);
  assert.equal(isForced({ FORCE_REGENERATE: "" }), false);
  assert.equal(isForced({}), false);
});
