export type SlackTargetClassification = {
  kind: "channel-id" | "user-id" | "channel-name" | "handle" | "bare";
  value: string;
};

// Mirrors isChannelId in index.ts: Slack channel IDs start with C (public),
// D (DM), or G (group DM) followed by 8+ base-36 chars.
const CHANNEL_ID_RE = /^[CDG][A-Z0-9]{8,}$/;
const USER_ID_RE = /^U[A-Z0-9]{8,}$/;

/**
 * Classify a Slack post target token: channel IDs (C/D/G...), user IDs
 * (U...), '@handles', '#channel names', or bare tokens that could be either.
 */
export function classifySlackTarget(channel: string): SlackTargetClassification {
  const trimmed = channel.trim();
  if (!trimmed) throw new Error("Channel is empty");
  if (CHANNEL_ID_RE.test(trimmed)) return { kind: "channel-id", value: trimmed };
  if (USER_ID_RE.test(trimmed)) return { kind: "user-id", value: trimmed };
  if (trimmed.startsWith("@")) {
    const value = trimmed.slice(1).trim();
    if (!value) throw new Error("Channel is empty");
    return { kind: "handle", value };
  }
  if (trimmed.startsWith("#")) return { kind: "channel-name", value: trimmed.slice(1) };
  return { kind: "bare", value: trimmed };
}

export type SlackUserIdentity = {
  id: string;
  name?: string;
  displayName?: string;
  realName?: string;
  email?: string;
};

export type StrictUserMatch<T extends SlackUserIdentity = SlackUserIdentity> = {
  matches: T[];
  closest: T[];
};

/**
 * Strict identity matching for DM delivery. '@handles' resolve to the exact
 * Slack handle only (unique per workspace); everything else must exactly
 * equal one of id, handle, display name, real name, or email. Substring
 * matches land in closest for error hints, never in matches - a routing
 * tool must not guess between people who merely share a name fragment.
 */
export function strictSlackUserMatch<T extends SlackUserIdentity>(
  users: T[],
  query: string,
): StrictUserMatch<T> {
  const trimmed = query.trim();
  const isHandle = trimmed.startsWith("@");
  const needle = (isHandle ? trimmed.slice(1) : trimmed).trim().toLowerCase();
  if (!needle) return { matches: [], closest: [] };

  const matches: T[] = [];
  const closest: T[] = [];
  for (const user of users) {
    const values = [user.id, user.name, user.displayName, user.realName, user.email]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());
    if (isHandle ? user.name?.toLowerCase() === needle : values.includes(needle)) {
      matches.push(user);
    } else if (values.some((value) => value.includes(needle))) {
      closest.push(user);
    }
  }
  return { matches, closest };
}
