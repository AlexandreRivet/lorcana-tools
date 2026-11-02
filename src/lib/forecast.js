/**
 * Preparing one tournament: its expected field (tournaments and ladder blended), each deck's
 * match win rate against it from the ladder's game win rates, a simulation of its swiss rounds
 * and top cut, and the cards of a deck's lists against their players' results.
 *
 * Decks by inks (the key both sources share: Lorcanahunter's archetypes are ink pairs), or by the
 * ladder's archetypes: each tournament decklist goes to the archetype whose average list it is
 * closest to (`profiles`, see collect.js), and what can't be told apart, an ink pair's unrecognised
 * decks, makes one "rest" deck per ink pair. Pure functions, shared by the page and its
 * simulation worker.
 */
import { config } from '../config.js';
import {
  archetypeNames,
  isRest,
  keyedProfiles,
  listArchetype,
  reconcileArchetypes,
  restInks,
  restKey,
} from './archetypes.js';
import { deckKey, nameArchetypes } from './inks.js';
import { aggregate, differenceCI, firstPlayerWinRate, matchupFor } from './metrics.js';
import { VIEWS, eventLists, fieldReport } from './tournaments.js';

export { VIEWS, isRest, keyedProfiles, listArchetype, reconcileArchetypes, restKey };

/** The decks below `minShare`, summed: plays 50 % against everyone. */
export const OTHER = 'other';

/** A decklist's deck key in a view: its inks, its archetype, or its ink pair's rest. */
export function listKey(list, view, profiles) {
  const colors = [...list.deck.colors].sort();
  if (view !== VIEWS.archetypes) return deckKey(colors);
  return listArchetype(list, profiles) ?? restKey(colors);
}

/**
 * Game win rates of every pair of decks, on the play and on the draw, from ladder BO1 snapshots.
 * By inks, each rate is pulled toward the queue's average on the play (or on the draw) by
 * `priorGames` games, so a thin matchup stays close to "even, with the play advantage"; a mirror
 * is exactly that average. By archetype, it is pulled toward its ink pairs' rate instead, so a
 * thin archetype matchup stays close to what its inks do; a rest deck plays its inks' rates.
 *
 * @param {object} [options] { view, priorGames }
 * @returns {{ firstPlayer: number, rate: (a: string, b: string) => object }} rates as fractions;
 *   rate(a, b) = { onPlay, onDraw, games, raw, inks, weight } from a's side, raw = observed win
 *   rate or null, inks = true when the figures are the ink pairs' (no archetype matchup to tell
 *   apart), weight = { play, draw }: the games behind each rate, prior included (see sampleRates)
 */
export function gameRates(snapshots, options = {}) {
  const { view = VIEWS.colors, priorGames = config.prep.priorGames } = options;
  const agg = aggregate(snapshots, VIEWS.colors);
  const firstPlayer = (firstPlayerWinRate(agg) ?? 50) / 100;
  const shrink = (wins, games, prior) => (wins + prior * priorGames) / (games + priorGames);
  // `weight`: the games behind each rate, prior included: how far a sample may stray from it
  const even = {
    onPlay: firstPlayer,
    onDraw: 1 - firstPlayer,
    games: 0,
    raw: null,
    weight: { play: priorGames, draw: priorGames },
  };

  const inkCache = new Map();
  const inkRate = (a, b) => {
    const id = `${a}|${b}`;
    if (inkCache.has(id)) return inkCache.get(id);
    const m = a && b && a !== b ? matchupFor(agg, a, b) : null;
    const result = m
      ? {
          onPlay: shrink(m.onPlay.wins, m.onPlay.games, firstPlayer),
          onDraw: shrink(m.onDraw.wins, m.onDraw.games, 1 - firstPlayer),
          games: m.games,
          raw: m.games ? m.wins / m.games : null,
          weight: { play: m.onPlay.games + priorGames, draw: m.onDraw.games + priorGames },
        }
      : even;
    inkCache.set(id, result);
    return result;
  };
  if (view !== VIEWS.archetypes) {
    return { firstPlayer, rate: (a, b) => (a === OTHER || b === OTHER ? even : inkRate(a, b)) };
  }

  const archetypes = aggregate(snapshots, VIEWS.archetypes);
  // An archetype of the set missing from these weeks still has its inks in the profiles
  const colors = new Map((options.profiles ?? []).map((p) => [p.archetypeId, p.colors]));
  for (const d of archetypes.decks.values()) colors.set(d.key, d.colors);
  const inksOf = (key) =>
    key === OTHER
      ? null
      : isRest(key)
        ? restInks(key)
        : colors.has(key)
          ? deckKey(colors.get(key))
          : null;
  const cache = new Map();
  return {
    firstPlayer,
    rate(a, b) {
      const id = `${a}|${b}`;
      if (cache.has(id)) return cache.get(id);
      const prior = { ...inkRate(inksOf(a), inksOf(b)), inks: true };
      const m =
        a === b || isRest(a) || isRest(b) || !inksOf(a) || !inksOf(b)
          ? null
          : matchupFor(archetypes, a, b);
      const result =
        a === b
          ? { ...even, inks: false, weight: { play: Infinity, draw: Infinity } }
          : m
            ? {
                onPlay: (m.onPlay.wins + prior.onPlay * priorGames) / (m.onPlay.games + priorGames),
                onDraw: (m.onDraw.wins + prior.onDraw * priorGames) / (m.onDraw.games + priorGames),
                games: m.games,
                raw: m.games ? m.wins / m.games : null,
                inks: false,
                weight: { play: m.onPlay.games + priorGames, draw: m.onDraw.games + priorGames },
              }
            : prior;
      cache.set(id, result);
      return result;
    },
  };
}

