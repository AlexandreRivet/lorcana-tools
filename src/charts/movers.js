/**
 * "Mouvements de la semaine" (this week's moves): for each deck, the change in play rate and in
 * win rate since the previous week, in points, as bars from 0 with the 95% interval of the
 * change. Two panels side by side (never two scales on one axis), decks sorted from the biggest
 * rise in play rate to the biggest fall. A bar is coloured only when its change beats the noise.
 */
import { max, scaleLinear } from 'd3';
import { formatDay, formatDelta, formatPct } from '../lib/format.js';
import { deckTitle } from '../lib/inks.js';
import {
  PAD,
  barPath,
  createSvg,
  deckLabel,
  deckLabelWidth,
  finalize,
  footer,
  header,
  hitArea,
  legendDot,
  middle,
  nameRoom,
  textWidth,
} from './common.js';

const ROW_HEIGHT = 28;
const BAR_HEIGHT = 12;

export function moversChart(report, { document, theme, width = 800 }) {
  const { week, previousWeek, unit } = report;
  const title = 'Mouvements de la semaine';
  const svg = createSvg(document, { width, title, theme });

  let y = header(svg, {
    title,
    subtitle: previousWeek
      ? `${report.queueName} · semaine du ${formatDay(week.startDate)}${week.complete === false ? ' (en cours)' : ''} vs semaine du ${formatDay(
          previousWeek.startDate,
        )} · decks à plus de ${formatPct(report.options.deckMinPlayRate)} de popularité`
      : report.queueName,
    theme,
  });

  const shown = report.decks;
  const rows = shown.filter((d) => d.previous).sort((a, b) => b.deltaPlayRate - a.deltaPlayRate);
  const newcomers = shown.filter((d) => !d.previous);

  if (!rows.length) {
    svg
      .append('text')
      .attr('x', PAD)
      .attr('y', y + 30)
      .attr('font-size', 14)
      .attr('fill', theme.text2)
      .text('Pas encore de semaine précédente à comparer.');
    const height = footer(svg, {
      y: y + 70,
      theme,
      updatedAt: week.updatedAt,
      sampleSize: week.sampleSize,
      unit,
    });
    return finalize(svg, height);
  }

  const signalColor = { up: theme.positive, flat: theme.neutral, down: theme.negative };
  // Archetype names widen the deck column; both panels give up the room
  const room = nameRoom(shown);
  const panels = [
    {
      label: 'POPULARITÉ (Δ PTS)',
      from: 70 + room,
      to: 400 + room / 2,
      value: (d) => d.deltaPlayRate,
      change: (d) => d.playRateChange,
    },
    {
      label: 'WIN RATE (Δ PTS)',
      from: 446 + room / 2,
      to: width - PAD,
      value: (d) => d.deltaWinRate,
      change: (d) => d.winRateChange,
    },
  ];
  for (const panel of panels) {
    // Symmetric around 0, with room left for the value labels at the bar tips
    const reach = max(rows, (d) =>
      Math.max(Math.abs(panel.value(d)), ...panel.change(d).ci.map(Math.abs)),
    );
    const half = Math.max(1, reach) * 1.3;
    panel.x = scaleLinear().domain([-half, half]).range([panel.from, panel.to]).clamp(true);
  }

  // Column headers
  y += 16;
  const columnHeader = (x, label) =>
    svg
      .append('text')
      .attr('x', x)
      .attr('y', y)
      .attr('font-size', 11)
      .attr('font-weight', 500)
      .attr('fill', theme.muted)
      .text(label);
  columnHeader(PAD, 'DECK');
  for (const panel of panels) columnHeader(panel.from, panel.label);

  const top = y + 10;
  const rowsHeight = rows.length * ROW_HEIGHT;
  for (const panel of panels) {
    svg
      .append('line')
      .attr('x1', panel.x(0))
      .attr('x2', panel.x(0))
      .attr('y1', top)
      .attr('y2', top + rowsHeight)
      .attr('stroke', theme.axis);
  }

  rows.forEach((deck, i) => {
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
    deckLabel(row, deck, { x: PAD, y: cy, theme });

    for (const panel of panels) {
      const value = panel.value(deck);
      const { ci, signal } = panel.change(deck);
      const x0 = panel.x(0);
      const x1 = panel.x(value);
      if (Math.abs(x1 - x0) >= 1) {
        row
          .append('path')
          .attr('d', barPath(x0, x1, cy - BAR_HEIGHT / 2, BAR_HEIGHT))
          .attr('fill', signalColor[signal]);
      }
      row
        .append('line')
        .attr('x1', panel.x(ci[0]))
        .attr('x2', panel.x(ci[1]))
        .attr('y1', cy)
        .attr('y2', cy)
        .attr('stroke', theme.text)
        .attr('stroke-opacity', 0.55)
        .attr('stroke-width', 1.5)
        .attr('stroke-linecap', 'round');
      // Value at the bar's tip, beyond the interval so they don't overlap
      const outer =
        value >= 0 ? Math.max(x1, panel.x(ci[1])) + 5 : Math.min(x1, panel.x(ci[0])) - 5;
      row
        .append('text')
        .attr('x', outer)
        .attr('y', cy + middle(11))
        .attr('font-size', 11)
        .attr('font-weight', signal === 'flat' ? 400 : 600)
        .attr('fill', signal === 'flat' ? theme.muted : theme.text)
        .attr('text-anchor', value >= 0 ? 'start' : 'end')
        .text(formatDelta(value));
    }

    const noise = (change) => (change.signal === 'flat' ? ' · dans le bruit' : '');
    hitArea(row, {
      x: PAD,
      y: rowTop,
      width: width - 2 * PAD,
      height: ROW_HEIGHT,
      tip: [
        deckTitle(deck),
        `Popularité ${formatDelta(deck.deltaPlayRate)} pts · win rate ${formatDelta(
          deck.deltaWinRate,
        )} pts`,
        `Popularité : ${formatPct(deck.previous.playRate)} → ${formatPct(deck.playRate)}${noise(
          deck.playRateChange,
        )}`,
        `Win rate : ${formatPct(deck.previous.winRate)} → ${formatPct(deck.winRate)}${noise(
          deck.winRateChange,
        )}`,
      ],
    });
  });

  // Legend
  const ly = top + rowsHeight + 30;
  let lx = PAD;
  for (const [signal, label] of [
    ['up', 'Hausse nette'],
    ['flat', 'Dans le bruit'],
    ['down', 'Baisse nette'],
  ]) {
    lx += legendDot(svg, { x: lx, y: ly, color: signalColor[signal], label, theme }) + 20;
  }

  // Decks without a previous week, as chips
  let footerTop = ly + 30;
  if (newcomers.length) {
    const ny = ly + 28;
    const lead = 'Nouveaux cette semaine :';
    svg
      .append('text')
      .attr('x', PAD)
      .attr('y', ny + middle(12))
      .attr('font-size', 12)
      .attr('fill', theme.text2)
      .text(lead);
    const start = PAD + textWidth(lead, 12) + 10;
    let nx = start;
    let line = ny;
    for (const deck of newcomers) {
      // Archetype names can run past the edge: wrap
      if (nx > start && nx + deckLabelWidth(deck) > width - PAD) {
        nx = start;
        line += 22;
        footerTop += 22;
      }
      nx += deckLabel(svg, deck, { x: nx, y: line, theme }) + 14;
    }
    footerTop += 24;
  }
  const height = footer(svg, {
    y: footerTop,
    theme,
    updatedAt: week.updatedAt,
    sampleSize: week.sampleSize,
    unit,
    note: 'Couleur quand l’intervalle à 95 % de l’écart exclut 0 · trait : cet intervalle',
  });
  return finalize(svg, height);
}
