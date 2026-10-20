// Stores every duels.ink week in data/<queue>/weeks/, the one in progress included.
// On the first run, backfills every week the API still exposes. A queue that fails doesn't stop
// the others; the run only fails when no queue could be collected.
// Usage: npm run collect [-- queue …]   (a queue id, or <queue>@<era> for one set's games only)
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from '../src/config.js';
import { fetchMeta } from '../src/lib/duels-api.js';
import { readAllWeeks, readIndex, readWeek, writeIndex, writeWeek } from '../src/lib/store.js';

// 60 requests / 60 s per IP: stay below it.
const REQUEST_INTERVAL_MS = 1100;

const queues = process.argv.length > 2 ? process.argv.slice(2) : config.queues;

/** Fetches, retrying rate limits, server errors and network failures with a growing delay. */
async function fetchWithRetry(params, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchMeta(params);
    } catch (error) {
      if (!error.retryable || attempt >= attempts) throw error;
      // A rate limit says how long to wait; otherwise 5 s, 10 s, 20 s
      const wait = error.retryAfter ?? 5 * 2 ** (attempt - 1);
      console.warn(`  ${error.message} (attempt ${attempt}/${attempts}, retrying in ${wait} s)`);
      await sleep(wait * 1000);
    }
  }
}

/**
 * Archetypes, from the `profiles` and `archetypeMatchups` fields. They are outside the API's
 * stable contract, so null when missing: the page then only offers the ink view.
 * A profile is a deck list cluster, recomputed on every request (its id changes); several
 * profiles share an archetype, whose id is stable from one week to the next. Profiles are
 * summed per archetype, and their matchups stored once per pair (archetypeA < archetypeB),
 * flipped to that side when needed.
 */
function toArchetypes({ profiles, archetypeMatchups }) {
  if (!profiles?.length) return { archetypes: null, archetypeMatchups: null };

  const archetypeOf = new Map();
  const archetypes = new Map();
  for (const p of profiles) {
    if (!p.archetypeId) continue;
    archetypeOf.set(p.id, p.archetypeId);
    const a = archetypes.get(p.archetypeId) ?? {
      id: p.archetypeId,
      name: p.archetypeName ?? null,
      slug: p.archetypeSlug ?? null,
      colors: p.colors,
      games: 0,
      wins: 0,
    };
    a.games += p.gamesPlayed;
    a.wins += p.wins;
    archetypes.set(p.archetypeId, a);
  }

  const pairs = new Map();
  for (const m of archetypeMatchups ?? []) {
    let a = archetypeOf.get(m.archetypeIdA);
    let b = archetypeOf.get(m.archetypeIdB);
    if (!a || !b) continue;
    let { games, winsA, firstPlayerGames } = m;
    let firstPlayerWins =
      m.firstPlayerWins ?? ((m.firstPlayerWinRate ?? 0) * firstPlayerGames) / 100;
    if (a > b) {
      // Seen from B: B goes first in the games A went second
      [a, b] = [b, a];
      const drawGames = games - firstPlayerGames;
      firstPlayerWins = drawGames - (winsA - firstPlayerWins);
      firstPlayerGames = drawGames;
      winsA = games - winsA;
    }
    const row = pairs.get(`${a}|${b}`) ?? {
      archetypeA: a,
      archetypeB: b,
      games: 0,
      winsA: 0,
      firstPlayerGames: 0,
      firstPlayerWins: 0,
    };
    row.games += games;
    row.winsA += winsA;
    row.firstPlayerGames += firstPlayerGames;
    row.firstPlayerWins += firstPlayerWins;
    pairs.set(`${a}|${b}`, row);
  }

  return {
    archetypes: [...archetypes.values()].sort((x, y) => y.games - x.games),
    // Same shape as `matchups`, so both are summed the same way
    archetypeMatchups: [...pairs.values()].map(({ firstPlayerWins, ...row }) => ({
      ...row,
      winRate: row.games ? (100 * row.winsA) / row.games : null,
      firstPlayerWinRate: row.firstPlayerGames
        ? (100 * firstPlayerWins) / row.firstPlayerGames
        : null,
    })),
  };
}