/**
 * Chance of winning a best-of-`bestOf` match from the game win rates on the play and on the draw.
 * Game 1's first player is drawn at random, then the loser of each game goes first in the next.
 */
export function matchWinRate({ onPlay, onDraw }, bestOf) {
  const need = Math.ceil(bestOf / 2);
  const memo = new Map();
  const win = (a, b, aPlays) => {
    if (a === need) return 1;
    if (b === need) return 0;
    const id = `${a}|${b}|${aPlays}`;
    if (!memo.has(id)) {
      const p = aPlays ? onPlay : onDraw;
      // Whoever loses a game goes first in the next one
      memo.set(id, p * win(a + 1, b, false) + (1 - p) * win(a, b + 1, true));
    }
    return memo.get(id);
  };
  return (win(0, 0, true) + win(0, 0, false)) / 2;
}

/** Shares (any total) scaled to sum to `total`; null when they sum to 0. */
function scaled(shares, total) {
  const sum = [...shares.values()].reduce((s, v) => s + v, 0);
  return sum > 0 ? new Map([...shares].map(([k, v]) => [k, (total * v) / sum])) : null;
}

/**
 * By archetype, the tournaments' players of each ink pair split between its archetypes, as
 * expected counts. Within each event, the pair's top-cut players follow the archetypes of its
 * top-cut lists and its other players those of its other lists (or the top cut's when none is
 * public): public lists are mostly the top cut's, so their mix alone would favour the archetypes
 * that win. A pair without any list gets nothing here: the caller splits it like the ladder.
 *
 * @returns {Map<string, Map<string, number>>} ink pair → (deck key → players)
 */
function tournamentSplit(events, profiles) {
  const split = new Map();
  for (const event of events) {
    const lists = eventLists(event);
    const pairs = new Map();
    for (const p of event.players) {
      if (!p.deck) continue;
      const inks = deckKey([...p.deck.colors].sort());
      const pair = pairs.get(inks) ?? { cut: 0, rest: 0, cutMix: new Map(), restMix: new Map() };
      pair[p.topCut ? 'cut' : 'rest']++;
      pairs.set(inks, pair);
    }
    for (const list of lists) {
      const pair = pairs.get(deckKey([...list.deck.colors].sort()));
      const mix = list.topCut ? pair.cutMix : pair.restMix;
      const key = listKey(list, VIEWS.archetypes, profiles);
      mix.set(key, (mix.get(key) ?? 0) + 1);
    }
    for (const [inks, pair] of pairs) {
      const cut = scaled(pair.cutMix, pair.cut);
      const rest = scaled(pair.restMix.size ? pair.restMix : pair.cutMix, pair.rest);
      if (!cut && !rest) continue;
      const total = split.get(inks) ?? new Map();
      for (const part of [cut, rest]) {
        for (const [key, n] of part ?? []) total.set(key, (total.get(key) ?? 0) + n);
      }
      split.set(inks, total);
    }
  }
  return split;
}

