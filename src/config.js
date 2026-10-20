/**
 * Settings shared by the collector, the Discord digest and the web page.
 */
export const config = {
  /**
   * Queues collected every week (ids from meta.queues.active), in priority order: the digest
   * and the page feature the first one with data for the last finished week. During a set's
   * beta, list the beta queue first; once duels.ink closes it, it stops getting new weeks and
   * the next queue takes over.
   *
   * `<queue>@<era>` keeps only one set's games (era keys from meta.eras): the ranked queues keep
   * their id from one set to the next, and a release week would otherwise mix two sets.
   */
  queues: [
    'core-bo1@set-14-core',
    'core-bo3@set-14-core',
    // Set 14 betas, closed at release: kept for the page
    'quick-play-core-set14',
    'core-bo3-set14',
  ],

  /**
   * Decks of the meta map, the key figures (page and Discord summary) and the podcast: the most
   * played ones that week, above minPlayRate (%). The map gets unreadable with more.
   */
  topDecks: 12,
  minPlayRate: 1,

  /**
   * Decks of every other chart, their tables and the deck picker: every deck above this play
   * rate (%), up to maxDecks, the top decks first. Their figures come with their interval, so
   * the less played ones stay readable. Applied once, when the report is built.
   */
  deckMinPlayRate: 0.5,
  maxDecks: 24,

  /**
   * Minimum games (BO3: matches) in a week for its charts to be shown, and for it to be
   * compared with: below, the page shows a note and Discord leaves the charts out.
   */
  minWeekSample: 500,

  /** Number of weeks shown in the trend chart. */
  trendWeeks: 12,

  /** Weeks in the Discord digest's trend chart: the week and the one before. */
  digestTrendWeeks: 2,

  /** Weeks summed for the matchup matrix (a single week is too thin). */
  matchupWeeks: 4,

  /** Below this, a matchup cell is greyed out: the win rate isn't reliable. */
  minMatchupGames: 100,

  /** Play-rate change (points) from which a deck is listed as rising / falling. */
  moverThreshold: 0.5,
};

export const SOURCE_URL = 'https://duels.ink/stats';
