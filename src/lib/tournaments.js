/**
 * Lorcanahunter tournaments: the top-cut rule, the players' lists and their archetypes, the
 * starting field and its conversion to the top cut, and the top-cut decklists card by card.
 * Shared by the collector and the page.
 */
import { config } from '../config.js';
import { archetypeDecks, listArchetype, restKey } from './archetypes.js';
import { deckKey, deckName } from './inks.js';
import { wilson } from './metrics.js';

/**
 * Charts by ink pair, or by the ladder's archetype as on every page: a player's archetype is
 * known from their public list only (see assignArchetypes).
 */
export const VIEWS = { colors: 'colors', archetypes: 'archetypes' };

/** Largest power of 2 up to `players / ratio`, at least 2. */
export function assumedCutSize(players, ratio = config.tournaments.assumedCutRatio) {
  let size = 2;
  while (size * 2 <= players / ratio) size *= 2;
  return size;
}

/**
 * The top cut of a tournament's standings: the players the results flag, or else the first
 * `assumedCutSize` places. A flag on every player (or none) isn't a cut. The assumed cut goes by
 * the tournament's player count when known: the standings also list players who dropped after a
 * round or two.
 * @returns {{ size: number, assumed: boolean, ids: Set<number> }} ids: tournamentPlayerId
 */
export function topCut(standings, players = standings.length) {
  const flagged = standings.filter((s) => s.isTopCut);
  if (flagged.length && flagged.length < standings.length) {
    return {
      size: flagged.length,
      assumed: false,
      ids: new Set(flagged.map((s) => s.tournamentPlayerId)),
    };
  }
  const size = assumedCutSize(players);
  return {
    size,
    assumed: true,
    ids: new Set(
      standings
        .filter((s) => s.standing != null && s.standing <= size)
        .map((s) => s.tournamentPlayerId),
    ),
  };
}

/** Lorcanahunter's ink ("Amber", or its code) → the site's ink key ("amber"), sorted. */
export function toInks(colors) {
  return (colors ?? [])
    .map((c) => (c.name ?? c.code ?? '').toLowerCase())
    .filter(Boolean)
    .sort();
}

/** A stored deck: its inks and archetype, or null when unknown (private decklists). */
export function toDeck(deck) {
  if (!deck) return null;
  const colors = toInks(deck.colors);
  if (!colors.length) return null;
  return {
    colors,
    archetype: deck.archetype ? { id: deck.archetype.id, name: deck.archetype.name } : null,
  };
}

/**
 * Stores the players' lists compactly: every card once per tournament in `cards` (name, cost,
 * inkwell), and each list as [card index, copies] pairs in `player.list`. Takes players with a
 * `cards` array (or none) and returns the event's card table; the players get `list` instead.
 */
export function packLists(players) {
  const table = [];
  const index = new Map();
  for (const p of players) {
    if (!p.cards) continue;
    p.list = p.cards.map(({ name, quantity, cost, inkwell }) => {
      if (!index.has(name)) {
        index.set(name, table.length);
        table.push({ name, cost, inkwell });
      }
      return [index.get(name), quantity];
    });
    delete p.cards;
  }
  return table;
}

const unpacked = new WeakMap();

/**
 * Every public list of a tournament, unpacked: { standing, topCut, wins, losses, deck, cards,
 * event }, cards as { name, quantity, cost, inkwell }. The deck is the player's own object, so an
 * archetype set on it shows in every report.
 */
export function eventLists(event) {
  if (!unpacked.has(event)) {
    unpacked.set(
      event,
      event.players
        .filter((p) => p.list && p.deck)
        .map((p) => ({
          standing: p.standing,
          topCut: p.topCut,
          wins: p.wins ?? 0,
          losses: p.losses ?? 0,
          deck: p.deck,
          cards: p.list.map(([i, quantity]) => ({ ...event.cards[i], quantity })),
          event,
        })),
    );
  }
  return unpacked.get(event);
}

/** Events dated from `from` (YYYY-MM-DD) on. */
export const eventsSince = (events, from) => events.filter((e) => e.date && e.date >= from);

