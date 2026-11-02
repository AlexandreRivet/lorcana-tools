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
   * `+<rank>` keeps the games where both players are at that rank or above (ranked queues only).
   */
  queues: [
    // The top of the ladder only: games between two Legendary players or above
    'core-bo1@set-14-core+legendary',
    'core-bo3@set-14-core+legendary',
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

  /** Tournaments page, from Lorcanahunter's results (npm run collect:tournaments). */
  tournaments: {
    /** Core tournaments of the last `windowDays` days with more than `minPlayers` players. */
    windowDays: 14,
    minPlayers: 75,
    /**
     * Without a top cut in the results, one is assumed: the largest power of 2 up to one player
     * in `assumedCutRatio` (8: 76 to 127 players → top 8, 128 to 255 → top 16).
     */
    assumedCutRatio: 8,
    /** Decks shown one by one in the charts; the others are summed under "Autres". */
    maxSlices: 8,
    /**
     * Top-cut lists: a card in every list is core, in at least `nearShare` of them a near-core
     * one, otherwise a possible tech card.
     */
    nearShare: 0.5,
    /**
     * By archetype (known from public lists only), a tournament only counts when at least this
     * share of its players outside the top cut have a public list: lists published for the top
     * cut alone would put nearly every listed player in it.
     */
    minListShare: 0.5,
  },

  /**
   * Tournament preparation page: the expected field of one event, each deck's win rate against
   * it, and a simulation of the event's swiss rounds and top cut. The defaults are London's.
   */
  prep: {
    event: 'Londres',
    /** Expected players: only the field's proportions matter for the win rates, not its size. */
    players: 1200,
    /** Day 1: `day1Rounds` swiss rounds, Day 2 from `day2Points` points (3 a win, 1 a draw). */
    day1Rounds: 8,
    day2Points: 18,
    /** Day 2: `day2Rounds` more swiss rounds, points carried over, then the top cut. */
    day2Rounds: 7,
    topCut: 8,
    /** Best of: swiss matches, top-cut matches. */
    swissBestOf: 3,
    topCutBestOf: 5,
    /**
     * Share of swiss matches drawn (time called), as a fraction: 4 to 4.5 % in the big tournaments
     * of October 2026 (Lorcanahunter's records).
     */
    drawRate: 0.04,
    /** Forecast field: weight of the tournaments against the ladder's last weeks, 0 to 1. */
    tournamentWeight: 0.6,
    /** Ladder weeks (BO1, last finished first) whose play rates feed the forecast. */
    ladderWeeks: 2,
    /**
     * Matchups: ladder BO1 games of every week of the set, by inks, each win rate (on the play,
     * on the draw) pulled toward the queue's average by `priorGames` games: a matchup seen 30
     * times moves about half way from that average.
     */
    priorGames: 30,
    /** Decks under this forecast share (%) are summed as "Autres", at 50 % against everyone. */
    minShare: 0.5,
    /**
     * Adaptation (a scenario, see adaptField): the share of the players who pick their deck again
     * against the forecast field, 0 to 1 (a slider), and how strongly they lean toward the decks
     * that beat it, per point of match win rate.
     */
    adaptation: 0,
    adaptationSelectivity: 0.15,
    /** Field shifted toward one deck by this many points, to find each deck's worst case. */
    stressPoints: 10,
    /** Simulated tournaments per run: ~1 s for 2 000 of 1 200 players. */
    simulations: 2000,
    /**
     * Uncertainty: the matchups drawn again this many times, from the games they rest on, for
     * the win rates' range; the simulation split into `uncertaintyBatches` batches, each on its
     * own draw, for its chances' range. Ranges hold `uncertaintyLevel` of the draws (90 %).
     */
    uncertaintySamples: 100,
    uncertaintyBatches: 20,
    uncertaintyLevel: 0.9,
    /**
     * Our players: on a deck the team masters better (or worse) than its average player, this
     * share of its simulated players play with that edge, counted apart (one at least per run).
     */
    teamShare: 0.05,
  },

  /**
   * The ladder's archetypes, told apart by what they play on every page (src/lib/archetypes.js):
   * cards shared, copies counted, out of 60.
   */
  archetypes: {
    /**
     * A week's archetype is one of today's when their average lists share at least this many:
     * one archetype from week to week shares 50 to 60, two near builds of one inks up to 48
     * (they are then matched one to one, closest first).
     */
    weekShared: 40,
    /**
     * A tournament decklist goes to the archetype whose average list shares the most cards with
     * it, if at least this many; otherwise to its ink pair's "Autres listes". A list and its own
     * archetype's average share 50 or so.
     */
    listShared: 30,
    /**
     * Two of today's archetypes of one inks are variants of one deck, merged, when their average
     * lists share at least this many (He Hurled and Woolter, 48; then the closest pair is 43.5,
     * where merging would start chaining distinct decks together).
     */
    mergeShared: 45,
  },
};

export const SOURCE_URL = 'https://duels.ink/stats';
export const LORCANAHUNTER_URL = 'https://lorcanahunter.com';
