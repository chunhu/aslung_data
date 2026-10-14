import {test} from "node:test";
import assert from "node:assert/strict";
import {normalizeRealtimeInterval} from "../lib/realtime-settings.mjs";

test("old short refresh settings respect each role's minimum", () => {
  for (const seconds of [10, 30]) {
    assert.equal(normalizeRealtimeInterval(seconds, true), 60);
    assert.equal(normalizeRealtimeInterval(seconds, false), 300);
  }
  assert.equal(normalizeRealtimeInterval(60, false), 300);
  assert.equal(normalizeRealtimeInterval(120, false), 300);
});

test("both roles cap refresh intervals at 30 minutes and preserve pause", () => {
  for (const isAdmin of [true, false]) {
    for (const seconds of [300, 600, 900, 1200, 1800]) {
      assert.equal(normalizeRealtimeInterval(seconds, isAdmin), seconds);
    }
    assert.equal(normalizeRealtimeInterval(86400, isAdmin), 1800);
    assert.equal(normalizeRealtimeInterval(0, isAdmin), 0);
    assert.equal(normalizeRealtimeInterval("0", isAdmin), 0);
  }
});

test("invalid stored preferences fall back to each role's minimum", () => {
  for (const invalid of ["invalid", -1, Infinity, undefined, null, ""]) {
    assert.equal(normalizeRealtimeInterval(invalid, true), 60);
    assert.equal(normalizeRealtimeInterval(invalid, false), 300);
  }
});