/**
 * Grouping key of a deck in a view; null when it has none (by archetype, no
 * public list to tell its archetype).
 */
function groupOf(deck, view) {
  if (!deck) return null;
  if (view === VIEWS.colors) return { key: deckKey(deck.colors), colors: deck.colors };
  return deck.sub ? { key: deck.sub.key, colors: deck.colors, label: deck.sub.label } : null;
}

/** The inks seen most often among an archetype's decks (a few are entered with other inks). */
function mostFrequent(counts) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split('/');
}

/**
 * The starting field and the top cut, per deck: share of the players, of the top cut, and the
 * conversion rate (share of the deck's players who made the cut) with its 95% interval. The
 * players whose deck is unknown (by archetype, without a public list to tell it; by inks, private
 * list) are left out of every share, and `coverage` says how many are kept.
 */
export function fieldReport(events, view = VIEWS.colors) {
  const groups = new Map();
  let players = 0;
  let cutPlayers = 0;
  let known = 0;
  let knownCut = 0;
  for (const event of events) {
    for (const p of event.players) {
      players++;
      if (p.topCut) cutPlayers++;
      const group = groupOf(p.deck, view);
      if (!group) continue;
      known++;
      if (p.topCut) knownCut++;
      const g = groups.get(group.key) ?? {
        key: group.key,
        label: group.label ?? null,
        inkCounts: new Map(),
        players: 0,
        topCut: 0,
        events: new Set(),
      };
      const inks = deckKey(group.colors);
      g.inkCounts.set(inks, (g.inkCounts.get(inks) ?? 0) + 1);
      g.players++;
      if (p.topCut) g.topCut++;
      g.events.add(event.id);
      groups.set(group.key, g);
    }
  }

  const baseline = known ? (100 * knownCut) / known : null;
  const decks = [...groups.values()]
    .map(({ inkCounts, events: seen, ...g }) => {
      const colors = mostFrequent(inkCounts);
      // Only an archetype has a name: by inks, decks are shown by their chips alone
      const name = g.label ? `${g.label} (${deckName(colors)})` : undefined;
      return {
        ...g,
        colors,
        name,
        events: seen.size,
        share: (100 * g.players) / known,
        cutShare: knownCut ? (100 * g.topCut) / knownCut : 0,
        conversion: (100 * g.topCut) / g.players,
        ci: wilson(g.topCut, g.players),
      };
    })
    .sort((a, b) => b.players - a.players || b.topCut - a.topCut);
  for (const d of decks) {
    // Over the field's conversion: 1.5 = 50% more likely than an average player to make the cut
    d.index = baseline ? d.conversion / baseline : null;
  }

  return {
    view,
    events: events.length,
    players,
    cutPlayers,
    known,
    knownCut,
    coverage: players ? known / players : 0,
    baseline,
    decks,
  };
}

/**
 * The first `max` decks, then the others summed as one "Autres" slice (null when there are
 * none), for the charts. Every chart folds the same decks: the most played at the start.
 */
export function foldDecks(decks, max = config.tournaments.maxSlices) {
  if (decks.length <= max + 1) return { shown: decks, other: null };
  const rest = decks.slice(max);
  const sum = (field) => rest.reduce((total, d) => total + d[field], 0);
  return {
    shown: decks.slice(0, max),
    other: {
      key: 'other',
      count: rest.length,
      players: sum('players'),
      topCut: sum('topCut'),
      share: sum('share'),
      cutShare: sum('cutShare'),
    },
  };
}

/** The bracket's rounds below a top cut, by the players left: 64, 32, … 2 for a top 128. */
export function bracketStages(size) {
  const stages = [];
  let n = 2 ** Math.floor(Math.log2(size));
  if (n === size) n /= 2;
  for (; n >= 2; n /= 2) stages.push(n);
  return stages;
}

