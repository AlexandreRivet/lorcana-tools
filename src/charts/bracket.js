/**
 * "Conversion tour par tour" (round by round): one row per deck that made a top cut, one column
 * per stage. First the top cut itself (share of the deck's players who made it), then each round
 * of the bracket down to the final (share of the deck's players still in who go through). A cell
 * is blue when the deck goes through more often than the whole field at that stage, red when
 * less, on a log scale of that ratio; too few players leave it grey.
 */
import { interpolateLab, piecewise, scaleDiverging } from 'd3';
import { LORCANAHUNTER_URL } from '../config.js';
import { formatInt, formatNumber1, formatPct } from '../lib/format.js';
import { deckTitle } from '../lib/inks.js';
import {
  DECK_LABEL_WIDTH,
  PAD,
  createSvg,
  deckLabel,
  finalize,
  footer,
  header,
  legendDot,
  middle,
  nameRoom,
} from './common.js';
import { inkOn } from './matchups.js';

const LABEL_WIDTH = 40;
const CELL_HEIGHT = 40;
/** Below this many players at the round before, a cell isn't coloured: one result swings it. */
export const MIN_ROUND_PLAYERS = 3;

const plural = (n, word) => `${formatInt(n)} ${word}${n > 1 ? 's' : ''}`;

/**
 * @param {object} field fieldReport()
 * @param {object} bracket bracketReport()
 * @param {object} context { period, minPlayers }
 */
