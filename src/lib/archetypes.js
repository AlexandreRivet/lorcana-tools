/**
 * The ladder's archetypes, told apart by what they play, the same way on every page: the weeks
 * collected on different days matched to today's archetypes by their average lists
 * (reconcileArchetypes), and a tournament decklist given the archetype whose average list it is
 * closest to (listArchetype). Today's archetypes are data/<queue>/profiles.json's, keyed by their
 * slug. Pure functions, shared by the pages, the digest and the podcast.
 */
import { config } from '../config.js';
import { deckKey, nameArchetypes, slugCards } from './inks.js';

/** An ink pair's decks no archetype recognises: `rest:amber/emerald`. */
const REST = 'rest:';
export const restKey = (colors) => `${REST}${deckKey(colors)}`;
export const isRest = (key) => key.startsWith(REST);
/** A rest deck's inks, as deckKey gives them. */
export const restInks = (key) => key.slice(REST.length);

/** Cards two average lists share, copies counted (out of 60). */
function sharedCopies(a, b) {
  let shared = 0;
  for (const [name, copies] of a) shared += Math.min(copies, b.get(name) ?? 0);
  return shared;
}

/**
 * The archetype duels.ink gives a profile, by its slug (which a link can carry from one day to the
 * next): a variant, until merged with its near twins (see mergedKeys).
 */
const variantKey = (p) => p.variant ?? p.slug ?? p.archetypeId;

/** Each variant's average list over its profiles (weighted by games): { key, inks, games, cards }. */
function variantLists(profiles) {
  const lists = new Map();
  for (const p of profiles) {
    const key = variantKey(p);
    const v = lists.get(key) ?? { key, inks: deckKey(p.colors), games: 0, copies: new Map() };
    v.games += p.games;
    for (const [name, n] of p.cards) v.copies.set(name, (v.copies.get(name) ?? 0) + n * p.games);
    lists.set(key, v);
  }
  for (const v of lists.values()) {
    v.cards = new Map([...v.copies].map(([name, n]) => [name, n / (v.games || 1)]));
  }
  return lists;
}

/**
 * Today's archetypes once near twins are merged: two archetypes of one inks whose average lists
 * share at least `minShared` cards are variants of one deck (He Hurled and Woolter, 48: duels.ink
 * calls both "Midrange"). Each variant's key → its deck's, the most played variant's.
 */
function mergedKeys(profiles, minShared = config.archetypes.mergeShared) {
  const variants = [...variantLists(profiles).values()];
  const root = new Map(variants.map((v) => [v.key, v.key]));
  const find = (key) => (root.get(key) === key ? key : find(root.get(key)));
  const games = new Map(variants.map((v) => [v.key, v.games]));
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      const [a, b] = [variants[i], variants[j]];
      if (a.inks !== b.inks || sharedCopies(a.cards, b.cards) < minShared) continue;
      const [x, y] = [find(a.key), find(b.key)];
      // The most played variant keys the deck
      if (x !== y) games.get(x) >= games.get(y) ? root.set(y, x) : root.set(x, y);
    }
  }
  return new Map(variants.map((v) => [v.key, find(v.key)]));
}

/**
 * The profiles with their archetype under its key (`archetypeId`: its deck's key once variants are
 * merged) and their own one (`variant`).
 */
export function keyedProfiles(profiles = []) {
  const merged = mergedKeys(profiles);
  return profiles.map((p) => ({
    ...p,
    variant: variantKey(p),
    archetypeId: merged.get(variantKey(p)),
  }));
}

/**
 * Today's name of each archetype, by key (variants merged): { name, slug }. duels.ink names each
 * profile, and the profiles of one archetype don't always agree (He Hurled's are "Midrange" and
 * "Touch Paradise"): the name of the most games wins, a name over none.
 */
export function archetypeNames(profiles = []) {
  const merged = mergedKeys(profiles);
  const games = new Map();
  for (const p of profiles) {
    const key = merged.get(variantKey(p));
    if (!games.has(key)) games.set(key, { slug: key, byName: new Map() });
    const { byName } = games.get(key);
    byName.set(p.name ?? null, (byName.get(p.name ?? null) ?? 0) + p.games);
  }
  return new Map(
    [...games].map(([key, { slug, byName }]) => {
      const [name] = [...byName].sort(([a, x], [b, y]) => (a === null) - (b === null) || y - x)[0];
      return [key, { name, slug }];
    }),
  );
}

