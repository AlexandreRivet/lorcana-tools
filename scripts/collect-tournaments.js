// Stores the Lorcanahunter core tournaments of the last few days with enough players, in
// data/lorcanahunter/: standings with each player's deck and, when public, their list.
// A tournament is fetched again until its results have had time to settle; older ones are kept.
// No player names are stored: the page only shows decks.
// Usage: npm run collect:tournaments   (LORCANAHUNTER_CLIENT_ID / _SECRET in .env or the env)
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from '../src/config.js';
import { lorcanahunterClient } from '../src/lib/lorcanahunter-api.js';
import {
  readAllTournaments,
  readTournament,
  writeTournament,
  writeTournamentIndex,
} from '../src/lib/store.js';
import { packLists, toDeck, topCut } from '../src/lib/tournaments.js';

// 60 requests / minute per application: stay below it.
const REQUEST_INTERVAL_MS = 1100;
// Results and decklists keep coming in for a few days after a tournament.
const SETTLE_DAYS = 3;
const PAGE_LIMIT = 100;
const DAY_MS = 86_400_000;

const { windowDays, minPlayers } = config.tournaments;

const clientId = process.env.LORCANAHUNTER_CLIENT_ID;
const clientSecret = process.env.LORCANAHUNTER_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.log('::error title=Collect tournaments::LORCANAHUNTER_CLIENT_ID / _SECRET missing');
  process.exit(1);
}
const api = lorcanahunterClient({ clientId, clientSecret });

/** Fetches, retrying rate limits, server errors and network failures with a growing delay. */
async function get(path, params, attempts = 4) {
  await sleep(REQUEST_INTERVAL_MS);
  for (let attempt = 1; ; attempt++) {
    try {
      return await api.get(path, params);
    } catch (error) {
      if (!error.retryable || attempt >= attempts) throw error;
      // A rate limit says how long to wait; otherwise 5 s, 10 s, 20 s
      const wait = error.retryAfter ?? 5 * 2 ** (attempt - 1);
      console.warn(`  ${error.message} (attempt ${attempt}/${attempts}, retrying in ${wait} s)`);
      await sleep(wait * 1000);
    }
  }
}

/** Every page of a paginated list. */
async function getAll(path, params) {
  const items = [];
  for (let page = 1; ; page++) {
    const res = await get(path, { ...params, page, limit: PAGE_LIMIT });
    items.push(...res.data);
    if (!res.hasMore) return items;
  }
}

const isoDay = (time) => new Date(time).toISOString().slice(0, 10);

/** Main-deck cards of a decklist (a sideboard, if any, isn't part of the deck). */
function toCards(cards) {
  return (cards ?? [])
    .filter((entry) => entry.card && !/side/i.test(entry.section ?? ''))
    .map(({ quantity, card }) => ({
      name: card.name,
      quantity,
      cost: card.cost ?? null,
      inkwell: card.inkwell ?? null,
    }));
}

/**
 * Every public list of a tournament, by tournamentPlayerId: the whole field's, since a list tells
 * its player's sub-archetype (about 8 requests for 700 players). A tournament keeping its
 * decklists private answers 403 decklists_private.
 */
async function decklists(id) {
  const lists = new Map();
  for (let page = 1; ; page++) {
    let res;
    try {
      res = await get(`/api/v1/tournaments/${id}/decklists`, { page, limit: PAGE_LIMIT });
    } catch (error) {
      if (error.code === 'decklists_private') return lists;
      throw error;
    }
    for (const entry of res.data) {
      const cards = toCards(entry.deck?.cards);
      if (cards.length) lists.set(entry.tournamentPlayerId, cards);
    }
    if (!res.hasMore) return lists;
  }
}

async function collectTournament(summary) {
  const { data } = await get(`/api/v1/tournaments/${summary.id}`);
  const standings = data.standings ?? [];
  const cut = topCut(standings, data.playerCount ?? standings.length);
  const lists = data.decklistsAvailable ? await decklists(data.id) : new Map();
  const players = standings
    .map((s) => {
      const deck = toDeck(s.deck);
      const cards = deck ? lists.get(s.tournamentPlayerId) : null;
      return {
        standing: s.standing,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        topCut: cut.ids.has(s.tournamentPlayerId),
        deck,
        ...(cards ? { cards } : {}),
      };
    })
    .sort((a, b) => (a.standing ?? 9999) - (b.standing ?? 9999));
  // Every card once, each list as [card, copies] pairs: a 700-player tournament stays small
  const cards = packLists(players);

  const event = {
    id: data.id,
    name: data.name,
    slug: data.slug ?? null,
    date: data.date,
    eventType: data.eventType ?? null,
    city: data.city ?? null,
    country: data.country ?? null,
    store: data.store ?? null,
    playerCount: data.playerCount ?? standings.length,
    decklistsAvailable: Boolean(data.decklistsAvailable),
    fetchedAt: new Date().toISOString(),
    // size: players in the top cut; assumed: no top cut in the results, the rule's one instead
    cut: { size: cut.size, assumed: cut.assumed },
    cards,
    players,
  };
  await writeTournament(event);
  const known = players.filter((p) => p.deck).length;
  const listed = players.filter((p) => p.list).length;
  console.log(
    `  ${event.date}  ${event.name} · ${players.length} players, ${known} decks, top ${cut.size}` +
      `${cut.assumed ? ' (assumed)' : ''}, ${listed} lists`,
  );
}

const now = Date.now();
const period = { from: isoDay(now - windowDays * DAY_MS), to: isoDay(now) };
console.log(`▸ Core tournaments over ${minPlayers} players, ${period.from} → ${period.to}`);

const listed = await getAll('/api/v1/tournaments', {
  format: 'core',
  dateFrom: period.from,
  dateTo: period.to,
});
const candidates = listed.filter((t) => t.isPast && (t.playerCount ?? 0) > minPlayers);
console.log(
  `  ${listed.length} tournaments listed, ${candidates.length} over ${minPlayers} players`,
);

let written = 0;
let failed = 0;
for (const summary of candidates) {
  const stored = await readTournament(summary.id);
  const settled =
    stored && Date.parse(stored.fetchedAt) >= Date.parse(stored.date) + SETTLE_DAYS * DAY_MS;
  if (settled) continue;
  try {
    await collectTournament(summary);
    written++;
  } catch (error) {
    failed++;
    // GitHub annotation: shows in the run summary without stopping the other tournaments
    console.log(`::error title=Tournament ${summary.id}::${error.message}`);
  }
}

const events = (await readAllTournaments()).sort(
  (a, b) => b.date.localeCompare(a.date) || b.playerCount - a.playerCount,
);
await writeTournamentIndex({
  collectedAt: new Date(now).toISOString(),
  window: period,
  minPlayers,
  tournaments: events.map((e) => ({
    id: e.id,
    name: e.name,
    slug: e.slug,
    date: e.date,
    eventType: e.eventType,
    city: e.city,
    country: e.country,
    players: e.players.length,
    knownDecks: e.players.filter((p) => p.deck).length,
    cut: e.cut,
    lists: e.players.filter((p) => p.list).length,
    cutLists: e.players.filter((p) => p.list && p.topCut).length,
  })),
});
console.log(`  ${written} tournament(s) written, ${events.length} stored`);
// Fail only when nothing could be fetched; otherwise the tournaments that worked get committed
if (failed && !written) process.exitCode = 1;
