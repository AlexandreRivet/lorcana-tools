/**
 * Play / draw: each deck's win rate when it goes first (filled dot) and when it goes second
 * (hollow dot), joined by a line, over the matchup window. The gap shows how much a deck relies
 * on going first. Shape, not colour, tells the two apart.
 */
import { max, min, scaleLinear } from 'd3';
import { formatCount, formatDelta, formatPct, formatWeekRange } from '../lib/format.js';
import { deckTitle } from '../lib/inks.js';
import {
  PAD,
  createSvg,
  deckLabel,
  finalize,
  footer,
  header,
  hitArea,
  middle,
  nameRoom,
} from './common.js';

const ROW_HEIGHT = 28;

export function playDrawChart(report, { document, theme, width = 800 }) {
  const { decks } = report;
  // Matchup figures: games by archetype, even in BO3
  const unit = report.matchups.unit ?? report.unit;
  const { weeks, endDate, firstPlayerWinRate, sampleSize, updatedAt } = report.matchups;
  // In BO3 by inks the first player is who starts game 1; by archetype, figures are per game
  const bo3 = report.gameMode === 'bo3' && unit === report.unit;
  const goesFirst = bo3 ? 'commence la 1re partie' : 'commence';
  const title = 'Commencer ou jouer en second';
  const svg = createSvg(document, { width, title, theme });

  let y = header(svg, {
    title,
    subtitle: `Win rate de chaque deck selon qui commence · ${report.queueName} · ${formatWeekRange(
      weeks[0],
      endDate,
    )}`,
    theme,
  });
  if (firstPlayerWinRate != null) {
    svg
      .append('text')
      .attr('x', PAD)
      .attr('y', y + 2)
      .attr('font-size', 13)
      .attr('fill', theme.text2)
      .text(
        `En moyenne, le joueur qui ${goesFirst} gagne ${formatPct(firstPlayerWinRate)} des ${unit.many}.`,
      );
    y += 20;
  }

  const rows = decks.filter((d) => d.playDraw.onPlay.games && d.playDraw.onDraw.games);
  const col = { deck: PAD, plotFrom: 80 + nameRoom(decks), plotTo: 680, gap: width - PAD };
  const rates = rows.flatMap((d) => [d.playDraw.onPlay.winRate, d.playDraw.onDraw.winRate]);
  const x = scaleLinear()
    .domain([Math.min(48, min(rates)), Math.max(52, max(rates))])
    .nice()
    .range([col.plotFrom, col.plotTo])
    .clamp(true);

  // Column headers
  y += 16;
  const columnHeader = (cx, label, anchor = 'start') =>
    svg
      .append('text')
      .attr('x', cx)
      .attr('y', y)
      .attr('font-size', 11)
      .attr('font-weight', 500)
      .attr('fill', theme.muted)
      .attr('text-anchor', anchor)
      .text(label);
  columnHeader(col.deck, 'DECK');
  columnHeader(col.plotFrom, 'WIN RATE');
  columnHeader(col.gap, 'ÉCART', 'end');

  const top = y + 10;
  const rowsHeight = rows.length * ROW_HEIGHT;
  for (const t of x.ticks(5)) {
    svg
      .append('line')
      .attr('x1', x(t))
      .attr('x2', x(t))
      .attr('y1', top)
      .attr('y2', top + rowsHeight)
      .attr('stroke', t === 50 ? theme.axis : theme.grid);
    svg
      .append('text')
      .attr('x', x(t))
      .attr('y', top + rowsHeight + 14)
      .attr('font-size', 10)
      .attr('fill', theme.muted)
      .attr('text-anchor', 'middle')
      .text(formatPct(t, 0));
  }

  rows.forEach((deck, i) => {
    const rowTop = top + i * ROW_HEIGHT;
    const cy = rowTop + ROW_HEIGHT / 2;
    const { onPlay, onDraw } = deck.playDraw;
    const row = svg.append('g');

    if (i > 0) {
      row
        .append('line')
        .attr('x1', PAD)
        .attr('x2', width - PAD)
        .attr('y1', rowTop)
        .attr('y2', rowTop)
        .attr('stroke', theme.grid);
    }
    deckLabel(row, deck, { x: col.deck, y: cy, theme });

    row
      .append('line')
      .attr('x1', x(onDraw.winRate))
      .attr('x2', x(onPlay.winRate))
      .attr('y1', cy)
      .attr('y2', cy)
      .attr('stroke', theme.accent)
      .attr('stroke-opacity', 0.45)
      .attr('stroke-width', 2);
    // Second: hollow dot
    row
      .append('circle')
      .attr('cx', x(onDraw.winRate))
      .attr('cy', cy)
      .attr('r', 4.5)
      .attr('fill', theme.surface)
      .attr('stroke', theme.accent)
      .attr('stroke-width', 2);
    // First: filled dot
    row
      .append('circle')
      .attr('cx', x(onPlay.winRate))
      .attr('cy', cy)
      .attr('r', 5)
      .attr('fill', theme.accent)
      .attr('stroke', theme.surface)
      .attr('stroke-width', 2);

    const gap = onPlay.winRate - onDraw.winRate;
    row
      .append('text')
      .attr('x', col.gap)
      .attr('y', cy + middle(13))
      .attr('font-size', 13)
      .attr('font-weight', 500)
      .attr('fill', theme.text)
      .attr('text-anchor', 'end')
      .text(`${formatDelta(gap)} pts`);

    hitArea(row, {
      x: PAD,
      y: rowTop,
      width: width - 2 * PAD,
      height: ROW_HEIGHT,
      tip: [
        deckTitle(deck),
        `${formatDelta(gap)} pts en commençant`,
        `En commençant : ${formatPct(onPlay.winRate)} sur ${formatCount(Math.round(onPlay.games), unit)}`,
        `En second : ${formatPct(onDraw.winRate)} sur ${formatCount(Math.round(onDraw.games), unit)}`,
      ],
    });
  });

  // Legend: the two dot shapes
  const ly = top + rowsHeight + 40;
  svg
    .append('circle')
    .attr('cx', PAD + 5)
    .attr('cy', ly)
    .attr('r', 5)
    .attr('fill', theme.accent);
  svg
    .append('text')
    .attr('x', PAD + 15)
    .attr('y', ly + middle(12))
    .attr('font-size', 12)
    .attr('fill', theme.text2)
    .text(`Le deck ${goesFirst}`);
  const second = PAD + 15 + 12 * 0.53 * `Le deck ${goesFirst}`.length + 24;
  svg
    .append('circle')
    .attr('cx', second + 5)
    .attr('cy', ly)
    .attr('r', 4.5)
    .attr('fill', theme.surface)
    .attr('stroke', theme.accent)
    .attr('stroke-width', 2);
  svg
    .append('text')
    .attr('x', second + 15)
    .attr('y', ly + middle(12))
    .attr('font-size', 12)
    .attr('fill', theme.text2)
    .text('Le deck joue en second');

  const height = footer(svg, {
    y: ly + 30,
    theme,
    updatedAt,
    sampleSize,
    unit,
    note: 'Écart : win rate en commençant moins win rate en second',
  });
  return finalize(svg, height);
}