/**
 * A week with its archetypes renamed by `keyOf` (id → key), named as `names` has them (today's
 * name and slug for today's archetypes), and its matchup rows renamed too, each turned so that its
 * first archetype's key sorts first, as aggregate() expects one row per pair. Two variants of one
 * deck share its key: their games add up, and the games between them, now a mirror, are left out
 * (a mirror is even; theirs aren't).
 */
function rekey(snapshot, keyOf, names) {
  const key = (id) => keyOf.get(id) ?? id;
  return {
    ...snapshot,
    archetypes: snapshot.archetypes.map((a) => ({ ...a, id: key(a.id), ...names.get(key(a.id)) })),
    archetypeMatchups: (snapshot.archetypeMatchups ?? []).flatMap((m) => {
      const [a, b] = [key(m.archetypeA), key(m.archetypeB)];
      if (a === b && m.archetypeA !== m.archetypeB) return [];
      if (a <= b) return { ...m, archetypeA: a, archetypeB: b };
      // Seen from B: B went first in the games A went second
      const firstWins = ((m.firstPlayerWinRate ?? 0) * m.firstPlayerGames) / 100;
      const drawGames = m.games - m.firstPlayerGames;
      const winsB = m.games - m.winsA;
      return {
        archetypeA: b,
        archetypeB: a,
        games: m.games,
        winsA: winsB,
        winRate: m.games ? (100 * winsB) / m.games : null,
        firstPlayerGames: drawGames,
        firstPlayerWinRate: drawGames
          ? (100 * (drawGames - (m.winsA - firstWins))) / drawGames
          : null,
      };
    }),
  };
}

/**
 * The ladder's archetypes, told apart by what they play rather than by their ids or names:
 * duels.ink gives an archetype a new id whenever it clusters the lists again, and a new slug and
 * name when it picks other key cards, so weeks collected on different days know one archetype
 * under several. Today's archetypes (the profiles, keyed by their slug) are the reference; each
 * week's archetypes go to them one to one, the pairs sharing the most cards first (average lists,
 * copies counted, same inks), if at least `minShared`: two near builds of one week (He Hurled and
 * Woolter, 48 cards in common) can't both go to the closest one. A week's archetype without an
 * average list (collected before they were kept) goes by its slug; one matching nothing makes an
 * archetype of its own, which older weeks can match in turn (newest weeks first). Each variant then
 * goes to its deck (see mergedKeys), and every week names an archetype of today by today's name.
 *
 * @returns {{ weeks: object[], profiles: object[], matched: { content, slug, own } }} the weeks
 *   and profiles with every archetype under its key; how the weeks' archetypes were matched
 */
export function reconcileArchetypes(
  snapshots,
  profiles = [],
  minShared = config.archetypes.weekShared,
) {
  // Matched variant by variant (one to one keeps near twins apart), then each to its deck
  const groups = variantLists(profiles);
  const merged = mergedKeys(profiles);
  const names = archetypeNames(profiles);

  const matched = { content: 0, slug: 0, own: 0 };
  const keys = new Map();
  const newestFirst = [...snapshots].sort((a, b) =>
    b.week.startDate.localeCompare(a.week.startDate),
  );
  for (const s of newestFirst) {
    const keyOf = new Map();
    keys.set(s, keyOf);
    if (!s.archetypes?.length) continue;
    const taken = new Set();
    const pairs = [];
    for (const a of s.archetypes) {
      if (!a.cards?.length) continue;
      const cards = new Map(a.cards);
      for (const g of groups.values()) {
        if (g.inks !== deckKey(a.colors)) continue;
        const shared = sharedCopies(cards, g.cards);
        if (shared >= minShared) pairs.push({ id: a.id, key: g.key, shared });
      }
    }
    for (const p of pairs.sort((x, y) => y.shared - x.shared)) {
      if (keyOf.has(p.id) || taken.has(p.key)) continue;
      keyOf.set(p.id, p.key);
      taken.add(p.key);
      matched.content++;
    }
    for (const a of s.archetypes) {
      if (keyOf.has(a.id)) continue;
      const slug = a.slug ?? a.id;
      if (!a.cards?.length && groups.has(slug) && !taken.has(slug)) {
        keyOf.set(a.id, slug);
        taken.add(slug);
        matched.slug++;
        continue;
      }
      // An archetype of its own, for the older weeks to match
      const key = groups.has(slug) ? `${slug}@${s.week.startDate}` : slug;
      keyOf.set(a.id, key);
      taken.add(key);
      matched.own++;
      if (a.cards?.length) {
        groups.set(key, { key, inks: deckKey(a.colors), cards: new Map(a.cards) });
      }
    }
  }

  for (const keyOf of keys.values()) {
    for (const [id, key] of keyOf) keyOf.set(id, merged.get(key) ?? key);
  }
  return {
    weeks: snapshots.map((s) => (s.archetypes?.length ? rekey(s, keys.get(s), names) : s)),
    profiles: keyedProfiles(profiles),
    matched,
  };
}