/**
 * The expected field: each deck's share of the tournaments' players (decks known) blended with
 * its play rate on the ladder's last weeks, in %. Decks under `minShare` are summed as OTHER,
 * except those the user overrides (`overrides`' keys): adaptField and applyOverrides come next.
 *
 * By archetype, each ink pair's tournament share is split between its archetypes as its public
 * lists are (see tournamentSplit), or else as on the ladder; on the ladder, a pair's decks no
 * archetype recognises make its rest deck.
 *
 * @param {object[]} events Lorcanahunter tournaments
 * @param {object[]} ladderSnapshots ladder BO1 weeks to average, any order
 * @param {object} options { view, profiles (by archetype), weight (tournaments, 0 to 1),
 *   overrides: { key: share } }
 * @returns {object[]} { key, colors, label?, name?, tournament, ladder, blended, share }, shares
 *   in %, largest first, OTHER last
 */
export function forecastField(events, ladderSnapshots, options = {}) {
  const { weight = config.prep.tournamentWeight, overrides = {} } = options;
  const { view = VIEWS.colors, profiles = [] } = options;
  const { minShare } = config.prep;
  const decks = new Map();
  const entry = (key, colors) => {
    if (!decks.has(key)) decks.set(key, { key, colors, tournament: 0, ladder: 0 });
    return decks.get(key);
  };

  const field = fieldReport(events, VIEWS.colors);
  const agg = aggregate(ladderSnapshots, VIEWS.colors);
  if (view !== VIEWS.archetypes) {
    for (const d of field.decks) entry(deckKey(d.colors), d.colors).tournament = d.share;
    for (const d of agg.decks.values()) {
      entry(d.key, d.colors).ladder = (100 * d.games) / agg.seats;
    }
  } else {
    // Ladder: each archetype, then what's left of its ink pair
    const archetypes = aggregate(ladderSnapshots, VIEWS.archetypes);
    // Today's name of each archetype, the same as on every page
    const named = archetypeNames(profiles);
    const ladderSplit = new Map();
    for (const pair of agg.decks.values()) {
      ladderSplit.set(pair.key, new Map([[restKey(pair.colors), pair.games]]));
    }
    for (const a of archetypes.decks.values()) {
      const inks = deckKey(a.colors);
      const split = ladderSplit.get(inks) ?? new Map([[restKey(a.colors), 0]]);
      split.set(a.key, a.games);
      split.set(restKey(a.colors), Math.max(0, split.get(restKey(a.colors)) - a.games));
      ladderSplit.set(inks, split);
      Object.assign(entry(a.key, a.colors), {
        // duels.ink renames archetypes too: the profiles hold the latest name
        archetype: named.get(a.key)?.name ?? a.archetype ?? null,
        slug: named.get(a.key)?.slug ?? a.slug ?? null,
      });
    }
    for (const [inks, split] of ladderSplit) {
      for (const [key, games] of split) {
        const d = entry(key, inks.split('/'));
        d.ladder = (100 * games) / agg.seats;
      }
    }

    // Tournaments: each ink pair's share, split as its lists are, or else as on the ladder
    const listSplit = tournamentSplit(events, profiles);
    for (const pair of field.decks) {
      const inks = deckKey(pair.colors);
      const split =
        scaled(listSplit.get(inks) ?? new Map(), pair.share) ??
        scaled(ladderSplit.get(inks) ?? new Map(), pair.share) ??
        new Map([[restKey(pair.colors), pair.share]]);
      for (const [key, share] of split) {
        const d = entry(key, pair.colors);
        d.tournament += share;
        if (!isRest(key) && !d.slug) {
          Object.assign(d, { archetype: named.get(key)?.name ?? null, slug: named.get(key)?.slug });
        }
      }
    }
    const archetypeDecks = [...decks.values()].filter((d) => !isRest(d.key));
    nameArchetypes(archetypeDecks);
    for (const d of decks.values()) {
      if (isRest(d.key)) Object.assign(d, { label: 'Autres listes', name: null });
    }
  }

  // Without one of the sources, the other one alone
  const w = !field.decks.length ? 0 : !agg.seats ? 1 : weight;
  const rows = [...decks.values()].map((d) => ({
    ...d,
    blended: w * d.tournament + (1 - w) * d.ladder,
  }));

  const kept = [];
  const other = { key: OTHER, colors: [], tournament: 0, ladder: 0, blended: 0 };
  for (const d of rows) {
    if (d.blended >= minShare || overrides[d.key] != null) kept.push(d);
    else {
      other.tournament += d.tournament;
      other.ladder += d.ladder;
      other.blended += d.blended;
    }
  }
  if (other.blended > 0 || overrides[OTHER] != null) kept.push(other);

  const total = kept.reduce((sum, d) => sum + d.blended, 0) || 1;
  for (const d of kept) d.share = (100 * d.blended) / total;
  return sortField(kept);
}

