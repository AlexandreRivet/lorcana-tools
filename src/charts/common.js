/**
 * Shared chart building blocks. Each chart builds a standalone <svg> from the given
 * `document`: the browser's for the page, jsdom's for the PNGs.
 * No text measurement (getBBox): jsdom can't do it, so widths are estimated.
 */
import { select } from 'd3';
import { SOURCE_URL } from '../config.js';
import { formatCount, formatUpdatedAt } from '../lib/format.js';
import { INKS, deckTitle } from '../lib/inks.js';
import { FONT_FAMILY } from './theme.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const PAD = 24;

/** Approximate width of a string in Inter (≈ 0.53 em per character). */
export const textWidth = (text, size) => text.length * size * 0.53;

/** Vertical offset that centres a line of text on `y`. */
export const middle = (size) => size * 0.35;

export function createSvg(document, { width, title, theme }) {
  const svg = select(document.createElementNS(SVG_NS, 'svg'))
    .attr('width', width)
    .attr('font-family', FONT_FAMILY)
    .attr('role', 'img');
  svg.append('title').text(title);
  svg.append('rect').attr('class', 'background').attr('width', width).attr('fill', theme.surface);
  return svg;
}

/** Sets the height once the layout is done. */
export function finalize(svg, height) {
  const width = Number(svg.attr('width'));
  svg.attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);
  svg.select('rect.background').attr('height', height);
  return svg.node();
}

/** Title + subtitle. Returns the y coordinate available below. */
export function header(svg, { title, subtitle, theme }) {
  svg
    .append('text')
    .attr('x', PAD)
    .attr('y', PAD + 16)
    .attr('font-size', 20)
    .attr('font-weight', 600)
    .attr('fill', theme.text)
    .text(title);
  svg
    .append('text')
    .attr('x', PAD)
    .attr('y', PAD + 40)
    .attr('font-size', 13)
    .attr('fill', theme.text2)
    .text(subtitle);
  return PAD + 60;
}

/** Source line, required by the API's terms. Returns the final height. */
export function footer(svg, { y, theme, updatedAt, sampleSize, unit, note }) {
  const source = `Source : ${SOURCE_URL.replace('https://', '')} · données du ${formatUpdatedAt(
    updatedAt,
  )} · ${formatCount(sampleSize, unit)}`;
  let line = y;
  if (note) {
    svg
      .append('text')
      .attr('x', PAD)
      .attr('y', line)
      .attr('font-size', 11)
      .attr('fill', theme.muted)
      .text(note);
    line += 16;
  }
  svg
    .append('text')
    .attr('x', PAD)
    .attr('y', line)
    .attr('font-size', 11)
    .attr('fill', theme.muted)
    .text(source);
  return line + PAD - 8;
}

/** A deck's ink chips, vertically centred on `y`. Returns the width used. */
export function inkChips(parent, colors, { x, y, theme, r = 5, name }) {
  const g = parent.append('g').attr('transform', `translate(${x},${y})`);
  // Accessible name, also shown by the browser when the chips are hovered
  if (name) g.append('title').text(name);
  colors.forEach((ink, i) => {
    g.append('circle')
      .attr('cx', r + i * (r * 2 - 1))
      .attr('cy', 0)
      .attr('r', r)
      .attr('fill', INKS[ink]?.color ?? theme.neutral)
      .attr('stroke', theme.surface)
      .attr('stroke-width', 1.5);
  });
  return r * 2 + (colors.length - 1) * (r * 2 - 1);
}

/** Width taken by a deck label (its chips) at the default size. */
export const DECK_LABEL_WIDTH = 23;

/** Room for an archetype's name after its chips, in the charts that list decks in rows. */
export const NAME_WIDTH = 124;

/** Extra width a chart's deck column needs: archetype names by archetype, none by inks. */
export const nameRoom = (decks) => (decks.some((d) => d.label) ? NAME_WIDTH : 0);

/** `text` cut with an ellipsis to fit `width` at `size` (estimated, see textWidth). */
export function fitText(text, width, size) {
  const chars = Math.floor(width / (size * 0.53));
  return text.length <= chars ? text : `${text.slice(0, Math.max(1, chars - 1))}…`;
}

/**
 * A deck's label: its ink chips, vertically centred on `y`, then its archetype name if it has
 * one, cut to `maxWidth`. The full name goes into an SVG <title>, read by screen readers and
 * shown when the label is hovered on the page. Returns the width used.
 */
export function deckLabel(parent, deck, { x, y, theme, r = 6, size = 11, maxWidth = NAME_WIDTH }) {
  const width = inkChips(parent, deck.colors, { x, y, theme, r, name: deckTitle(deck) });
  if (!deck.label) return width;
  const text = fitText(deck.label, maxWidth - 6, size);
  parent
    .append('text')
    .attr('x', x + width + 6)
    .attr('y', y + middle(size))
    .attr('font-size', size)
    .attr('fill', theme.text)
    .text(text)
    .append('title')
    .text(deckTitle(deck));
  return width + 6 + Math.min(textWidth(text, size), maxWidth - 6);
}

/** Width deckLabel will take for this deck. */
export function deckLabelWidth(deck, { r = 6, size = 11, maxWidth = NAME_WIDTH } = {}) {
  const chips = r * 2 + (deck.colors.length - 1) * (r * 2 - 1);
  if (!deck.label) return chips;
  return (
    chips + 6 + Math.min(textWidth(fitText(deck.label, maxWidth - 6, size), size), maxWidth - 6)
  );
}

/**
 * Path of a horizontal bar: square at the baseline, rounded (4 px) at the tip.
 */
export function horizontalBar(x0, y, width, height, radius = 4) {
  const r = Math.min(radius, width / 2, height / 2);
  const x1 = x0 + width;
  return [
    `M${x0},${y}`,
    `H${x1 - r}`,
    `Q${x1},${y} ${x1},${y + r}`,
    `V${y + height - r}`,
    `Q${x1},${y + height} ${x1 - r},${y + height}`,
    `H${x0}`,
    'Z',
  ].join('');
}

/** Bar square at `from` and rounded (4px) at `to`, in either direction. */
export function barPath(from, to, y, height, radius = 4) {
  const r = Math.min(radius, Math.abs(to - from) / 2, height / 2);
  const s = to >= from ? 1 : -1;
  const tip = to - s * r;
  return [
    `M${from},${y}`,
    `H${tip}`,
    `Q${to},${y} ${to},${y + r}`,
    `V${y + height - r}`,
    `Q${to},${y + height} ${tip},${y + height}`,
    `H${from}`,
    'Z',
  ].join('');
}

/** Transparent hover area carrying the tooltip (web page only). */
export function hitArea(parent, { x, y, width, height, tip }) {
  return parent
    .append('rect')
    .attr('class', 'hit')
    .attr('x', x)
    .attr('y', y)
    .attr('width', width)
    .attr('height', height)
    .attr('fill', 'transparent')
    .attr('tabindex', 0)
    .attr('data-tip', tip.join('\n'));
}

/** Legend item: a coloured dot followed by a label. Returns its width. */
export function legendDot(parent, { x, y, color, label, theme }) {
  parent
    .append('circle')
    .attr('cx', x + 5)
    .attr('cy', y)
    .attr('r', 5)
    .attr('fill', color)
    .attr('stroke', theme.surface)
    .attr('stroke-width', 2);
  parent
    .append('text')
    .attr('x', x + 15)
    .attr('y', y + middle(12))
    .attr('font-size', 12)
    .attr('fill', theme.text2)
    .text(label);
  return 15 + textWidth(label, 12);
}
