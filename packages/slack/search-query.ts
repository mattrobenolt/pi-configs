export function validateSlackSearchDate(value: string): string {
  const trimmed = value.trim();
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ||
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== trimmed
  ) {
    throw new Error(`Invalid date: ${value} (expected YYYY-MM-DD)`);
  }
  return trimmed;
}

export function validateSlackSearchQuery(query: string): string {
  const trimmed = query.trim();
  const operators = [
    ...trimmed.matchAll(/(?:^|\s)(after|before|in|from):(?:"[^"]*"|'[^']*'|\S+)/gi),
  ].map((match) => `${match[1]!.toLowerCase()}:`);

  if (operators.length > 0) {
    const names = [...new Set(operators)].join(", ");
    throw new Error(
      `slack_search.query contains structured filters: ${names}. Move in:, from:, after:, and before: into their named tool parameters. ` +
        "after/before accept calendar dates in YYYY-MM-DD format only; use slack_channel_history with oldest=nextOldest for exact-time channel polling.",
    );
  }

  return trimmed;
}