/** Largest share first, OTHER last. */
const sortField = (field) =>
  field.sort(
    (a, b) => (a.key === OTHER) - (b.key === OTHER) || b.share - a.share || b.blended - a.blended,
  );

/**
 * The field once part of it adapts to the matchups: a share `alpha` (0 to 1) of the players picks
 * its deck again, knowing the field, and leans toward the decks that beat it. Among them, each
 * deck keeps its share times exp(selectivity × its match win rate gap to the field's average,
 * in points): with 0.15, a deck 5 points above the field draws about twice its share of them, one
 * 5 points below about half. One step only: the adapters answer today's field, not each other.
 * A hypothesis, not a measure: the ladder's weeks of the set show no such effect yet (see
 * README).
 *
 * @param {number[][]} matrix match win rates between the field's decks, in its order
 * @returns {object[]} the field's decks, `adapted` (share after adaptation) and `share` set to it
 */
export function adaptField(field, matrix, alpha, selectivity = config.prep.adaptationSelectivity) {
  const shares = field.map((d) => d.share);
  const winRates = field.map((_, i) => fieldWinRate(matrix, shares, i));
  const average = winRates.reduce((sum, wr, i) => sum + (shares[i] / 100) * wr, 0);
  const pull = shares.map((s, i) => s * Math.exp(selectivity * 100 * (winRates[i] - average)));
  const total = pull.reduce((sum, p) => sum + p, 0) || 1;
  return field.map((d, i) => {
    const adapted = (1 - alpha) * d.share + (alpha * 100 * pull[i]) / total;
    return { ...d, adapted, share: adapted };
  });
}

/**
 * The user's overrides (shares in %) in place of the forecast's, then every share renormalised to
 * 100 %.
 */
export function applyOverrides(field, overrides) {
  const rows = field.map((d) => {
    const overridden = overrides[d.key] != null;
    return { ...d, overridden, share: overridden ? Math.max(0, overrides[d.key]) : d.share };
  });
  const total = rows.reduce((sum, d) => sum + d.share, 0) || 1;
  for (const d of rows) d.share = (100 * d.share) / total;
  return sortField(rows);
}

const logit = (p) => Math.log(p / (1 - p));
const logistic = (x) => 1 / (1 + Math.exp(-x));

/**
 * Game win rates of a player better than the deck's average player by `edge` points: an even
 * game (50 %) becomes 50 + edge %, and every other rate moves by as much in log-odds, so a 90 %
 * game moves less than an even one.
 */
export function withEdge({ onPlay, onDraw }, edge) {
  if (!edge) return { onPlay, onDraw };
  const shift = logit(Math.min(0.99, Math.max(0.01, 0.5 + edge / 100)));
  return {
    onPlay: logistic(logit(onPlay) + shift),
    onDraw: logistic(logit(onDraw) + shift),
  };
}

/**
 * Match win rates between the field's decks, best of `bestOf`: matrix[i][j] for deck i against
 * deck j, in the field's order. With `edges` (points per deck key), deck i is played by a player
 * with that edge, its opponents by average players: the matrix of "our" players.
 */
export function matchMatrix(field, rates, bestOf, edges = {}) {
  return field.map((a) =>
    field.map((b) => {
      const edge = edges[a.key] ?? 0;
      if (a.key === b.key && !edge) return 0.5;
      return matchWinRate(withEdge(rates.rate(a.key, b.key), edge), bestOf);
    }),
  );
}