/**
 * Conversion through the top cut, round by round down to the final: for each "Top N", the share
 * of the players still in at the round before who reach it. Once the top cut is played, the
 * standings follow the bracket (winner, finalist, then semi-finalists…), so reaching the top N is
 * finishing N-th or better. A round only counts the tournaments whose bracket went through it;
 * an assumed top cut was never played, so its tournament only counts for the top cut itself.
 *
 * @param {object} field fieldReport() of the same events and view: its decks give the rows
 */
export function bracketReport(events, view, field, max = config.maxDecks) {
  const bracketed = events.filter((e) => !e.cut.assumed);
  const columns = new Map();
  const steps = new Map();
  for (const event of bracketed) {
    const levels = [event.cut.size, ...bracketStages(event.cut.size)];
    for (let k = 1; k < levels.length; k++) {
      const [before, n] = [levels[k - 1], levels[k]];
      const column = columns.get(n) ?? { n, events: 0, from: 0, to: 0 };
      column.events++;
      columns.set(n, column);
      for (const p of event.players) {
        if (!p.topCut || p.standing == null || p.standing > before) continue;
        const group = groupOf(p.deck, view);
        if (!group) continue;
        const reached = p.standing <= n;
        column.from++;
        if (reached) column.to++;
        const id = `${group.key}|${n}`;
        const step = steps.get(id) ?? { from: 0, to: 0 };
        step.from++;
        if (reached) step.to++;
        steps.set(id, step);
      }
    }
  }

  const cols = [...columns.values()]
    .sort((a, b) => b.n - a.n)
    .map((c) => ({ ...c, rate: c.from ? (100 * c.to) / c.from : null }));
  const decks = field.decks
    .filter((d) => d.topCut > 0)
    .sort((a, b) => b.topCut - a.topCut || b.players - a.players)
    .slice(0, max)
    .map((d) => {
      const byRound = {};
      for (const c of cols) {
        const step = steps.get(`${d.key}|${c.n}`) ?? { from: 0, to: 0 };
        const rate = step.from ? (100 * step.to) / step.from : null;
        byRound[c.n] = { ...step, rate, index: rate != null && c.rate ? rate / c.rate : null };
      }
      return { ...d, rounds: byRound };
    });

  return {
    columns: cols,
    decks,
    // Tournaments left out of the rounds: their top cut is assumed
    excluded: events.filter((e) => e.cut.assumed),
  };
}

/**
 * The matchups each deck met, by ink pair, from the tournaments whose results say who played
 * whom (`event.matchups`: one row per deck and opponent, seen from the deck's side, a mirror
 * counting both players). Per deck: its matches, then per opponent the share of its matches,
 * how often one of its players met it, and its win rate with the 95% interval.
 */
export function matchupReport(events) {
  const withPairings = events.filter((e) => e.matchups?.length);
  const players = new Map();
  for (const event of withPairings) {
    for (const p of event.players) {
      if (!p.deck) continue;
      const key = deckKey(p.deck.colors);
      players.set(key, (players.get(key) ?? 0) + 1);
    }
  }

  const decks = new Map();
  let total = 0;
  const met = new Map();
  for (const event of withPairings) {
    for (const { colors, opponent, matches, wins } of event.matchups) {
      const key = deckKey(colors);
      const against = deckKey(opponent);
      const d = decks.get(key) ?? { key, colors, matches: 0, wins: 0, opponents: new Map() };
      d.matches += matches;
      d.wins += wins;
      const o = d.opponents.get(against) ?? { key: against, colors: opponent, matches: 0, wins: 0 };
      o.matches += matches;
      o.wins += wins;
      d.opponents.set(against, o);
      decks.set(key, d);
      total += matches;
      met.set(against, (met.get(against) ?? 0) + matches);
    }
  }

  return {
    events: withPairings.length,
    // Share of every match played against each deck: the field a player met on average
    field: new Map([...met].map(([key, n]) => [key, (100 * n) / total])),
    decks: [...decks.values()]
      .map(({ opponents, ...d }) => ({
        ...d,
        players: players.get(d.key) ?? 0,
        winRate: (100 * d.wins) / d.matches,
        ci: wilson(d.wins, d.matches),
        opponents: [...opponents.values()]
          .map((o) => ({
            ...o,
            mirror: o.key === d.key,
            share: (100 * o.matches) / d.matches,
            perPlayer: players.get(d.key) ? o.matches / players.get(d.key) : null,
            winRate: (100 * o.wins) / o.matches,
            ci: wilson(o.wins, o.matches),
          }))
          .sort((a, b) => b.matches - a.matches),
      }))
      .sort((a, b) => b.matches - a.matches),
  };
}

