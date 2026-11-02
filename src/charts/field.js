/**
 * "Ligne de départ et top cut" (starting field and top cut): two donuts, the share of each deck
 * among the players, then among the top cut. A slice wears its deck's inks, from the first to
 * the second along the arc, in the chips' order (a single ink fills it plain). The most played
 * decks are shown one by one, the others summed as "Autres", in the same order in both donuts.
 */
import { arc, pie } from 'd3';
import { LORCANAHUNTER_URL } from '../config.js';
import { formatInt, formatPct } from '../lib/format.js';
import { INKS, deckTitle } from '../lib/inks.js';
import { VIEWS, foldDecks } from '../lib/tournaments.js';
import { PAD, createSvg, deckLabel, finalize, footer, header, middle } from './common.js';

const OUTER = 104;
const INNER = 60;
const LEGEND_ROW = 26;

const otherTitle = (other) => `Autres (${other.count} decks)`;

// Gradient ids stay unique across charts redrawn on the same page
let gradientCount = 0;

/** A point of the donut at `angle` (d3's: 0 at the top, clockwise) and `radius`. */
const at = (angle, radius) => [radius * Math.sin(angle), -radius * Math.cos(angle)];

/**
 * A linear gradient from one ink to the other along a slice. SVG has no gradient that turns
 * around a circle: it runs along the slice's chord, the tangent at its middle. Past half a turn
 * the chord shrinks, so the gradient then spans the slice's widest extent along that tangent.
 */
function inkGradient(defs, { startAngle, endAngle }, from, to) {
  const mid = (startAngle + endAngle) / 2;
  const radius = (INNER + OUTER) / 2;
  const [p1, p2] =
    endAngle - startAngle <= Math.PI
      ? [at(startAngle, radius), at(endAngle, radius)]
      : [at(mid - Math.PI / 2, OUTER), at(mid + Math.PI / 2, OUTER)];
  const id = `ink-gradient-${++gradientCount}`;
  const gradient = defs
    .append('linearGradient')
    .attr('id', id)
    .attr('gradientUnits', 'userSpaceOnUse')
    .attr('x1', p1[0])
    .attr('y1', p1[1])
    .attr('x2', p2[0])
    .attr('y2', p2[1]);
  // Each ink keeps its own colour at its end: the blend only takes the middle
  for (const [offset, color] of [
    [0.15, from],
    [0.85, to],
  ]) {
    gradient.append('stop').attr('offset', offset).attr('stop-color', color);
  }
  return `url(#${id})`;
}

/** One donut: its slices, a title above and the head count in its hole. */
function donut(svg, slices, { cx, cy, value, title, total, totalLabel, theme }) {
  const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);
  g.append('text')
    .attr('y', -OUTER - 16)
    .attr('text-anchor', 'middle')
    .attr('font-size', 13)
    .attr('font-weight', 600)
    .attr('fill', theme.text)
    .text(title);

  const arcs = pie().value(value).sort(null).padAngle(0.012)(slices.filter((s) => value(s) > 0));
  const ring = (inner, outer) => arc().innerRadius(inner).outerRadius(outer);
  const whole = ring(INNER, OUTER);
  const defs = g.append('defs');
  for (const a of arcs) {
    const s = a.data;
    if (s.colors) {
      const [first, second = first] = s.colors.map((ink) => INKS[ink]?.color ?? theme.neutral);
      const fill = first === second ? first : inkGradient(defs, a, first, second);
      g.append('path').attr('d', whole(a)).attr('fill', fill);
    } else {
      // "Autres": hollow, so that no grey reads as the steel ink
      g.append('path')
        .attr('d', ring(INNER + 1, OUTER - 1)(a))
        .attr('fill', 'none')
        .attr('stroke', theme.muted)
        .attr('stroke-width', 1.5);
    }
    // Hover area over the whole slice, the hollow "Autres" included
    g.append('path')
      .attr('class', 'hit')
      .attr('d', whole(a))
      .attr('fill', 'transparent')
      .attr('tabindex', 0)
      .attr('data-tip', [`${title} · ${s.title}`, formatPct(value(s)), s.detail(title)].join('\n'));
  }

  g.append('text')
    .attr('y', middle(22) - 8)
    .attr('text-anchor', 'middle')
    .attr('font-size', 22)
    .attr('font-weight', 600)
    .attr('fill', theme.text)
    .text(formatInt(total));
  g.append('text')
    .attr('y', middle(11) + 12)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .attr('fill', theme.text2)
    .text(totalLabel);
}