/** Match win rate of deck `i` against a field (shares in %, any total). */
export function fieldWinRate(matrix, shares, i) {
  const total = shares.reduce((sum, s) => sum + s, 0);
  return shares.reduce((sum, s, j) => sum + (s / total) * matrix[i][j], 0);
}

/**
 * Each deck against the field, and against the field shifted toward one opponent by `points`
 * (taken from the others in proportion): the worst of those is the deck's bad day, if the room
 * goes for its bad matchup.
 *
 * @returns {object[]} per deck, in the field's order: { winRate, worst: { winRate, against } }
 */
export function fieldWinRates(field, matrix, points = config.prep.stressPoints) {
  const shares = field.map((d) => d.share);
  return field.map((_, i) => {
    let worst = null;
    field.forEach((target, t) => {
      const shifted = shares.map((s, j) =>
        j === t ? s + points * (1 - s / 100) : s * (1 - points / 100),
      );
      const winRate = fieldWinRate(matrix, shifted, i);
      if (!worst || winRate < worst.winRate) worst = { winRate, against: target.key };
    });
    return { winRate: fieldWinRate(matrix, shares, i), worst };
  });
}

/** Small seeded generator (mulberry32), so a run can be replayed. */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal draw (Box–Muller). */
function normal(rand) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

/** A Gamma(shape, 1) draw (Marsaglia–Tsang; shape < 1 boosted). */
function gamma(shape, rand) {
  if (shape < 1) return gamma(shape + 1, rand) * rand() ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = normal(rand);
      v = 1 + c * x;
    } while (v <= 0);
    v = v ** 3;
    const u = rand();
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

/** A Beta draw around `mean`, as spread as `weight` games allow; the mean itself if infinite. */
function beta(mean, weight, rand) {
  if (!Number.isFinite(weight)) return mean;
  const a = gamma(mean * weight, rand);
  return a / (a + gamma((1 - mean) * weight, rand));
}

/**
 * The matchups as they might be, given the games they rest on: each game win rate drawn from its
 * Beta distribution (`weight` games, prior included), once per pair of decks, its reverse taken
 * as its complement. Drawing again and again gives how much every figure built on them can move.
 * The ink pairs' rates an archetype matchup is pulled toward are taken as known.
 */
export function sampleRates(rates, rand) {
  const cache = new Map();
  return {
    firstPlayer: rates.firstPlayer,
    rate(a, b) {
      if (a === b) return rates.rate(a, b);
      const [x, y] = a < b ? [a, b] : [b, a];
      const id = `${x}|${y}`;
      if (!cache.has(id)) {
        const r = rates.rate(x, y);
        cache.set(id, {
          onPlay: beta(r.onPlay, r.weight.play, rand),
          onDraw: beta(r.onDraw, r.weight.draw, rand),
        });
      }
      const s = cache.get(id);
      // Seen from the other side: its games on the play are this side's on the draw
      return a === x ? s : { onPlay: 1 - s.onDraw, onDraw: 1 - s.onPlay };
    },
  };
}

/** The `p` quantile (0 to 1) of some numbers, linearly interpolated. */
export function quantile(values, p) {
  const sorted = [...values].sort((x, y) => x - y);
  if (!sorted.length) return NaN;
  const at = p * (sorted.length - 1);
  const low = Math.floor(at);
  return sorted[low] + (sorted[Math.min(low + 1, sorted.length - 1)] - sorted[low]) * (at - low);
}

/**
 * Chance that player `a` beats player `b` from the average players' matrix and the team's (our
 * players, with their edge on their deck). Two team players meet as average ones: rare, and their
 * edges roughly cancel out.
 */
const chance = (matrix, team) => (a, b) =>
  a.team === b.team
    ? matrix[a.deck][b.deck]
    : a.team
      ? team[a.deck][b.deck]
      : 1 - team[b.deck][a.deck];

/**
 * Swiss rounds: players sorted by points (ties in random order), paired down the list, so each
 * meets someone on (or near) the same score. An odd player out gets a bye, worth a win. Rematches
 * aren't avoided: in a large field they're rare and change little.
 */
