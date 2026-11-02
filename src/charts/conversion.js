/**
 * "Conversion au top cut": one row per deck, most played first. Its players and top-cut places,
 * then its conversion rate (share of its players who made the cut) with the 95% interval, against
 * the field's rate (dashed line). The dot is only coloured when the interval leaves that line.
 */
import { max, scaleLinear } from 'd3';
import { LORCANAHUNTER_URL } from '../config.js';
import { formatInt, formatNumber1, formatPct } from '../lib/format.js';
import { deckTitle } from '../lib/inks.js';
import {
  PAD,
  createSvg,
  deckLabel,
  finalize,
  footer,
  header,
  hitArea,
  legendDot,
  middle,
  nameRoom,
} from './common.js';

const ROW_HEIGHT = 30;

export const CONVERSION_SIGNALS = {
  above: 'Au-dessus de la moyenne',
  neutral: "Pas d'écart significatif",
  below: 'En dessous de la moyenne',
};

/** above / below when the 95% interval leaves the field's rate, neutral otherwise. */
export function conversionSignal(deck, baseline) {
  if (deck.ci[0] > baseline) return 'above';
  if (deck.ci[1] < baseline) return 'below';
  return 'neutral';
}

/**
 * @param {object} report fieldReport()
 * @param {object[]} decks the rows to draw, from report.decks
 * @param {object} context { period, minPlayers, minDeckPlayers }
 */
export function conversionChart(report, decks, context, { document, theme, width = 800 }) {
  const title = 'Conversion au top cut';
  const svg = createSvg(document, { width, title, theme });
  const { baseline } = report;

  let y = header(svg, {
    title,
    subtitle: `${context.period} · ${formatPct(baseline)} des joueurs passent le top cut · decks d'au moins ${context.minDeckPlayers} joueurs`,
    theme,
  });

  const room = nameRoom(decks);
  const col = {
    deck: PAD,
    players: 116 + room,
    cut: 196 + room,
    dotsFrom: 226 + room,
    dotsTo: 640,
    rate: 712,
    index: width - PAD,
  };
  const signalColor = { above: theme.positive, neutral: theme.neutral, below: theme.negative };
  const scale = scaleLinear()
    .domain([
      0,
      Math.max(
        baseline * 2,
        max(decks, (d) => d.ci[1]),
      ),
    ])
    .nice()
    .range([col.dotsFrom, col.dotsTo])
    .clamp(true);

  // Legend: what the dot's colour says
  y += 6;
  let lx = PAD;
  for (const [signal, label] of Object.entries(CONVERSION_SIGNALS)) {
    lx += legendDot(svg, { x: lx, y, color: signalColor[signal], label, theme }) + 20;
  }

  y += 30;
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
  columnHeader(col.players, 'JOUEURS', 'end');
  columnHeader(col.cut, 'TOP CUT', 'end');
  columnHeader(col.dotsFrom, 'CONVERSION · IC 95 %');
  columnHeader(col.rate, 'TAUX', 'end');
  columnHeader(col.index, 'INDICE', 'end');

  y += 10;
  const top = y;
  const bottom = top + decks.length * ROW_HEIGHT;

  // Gridlines and axis labels under the rows
  const axis = svg.append('g');
  for (const tick of scale.ticks(5)) {
    axis
      .append('line')
      .attr('x1', scale(tick))
      .attr('x2', scale(tick))
      .attr('y1', top)
      .attr('y2', bottom)
      .attr('stroke', theme.grid);
    axis
      .append('text')
      .attr('x', scale(tick))
      .attr('y', bottom + 14)
      .attr('font-size', 10)
      .attr('fill', theme.muted)
      .attr('text-anchor', 'middle')
      .text(formatPct(tick, 0));
  }
  axis
    .append('line')
    .attr('x1', scale(baseline))
    .attr('x2', scale(baseline))
    .attr('y1', top - 4)
    .attr('y2', bottom)
    .attr('stroke', theme.text2)
    .attr('stroke-dasharray', '3 3');
  axis
    .append('text')
    .attr('x', scale(baseline))
    .attr('y', bottom + 28)
    .attr('font-size', 10)
    .attr('fill', theme.text2)
    .attr('text-anchor', 'middle')
    .text(`moyenne ${formatPct(baseline)}`);

  decks.forEach((d, i) => {
    const cy = top + i * ROW_HEIGHT + ROW_HEIGHT / 2;
    const row = svg.append('g');
    const signal = conversionSignal(d, baseline);
    hitArea(row, {
      x: 0,
      y: cy - ROW_HEIGHT / 2,
      width,
      height: ROW_HEIGHT,
      tip: [
        deckTitle(d),
        `${formatPct(d.conversion)} au top cut`,
        `${formatInt(d.topCut)} sur ${formatInt(d.players)} joueurs · IC 95 % ${formatPct(d.ci[0])}–${formatPct(d.ci[1])}`,
        `${formatPct(d.share)} de la ligne de départ, ${formatPct(d.cutShare)} du top cut`,
        CONVERSION_SIGNALS[signal],
      ],
    });
    deckLabel(row, d, { x: col.deck, y: cy, theme });

    const number = (x, text, color = theme.text) =>
      row
        .append('text')
        .attr('x', x)
        .attr('y', cy + middle(12))
        .attr('font-size', 12)
        .attr('fill', color)
        .attr('text-anchor', 'end')
        .text(text);
    number(col.players, formatInt(d.players));
    number(col.cut, formatInt(d.topCut));

    row
      .append('line')
      .attr('x1', scale(d.ci[0]))
      .attr('x2', scale(d.ci[1]))
      .attr('y1', cy)
      .attr('y2', cy)
      .attr('stroke', theme.axis)
      .attr('stroke-width', 2)
      .attr('stroke-linecap', 'round');
    row
      .append('circle')
      .attr('cx', scale(d.conversion))
      .attr('cy', cy)
      .attr('r', 5)
      .attr('fill', signalColor[signal])
      .attr('stroke', theme.surface)
      .attr('stroke-width', 2);

    number(col.rate, formatPct(d.conversion));
    number(
      col.index,
      `×${formatNumber1(d.index)}`,
      signal === 'neutral' ? theme.muted : theme.text,
    );
  });

  const height = footer(svg, {
    y: bottom + 52,
    theme,
    note: "Indice : conversion du deck sur celle de l'ensemble des joueurs (×1,5 = 50 % de chances en plus de passer le top cut).",
    source: `Source : ${LORCANAHUNTER_URL.replace('https://', '')} · tournois core de plus de ${context.minPlayers} joueurs`,
  });
  return finalize(svg, height);
}
