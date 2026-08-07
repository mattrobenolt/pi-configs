import assert from "node:assert/strict";
import test from "node:test";

import { validateSlackSearchDate, validateSlackSearchQuery } from "./search-query.ts";
import { classifySlackTarget, strictSlackUserMatch, type SlackUserIdentity } from "./target.ts";

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

test("classifySlackTarget separates channel IDs from user IDs", () => {
  assert.deepEqual(classifySlackTarget("C123ABC456"), {
    kind: "channel-id",
    value: "C123ABC456",
  });
  assert.deepEqual(classifySlackTarget("D0B0A1B2C3"), {
    kind: "channel-id",
    value: "D0B0A1B2C3",
  });
  assert.deepEqual(classifySlackTarget("G123ABC456"), {
    kind: "channel-id",
    value: "G123ABC456",
  });
  assert.deepEqual(classifySlackTarget("U123ABC456"), {
    kind: "user-id",
    value: "U123ABC456",
  });
});

test("classifySlackTarget handles @handles, #channels, and bare tokens", () => {
  assert.deepEqual(classifySlackTarget("@matt"), { kind: "handle", value: "matt" });
  assert.deepEqual(classifySlackTarget("@matt kennedy"), { kind: "handle", value: "matt kennedy" });
  assert.deepEqual(classifySlackTarget("#general"), { kind: "channel-name", value: "general" });
  assert.deepEqual(classifySlackTarget("  general  "), { kind: "bare", value: "general" });
  assert.deepEqual(classifySlackTarget("matt@example.com"), {
    kind: "bare",
    value: "matt@example.com",
  });
});

test("classifySlackTarget rejects empty targets", () => {
  assert.throws(() => classifySlackTarget("   "), /Channel is empty/);
  assert.throws(() => classifySlackTarget("@"), /Channel is empty/);
});

const USERS = [
  {
    id: "U097KH3QELU",
    name: "nick",
    displayName: "nick",
    realName: "Nick Van Wiggeren",
    email: "nick@planetscale.com",
  },
  {
    id: "URQRQAHMG",
    name: "nick.dodson",
    displayName: "Nick Dodson",
    realName: "Nick Dodson",
    email: "nick.dodson@fuel.sh",
  },
  {
    id: "U0ANGFGCM2S",
    name: "nick.holden",
    displayName: "nick.holden",
    realName: "Nick Holden",
    email: "nick.holden@planetscale.com",
  },
  {
    id: "UQJ4JNPJA",
    name: "nickcanz",
    displayName: "Nick Canzoneri",
    email: "nickcanz@github.com",
  },
];

const nickIds = (users: SlackUserIdentity[]) => users.map((u) => u.id).sort();

test("strictSlackUserMatch: @handle matches the exact handle owner only", () => {
  const { matches, closest } = strictSlackUserMatch(USERS, "@nick");
  assert.deepEqual(nickIds(matches), ["U097KH3QELU"]);
  assert.deepEqual(nickIds(closest), ["U0ANGFGCM2S", "UQJ4JNPJA", "URQRQAHMG"].sort());
});

test("strictSlackUserMatch: bare names need an exact identity match", () => {
  assert.deepEqual(nickIds(strictSlackUserMatch(USERS, "nick").matches), ["U097KH3QELU"]);
  assert.deepEqual(nickIds(strictSlackUserMatch(USERS, "Nick Dodson").matches), ["URQRQAHMG"]);
  assert.deepEqual(nickIds(strictSlackUserMatch(USERS, "Nick Van Wiggeren").matches), [
    "U097KH3QELU",
  ]);
  assert.deepEqual(nickIds(strictSlackUserMatch(USERS, "nick@planetscale.com").matches), [
    "U097KH3QELU",
  ]);
  assert.deepEqual(nickIds(strictSlackUserMatch(USERS, "U097KH3QELU").matches), ["U097KH3QELU"]);
});

test("strictSlackUserMatch: partial names land in closest, never matches", () => {
  const { matches, closest } = strictSlackUserMatch(USERS, "nickc");
  assert.deepEqual(matches, []);
  assert.deepEqual(nickIds(closest), ["UQJ4JNPJA"]);
});

test("strictSlackUserMatch: duplicate display names stay ambiguous", () => {
  const dupes: SlackUserIdentity[] = [
    { id: "UAAA", name: "a", displayName: "Alex Chen" },
    { id: "UBBB", name: "b", displayName: "Alex Chen" },
  ];
  assert.deepEqual(nickIds(strictSlackUserMatch(dupes, "Alex Chen").matches), ["UAAA", "UBBB"]);
});

test("strictSlackUserMatch: @ form never matches display or real names", () => {
  assert.deepEqual(strictSlackUserMatch(USERS, "@Nick Dodson").matches, []);
  assert.deepEqual(strictSlackUserMatch([], "@anything"), { matches: [], closest: [] });
});