function swissRound(players, beats, drawRate, rand) {
  for (const p of players) p.tie = rand();
  players.sort((a, b) => b.points - a.points || a.tie - b.tie);
  for (let i = 0; i + 1 < players.length; i += 2) {
    const a = players[i];
    const b = players[i + 1];
    const r = rand();
    if (r < drawRate) {
      a.points += 1;
      b.points += 1;
      a.draws++;
      b.draws++;
    } else if ((r - drawRate) / (1 - drawRate) < beats(a, b)) {
      a.points += 3;
      a.wins++;
      b.losses++;
    } else {
      b.points += 3;
      b.wins++;
      a.losses++;
    }
  }
  if (players.length % 2) {
    const bye = players[players.length - 1];
    bye.points += 3;
    bye.wins++;
  }
}

const emptyCounts = () => ({
  players: 0,
  day2: 0,
  top: 0,
  wins: 0,
  matchWins: 0,
  matchLosses: 0,
  matchDraws: 0,
});

/**
 * Simulates the event `runs` times and counts, per deck of the field, its players, how many
 * reach Day 2, the top cut, and win, and their swiss record. Players differ by their deck alone,
 * except the team's: on each deck with an edge, `teamShare` of its players (one at least) play
 * with it, from the team matrices, and are counted apart. Every deck gets at least one player per
 * run, so the rarest still get measured.
 *
 * With `batches` (matrix sets drawn from sampleRates), the runs are split between them, each
 * batch counted apart too: how much the results move from one plausible set of matchups to
 * another (plus the simulation's own chance).
 *
 * @param {object} input { shares (%, field order), swiss, top (match matrices), teamSwiss,
 *   teamTop (the same with the team's edges), batches ([{ swiss, top, teamSwiss, teamTop }], in
 *   place of the four), edged (per deck: has an edge), format: the prep settings (players,
 *   rounds, points…), runs, seed }
 * @param {(done: number) => void} [progress] called every few runs
 * @returns {{ counts: object[], team: object[], batches: object[] }} per deck, the average
 *   players' and the team's: { players, day2, top, wins, matchWins, matchLosses, matchDraws };
 *   and the same per batch ({ counts, team })
 */
export function simulate(input, progress) {
  const { shares, swiss, top, format, runs, seed = 1 } = input;
  const { teamSwiss = swiss, teamTop = top, edged = [] } = input;
  const sets = input.batches ?? [{ swiss, top, teamSwiss, teamTop }];
  const { players: size, day1Rounds, day2Points, day2Rounds, topCut, drawRate } = format;
  const teamShare = format.teamShare ?? config.prep.teamShare;
  const rand = random(seed);
  const n = shares.length;
  const total = shares.reduce((sum, s) => sum + s, 0);
  const cumulative = [];
  shares.reduce((sum, s, i) => (cumulative[i] = sum + s / total), 0);
  const counts = shares.map(emptyCounts);
  const team = shares.map(emptyCounts);
  const batches = sets.map(() => ({
    counts: shares.map(emptyCounts),
    team: shares.map(emptyCounts),
  }));

  for (let run = 0; run < runs; run++) {
    const batch = Math.floor((run * sets.length) / runs);
    const set = sets[batch];
    const swissBeats = chance(set.swiss, set.teamSwiss);
    const topBeats = chance(set.top, set.teamTop);
    const players = Array.from({ length: size }, () => {
      const r = rand();
      let deck = cumulative.findIndex((c) => r < c);
      if (deck < 0) deck = n - 1;
      return { deck, team: false, points: 0, wins: 0, losses: 0, draws: 0, tie: 0 };
    });
    // One player at least per deck, in place of random players
    for (let d = 0; d < n && d < size; d++) {
      if (!players.some((p) => p.deck === d)) players[Math.floor(rand() * size)].deck = d;
    }
    // The team: a few of each edged deck's players, picked at random
    for (let d = 0; d < n; d++) {
      if (!edged[d]) continue;
      const pool = players.filter((p) => p.deck === d);
      for (let k = Math.max(1, Math.round(teamShare * pool.length)); k > 0 && pool.length; k--) {
        pool.splice(Math.floor(rand() * pool.length), 1)[0].team = true;
      }
    }

    for (let round = 0; round < day1Rounds; round++) {
      swissRound(players, swissBeats, drawRate, rand);
    }
    const day2 = players.filter((p) => p.points >= day2Points);
    for (let round = 0; round < day2Rounds; round++) swissRound(day2, swissBeats, drawRate, rand);
    // Ties broken at random: the real tiebreakers (opponents' results) aren't simulated
    for (const p of day2) p.tie = rand();
    day2.sort((a, b) => b.points - a.points || a.tie - b.tie);
    const cut = day2.slice(0, topCut);

    // Single elimination, seeded 1 v 8, 4 v 5, 2 v 7, 3 v 6; a missing seed is a bye
    let bracket = seedOrder(topCut).map((seed) => cut[seed] ?? null);
    while (bracket.length > 1) {
      const next = [];
      for (let i = 0; i < bracket.length; i += 2) {
        const [a, b] = [bracket[i], bracket[i + 1]];
        next.push(!a || !b ? (a ?? b) : rand() < topBeats(a, b) ? a : b);
      }
      bracket = next;
    }

    // Every count goes to the totals and to the run's batch
    const of = (p) => [
      (p.team ? team : counts)[p.deck],
      (p.team ? batches[batch].team : batches[batch].counts)[p.deck],
    ];
    for (const p of players) {
      for (const c of of(p)) {
        c.players++;
        c.matchWins += p.wins;
        c.matchLosses += p.losses;
        c.matchDraws += p.draws;
      }
    }
    for (const p of day2) for (const c of of(p)) c.day2++;
    for (const p of cut) for (const c of of(p)) c.top++;
    if (bracket.length) for (const c of of(bracket[0])) c.wins++;
    if (progress && (run + 1) % 10 === 0) progress(run + 1);
  }
  return { counts, team, batches };
}

