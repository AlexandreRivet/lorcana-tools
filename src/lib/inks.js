/**
 * Lorcana inks: names (French, for the team), the plain colour players say out loud, chip
 * colours, and the closest coloured-circle emoji for text-only places (Discord messages,
 * drop-down lists).
 * Decks are shown by their ink chips; names remain in tooltips and for screen readers.
 */
export const INKS = {
  amber: { name: 'Ambre', colorName: 'jaune', color: '#f5b202', emoji: '🟡' },
  amethyst: { name: 'Améthyste', colorName: 'violet', color: '#81377b', emoji: '🟣' },
  emerald: { name: 'Émeraude', colorName: 'vert', color: '#2a8934', emoji: '🟢' },
  ruby: { name: 'Rubis', colorName: 'rouge', color: '#d3082f', emoji: '🔴' },
  sapphire: { name: 'Saphir', colorName: 'bleu', color: '#0189c4', emoji: '🔵' },
  steel: { name: 'Acier', colorName: 'gris', color: '#9fa8b4', emoji: '⚪' },
};

/** Stable deck key: sorted ink names joined by "/", as in the API. */
export function deckKey(colors) {
  return colors.join('/');
}

export function inkName(ink) {
  return INKS[ink]?.name ?? ink;
}

export function deckName(colors) {
  return colors.map(inkName).join(' / ');
}

/**
 * "Max Goof Tod": an archetype's key cards, from its slug ("amber-emerald-max-goof-tod") once
 * the inks are dropped. Stands in for archetypes duels.ink hasn't named.
 */
function slugCards({ slug, colors }) {
  if (!slug) return null;
  const words = slug.split('-');
  while (words.length > 1 && colors.includes(words[0])) words.shift();
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Gives each archetype deck a `label` (shown next to its chips) and a `name` (with its inks,
 * for tooltips and screen readers). Two archetypes of the same inks under one name ("Midrange")
 * are told apart by their key cards.
 */
export function nameArchetypes(decks) {
  const base = (d) => d.archetype ?? slugCards(d) ?? 'Sans nom';
  const count = new Map();
  for (const d of decks) {
    const id = `${deckKey(d.colors)}|${base(d)}`;
    count.set(id, (count.get(id) ?? 0) + 1);
  }
  for (const d of decks) {
    const shared = count.get(`${deckKey(d.colors)}|${base(d)}`) > 1;
    const cards = slugCards(d);
    d.label = shared && d.archetype && cards ? `${d.archetype} · ${cards}` : base(d);
    d.name = `${d.label} (${deckName(d.colors)})`;
  }
}

/** A deck's full name: an archetype's, or its inks. */
export function deckTitle(deck) {
  return deck.name ?? deckName(deck.colors);
}

/** "jaune-vert": a deck by its plain colours, as the podcast hosts say it. */
export function deckColorName(colors) {
  return colors.map((ink) => INKS[ink]?.colorName ?? ink).join('-');
}

/** "🟡🟢": a deck's inks as emoji, where only text can be shown. */
export function deckEmoji(colors) {
  return colors.map((ink) => INKS[ink]?.emoji ?? '⚫').join('');
}
