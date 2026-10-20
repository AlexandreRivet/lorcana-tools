/**
 * "Carte du méta" (meta map): each deck drawn as its ink chips at (play rate, win rate), with an
 * arrow from where it stood the previous week. A dashed line marks 50% win rate and the median
 * play rate splits popular decks from rarely played ones: top right is popular and strong, top
 * left rarely played but strong. Deck names are in the tooltips and the table view.
 */
import { max, median, min, scaleLinear } from 'd3';
import { formatCount, formatPct, formatWeek } from '../lib/format.js';
import { INKS, deckTitle } from '../lib/inks.js';
import {
  PAD,
  createSvg,
  finalize,
  fitText,
  footer,
  header,
  inkChips,
  middle,
  textWidth,
} from './common.js';

const PLOT_HEIGHT = 400;
/** Archetype names on the map: small, and cut short so they don't hide other decks. */
const MAP_NAME_SIZE = 10;
const MAP_NAME_WIDTH = 110;
const LEFT = 64;
const CHIP_R = 6;
/** Width of a deck's chips: two overlapping circles (or one for a mono-ink deck). */
const chipsWidth = (colors) => CHIP_R * 2 + (colors.length - 1) * (CHIP_R * 2 - 1);

export function metaMapChart(report, { document, theme, width = 800 }) {
  const { decks, week, unit } = report;
  const title = 'Carte du méta';
  const svg = createSvg(document, { width, title, theme });

  const top =
    header(svg, {
      title,
      subtitle: `${report.queueName} · ${formatWeek(week)}`,
      theme,
    }) + 28;

  const plot = { x0: PAD + LEFT, x1: width - PAD, y0: top, y1: top + PLOT_HEIGHT };
  const x = scaleLinear()
    .domain([0, max(decks, (d) => Math.max(d.playRate, d.previous?.playRate ?? 0)) * 1.05])
    .nice()
    .range([plot.x0, plot.x1]);
  const y = scaleLinear()
    .domain([
      Math.min(48, min(decks, (d) => Math.min(d.winRate, d.previous?.winRate ?? 100)) - 1),
      Math.max(52, max(decks, (d) => Math.max(d.winRate, d.previous?.winRate ?? 0)) + 1),
    ])
    .nice()
    .range([plot.y1, plot.y0])
    .clamp(true);

  const axisText = (selection) => selection.attr('font-size', 10).attr('fill', theme.muted);

  // Gridlines and axes; 50 % gets its own dashed line below
  for (const t of y.ticks(5)) {
    if (t !== 50) {
      svg
        .append('line')
        .attr('x1', plot.x0)
        .attr('x2', plot.x1)
        .attr('y1', y(t))
        .attr('y2', y(t))
        .attr('stroke', theme.grid);
    }
    svg
      .append('text')
      .attr('x', plot.x0 - 8)
      .attr('y', y(t) + middle(10))
      .attr('text-anchor', 'end')
      .call(axisText)
      .text(formatPct(t, 0));
  }
  svg
    .append('line')
    .attr('x1', plot.x0)
    .attr('x2', plot.x1)
    .attr('y1', plot.y1)
    .attr('y2', plot.y1)
    .attr('stroke', theme.axis);
  for (const t of x.ticks(6)) {
    svg
      .append('text')
      .attr('x', x(t))
      .attr('y', plot.y1 + 16)
      .attr('text-anchor', 'middle')
      .call(axisText)
      .text(formatPct(t, 0));
  }
  svg
    .append('text')
    .attr('x', plot.x1)
    .attr('y', plot.y1 + 32)
    .attr('text-anchor', 'end')
    .attr('font-size', 11)
    .attr('fill', theme.text2)
    .text('Popularité →');
  svg
    .append('text')
    .attr('x', PAD)
    .attr('y', plot.y0 - 14)
    .attr('font-size', 11)
    .attr('fill', theme.text2)
    .text('↑ Win rate');

  // Median play rate: splits popular decks from the rarely played ones
  const medianPlayRate = median(decks, (d) => d.playRate);
  svg
    .append('line')
    .attr('x1', x(medianPlayRate))
    .attr('x2', x(medianPlayRate))
    .attr('y1', plot.y0)
    .attr('y2', plot.y1)
    .attr('stroke', theme.axis);
  svg
    .append('text')
    .attr('x', x(medianPlayRate))
    .attr('y', plot.y1 + 32)
    .attr('text-anchor', 'middle')
    .call(axisText)
    .text(`médiane ${formatPct(medianPlayRate)}`);

  // 50 % win rate: the threshold, dashed
  svg
    .append('line')
    .attr('x1', plot.x0)
    .attr('x2', plot.x1)
    .attr('y1', y(50))
    .attr('y2', y(50))
    .attr('stroke', theme.text2)
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '6 4');

  // Decks on exactly the same spot (tiny samples: 0 % or 100 %) are laid side by side
  const spots = [];
  for (const deck of decks) {
    const px = x(deck.playRate);
    const py = y(deck.winRate);
    const spot = spots.find((s) => Math.abs(s.x - px) < 2 && Math.abs(s.y - py) < 2);
    if (spot) spot.decks.push(deck);
    else spots.push({ x: px, y: py, decks: [deck] });
  }
  const markers = spots.flatMap((spot) => {
    // Clearly wider than the 1px overlap between a deck's own chips
    const gap = 9;
    const total =
      spot.decks.reduce((sum, d) => sum + chipsWidth(d.colors), 0) + gap * (spot.decks.length - 1);
    let left = spot.x - total / 2;
    return spot.decks.map((deck) => {
      const w = chipsWidth(deck.colors);
      const marker = { deck, x: left + w / 2, y: spot.y, left, width: w };
      left += w + gap;
      return marker;
    });
  });

  // Arrows first, so the chips sit on top: from last week's position to this week's, in the
  // deck's colours (first ink at the start, second at the chips) so close arrows stay apart
  const defs = svg.append('defs');
  for (const m of markers) {
    const { deck } = m;
    if (!deck.previous) continue;
    const fromX = x(deck.previous.playRate);
    const fromY = y(deck.previous.winRate);
    const dx = m.x - fromX;
    const dy = m.y - fromY;
    const length = Math.hypot(dx, dy);
    if (length < 16) continue;
    const ux = dx / length;
    const uy = dy / length;
    // Stop short of the chips, and draw the head by hand (no SVG markers needed)
    const tipX = m.x - ux * (m.width / 2 + 3);
    const tipY = m.y - uy * (m.width / 2 + 3);
    const [first, second = first] = deck.colors.map((ink) => INKS[ink]?.color ?? theme.text2);
    let stroke = first;
    if (second !== first) {
      // In user space: a bounding-box gradient would vanish on a horizontal or vertical line
      const id = `arrow-${theme.name}-${deck.key.replace(/\W/g, '-')}`;
      const gradient = defs
        .append('linearGradient')
        .attr('id', id)
        .attr('gradientUnits', 'userSpaceOnUse')
        .attr('x1', fromX)
        .attr('y1', fromY)
        .attr('x2', tipX)
        .attr('y2', tipY);
      gradient.append('stop').attr('offset', '0%').attr('stop-color', first);
      gradient.append('stop').attr('offset', '100%').attr('stop-color', second);
      stroke = `url(#${id})`;
    }
    const arrow = svg.append('g').attr('opacity', 0.9);
    arrow
      .append('circle')
      .attr('cx', fromX)
      .attr('cy', fromY)
      .attr('r', 3)
      .attr('fill', 'none')
      .attr('stroke', first)
      .attr('stroke-width', 1.5);
    arrow
      .append('line')
      .attr('x1', fromX + ux * 3)
      .attr('y1', fromY + uy * 3)
      .attr('x2', tipX - ux * 5)
      .attr('y2', tipY - uy * 5)
      .attr('stroke', stroke)
      .attr('stroke-width', 2);
    arrow
      .append('path')
      .attr(
        'd',
        `M${tipX},${tipY}L${tipX - ux * 6 - uy * 3.5},${tipY - uy * 6 + ux * 3.5}L${
          tipX - ux * 6 + uy * 3.5
        },${tipY - uy * 6 - ux * 3.5}Z`,
      )
      .attr('fill', second);
  }

  // Archetype names next to the chips: right, left, above or below, wherever nothing is
  // drawn yet; a name with no room left stays in the tooltip.
  const taken = markers.map((m) => ({
    x0: m.left - 2,
    x1: m.left + m.width + 2,
    y0: m.y - 8,
    y1: m.y + 8,
  }));
  const overlaps = (box) =>
    taken.some((t) => box.x0 < t.x1 && box.x1 > t.x0 && box.y0 < t.y1 && box.y1 > t.y0);
  for (const m of [...markers].sort((a, b) => b.deck.playRate - a.deck.playRate)) {
    if (!m.deck.label) continue;
    const text = fitText(m.deck.label, MAP_NAME_WIDTH, MAP_NAME_SIZE);
    const w = textWidth(text, MAP_NAME_SIZE);
    const h = MAP_NAME_SIZE + 2;
    const spots = [
      { x: m.left + m.width + 4, y: m.y, anchor: 'start' },
      { x: m.left - 4, y: m.y, anchor: 'end' },
      { x: m.x, y: m.y - 14, anchor: 'middle' },
      { x: m.x, y: m.y + 14, anchor: 'middle' },
    ];
    for (const spot of spots) {
      const x0 =
        spot.anchor === 'start' ? spot.x : spot.anchor === 'end' ? spot.x - w : spot.x - w / 2;
      const box = { x0, x1: x0 + w, y0: spot.y - h / 2, y1: spot.y + h / 2 };
      const inside =
        box.x0 >= plot.x0 && box.x1 <= plot.x1 && box.y0 >= plot.y0 && box.y1 <= plot.y1;
      if (!inside || overlaps(box)) continue;
      taken.push(box);
      svg
        .append('text')
        .attr('x', spot.x)
        .attr('y', spot.y + middle(MAP_NAME_SIZE))
        .attr('font-size', MAP_NAME_SIZE)
        .attr('fill', theme.text2)
        // A halo in the background colour keeps the name readable over an arrow
        .attr('stroke', theme.surface)
        .attr('stroke-width', 3)
        .attr('stroke-linejoin', 'round')
        .attr('paint-order', 'stroke')
        .attr('text-anchor', spot.anchor)
        .attr('pointer-events', 'none')
        .text(text);
      break;
    }
  }

  // Most played first, so the smaller decks end up on top where markers overlap
  for (const m of [...markers].sort((a, b) => b.deck.playRate - a.deck.playRate)) {
    const { deck } = m;
    inkChips(svg, deck.colors, { x: m.left, y: m.y, theme, r: CHIP_R });
    // Hit target around the chips, carrying the tooltip on the page
    svg
      .append('rect')
      .attr('class', 'hit')
      .attr('x', m.left - 6)
      .attr('y', m.y - 12)
      .attr('width', m.width + 12)
      .attr('height', 24)
      .attr('rx', 12)
      .attr('fill', 'transparent')
      .attr('tabindex', 0)
      .attr(
        'data-tip',
        [
          deckTitle(deck),
          `${formatPct(deck.winRate)} de victoires`,
          `IC 95 % : ${formatPct(deck.ci[0])} – ${formatPct(deck.ci[1])}`,
          `${formatPct(deck.playRate)} des decks · ${formatCount(deck.games, unit)}`,
          deck.previous
            ? `Semaine précédente : ${formatPct(deck.previous.playRate)} des decks, ${formatPct(
                deck.previous.winRate,
              )} de victoires`
            : 'Absent la semaine précédente',
        ].join('\n'),
      );
  }

  const height = footer(svg, {
    y: plot.y1 + 62,
    theme,
    updatedAt: week.updatedAt,
    sampleSize: week.sampleSize,
    unit,
    note: 'Pastilles : encres du deck · flèche aux couleurs du deck : depuis la semaine précédente · pointillés : 50 % de victoires',
  });
  return finalize(svg, height);
}