/**
 * @param {object} report fieldReport()
 * @param {object} context { period: "19 oct. – 2 nov. 2026", events, updatedAt }
 */
export function fieldChart(report, context, { document, theme, width = 800 }) {
  const title = 'Ligne de départ et top cut';
  const svg = createSvg(document, { width, title, theme });
  const { shown, other } = foldDecks(report.decks);

  let y = header(svg, {
    title,
    subtitle: `${context.period} · ${report.events} tournois · ${formatInt(report.known)} decks connus, dont ${formatInt(report.knownCut)} au top cut`,
    theme,
  });

  const slices = [
    ...shown.map((d) => ({
      ...d,
      title: deckTitle(d),
      detail: (side) =>
        side === 'Top cut'
          ? `${formatInt(d.topCut)} joueurs au top cut sur ${formatInt(d.players)}`
          : `${formatInt(d.players)} joueurs`,
    })),
    ...(other
      ? [
          {
            ...other,
            colors: null,
            title: otherTitle(other),
            detail: (side) =>
              side === 'Top cut'
                ? `${formatInt(other.topCut)} joueurs au top cut`
                : `${formatInt(other.players)} joueurs`,
          },
        ]
      : []),
  ];

  y += 30;
  const cy = y + OUTER;
  donut(svg, slices, {
    cx: width / 4 + 8,
    cy,
    value: (s) => s.share,
    title: 'Ligne de départ',
    total: report.known,
    totalLabel: 'joueurs',
    theme,
  });
  donut(svg, slices, {
    cx: (3 * width) / 4 - 8,
    cy,
    value: (s) => s.cutShare,
    title: 'Top cut',
    total: report.knownCut,
    totalLabel: 'au top cut',
    theme,
  });
  y = cy + OUTER + 36;

  // Legend in two columns, figures beside each deck: share at the start, then in the top cut
  const colWidth = (width - 2 * PAD - 32) / 2;
  const perColumn = Math.ceil(slices.length / 2);
  const columnHeader = (x, text, anchor) =>
    svg
      .append('text')
      .attr('x', x)
      .attr('y', y)
      .attr('font-size', 11)
      .attr('font-weight', 500)
      .attr('fill', theme.muted)
      .attr('text-anchor', anchor)
      .text(text);
  for (let c = 0; c < Math.min(2, slices.length); c++) {
    const x = PAD + c * (colWidth + 32);
    columnHeader(x, 'DECK', 'start');
    columnHeader(x + colWidth - 72, 'DÉPART', 'end');
    columnHeader(x + colWidth, 'TOP CUT', 'end');
  }
  y += 10;
  slices.forEach((s, i) => {
    const x = PAD + Math.floor(i / perColumn) * (colWidth + 32);
    const cy = y + (i % perColumn) * LEGEND_ROW + LEGEND_ROW / 2;
    if (s.colors) {
      deckLabel(svg, s, { x, y: cy, theme, maxWidth: colWidth - 170 });
    } else {
      svg
        .append('circle')
        .attr('cx', x + 6)
        .attr('cy', cy)
        .attr('r', 5.25)
        .attr('fill', 'none')
        .attr('stroke', theme.muted)
        .attr('stroke-width', 1.5);
      svg
        .append('text')
        .attr('x', x + 18)
        .attr('y', cy + middle(11))
        .attr('font-size', 11)
        .attr('fill', theme.text)
        .text(s.title);
    }
    for (const [dx, v] of [
      [colWidth - 72, s.share],
      [colWidth, s.cutShare],
    ]) {
      svg
        .append('text')
        .attr('x', x + dx)
        .attr('y', cy + middle(12))
        .attr('font-size', 12)
        .attr('fill', theme.text)
        .attr('text-anchor', 'end')
        .attr('font-variant-numeric', 'tabular-nums')
        .text(formatPct(v));
    }
  });
  y += perColumn * LEGEND_ROW + 28;

  const height = footer(svg, {
    y,
    theme,
    note:
      report.coverage < 1
        ? `Sur les joueurs dont le deck est ${report.view === VIEWS.archetypes ? 'rattaché à un archétype' : 'connu'} (${formatPct(100 * report.coverage, 0)} des ${formatInt(report.players)} joueurs).`
        : null,
    source: `Source : ${LORCANAHUNTER_URL.replace('https://', '')} · tournois core de plus de ${context.minPlayers} joueurs`,
  });
  return finalize(svg, height);
}