/** Keeps only the fields listed as stable in the API docs, plus the archetypes when present. */
function toSnapshot(queue, week, { data, etag }) {
  return {
    queue,
    week: { startDate: week.startDate, endDate: week.endDate, label: week.label },
    updatedAt: data.updatedAt,
    fetchedAt: new Date().toISOString(),
    etag,
    totalGames: data.activity.totalGames,
    colorPairs: data.colorPairs.map(({ colors, games, wins, winRate, firstPlayerWinRate }) => ({
      colors,
      games,
      wins,
      winRate,
      firstPlayerWinRate,
    })),
    matchups: data.matchups.map(
      ({ colorsA, colorsB, games, winsA, winRate, firstPlayerGames, firstPlayerWinRate }) => ({
        colorsA,
        colorsB,
        games,
        winsA,
        winRate,
        firstPlayerGames,
        firstPlayerWinRate,
      }),
    ),
    ...toArchetypes(data),
  };
}

async function collectQueue(id) {
  // <queue>@<era>: that set's games only, stored under the whole id
  const [queue, era] = id.split('@');
  console.log(`▸ ${id}`);
  const { data: overview } = await fetchWithRetry({ queue, era });
  const { meta } = overview;
  // An unknown era key silently falls back to the current one
  if (era && meta.selectedEraKey !== era) {
    throw new Error(`Unknown era ${era} (got ${meta.selectedEraKey})`);
  }

  // duels.ink recomputes the current week every night (~01:30 UTC) and freezes it after
  // Saturday's run. Every week is stored, the current one included, and fetched again whenever
  // its game count changes: daily for the week in progress, rarely afterwards.
  const weeks = (meta.availableWeeks ?? []).filter((w) => w.totalGames > 0);

  let written = 0;
  for (const week of weeks) {
    const stored = await readWeek(id, week.startDate);
    // Weeks stored before the archetypes were kept are fetched once more to add them
    const complete = stored && 'archetypes' in stored;
    if (complete && stored.totalGames === week.totalGames) continue;

    await sleep(REQUEST_INTERVAL_MS);
    const res = await fetchWithRetry({
      queue,
      era,
      period: `week:${week.startDate}`,
      etag: complete ? stored.etag : undefined,
    });
    if (res.status === 304) continue;
    // With an era, meta.period is an opaque id: selectedEraKey tells the scope instead
    const scope = era ? res.data.meta.selectedEraKey : res.data.meta.period;
    if (scope !== (era ?? `week:${week.startDate}`)) {
      throw new Error(`Unexpected response for ${week.startDate}: ${scope}`);
    }

    await writeWeek(id, toSnapshot(id, week, res));
    written++;
    console.log(`  ${week.startDate}  ${res.data.activity.totalGames} games`);
  }

  const snapshots = await readAllWeeks(id);
  const previous = await readIndex(id);
  // A closed beta queue moves from the active list to the archived one.
  const open = meta.queues?.active?.some((q) => q.id === queue) ?? true;
  const info = [...(meta.queues?.active ?? []), ...(meta.queues?.archived ?? [])].find(
    (q) => q.id === queue,
  );
  const eras = [meta.eras?.currentEra, ...(meta.eras?.pastEras ?? [])]
    .filter(Boolean)
    .map(({ key, name, startedAt, endedAt }) => ({
      key,
      name,
      startedAt,
      endedAt: endedAt ?? null,
    }))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  // duels.ink names a ranked queue after the current set ("Core Set 14 BO1"): a queue kept to an
  // earlier set keeps the name it had while that set was the current one.
  const named = !era || meta.eras?.currentEra?.key === era;
  const queueName = (named ? info?.name : previous?.queueName) ?? id;

  await writeIndex(id, {
    queue: id,
    queueName,
    // bo1 | bo3: in BO3 queues, decks and matchups are counted in matches.
    gameMode: info?.gameMode ?? null,
    // The set the queue is kept to (<queue>@<era>), or null for its whole lifetime
    era: eras.find((e) => e.key === era) ?? null,
    // Once closed, a queue keeps the eras it had while open: the API then answers with its
    // format's eras, set releases a beta never played through.
    eras: open || !previous ? eras : previous.eras,
    weeks: snapshots.map((s) => ({
      ...s.week,
      totalGames: s.totalGames,
      updatedAt: s.updatedAt,
    })),
  });

  console.log(`  ${written} week(s) written, ${snapshots.length} stored`);
}

const failed = [];
for (const queue of queues) {
  try {
    await collectQueue(queue);
  } catch (error) {
    failed.push(queue);
    // GitHub annotation: shows in the run summary without stopping the other queues
    console.log(`::error title=Collect ${queue}::${error.message}`);
  }
}
// Fail only when nothing could be collected; otherwise the queues that worked get committed
if (failed.length === queues.length) process.exitCode = 1;
