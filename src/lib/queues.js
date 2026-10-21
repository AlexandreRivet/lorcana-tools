/**
 * Collected queue ids, and picks the queue to feature (digest, page default) from the queues'
 * indexes.
 */
const DAY_MS = 86_400_000;

/** duels.ink's rank tiers, lowest first. */
export const RANKS = [
  'Common',
  'Uncommon',
  'Rare',
  'Super Rare',
  'Legendary',
  'Epic',
  'Enchanted',
  'Iconic',
];

/**
 * A collected queue's id: `<queue>[@<era>][+<rank>]`. `@<era>` keeps one set's games;
 * `+<rank>` keeps the games where both players are at that rank or above (`+legendary`,
 * `+super-rare`).
 *
 * @returns {{ queue: string, era: string | undefined, minRank: string | null, ranks: string[] | null }}
 */
export function parseQueueId(id) {
  const [base, rank] = id.split('+');
  const [queue, era] = base.split('@');
  if (!rank) return { queue, era, minRank: null, ranks: null };
  const slug = (name) => name.toLowerCase().replace(/\s+/g, '-');
  const from = RANKS.findIndex((name) => slug(name) === rank.toLowerCase());
  if (from < 0) throw new Error(`Unknown rank ${rank} in ${id} (${RANKS.map(slug).join(', ')})`);
  return { queue, era, minRank: RANKS[from], ranks: RANKS.slice(from) };
}

/** End date (Saturday, YYYY-MM-DD) of the last week that is over, duels.ink weeks being Sunday–Saturday. */
export function lastFinishedWeekEnd(today = new Date()) {
  const day = today.getUTCDay();
  const daysBack = day === 6 ? 7 : day + 1;
  return new Date(today.getTime() - daysBack * DAY_MS).toISOString().slice(0, 10);
}

/** Whether a week is over (its data won't change any more), as opposed to still in progress. */
export function isWeekComplete(week, today = new Date()) {
  return week.endDate <= lastFinishedWeekEnd(today);
}

/**
 * First index, in the given order, with data for the last finished week (the week in progress
 * doesn't count: a queue that just opened would win with no finished week to show); otherwise the
 * one with the most recent data, so a closed queue never wins over a live one.
 *
 * @param {object[]} indexes contents of data/<queue>/index.json, in priority order
 * @returns {object | null} null when no index has any week
 */
export function pickFeaturedQueue(indexes, today = new Date()) {
  const lastEnd = lastFinishedWeekEnd(today);
  const latest = (index) => index.weeks.at(-1)?.endDate ?? '';
  const candidates = indexes.filter((index) => index?.weeks.length);
  if (!candidates.length) return null;
  return (
    candidates.find((index) => index.weeks.some((week) => week.endDate === lastEnd)) ??
    candidates.reduce((best, index) => (latest(index) > latest(best) ? index : best))
  );
}