export function bracketChart(field, bracket, context, { document, theme, width = 800 }) {
  const title = 'Conversion tour par tour';
  const svg = createSvg(document, { width, title, theme });
  const { decks, columns } = bracket;

  let y = header(svg, {
    title,
    subtitle: `${context.period} · part des joueurs encore en lice qui passent chaque tour, jusqu'à la finale`,
    theme,
  });

  // Legend: what the colour says
  y += 6;
  let lx = PAD;
  for (const [color, label] of [
    [theme.positive, 'Passe plus souvent que la moyenne'],
    [theme.negative, 'Passe moins souvent'],
    [theme.divergingMid, `Moins de ${MIN_ROUND_PLAYERS} joueurs au tour d'avant`],
  ]) {
    lx += legendDot(svg, { x: lx, y, color, label, theme }) + 20;
  }

  // Index → colour, symmetric on a log scale: ×2 as blue as ×0,5 is red
  const color = scaleDiverging(
    piecewise(interpolateLab, [theme.negative, theme.divergingMid, theme.positive]),
  )
    .domain([-1, 0, 1])
    .clamp(true);

  const stages = [
    {
      label: 'Top cut',
      rate: field.baseline,
      detail: 'de tous les joueurs',
      cell: (d) => ({
        from: d.players,
        to: d.topCut,
        rate: d.conversion,
        index: d.index,
        // Every player starts: the top cut is coloured from the first one
        enough: true,
      }),
      tip: (d, cell) => [
        `${deckTitle(d)} · top cut`,
        `${formatPct(cell.rate)} au top cut`,
        `${formatInt(cell.to)} sur ${formatInt(cell.from)} joueurs, contre ${formatPct(field.baseline)} pour l'ensemble`,
      ],
    },
    ...columns.map((c) => ({
      label: c.n === 2 ? 'Finale' : `Top ${c.n}`,
      rate: c.rate,
      detail: plural(c.events, 'tournoi'),
      cell: (d) => d.rounds[c.n],
      tip: (d, cell) => [
        `${deckTitle(d)} · ${c.n === 2 ? 'finale' : `top ${c.n}`}`,
        cell.from ? `${formatPct(cell.rate)} passent ce tour` : `Aucun joueur au tour d'avant`,
        cell.from
          ? `${formatInt(cell.to)} sur ${formatInt(cell.from)} joueurs encore en lice, contre ${formatPct(c.rate)} pour l'ensemble`
          : null,
        `Sur ${plural(c.events, 'tournoi')} dont le top cut est allé jusque-là`,
      ],
    })),
  ];

  const room = nameRoom(decks);
  const gridLeft = PAD + LABEL_WIDTH + room;
  const cellWidth = Math.min(96, (width - PAD - gridLeft) / stages.length);

  // Column headers: the stage, then the field's rate there and what it covers
  y += 30;
  stages.forEach((s, j) => {
    const cx = gridLeft + j * cellWidth + cellWidth / 2;
    const text = (dy, value, attrs) => {
      const t = svg
        .append('text')
        .attr('x', cx)
        .attr('y', y + dy)
        .attr('text-anchor', 'middle')
        .text(value);
      for (const [name, v] of Object.entries(attrs)) t.attr(name, v);
    };
    text(0, s.label, { 'font-size': 12, 'font-weight': 600, fill: theme.text });
    text(15, s.rate == null ? '—' : `moy. ${formatPct(s.rate, 0)}`, {
      'font-size': 10,
      fill: theme.text2,
    });
    text(28, s.detail, { 'font-size': 10, fill: theme.muted });
  });
  const gridTop = y + 40;

  decks.forEach((d, i) => {
    const rowTop = gridTop + i * CELL_HEIGHT;
    deckLabel(svg, d, {
      x: PAD,
      y: rowTop + CELL_HEIGHT / 2,
      theme,
      maxWidth: LABEL_WIDTH + room - DECK_LABEL_WIDTH - 6,
    });
    stages.forEach((s, j) => {
      const cell = s.cell(d);
      const colored =
        cell.from > 0 && cell.index != null && (cell.enough || cell.from >= MIN_ROUND_PLAYERS);
      const fill = colored ? color(Math.log2(Math.max(cell.index, 1 / 8))) : theme.divergingMid;
      const x = gridLeft + j * cellWidth;
      const g = svg.append('g');
      g.append('rect')
        .attr('class', 'cell')
        .attr('x', x + 1)
        .attr('y', rowTop + 1)
        .attr('width', cellWidth - 2)
        .attr('height', CELL_HEIGHT - 2)
        .attr('rx', 2)
        .attr('fill', fill)
        .attr('tabindex', 0)
        .attr('data-tip', s.tip(d, cell).filter(Boolean).join('\n'));
      const ink = colored ? inkOn(fill) : theme.muted;
      g.append('text')
        .attr('x', x + cellWidth / 2)
        .attr('y', rowTop + 15 + middle(12))
        .attr('font-size', 12)
        .attr('font-weight', colored ? 600 : 400)
        .attr('fill', ink)
        .attr('text-anchor', 'middle')
        .attr('pointer-events', 'none')
        .text(cell.from ? formatPct(cell.rate, 0) : '·');
      if (cell.from) {
        g.append('text')
          .attr('x', x + cellWidth / 2)
          .attr('y', rowTop + 29 + middle(10))
          .attr('font-size', 10)
          .attr('fill', ink)
          .attr('opacity', 0.8)
          .attr('text-anchor', 'middle')
          .attr('pointer-events', 'none')
          .text(`${formatInt(cell.to)}/${formatInt(cell.from)}`);
      }
    });
  });

  // A tournament without its top cut in the results never played one: not in the rounds
  const excluded = bracket.excluded.length
    ? `Hors des tours (top cut supposé) : ${bracket.excluded.map((e) => e.name).join(', ')}.`
    : null;
  const height = footer(svg, {
    y: gridTop + decks.length * CELL_HEIGHT + 24,
    theme,
    note: excluded,
    source: `Source : ${LORCANAHUNTER_URL.replace('https://', '')} · tournois core de plus de ${context.minPlayers} joueurs`,
  });
  return finalize(svg, height);
}

/** "×1,4": a deck's rate over the field's, for the table view. */
export const formatIndex = (index) => (index == null ? '—' : `×${formatNumber1(index)}`);
