/**
 * The week's figures for the podcast script, taken from the reports: rounded, labelled in French
 * (decks by their plain colours, « jaune-vert », as the hosts say them) and already qualified (a
 * change within the noise says so), so the model only tells them and never computes or reads
 * intervals itself. Two parts per format: the colour pairs, kept short, then the top archetypes,
 * in detail, each with its colours. Pure functions.
 */
import { formatWeekRange } from './format.js';
import { deckColorName } from './inks.js';
import { chartRelevance } from './relevance.js';

/** Weeks of play-rate history given per archetype. */
const HISTORY_WEEKS = 6;
/** Colour pairs listed, with a few figures each. */
const INK_DECKS = 8;
/** Archetypes told in detail: the ones that shape the meta. */
const TOP_ARCHETYPES = 5;

const round1 = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10);

const CHANGE = { up: 'hausse nette', down: 'baisse nette', flat: 'dans le bruit statistique' };
const VS_50 = {
  above: 'au-dessus de 50 %',
  below: 'en dessous de 50 %',
  neutral: 'pas distinguable de 50 %',
};

/** A colour pair in a few figures: the overview before the archetypes. */
function inkDeckFacts(deck, rank) {
  return {
    rank,
    deck: deckColorName(deck.colors),
    playRate: round1(deck.playRate),
    playRateChange: round1(deck.deltaPlayRate),
    playRateTrend: deck.playRateChange ? CHANGE[deck.playRateChange.signal] : null,
    winRate: round1(deck.winRate),
    winRateVs50: VS_50[deck.signal],
  };
}

/**
 * The top archetypes' names as said aloud: duels.ink's name, with the key cards only when two of
 * them share both name and colours (the page's « Midrange · He Hurled », without the dot).
 */
function spokenNames(top) {
  const base = (d) => d.archetype ?? d.label;
  const id = (d) => `${d.colors.join('/')}|${base(d)}`;
  const shared = (d) => top.filter((other) => id(other) === id(d)).length > 1;
  return new Map(top.map((d) => [d.key, shared(d) ? d.label.replace(/ · /g, ' ') : base(d)]));
}

/** An archetype in detail, with its colours so it is never mistaken for another. */
function archetypeFacts(deck, rank, names) {
  const { history, playDraw } = deck;
  return {
    rank,
    archetype: names.get(deck.key),
    colors: deckColorName(deck.colors),
    playRate: round1(deck.playRate),
    playRateLastWeek: round1(deck.previous?.playRate),
    playRateChange: round1(deck.deltaPlayRate),
    playRateTrend: deck.playRateChange ? CHANGE[deck.playRateChange.signal] : null,
    winRate: round1(deck.winRate),
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

/** The matchups between the top archetypes, each pair once, from the favoured side. */
function archetypeMatchupFacts(report, relevance, top, names) {
  if (!relevance.matchups.ok) return { reliable: false, reason: relevance.matchups.reason };
  const keys = new Set(top.map((d) => d.key));
  const named = new Map(top.map((d) => [d.key, `${names.get(d.key)} ${deckColorName(d.colors)}`]));
  const { cells, weeks, unit } = report.matchups;
  const between = cells.filter((c) => !c.mirror && keys.has(c.row) && keys.has(c.col));
  const pairs = between
    .filter((c) => c.winRate != null && c.games >= report.options.minMatchupGames)
    .filter((c) => c.winRate > 50)
    .sort((a, b) => b.winRate - a.winRate)
    .map((c) => ({
      favourite: named.get(c.row),
      against: named.get(c.col),
      winRate: round1(c.winRate),
      games: c.games,
    }));
  // Clear moves this week, from the side that gained
  const moved = between
    .filter((c) => c.trend === 'up')
    .map((c) => ({
      archetype: named.get(c.row),
      against: named.get(c.col),
      winRateThisWeek: round1(c.thisWeek.winRate),
      winRateBefore: round1(c.before.winRate),
    }));
  return {
    reliable: true,
    weeksSummed: weeks.length,
    // Archetype matchups count single games, even in best-of-three
    unit: unit.many,
    favoured: pairs,
    clearMovesThisWeek: moved,
  };
}

/** The top archetypes of a report by archetype, or why there are none. */
function archetypesFacts(report) {
  const relevance = chartRelevance(report);
  if (!relevance.week.ok) return { available: false, reason: relevance.week.reason };
  const top = report.topDecks.slice(0, TOP_ARCHETYPES);
  const names = spokenNames(top);
  return {
    available: true,
    // Share of the week's decks duels.ink recognises as an archetype (%)
    recognisedDecks: Math.round(100 * report.coverage),
    top: top.map((deck, i) => archetypeFacts(deck, i + 1, names)),
    matchups: archetypeMatchupFacts(report, relevance, top, names),
  };
}

/**
 * @param {object} report from buildReport, by inks (default trend window)
 * @param {object} relevance from chartRelevance(report)
 * @param {object | null} [archetypes] the same week by archetype, or null when it has none (or
 *   too few decks recognised to say anything by archetype)
 */
export function buildPodcastFacts(report, relevance, archetypes = null) {
  const { week, previousWeek, unit, summary } = report;
  const decks = report.topDecks ?? report.decks;
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
    // First part: the colour pairs, a quick overview
    colorPairs: {
      headlines: {
        mostPlayed: name(summary.topDeck),
        risers: summary.risers.map((d) => ({ deck: name(d), change: round1(d.deltaPlayRate) })),
        fallers: summary.fallers.map((d) => ({ deck: name(d), change: round1(d.deltaPlayRate) })),
        // Ranked on the interval's lower bound: a small lucky sample doesn't win
        bestWinRate: name(summary.bestWinRate),
      },
      decks: decks.slice(0, INK_DECKS).map((deck, i) => inkDeckFacts(deck, i + 1)),
    },
    // Second part: the archetypes that shape the meta, in detail
    archetypes: archetypes
      ? archetypesFacts(archetypes)
      : { available: false, reason: 'Trop peu de decks reconnus par archétype cette semaine' },
  };
}
