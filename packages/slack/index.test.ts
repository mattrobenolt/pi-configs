import assert from "node:assert/strict";
import test from "node:test";

import { validateSlackSearchDate, validateSlackSearchQuery } from "./search-query.ts";

test("validateSlackSearchQuery accepts plain search terms", () => {
  assert.equal(validateSlackSearchQuery("  deployment status  "), "deployment status");
  assert.equal(
    validateSlackSearchQuery("what happened after deploy?"),
    "what happened after deploy?",
  );
});

test("validateSlackSearchQuery rejects filters embedded in query", () => {
  for (const query of [
    "in:#incident after:2026-07-17T18:01:00",
    "errors from:@matt",
    "before:2026-07-18 deploy",
  ]) {
    assert.throws(
      () => validateSlackSearchQuery(query),
      /Move in:, from:, after:, and before: into their named tool parameters/,
    );
  }
});

test("invalid embedded ISO timestamps explain exact-time polling", () => {
  assert.throws(
    () => validateSlackSearchQuery("after:2026-07-17T18:01:00"),
    /slack_channel_history with oldest=nextOldest/,
  );
});

test("validateSlackSearchDate accepts real calendar dates only", () => {
  assert.equal(validateSlackSearchDate(" 2026-07-17 "), "2026-07-17");
  assert.throws(() => validateSlackSearchDate("2026-07-17T18:01:00"), /YYYY-MM-DD/);
  assert.throws(() => validateSlackSearchDate("2026-02-30"), /YYYY-MM-DD/);
});