/** Standard bracket order of `size` seeds (a power of 2), as indexes: 8 → 0 7 3 4 1 6 2 5. */
function seedOrder(size) {
  let order = [0];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n - 1 - s]);
  }
  return order.filter((s) => s < size);
}

/** Every public list of the period of one deck (its key in the view: inks, archetype or rest). */
export const deckLists = (events, key, view = VIEWS.colors, profiles = []) =>
  events.flatMap(eventLists).filter((l) => listKey(l, view, profiles) === key);

/**
 * The cards of a deck's public lists against their players' results. Per card: the share of the
 * lists playing it, among the top cut's lists and among the others, the copies when played, and
 * the match win rate of the players with it and without it, with the 99% interval of the gap.
 * The lists are mostly the top cut's, so every win rate is high: only the gap means something,
 * and only on cards some lists leave out.
 */
export function cardPerformance(lists) {
  const cut = lists.filter((l) => l.topCut).length;
  const record = (sum, l) => ({ wins: sum.wins + l.wins, games: sum.games + l.wins + l.losses });
  const all = lists.reduce(record, { wins: 0, games: 0 });
  const cards = new Map();
  for (const list of lists) {
    for (const entry of list.cards) {
      const c = cards.get(entry.name) ?? {
        name: entry.name,
        cost: entry.cost,
        lists: [],
        copies: 0,
      };
      // A card listed twice (two printings) counts once per list
      if (c.lists.at(-1) !== list) c.lists.push(list);
      c.copies += entry.quantity;
      cards.set(entry.name, c);
    }
  }

  return [...cards.values()]
    .map(({ lists: playing, copies, ...c }) => {
      const withIt = playing.reduce(record, { wins: 0, games: 0 });
      const without = { wins: all.wins - withIt.wins, games: all.games - withIt.games };
      const inCut = playing.filter((l) => l.topCut).length;
      return {
        ...c,
        lists: playing.length,
        share: (100 * playing.length) / lists.length,
        cutShare: cut ? (100 * inCut) / cut : null,
        otherShare:
          lists.length > cut ? (100 * (playing.length - inCut)) / (lists.length - cut) : null,
        meanCopies: copies / playing.length,
        withIt: withIt.games ? (100 * withIt.wins) / withIt.games : null,
        without: without.games ? (100 * without.wins) / without.games : null,
        withoutLists: lists.length - playing.length,
        // 99% rather than 95%: every card of the deck is tested at once
        gap: differenceCI(withIt.wins, withIt.games, without.wins, without.games, 2.58),
      };
    })
    .sort(
      (a, b) => b.share - a.share || b.meanCopies - a.meanCopies || a.name.localeCompare(b.name),
    );
}