/** Top-cut lists of the period, best placed first within each tournament. */
export const cutLists = (events) =>
  events.flatMap((e) =>
    eventLists(e)
      .filter((l) => l.topCut)
      .sort((a, b) => (a.standing ?? 999) - (b.standing ?? 999)),
  );

/** Top-cut lists of a group (a deck key from fieldReport), with the event each comes from. */
export const topCutLists = (events, view, key) =>
  cutLists(events).filter((l) => groupOf(l.deck, view)?.key === key);

/** Decks with at least one top-cut list, most lists first: the card analysis' picker. */
export function listGroups(events, view) {
  const groups = new Map();
  for (const list of cutLists(events)) {
    const group = groupOf(list.deck, view);
    if (!group) continue;
    const g = groups.get(group.key) ?? { ...group, lists: 0 };
    g.lists++;
    groups.set(group.key, g);
  }
  return [...groups.values()].sort((a, b) => b.lists - a.lists);
}

/** Cards two lists have in common, copies counted: 60 for the same list. */
function sharedCards(a, b) {
  let n = 0;
  for (const [name, copies] of a) n += Math.min(copies, b.get(name) ?? 0);
  return n;
}

/** "Max Goof" for "Max Goof - Rebellious Teen": how players name a deck by its cards. */
const shortName = (card) => card.split(' - ')[0];

/**
 * Gives every public list of the period its ladder archetype, the one whose average list it is
 * closest to (see listArchetype), and sets it on the list's deck (`deck.sub`: key, label,
 * signature): the same archetypes as the ladder's pages, by the same rule as the preparation
 * page. A list close to none goes to its ink pair's "Autres listes". Every report by archetype
 * then reads it. Run once, on the events shown.
 *
 * @param {object[]} profiles keyedProfiles() of the ladder's BO1 queue
 */
export function assignArchetypes(events, profiles) {
  const decks = archetypeDecks(profiles);
  for (const list of events.flatMap(eventLists)) {
    const key = listArchetype(list, profiles);
    const deck = key ? decks.get(key) : null;
    list.deck.sub = deck
      ? { key, label: deck.label, signature: deck.signature.slice(0, 2).map(shortName) }
      : { key: restKey([...list.deck.colors].sort()), label: 'Autres listes', signature: [] };
  }
}

/** Cards in a Lorcana deck, at least: a few top-cut lists play 61 or 62. */
export const DECK_SIZE = 60;

const listSize = (list) => list.cards.reduce((n, c) => n + c.quantity, 0);

/**
 * A list to play from a deck's top-cut lists: each card at its median copies over the lists (a
 * missing card counting 0), then copies added or removed one at a time, where the mean is the
 * farthest, until the deck has the lists' median size (60 at least); never more copies than a
 * list played. Also the real list closest to it, since a median list was never played as such.
 *
 * @returns {{ cards: object[], size: number, closest: { list: object, shared: number } | null }}
 */
