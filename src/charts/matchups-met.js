/**
 * "Matchups rencontrés" (matchups met): one deck's opponents in tournaments, most met first. How
 * much of its matches each one took (a tick marks that deck's share of every match played, the
 * field a player met on average), how often one of its players met it, and its win rate with the
 * 95% interval; the dot is only coloured when that interval leaves 50%.
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
  horizontalBar,
  legendDot,
  middle,
} from './common.js';

const ROW_HEIGHT = 30;
const BAR_HEIGHT = 12;

export const WIN_SIGNALS = {
  above: 'Favorable',
  neutral: "Pas d'écart significatif",
  below: 'Défavorable',
};

/** above / below when the 95% interval leaves 50%, neutral otherwise. */
export const winSignal = ({ ci }) => (ci[0] > 50 ? 'above' : ci[1] < 50 ? 'below' : 'neutral');

/**
 * @param {object} deck one of matchupReport().decks
 * @param {object} report matchupReport()
 * @param {object} context { period, minPlayers }
 */
export function matchupsMetChart(deck, report, context, { document, theme, width = 800 }) {
  const title = 'Matchups rencontrés';
  const svg = createSvg(document, { width, title, theme });
  const { opponents } = deck;

  let y = header(svg, {
    title,
    subtitle: `${deckTitle(deck)} · ${formatInt(deck.matches)} matchs, ${formatPct(deck.winRate)} de victoires · ${context.period}`,
    theme,
  });

  const signalColor = { above: theme.positive, neutral: theme.neutral, below: theme.negative };
  y += 6;
  let lx = PAD;
  for (const [signal, label] of Object.entries(WIN_SIGNALS)) {
    lx += legendDot(svg, { x: lx, y, color: signalColor[signal], label, theme }) + 20;
  }

  const col = {
    deck: PAD,
    bar: 88,
    barMax: 150,
    perPlayer: 334,
    dotsFrom: 362,
    dotsTo: 640,
    winRate: 712,
    matches: width - PAD,
  };
  const shareScale = scaleLinear()
    .domain([0, max(opponents, (o) => Math.max(o.share, report.field.get(o.key) ?? 0))])
    .range([0, col.barMax]);
  const winScale = scaleLinear().domain([0, 100]).range([col.dotsFrom, col.dotsTo]);

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
  columnHeader(col.deck, 'CONTRE');
  columnHeader(col.bar, 'PART DES MATCHS');
  columnHeader(col.perPlayer, 'PAR JOUEUR', 'end');
  columnHeader(col.dotsFrom, 'WIN RATE · IC 95 %');
  columnHeader(col.matches, 'MATCHS', 'end');

  y += 10;
  const top = y;
  const bottom = top + opponents.length * ROW_HEIGHT;
  const axis = svg.append('g');
  for (const tick of [0, 25, 50, 75, 100]) {
    axis
      .append('line')
      .attr('x1', winScale(tick))
      .attr('x2', winScale(tick))
      .attr('y1', top)
      .attr('y2', bottom)
      .attr('stroke', tick === 50 ? theme.text2 : theme.grid)
      .attr('stroke-dasharray', tick === 50 ? '3 3' : null);
    axis
      .append('text')
      .attr('x', winScale(tick))
      .attr('y', bottom + 14)
      .attr('font-size', 10)
      .attr('fill', theme.muted)
      .attr('text-anchor', 'middle')
      .text(formatPct(tick, 0));
  }

  opponents.forEach((o, i) => {
    const cy = top + i * ROW_HEIGHT + ROW_HEIGHT / 2;
    const row = svg.append('g');
    const signal = winSignal(o);
    const fieldShare = report.field.get(o.key) ?? 0;
    hitArea(row, {
      x: 0,
      y: cy - ROW_HEIGHT / 2,
      width,
      height: ROW_HEIGHT,
      tip: [
        `${deckTitle(deck)} contre ${o.mirror ? 'lui-même (miroir)' : deckTitle(o)}`,
        `${formatPct(o.winRate)} de victoires`,
        `${formatInt(o.wins)} sur ${formatInt(o.matches)} matchs · IC 95 % ${formatPct(o.ci[0])}–${formatPct(o.ci[1])}`,
        `${formatPct(o.share)} de ses matchs, contre ${formatPct(fieldShare)} pour l'ensemble des joueurs`,
        o.perPlayer == null
          ? null
          : `Rencontré ${formatNumber1(o.perPlayer)} fois par joueur en moyenne`,
      ].filter(Boolean),
    });
    deckLabel(row, o, { x: col.deck, y: cy, theme });
    if (o.mirror) {
      row
        .append('text')
        .attr('x', col.deck + 30)
        .attr('y', cy + middle(10))
        .attr('font-size', 10)
        .attr('fill', theme.muted)
        .text('miroir');
    }

    row
      .append('path')
      .attr('d', horizontalBar(col.bar, cy - BAR_HEIGHT / 2, shareScale(o.share), BAR_HEIGHT))
      .attr('fill', theme.accent);
    // The field's share of this deck: what an average player met
    row
      .append('line')
      .attr('x1', col.bar + shareScale(fieldShare))
      .attr('x2', col.bar + shareScale(fieldShare))
      .attr('y1', cy - BAR_HEIGHT / 2 - 3)
      .attr('y2', cy + BAR_HEIGHT / 2 + 3)
      .attr('stroke', theme.text)
      .attr('stroke-width', 2);
    row
      .append('text')
      .attr('x', col.bar + col.barMax + 44)
      .attr('y', cy + middle(12))
      .attr('font-size', 12)
      .attr('fill', theme.text)
      .attr('text-anchor', 'end')
      .text(formatPct(o.share, 0));

    const number = (x, text, color = theme.text) =>
      row
        .append('text')
        .attr('x', x)
        .attr('y', cy + middle(12))
        .attr('font-size', 12)
        .attr('fill', color)
        .attr('text-anchor', 'end')
        .text(text);
    number(col.perPlayer, o.perPlayer == null ? '—' : formatNumber1(o.perPlayer));

    row
      .append('line')
      .attr('x1', winScale(o.ci[0]))
      .attr('x2', winScale(o.ci[1]))
      .attr('y1', cy)
      .attr('y2', cy)
      .attr('stroke', theme.axis)
      .attr('stroke-width', 2)
      .attr('stroke-linecap', 'round');
    row
      .append('circle')
      .attr('cx', winScale(o.winRate))
      .attr('cy', cy)
      .attr('r', 5)
      .attr('fill', signalColor[signal])
      .attr('stroke', theme.surface)
      .attr('stroke-width', 2);
    number(col.winRate, formatPct(o.winRate, 0), signal === 'neutral' ? theme.text2 : theme.text);
    number(col.matches, formatInt(o.matches), theme.text2);
  });

  const height = footer(svg, {
    y: bottom + 36,
    theme,
    note: `Trait noir : part de cet adversaire dans tous les matchs joués. Sur ${report.events} tournoi${report.events > 1 ? 's' : ''} dont les appariements sont connus.`,
    source: `Source : ${LORCANAHUNTER_URL.replace('https://', '')} · tournois core de plus de ${context.minPlayers} joueurs`,
  });
  return finalize(svg, height);
}
