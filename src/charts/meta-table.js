/**
 * "Méta de la semaine" (meta of the week): one row per deck, most played first.
 * Play rate as bars, win rate with its 95% confidence interval (the dot is only coloured when
 * the gap to 50% is significant), and the change since the previous week: a tick on the bar and
 * a hollow dot mark last week's values, and the changes are bold when they beat the noise.
 */
import { max, min, scaleLinear } from 'd3';
import { formatCount, formatDelta, formatInt, formatPct, formatWeek } from '../lib/format.js';
import { deckTitle } from '../lib/inks.js';
import {
  PAD,
  createSvg,
  deckLabel,
  finalize,
  footer,
  header,
  hitArea,
  horizontalBar,
  legendDot,
  middle,
  nameRoom,
} from './common.js';

const ROW_HEIGHT = 30;
const BAR_HEIGHT = 14;

export const SIGNAL_LABELS = {
  above: 'Au-dessus de 50 %',
  neutral: "Pas d'écart significatif",
  below: 'En dessous de 50 %',
};

/**
 * A change in points, right-aligned: bold when it beats the noise, muted otherwise. Without a
 * change: "nouveau" if the deck wasn't there last week, "—" if there's no week to compare with.
 */
function deltaText(row, { x, cy, delta, change, theme, comparable }) {
  const significant = change && change.signal !== 'flat';
  row
    .append('text')
    .attr('x', x)
    .attr('y', cy + middle(12))
    .attr('font-size', 12)
    .attr('font-weight', significant ? 600 : 400)
    .attr('fill', delta == null ? theme.muted : significant ? theme.text : theme.muted)
    .attr('text-anchor', 'end')
    .text(delta == null ? (comparable ? 'nouveau' : '—') : formatDelta(delta));
}

