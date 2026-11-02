/**
 * Card names from the public Lorcast API (https://lorcast.com/docs/api), to read duels.ink's card
 * ids ("12-6": set 12, card 6) as the names tournament decklists use ("Agustin Madrigal -
 * Exceptionally Kind"). Node only: called by the collector, which stores the names.
 */
import { setTimeout as sleep } from 'node:timers/promises';

export const BASE_URL = 'https://api.lorcast.com/v0';

// Lorcast asks for 50 to 100 ms between requests
const REQUEST_INTERVAL_MS = 100;

/** "Name - Version", or the name alone for cards without a version (actions, items). */
const fullName = (card) => (card.version ? `${card.name} - ${card.version}` : card.name);

/**
 * Names of every card of the given sets, by duels.ink id ("<set>-<number>").
 * @param {string[]} sets set codes, as in the ids ("12", "P1")
 * @returns {Promise<Record<string, string>>}
 */
export async function fetchCardNames(sets) {
  const names = {};
  for (const set of sets) {
    const res = await fetch(`${BASE_URL}/sets/${encodeURIComponent(set)}/cards`);
    // A set Lorcast doesn't know: its cards stay unnamed
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`HTTP ${res.status} on Lorcast set ${set}`);
    for (const card of await res.json()) names[`${set}-${card.collector_number}`] = fullName(card);
    await sleep(REQUEST_INTERVAL_MS);
  }
  return names;
}
