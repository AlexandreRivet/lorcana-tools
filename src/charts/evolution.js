/**
 * "Évolution" (trends): a grid of small panels, one per deck, each with its play rate and win
 * rate over the last weeks on the same plot, on two scales: play rate on the left (blue,
 * filled), win rate on the right (orange, with the dashed 50% line). Every panel shares the
 * same two scales, written at the edges of each plot. Since the scales are independent, where
 * the curves cross means nothing; the footnote says so.
 */
import { area, extent, line, max, scaleLinear } from 'd3';
import { formatCount, formatDay, formatDelta, formatPct } from '../lib/format.js';
import { deckTitle } from '../lib/inks.js';
import {
  PAD,
  createSvg,
  deckLabel,
  finalize,
  fitText,
  footer,
  header,
  hitArea,
  middle,
} from './common.js';

const COLUMNS = 3;
const GAP_X = 24;
const GAP_Y = 22;
const PANEL_HEADER = 42;
const PLOT_HEIGHT = 84;
const GUTTER = 30;

/** Second series colour: categorical slot 2 (orange), validated next to the accent blue. */
const WIN_RATE_COLOR = { light: '#eb6834', dark: '#d95926' };

export function evolutionChart(report, { document, theme, width = 800 }) {
  const { decks, unit } = report;
  const { weeks, eraMarkers } = report.trend;
  const period = weeks.length > 1 ? `${weeks.length} dernières semaines` : 'semaine';
  const title = `Évolution — ${period}`;
  const svg = createSvg(document, { width, title, theme });
  const winColor = WIN_RATE_COLOR[theme.name] ?? WIN_RATE_COLOR.light;

  const eraNote = eraMarkers.length
    ? ` · trait vertical : sortie du ${eraMarkers.map((e) => e.name).join(', ')}`
    : '';
  let y = header(svg, {
    title,
    subtitle: `Popularité et win rate de chaque deck, semaine par semaine${eraNote}`,
    theme,
  });

  // Shared scales: play rate from 0, win rate from the rates themselves (wide intervals of small
  // decks would flatten every curve), always including 50 %.
  const points = decks.flatMap((d) => d.history);
  const rates = points.map((p) => p.winRate).filter((v) => v != null);
  const [lo, hi] = rates.length ? extent(rates) : [50, 50];
  const playY = scaleLinear()
    .domain([0, max(points, (p) => p.playRate) || 1])
    .nice(3)
    .range([PLOT_HEIGHT, 0]);
  const winY = scaleLinear()
    .domain([Math.min(lo - 2, 48), Math.max(hi + 2, 52)])
    .nice(3)
    .range([PLOT_HEIGHT, 0])
    .clamp(true);
  const [p0, p1] = playY.domain();
  const [w0, w1] = winY.domain();

  // Legend: a line key per series, with its scale
  y += 18;
  const key = (parent, kx, ky, color, length = 16) =>
    parent
      .append('line')
      .attr('x1', kx)
      .attr('x2', kx + length)
      .attr('y1', ky)
      .attr('y2', ky)
      .attr('stroke', color)
      .attr('stroke-width', 3)
      .attr('stroke-linecap', 'round');
  const legendItem = (lx, color, label) => {
    key(svg, lx, y, color);
    svg
      .append('text')
      .attr('x', lx + 22)
      .attr('y', y + middle(12))
      .attr('font-size', 12)
      .attr('fill', theme.text2)
      .text(label);
  };
  legendItem(
    PAD,
    theme.accent,
    `Popularité · échelle de gauche, ${formatPct(p0, 0)} – ${formatPct(p1, 0)}`,
  );
  legendItem(
    400,
    winColor,
    `Win rate · échelle de droite, ${formatPct(w0, 0)} – ${formatPct(w1, 0)}`,
  );

  const top = y + 22;
  const panelWidth = (width - 2 * PAD - (COLUMNS - 1) * GAP_X) / COLUMNS;
  const panelHeight = PANEL_HEADER + PLOT_HEIGHT + 18;
  const plotLeft = GUTTER;
  const plotRight = panelWidth - GUTTER;
  // A single week sits in the middle of the plot.
  const x = scaleLinear()
    .domain(weeks.length > 1 ? [0, weeks.length - 1] : [-1, 1])
    .range([plotLeft, plotRight]);

  decks.forEach((deck, i) => {
    const px = PAD + (i % COLUMNS) * (panelWidth + GAP_X);
    const py = top + Math.floor(i / COLUMNS) * (panelHeight + GAP_Y);
    const panel = svg.append('g').attr('transform', `translate(${px},${py})`);

    // Panel header: chips on the left; each series' value and change on the right
    deckLabel(panel, { ...deck, label: null }, { x: 0, y: 9, theme });
    // An archetype's name goes under its chips, clear of the play-rate change
    if (deck.label) {
      panel
        .append('text')
        .attr('x', 0)
        .attr('y', 27 + middle(11))
        .attr('font-size', 11)
        .attr('fill', theme.text)
        .text(fitText(deck.label, panelWidth - 94 - 52, 11))
        .append('title')
        .text(deckTitle(deck));
    }
    const values = [
      {
        color: theme.accent,
        value: deck.playRate,
        delta: deck.deltaPlayRate,
        change: deck.playRateChange,
        right: panelWidth - 94,
      },
      {
        color: winColor,
        value: deck.winRate,
        delta: deck.deltaWinRate,
        change: deck.winRateChange,
        right: panelWidth,
      },
    ];
    for (const v of values) {
      const text = formatPct(v.value);
      // Semibold 14px figures run ~8.4px each; leave a clear gap before the key
      key(panel, v.right - text.length * 8.4 - 20, 9, v.color, 10);
      panel
        .append('text')
        .attr('x', v.right)
        .attr('y', 9 + middle(14))
        .attr('font-size', 14)
        .attr('font-weight', 600)
        .attr('fill', theme.text)
        .attr('text-anchor', 'end')
        .text(text);
      const significant = v.change && v.change.signal !== 'flat';
      panel
        .append('text')
        .attr('x', v.right)
        .attr('y', 27 + middle(11))
        .attr('font-size', 11)
        .attr('font-weight', significant ? 600 : 400)
        .attr('fill', significant ? theme.text2 : theme.muted)
        .attr('text-anchor', 'end')
        .text(
          v.delta == null ? (report.previousWeek ? 'nouveau' : '—') : `${formatDelta(v.delta)} pt`,
        );
    }

    const plot = panel.append('g').attr('transform', `translate(0,${PANEL_HEADER})`);
    // Each scale's ends, on its own side of the plot
    const edge = (ex, ey, anchor, text) =>
      plot
        .append('text')
        .attr('x', ex)
        .attr('y', ey + middle(9))
        .attr('font-size', 9)
        .attr('fill', theme.muted)
        .attr('text-anchor', anchor)
        .text(text);
    edge(plotLeft - 4, 0, 'end', formatPct(p1, 0));
    edge(plotLeft - 4, PLOT_HEIGHT, 'end', formatPct(p0, 0));
    edge(plotRight + 4, 0, 'start', formatPct(w1, 0));
    edge(plotRight + 4, PLOT_HEIGHT, 'start', formatPct(w0, 0));

    plot
      .append('line')
      .attr('x1', plotLeft)
      .attr('x2', plotRight)
      .attr('y1', PLOT_HEIGHT)
      .attr('y2', PLOT_HEIGHT)
      .attr('stroke', theme.grid);
    // 50 % win rate, dashed as on the meta map
    plot
      .append('line')
      .attr('x1', plotLeft)
      .attr('x2', plotRight)
      .attr('y1', winY(50))
      .attr('y2', winY(50))
      .attr('stroke', theme.axis)
      .attr('stroke-dasharray', '4 3');
    for (const era of eraMarkers) {
      plot
        .append('line')
        .attr('x1', x(era.position))
        .attr('x2', x(era.position))
        .attr('y1', 0)
        .attr('y2', PLOT_HEIGHT)
        .attr('stroke', theme.axis);
      if (i === 0) {
        plot
          .append('text')
          .attr('x', x(era.position) + 4)
          .attr('y', 8)
          .attr('font-size', 10)
          .attr('fill', theme.muted)
          .text(era.name);
      }
    }

    const history = deck.history.map((p, idx) => ({ ...p, idx }));
    plot
      .append('path')
      .attr(
        'd',
        area()
          .x((p) => x(p.idx))
          .y0(playY(0))
          .y1((p) => playY(p.playRate))(history),
      )
      .attr('fill', theme.accent)
      .attr('fill-opacity', 0.1);
    const series = [
      { color: theme.accent, scale: playY, value: (p) => p.playRate },
      { color: winColor, scale: winY, value: (p) => p.winRate },
    ];
    for (const s of series) {
      plot
        .append('path')
        .attr(
          'd',
          line()
            .defined((p) => s.value(p) != null)
            .x((p) => x(p.idx))
            .y((p) => s.scale(s.value(p)))(history),
        )
        .attr('fill', 'none')
        .attr('stroke', s.color)
        .attr('stroke-width', 2)
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round');
      const last = history.findLast((p) => s.value(p) != null);
      if (last) {
        plot
          .append('circle')
          .attr('cx', x(last.idx))
          .attr('cy', s.scale(s.value(last)))
          .attr('r', 3.5)
          .attr('fill', s.color)
          .attr('stroke', theme.surface)
          .attr('stroke-width', 2);
      }
    }

    // Week labels: first and last week
    const labelY = PLOT_HEIGHT + 14;
    const labels =
      weeks.length > 1
        ? [
            { x: plotLeft, anchor: 'start', week: weeks[0] },
            { x: plotRight, anchor: 'end', week: weeks.at(-1) },
          ]
        : [{ x: x(0), anchor: 'middle', week: weeks[0] }];
    for (const label of labels) {
      plot
        .append('text')
        .attr('x', label.x)
        .attr('y', labelY)
        .attr('font-size', 10)
        .attr('fill', theme.muted)
        .attr('text-anchor', label.anchor)
        .text(formatDay(label.week));
    }

    // One hover area per week: readers aim at a date, not at a 2px line
    const step = weeks.length > 1 ? x(1) - x(0) : plotRight - plotLeft;
    for (const p of history) {
      hitArea(plot, {
        x: Math.max(plotLeft - step / 2, x(p.idx) - step / 2),
        y: 0,
        width: step,
        height: PLOT_HEIGHT,
        tip: [
          `${deckTitle(deck)} · semaine du ${formatDay(p.startDate)}`,
          `Popularité ${formatPct(p.playRate)} · win rate ${formatPct(p.winRate)}`,
          p.ci
            ? `IC 95 % du win rate : ${formatPct(p.ci[0])} – ${formatPct(p.ci[1])} · ${formatCount(
                p.games,
                unit,
              )}`
            : formatCount(p.games, unit),
        ],
      });
    }
  });

  const rows = Math.ceil(decks.length / COLUMNS);
  const bottom = top + rows * panelHeight + (rows - 1) * GAP_Y + 24;
  const height = footer(svg, {
    y: bottom,
    theme,
    updatedAt: report.week.updatedAt,
    sampleSize: report.trend.sampleSize,
    unit,
    note: `Deux échelles indépendantes : l'endroit où les courbes se croisent ne veut rien dire · pointillés : 50 % de victoires · semaines du ${formatDay(
      weeks[0],
    )} au ${formatDay(report.trend.endDate)}`,
  });
  return finalize(svg, height);
}