export function medianList(lists) {
  if (!lists.length) return { cards: [], size: 0, closest: null };
  const sizes = lists.map(listSize).sort((a, b) => a - b);
  const size = Math.max(DECK_SIZE, sizes[Math.floor((sizes.length - 1) / 2)]);
  const cards = new Map();
  for (const list of lists) {
    for (const c of list.cards) {
      const card = cards.get(c.name) ?? {
        name: c.name,
        cost: c.cost,
        inkwell: c.inkwell,
        played: [],
      };
      card.played.push(c.quantity);
      cards.set(c.name, card);
    }
  }

  const rows = [...cards.values()].map(({ played, ...card }) => {
    const copies = [...played, ...Array(lists.length - played.length).fill(0)].sort(
      (a, b) => a - b,
    );
    const mid = copies.length / 2;
    const mean = copies.reduce((a, b) => a + b, 0) / copies.length;
    let median = copies.length % 2 ? copies[Math.floor(mid)] : (copies[mid - 1] + copies[mid]) / 2;
    // Between two counts, the one on the mean's side
    if (!Number.isInteger(median)) median = mean > median ? Math.ceil(median) : Math.floor(median);
    return { ...card, copies: median, mean, max: copies.at(-1), lists: played.length };
  });

  // To 60 cards: the copy the mean wants most, or misses least
  let total = rows.reduce((n, r) => n + r.copies, 0);
  const gap = (r) => r.mean - r.copies;
  while (total !== size) {
    const adding = total < size;
    const candidates = rows.filter((r) => (adding ? r.copies < r.max : r.copies > 0));
    if (!candidates.length) break;
    const pick = candidates.reduce((best, r) => {
      const d = adding ? gap(r) - gap(best) : gap(best) - gap(r);
      return d > 0 || (d === 0 && (adding ? r.lists > best.lists : r.lists < best.lists))
        ? r
        : best;
    });
    pick.copies += adding ? 1 : -1;
    total += adding ? 1 : -1;
  }

  const kept = rows
    .filter((r) => r.copies > 0)
    .sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99) || a.name.localeCompare(b.name));
  const median = new Map(kept.map((r) => [r.name, r.copies]));
  const closest = lists
    .map((list) => ({
      list,
      shared: sharedCards(median, new Map(list.cards.map((c) => [c.name, c.quantity]))),
    }))
    .sort((a, b) => b.shared - a.shared || (a.list.standing ?? 999) - (b.list.standing ?? 999))[0];
  return { cards: kept, size: total, closest };
}

export const CARD_TIERS = {
  core: 'Communes à toutes les listes',
  near: 'Proches',
  tech: 'Tech cards possibles',
};

/**
 * The cards of a group's top-cut lists, by name (reprints share a name, and the four-copy limit
 * is by name). Per card: the lists playing it, their share, the copies when played (mean and
 * distribution), and its tier: in every list (core), in at least `nearShare` of them (near), or
 * fewer (a possible tech card).
 */
export function cardReport(lists, nearShare = config.tournaments.nearShare) {
  const cards = new Map();
  for (const list of lists) {
    for (const entry of list.cards) {
      const c = cards.get(entry.name) ?? {
        name: entry.name,
        cost: entry.cost,
        inkwell: entry.inkwell,
        lists: 0,
        copies: [],
      };
      c.copies.push(entry.quantity);
      c.lists++;
      cards.set(entry.name, c);
    }
  }

  const tierOf = (share) => (share >= 1 ? 'core' : share >= nearShare ? 'near' : 'tech');
  const rows = [...cards.values()].map((c) => {
    const share = c.lists / lists.length;
    const distribution = new Map();
    for (const n of c.copies) distribution.set(n, (distribution.get(n) ?? 0) + 1);
    return {
      name: c.name,
      cost: c.cost,
      inkwell: c.inkwell,
      lists: c.lists,
      share: 100 * share,
      meanCopies: c.copies.reduce((a, b) => a + b, 0) / c.copies.length,
      // Most copies first: "4 × 6, 3 × 1"
      distribution: [...distribution.entries()].sort((a, b) => b[0] - a[0]),
      // Copies per list over every list, a missing card counting 0: its weight in the archetype
      weight: c.copies.reduce((a, b) => a + b, 0) / lists.length,
      tier: tierOf(share),
    };
  });
  rows.sort(
    (a, b) =>
      b.share - a.share ||
      b.meanCopies - a.meanCopies ||
      (a.cost ?? 99) - (b.cost ?? 99) ||
      a.name.localeCompare(b.name),
  );

  return {
    lists: lists.length,
    cards: rows,
    tiers: Object.keys(CARD_TIERS).map((tier) => ({
      tier,
      label: CARD_TIERS[tier],
      cards: rows.filter((r) => r.tier === tier),
    })),
  };
}