export function metaTableChart(report, { document, theme, width = 800 }) {
  const { decks, week, unit } = report;
  const title = 'Méta de la semaine';
  const svg = createSvg(document, { width, title, theme });

  let y = header(svg, {
    title,
    subtitle: `${report.queueName} · ${formatWeek(week)} · ${formatCount(
      week.sampleSize,
      unit,
    )} · les ${decks.length} decks les plus joués`,
    theme,
  });

  // Archetype names widen the deck column; the bars and the win-rate scale give up the room
  const room = nameRoom(decks);
  const bar = 66 + room;
  const barMax = 190 - Math.round(room * 0.6);
  const col = {
    deck: PAD,
    bar,
    barMax,
    deltaPlay: bar + barMax + 90,
    dotsFrom: bar + barMax + 118,
    dotsTo: 590,
    winRate: 664,
    deltaWin: 722,
    games: width - PAD,
  };

  const signalColor = {
    above: theme.positive,
    neutral: theme.neutral,
    below: theme.negative,
  };

  const playScale = scaleLinear()
    .domain([0, max(decks, (d) => Math.max(d.playRate, d.previous?.playRate ?? 0))])
    .range([0, col.barMax]);
  const lo = Math.min(
    48,
    min(decks, (d) => Math.min(d.ci[0], d.previous?.winRate ?? 100)),
  );
  const hi = Math.max(
    52,
    max(decks, (d) => Math.max(d.ci[1], d.previous?.winRate ?? 0)),
  );
  const winScale = scaleLinear()
    .domain([lo, hi])
    .nice()
    .range([col.dotsFrom, col.dotsTo])
    .clamp(true);

  // Column headers
  y += 14;
  const columnHeader = (x, label, anchor = 'start') =>
    svg
      .append('text')
      .attr('x', x)
      .attr('y', y)
      .attr('font-size', 11)
      .attr('font-weight', 500)
      .attr('fill', theme.muted)
      .attr('text-anchor', anchor)
      .text(label);
  columnHeader(col.deck, 'DECK');
  columnHeader(col.bar, 'POPULARITÉ');
  columnHeader(col.deltaPlay, 'Δ', 'end');
  columnHeader(col.dotsFrom, 'WIN RATE · IC 95 %');
  columnHeader(col.deltaWin, 'Δ', 'end');
  columnHeader(col.games, unit.many.toUpperCase(), 'end');

  const top = y + 10;
  const rowsHeight = decks.length * ROW_HEIGHT;

  // Win-rate gridlines, behind the rows
  // 3 ticks: on a wide scale (tiny samples, 0–100 %) more of them would collide.
  const ticks = winScale.ticks(3);
  const grid = svg.append('g');
  for (const t of ticks) {
    grid
      .append('line')
      .attr('x1', winScale(t))
      .attr('x2', winScale(t))
      .attr('y1', top)
      .attr('y2', top + rowsHeight)
      .attr('stroke', t === 50 ? theme.axis : theme.grid)
      .attr('stroke-width', 1);
    grid
      .append('text')
      .attr('x', winScale(t))
      .attr('y', top + rowsHeight + 14)
      .attr('font-size', 10)
      .attr('fill', theme.muted)
      .attr('text-anchor', 'middle')
      .text(formatPct(t, 0));
  }

  decks.forEach((deck, i) => {
    const rowTop = top + i * ROW_HEIGHT;
    const cy = rowTop + ROW_HEIGHT / 2;
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

    const barWidth = Math.max(2, playScale(deck.playRate));
    row
      .append('path')
      .attr('d', horizontalBar(col.bar, cy - BAR_HEIGHT / 2, barWidth, BAR_HEIGHT))
      .attr('fill', theme.accent);
    if (deck.previous) {
      // Last week's play rate: a tick across the bar
      const px = col.bar + playScale(deck.previous.playRate);
      row
        .append('line')
        .attr('x1', px)
        .attr('x2', px)
        .attr('y1', cy - BAR_HEIGHT / 2 - 3)
        .attr('y2', cy + BAR_HEIGHT / 2 + 3)
        .attr('stroke', theme.text)
        .attr('stroke-opacity', 0.8)
        .attr('stroke-width', 2);
    }
    row
      .append('text')
      .attr('x', col.bar + Math.max(barWidth, playScale(deck.previous?.playRate ?? 0)) + 6)
      .attr('y', cy + middle(12))
      .attr('font-size', 12)
      .attr('fill', theme.text2)
      .text(formatPct(deck.playRate));

    deltaText(row, {
      comparable: Boolean(report.previousWeek),
      x: col.deltaPlay,
      cy,
      delta: deck.deltaPlayRate,
      change: deck.playRateChange,
      theme,
    });

    const color = signalColor[deck.signal];
    if (deck.previous) {
      // Last week's win rate: a hollow dot, under this week's
      row
        .append('circle')
        .attr('cx', winScale(deck.previous.winRate))
        .attr('cy', cy)
        .attr('r', 3.5)
        .attr('fill', 'none')
        .attr('stroke', theme.text2)
        .attr('stroke-width', 1.5);
    }
    row
      .append('line')
      .attr('x1', winScale(deck.ci[0]))
      .attr('x2', winScale(deck.ci[1]))
      .attr('y1', cy)
      .attr('y2', cy)
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('stroke-linecap', 'round');
    row
      .append('circle')
      .attr('cx', winScale(deck.winRate))
      .attr('cy', cy)
      .attr('r', 5)
      .attr('fill', color)
      .attr('stroke', theme.surface)
      .attr('stroke-width', 2);

    row
      .append('text')
      .attr('x', col.winRate)
      .attr('y', cy + middle(13))
      .attr('font-size', 13)
      .attr('font-weight', 500)
      .attr('fill', theme.text)
      .attr('text-anchor', 'end')
      .text(formatPct(deck.winRate));
    deltaText(row, {
      comparable: Boolean(report.previousWeek),
      x: col.deltaWin,
      cy,
      delta: deck.deltaWinRate,
      change: deck.winRateChange,
      theme,
    });
    row
      .append('text')
      .attr('x', col.games)
      .attr('y', cy + middle(12))
      .attr('font-size', 12)
      .attr('fill', theme.text2)
      .attr('text-anchor', 'end')
      .text(formatInt(deck.games));

    hitArea(row, {
      x: PAD,
      y: rowTop,
      width: width - 2 * PAD,
      height: ROW_HEIGHT,
      tip: [
        deckTitle(deck),
        `${formatPct(deck.winRate)} de victoires`,
        `IC 95 % : ${formatPct(deck.ci[0])} – ${formatPct(deck.ci[1])}`,
        `${formatPct(deck.playRate)} des decks · ${formatCount(deck.games, unit)}`,
        ...(deck.previous
          ? [
              `Semaine précédente : ${formatPct(deck.previous.playRate)} des decks, ${formatPct(
                deck.previous.winRate,
              )} de victoires`,
              `Popularité ${formatDelta(deck.deltaPlayRate)} pt${
                deck.playRateChange.signal === 'flat' ? ' (dans le bruit)' : ''
              } · win rate ${formatDelta(deck.deltaWinRate)} pt${
                deck.winRateChange.signal === 'flat' ? ' (dans le bruit)' : ''
              }`,
            ]
          : ['Absent la semaine précédente']),
      ],
    });
  });

  // Legend: dot colours, then last week's markers
  const ly = top + rowsHeight + 40;
  let lx = PAD;
  for (const signal of ['above', 'neutral', 'below']) {
    lx +=
      legendDot(svg, {
        x: lx,
        y: ly,
        color: signalColor[signal],
        label: SIGNAL_LABELS[signal],
        theme,
      }) + 20;
  }
  const ly2 = ly + 24;
  svg
    .append('line')
    .attr('x1', PAD + 4)
    .attr('x2', PAD + 4)
    .attr('y1', ly2 - 7)
    .attr('y2', ly2 + 7)
    .attr('stroke', theme.text)
    .attr('stroke-opacity', 0.8)
    .attr('stroke-width', 2);
  svg
    .append('circle')
    .attr('cx', PAD + 18)
    .attr('cy', ly2)
    .attr('r', 3.5)
    .attr('fill', 'none')
    .attr('stroke', theme.text2)
    .attr('stroke-width', 1.5);
  svg
    .append('text')
    .attr('x', PAD + 30)
    .attr('y', ly2 + middle(12))
    .attr('font-size', 12)
    .attr('fill', theme.text2)
    .text('semaine précédente (popularité, win rate)');

  const height = footer(svg, {
    y: ly2 + 30,
    theme,
    updatedAt: week.updatedAt,
    sampleSize: week.sampleSize,
    unit,
    note: 'Δ : évolution en points vs la semaine précédente, en gras quand elle dépasse le bruit (IC 95 %) · trait : IC 95 % du win rate',
  });
  return finalize(svg, height);
}