/**
 * What to expect from a deck across the table: the cards in at least half its lists that set it
 * apart the most from every other deck's lists (share in its lists minus share in the others).
 */
export function keyCards(events, key, count = 4, view = VIEWS.colors, profiles = []) {
  const lists = events.flatMap(eventLists);
  const own = lists.filter((l) => listKey(l, view, profiles) === key);
  const others = lists.length - own.length;
  if (!own.length) return [];
  const shares = new Map();
  for (const list of lists) {
    const mine = listKey(list, view, profiles) === key;
    for (const name of new Set(list.cards.map((c) => c.name))) {
      const s = shares.get(name) ?? { name, own: 0, others: 0 };
      if (mine) s.own++;
      else s.others++;
      shares.set(name, s);
    }
  }
  return [...shares.values()]
    .map((s) => ({
      name: s.name,
      share: s.own / own.length,
      apart: s.own / own.length - (others ? s.others / others : 0),
    }))
    .filter((s) => s.share >= 0.5)
    .sort((a, b) => b.apart - a.apart)
    .slice(0, count);
}

/** An archetype's profiles (its list clusters), most played first. */
const profilesOf = (profiles, key) =>
  profiles.filter((p) => p.archetypeId === key).sort((a, b) => b.games - a.games);

/** An archetype's signature cards on the ladder: those of its most played profile. */
export const ladderSignature = (profiles, key) => profilesOf(profiles, key)[0]?.signature ?? [];

/**
 * The cards that swing an ink pair's results on the ladder (`pairLift` in profiles.json, kept to
 * the queue's ranks): per card, its presence (0 to 1), the games and win rate with it, and the gap
 * to the pair's win rate, in points. Gains first, then losses, biggest first.
 */
export const ladderCards = (pairLift, colors) =>
  [...(pairLift?.[deckKey(colors)] ?? [])].sort(
    (a, b) => (b.lift > 0) - (a.lift > 0) || Math.abs(b.lift) - Math.abs(a.lift),
  );

/** Below this many hands kept (or sent back) with a card, the two aren't compared. */
const MIN_MULLIGAN_HANDS = 30;

/**
 * The mulligan guide of an archetype, per seat, from its ladder opening hands (`openings` in
 * profiles.json, by slug): for each card, how often it's in the opening hand, how often players
 * keep it, and the game win rate when kept and when sent back, with the 99 % interval of the gap
 * (every card of the deck is tested at once). `keep`: cards whose keeping clearly wins more,
 * `toss`: clearly less. A kept card also tells of the rest of the hand (one sends a card back from
 * a hand that needs it gone), so the gap is a guide, not the card's own worth.
 *
 * @returns {{ play: object, draw: object } | null} per seat: { cards, keep, toss }, biggest gaps
 *   first; null without opening hands for the archetype
 */
export function mulliganGuide(openings, key) {
  const seats = openings?.[key];
  if (!seats) return null;
  const guide = {};
  for (const seat of ['play', 'draw']) {
    const cards = (seats[seat] ?? []).map(
      ([name, seen, seenWon, kept, keptWon, tossed, tossedWon]) => {
        const compared = kept >= MIN_MULLIGAN_HANDS && tossed >= MIN_MULLIGAN_HANDS;
        return {
          name,
          seen,
          winRate: seen ? (100 * seenWon) / seen : null,
          keepRate: seen ? (100 * kept) / seen : null,
          kept: compared ? (100 * keptWon) / kept : null,
          tossed: compared ? (100 * tossedWon) / tossed : null,
          gap: compared ? differenceCI(keptWon, kept, tossedWon, tossed, 2.58) : null,
        };
      },
    );
    const byGap = (a, b) => b.kept - b.tossed - (a.kept - a.tossed);
    guide[seat] = {
      cards,
      keep: cards.filter((c) => c.gap?.[0] > 0).sort(byGap),
      toss: cards.filter((c) => c.gap?.[1] < 0).sort((a, b) => byGap(b, a)),
    };
  }
  return guide;
}
