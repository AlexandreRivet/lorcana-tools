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

/** "jaune-vert": a deck by its plain colours, as the podcast hosts say it. */
export function deckColorName(colors) {
  return colors.map((ink) => INKS[ink]?.colorName ?? ink).join('-');
}

/** "🟡🟢": a deck's inks as emoji, where only text can be shown. */
export function deckEmoji(colors) {
  return colors.map((ink) => INKS[ink]?.emoji ?? '⚫').join('');
}
