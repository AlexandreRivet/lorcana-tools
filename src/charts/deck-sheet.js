/**
 * Deck sheet: one deck's win rate against every other deck over the matchup window, as bars
 * growing from 50% (right = favourable, left = unfavourable), with the 95% interval. Opponents
 * are listed most played first: the ones you'll face most come first.
 */
import { scaleLinear } from 'd3';
import { formatCount, formatInt, formatPct, formatWeekRange } from '../lib/format.js';
import { deckTitle } from '../lib/inks.js';
import { wilson } from '../lib/metrics.js';
import {
  PAD,
  barPath,
  createSvg,
  deckLabel,
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
const BAR_HEIGHT = 14;

export const MATCHUP_SIGNAL_LABELS = {
  above: 'Favorable',
  neutral: "Pas d'écart significatif",
  below: 'Défavorable',
};

export function deckSheetChart(report, deckKey, { document, theme, width = 800 }) {
  const { decks } = report;
  const deck = decks.find((d) => d.key === deckKey) ?? decks[0];
  const { cells, weeks, endDate, sampleSize, updatedAt } = report.matchups;
  // Matchup figures: games by archetype, even in BO3
  const unit = report.matchups.unit ?? report.unit;
  const minGames = report.options.minMatchupGames;
  const name = deckTitle(deck);
  // The <title> keeps the name; the visible title shows the deck's chips
  const svg = createSvg(document, { width, title: `Fiche deck : ${name}`, theme });

  let y = header(svg, {
    title: 'Fiche deck',
    subtitle: `Win rate contre chaque deck · ${report.queueName} · ${formatWeekRange(
      weeks[0],
      endDate,
    )}`,
    theme,
  });

  // Chips, and the archetype's name when there is one
  deckLabel(svg, deck, {
    x: PAD + textWidth('Fiche deck', 20) + 14,
    y: PAD + 16 - middle(20),
    theme,
    r: 8,
    size: 16,
    maxWidth: width - 2 * PAD - textWidth('Fiche deck', 20) - 50,
  });

  const { onPlay, onDraw } = deck.playDraw;
  const games = onPlay.games + onDraw.games;
  if (games) {
    const overall = (100 * (onPlay.wins + onDraw.wins)) / games;
    svg
      .append('text')
      .attr('x', PAD)
      .attr('y', y + 2)
      .attr('font-size', 13)
      .attr('fill', theme.text2)
      .text(
        `${formatPct(overall)} de victoires sur la période · en commençant ${formatPct(
          onPlay.winRate,
        )} · en second ${formatPct(onDraw.winRate)}`,
      );
    y += 20;
  }

  const byKey = new Map(cells.map((c) => [`${c.row}|${c.col}`, c]));
  const rows = decks.map((opponent) => {
    const cell = byKey.get(`${deck.key}|${opponent.key}`);
    const enough = !cell.mirror && cell.winRate != null && cell.games >= minGames;
    const ci = enough ? wilson((cell.winRate * cell.games) / 100, cell.games) : null;
    const signal = !ci ? null : ci[0] > 50 ? 'above' : ci[1] < 50 ? 'below' : 'neutral';
    return { opponent, cell, enough, ci, signal };
  });

  const room = nameRoom(decks);
  const col = {
    deck: PAD,
    freq: 110 + room,
    plotFrom: 138 + room,
    plotTo: 610,
    value: 690,
    games: width - PAD,
  };
  const spread = Math.min(
    50,
    Math.max(10, ...rows.filter((r) => r.ci).map((r) => Math.max(50 - r.ci[0], r.ci[1] - 50))),
  );
  const half = Math.ceil(spread / 5) * 5;
  const x = scaleLinear()
    .domain([50 - half, 50 + half])
    .range([col.plotFrom, col.plotTo])
    .clamp(true);
  const signalColor = { above: theme.positive, neutral: theme.neutral, below: theme.negative };

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
  columnHeader(col.deck, 'CONTRE');
  columnHeader(col.freq, 'FRÉQ.', 'end');
  columnHeader(col.plotFrom, 'WIN RATE · IC 95 %');
  columnHeader(col.games, unit.many.toUpperCase(), 'end');

  const top = y + 10;
  const rowsHeight = rows.length * ROW_HEIGHT;
  for (const t of [50 - half, 50, 50 + half]) {
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

  rows.forEach(({ opponent, cell, enough, ci, signal }, i) => {
    const rowTop = top + i * ROW_HEIGHT;
    const cy = rowTop + ROW_HEIGHT / 2;
    const row = svg.append('g');
    const opponentName = deckTitle(opponent);

    if (i > 0) {
      row
        .append('line')
        .attr('x1', PAD)
        .attr('x2', width - PAD)
        .attr('y1', rowTop)
        .attr('y2', rowTop)
        .attr('stroke', theme.grid);
    }
    deckLabel(row, opponent, { x: col.deck, y: cy, theme });
    row
      .append('text')
      .attr('x', col.freq)
      .attr('y', cy + middle(12))
      .attr('font-size', 12)
      .attr('fill', theme.text2)
      .attr('text-anchor', 'end')
      .text(formatPct(opponent.playRate));

    if (enough) {
      row
        .append('path')
        .attr('d', barPath(x(50), x(cell.winRate), cy - BAR_HEIGHT / 2, BAR_HEIGHT))
        .attr('fill', signalColor[signal]);
      row
        .append('line')
        .attr('x1', x(ci[0]))
        .attr('x2', x(ci[1]))
        .attr('y1', cy)
        .attr('y2', cy)
        .attr('stroke', theme.text)
        .attr('stroke-opacity', 0.55)
        .attr('stroke-width', 1.5)
        .attr('stroke-linecap', 'round');
    }
    row
      .append('text')
      .attr('x', col.value)
      .attr('y', cy + middle(13))
      .attr('font-size', cell.mirror ? 11 : 13)
      .attr('font-weight', enough ? 500 : 400)
      .attr('fill', enough ? theme.text : theme.muted)
      .attr('text-anchor', 'end')
      .text(cell.mirror ? 'miroir' : enough ? formatPct(cell.winRate) : '—');
    row
      .append('text')
      .attr('x', col.games)
      .attr('y', cy + middle(12))
      .attr('font-size', 12)
      .attr('fill', theme.text2)
      .attr('text-anchor', 'end')
      .text(formatInt(cell.games));

    const tip = [`${name} contre ${opponentName}`];
    if (cell.mirror) {
      tip.push(
        cell.onPlay?.winRate != null
          ? `Miroir · ${formatPct(cell.onPlay.winRate)} pour le joueur qui commence`
          : 'Miroir',
        formatCount(cell.games, unit),
      );
    } else if (cell.winRate == null) {
      tip.push('Jamais joué sur la période');
    } else {
      tip.push(`${formatPct(cell.winRate)} de victoires sur ${formatCount(cell.games, unit)}`);
      if (ci) tip.push(`IC 95 % : ${formatPct(ci[0])} – ${formatPct(ci[1])}`);
      if (cell.onPlay?.winRate != null && cell.onDraw?.winRate != null) {
        tip.push(
          `En commençant : ${formatPct(cell.onPlay.winRate)} · en second : ${formatPct(cell.onDraw.winRate)}`,
        );
      }
      if (!enough) tip.push(`Moins de ${minGames} ${unit.many} : pas assez pour conclure`);
    }
    tip.push(`${opponentName} : ${formatPct(opponent.playRate)} des decks`);
    hitArea(row, { x: PAD, y: rowTop, width: width - 2 * PAD, height: ROW_HEIGHT, tip });
  });

  // Legend
  const ly = top + rowsHeight + 40;
  let lx = PAD;
  for (const signal of ['above', 'neutral', 'below']) {
    lx +=
      legendDot(svg, {
        x: lx,
        y: ly,
        color: signalColor[signal],
        label: MATCHUP_SIGNAL_LABELS[signal],
        theme,
      }) + 20;
  }

  const height = footer(svg, {
    y: ly + 30,
    theme,
    updatedAt,
    sampleSize,
    unit,
    note: `Fréq. : part des decks joués la dernière semaine · — : moins de ${minGames} ${unit.many} · trait : IC 95 %`,
  });
  return finalize(svg, height);
}
