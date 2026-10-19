/**
 * The week's figures for the podcast script, taken from a report: rounded, labelled in French
 * (decks by their plain colours, « jaune-vert », as the hosts say them) and already qualified (a change within the noise says so), so the model only tells them and
 * never computes or reads intervals itself. Pure functions.
 */
import { formatWeekRange } from './format.js';
import { deckColorName } from './inks.js';

/** Weeks of play-rate history given per deck. */
const HISTORY_WEEKS = 6;
/** Most lopsided matchups listed. */
const MATCHUPS = 6;
/** Matchups are only picked among this many top decks: the ones listeners face. */
const MATCHUP_DECKS = 8;

const round1 = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10);

const CHANGE = { up: 'hausse nette', down: 'baisse nette', flat: 'dans le bruit statistique' };
const VS_50 = {
  above: 'au-dessus de 50 %',
  below: 'en dessous de 50 %',
  neutral: 'pas distinguable de 50 %',
};

function deckFacts(deck, rank) {
  const { history, playDraw } = deck;
  return {
    rank,
    deck: deckColorName(deck.colors),
    playRate: round1(deck.playRate),
    playRateLastWeek: round1(deck.previous?.playRate),
    playRateChange: round1(deck.deltaPlayRate),
    playRateTrend: deck.playRateChange ? CHANGE[deck.playRateChange.signal] : null,
    winRate: round1(deck.winRate),
    winRateRange: deck.ci.map(round1),
    winRateVs50: VS_50[deck.signal],
    winRateLastWeek: round1(deck.previous?.winRate),
    winRateChange: round1(deck.deltaWinRate),
    winRateTrend: deck.winRateChange ? CHANGE[deck.winRateChange.signal] : null,
    winRateOnPlay: round1(playDraw?.onPlay.winRate),
    winRateOnDraw: round1(playDraw?.onDraw.winRate),
    // Points won by going first rather than second
    playDrawGap:
      playDraw?.onPlay.winRate != null && playDraw?.onDraw.winRate != null
        ? round1(playDraw.onPlay.winRate - playDraw.onDraw.winRate)
        : null,
    playRateHistory: history.slice(-HISTORY_WEEKS).map((h) => round1(h.playRate)),
  };
}

function matchupFacts(report, relevance) {
  if (!relevance.matchups.ok) return { reliable: false, reason: relevance.matchups.reason };
  const { cells, weeks } = report.matchups;
  const top = new Set(report.decks.slice(0, MATCHUP_DECKS).map((d) => d.key));
  const named = new Map(report.decks.map((d) => [d.key, deckColorName(d.colors)]));
  const solid = cells.filter(
    (c) =>
      !c.mirror &&
      c.winRate != null &&
      c.games >= report.options.minMatchupGames &&
      top.has(c.row) &&
      top.has(c.col),
  );
  // Each pair once, from the favoured side
  const lopsided = solid
    .filter((c) => c.winRate > 50)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, MATCHUPS)
    .map((c) => ({
      favourite: named.get(c.row),
      against: named.get(c.col),
      winRate: round1(c.winRate),
      games: c.games,
    }));
  // Clear moves this week, from the side that gained
  const moved = cells
    .filter((c) => c.trend === 'up')
    .map((c) => ({
      deck: named.get(c.row),
      against: named.get(c.col),
      winRateThisWeek: round1(c.thisWeek.winRate),
      winRateBefore: round1(c.before.winRate),
    }));
  return { reliable: true, weeksSummed: weeks.length, lopsided, clearMovesThisWeek: moved };
}

/**
 * @param {object} report from buildReport (default trend window: the history needs it)
 * @param {object} relevance from chartRelevance(report)
 */
export function buildPodcastFacts(report, relevance) {
  const { week, previousWeek, unit, summary, decks } = report;
  const name = (deck) => (deck ? deckColorName(deck.colors) : null);
  const volumeChange = previousWeek?.sampleSize
    ? round1((100 * (week.sampleSize - previousWeek.sampleSize)) / previousWeek.sampleSize)
    : null;

  const facts = {
    format: report.gameMode === 'bo3' ? 'best-of-three' : 'best-of-one',
    queueName: report.queueName,
    set: report.era?.name ?? null,
    week: formatWeekRange(week.startDate, week.endDate),
    unit: unit.many,
    volume: {
      thisWeek: week.sampleSize,
      lastWeek: previousWeek?.sampleSize ?? null,
      changePercent: volumeChange,
    },
    enoughData: relevance.week.ok,
  };
  if (!relevance.week.ok) return { ...facts, note: relevance.week.reason };

  return {
    ...facts,
    comparedWithLastWeek: Boolean(previousWeek),
    // Who goes first wins this share of games, over the matchup window
    firstPlayerWinRate: round1(report.matchups.firstPlayerWinRate),
    headlines: {
      mostPlayed: name(summary.topDeck),
      risers: summary.risers.map((d) => ({ deck: name(d), change: round1(d.deltaPlayRate) })),
      fallers: summary.fallers.map((d) => ({ deck: name(d), change: round1(d.deltaPlayRate) })),
      // Ranked on the interval's lower bound: a small lucky sample doesn't win
      bestWinRate: name(summary.bestWinRate),
    },
    decks: decks.map((deck, i) => deckFacts(deck, i + 1)),
    matchups: matchupFacts(report, relevance),
  };
}