/**
 * A card name as both sources can agree on it: Lorcanahunter and Lorcast don't always write a
 * name alike ("Mamá Imelda" and "Mama Imelda", "Like a Bird in the Sky" and "Like A Bird In the
 * Sky"), so accents, case and curly apostrophes are left out.
 */
const cardKey = (name) =>
  name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[‘’ʼ]/g, "'")
    .toLowerCase();

/** A profile's average list by cardKey, computed once per profile. */
const profileCopies = new WeakMap();
function copiesOf(profile) {
  if (!profileCopies.has(profile)) {
    const copies = new Map();
    for (const [name, n] of profile.cards) {
      copies.set(cardKey(name), (copies.get(cardKey(name)) ?? 0) + n);
    }
    profileCopies.set(profile, copies);
  }
  return profileCopies.get(profile);
}

/**
 * The ladder archetype of a tournament decklist: the key of the one whose average list (of one of
 * its profiles, same inks) shares the most cards with it, copies counted, if at least
 * `minShared`. Null otherwise. Cached on the list.
 *
 * @param {object[]} profiles keyedProfiles()
 */
const archetypeCache = new WeakMap();
export function listArchetype(list, profiles, minShared = config.archetypes.listShared) {
  if (archetypeCache.has(list)) return archetypeCache.get(list).id;
  const copies = new Map();
  for (const c of list.cards) {
    copies.set(cardKey(c.name), (copies.get(cardKey(c.name)) ?? 0) + c.quantity);
  }
  const inks = deckKey([...list.deck.colors].sort());
  let best = null;
  for (const p of profiles) {
    if (deckKey(p.colors) !== inks) continue;
    let shared = 0;
    for (const [name, n] of copiesOf(p)) shared += Math.min(n, copies.get(name) ?? 0);
    if (!best || shared > best.shared) best = { shared, id: p.archetypeId, variant: p.variant };
  }
  const found = best && best.shared >= minShared ? best : { id: null, variant: null };
  archetypeCache.set(list, found);
  return found.id;
}

/**
 * The variant of a tournament decklist's archetype (the archetype duels.ink gave its closest
 * profile, before merging near twins), once listArchetype has placed it; null otherwise.
 */
export const listVariant = (list) => archetypeCache.get(list)?.variant ?? null;

/** A variant as players name it, by its key cards ("He Hurled", "Woolter Huntsman Toulouse"). */
export const variantLabel = (variant, colors) => slugCards({ slug: variant, colors }) ?? variant;

/**
 * How lists of one deck split between its variants, most lists first: "He Hurled (35), Woolter
 * Huntsman Toulouse (1)", or null when they are all one variant.
 */
export function variantSummary(lists) {
  const counts = new Map();
  for (const list of lists) {
    const variant = listVariant(list);
    if (!variant) continue;
    const label = variantLabel(variant, [...list.deck.colors].sort());
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (counts.size < 2) return null;
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${label} (${n})`)
    .join(', ');
}

/**
 * Today's archetypes as decks to show, by key: { key, colors, label, name, signature (its most
 * played profile's), games }, named as the meta page names them (two of one inks and one name
 * told apart by their key cards).
 *
 * @param {object[]} profiles keyedProfiles()
 */
export function archetypeDecks(profiles) {
  const names = archetypeNames(profiles);
  const decks = new Map();
  for (const p of [...profiles].sort((a, b) => b.games - a.games)) {
    const d = decks.get(p.archetypeId) ?? {
      key: p.archetypeId,
      colors: p.colors,
      archetype: names.get(p.archetypeId)?.name ?? null,
      slug: names.get(p.archetypeId)?.slug ?? null,
      signature: p.signature ?? [],
      games: 0,
    };
    d.games += p.games;
    decks.set(p.archetypeId, d);
  }
  nameArchetypes([...decks.values()]);
  return decks;
}
