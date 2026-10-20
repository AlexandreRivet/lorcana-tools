/**
 * Matchup matrix: win rate of the row deck against the column deck, summed over
 * several weeks. Diverging blue (favourable) ↔ red (unfavourable) scale centred on
 * 50%, cells greyed out when the sample is too small.
 */
import { interpolateLab, piecewise, rgb, scaleDiverging } from 'd3';
import { formatCount, formatDay, formatPct, formatWeekRange } from '../lib/format.js';
import { deckTitle } from '../lib/inks.js';
import {
  DECK_LABEL_WIDTH,
  PAD,
  createSvg,
  deckLabel,
  finalize,
  fitText,
  footer,
  header,
  middle,
  nameRoom,
  textWidth,
} from './common.js';

const LABEL_WIDTH = 40;
const CELL_HEIGHT = 40;
const COLUMN_HEADER = 30;
/** Height of the archetype names written upwards above the columns. */
const COLUMN_NAME_HEIGHT = 112;

/** Largest distance from 50% shown by the colour (beyond it, the colour saturates). */
export const MATCHUP_SPREAD = 10;

function luminance(color) {
  const { r, g, b } = rgb(color);
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** White or black text, whichever contrasts more with the fill. */
function inkOn(fill) {
  const l = luminance(fill);
  const contrastWhite = 1.05 / (l + 0.05);
  const contrastBlack = (l + 0.05) / (luminance('#0b0b0b') + 0.05);
  return contrastWhite >= contrastBlack ? '#ffffff' : '#0b0b0b';
}

export function matchupColorScale(theme) {
  return scaleDiverging(
    piecewise(interpolateLab, [theme.negative, theme.divergingMid, theme.positive]),
  )
    .domain([50 - MATCHUP_SPREAD, 50, 50 + MATCHUP_SPREAD])
    .clamp(true);
}

export function matchupsChart(report, { document, theme, width = 800 }) {
  const { decks, cells, weeks, sampleSize, updatedAt, endDate } = report.matchups;
  // Matchup figures: games by archetype, even in BO3
  const unit = report.matchups.unit ?? report.unit;
  const minGames = report.options.minMatchupGames;
  const title = `Matchups — ${weeks.length > 1 ? `${weeks.length} dernières semaines` : 'semaine'}`;
  const svg = createSvg(document, { width, title, theme });

  const top = header(svg, {
    title,
    subtitle: `Win rate du deck en ligne contre le deck en colonne · ${formatWeekRange(weeks[0], endDate)}`,
    theme,
  });

  const color = matchupColorScale(theme);
  // By archetype: names after the row chips, and written upwards above the column chips
  const room = nameRoom(decks);
  const gridLeft = PAD + LABEL_WIDTH + room;
  const cellWidth = Math.floor((width - PAD - gridLeft) / decks.length);
  const columnHeader = COLUMN_HEADER + (room ? COLUMN_NAME_HEIGHT : 0);
  const gridTop = top + columnHeader;

  // Column headers: the opponent's ink chips, with its name above when it has one
  decks.forEach((deck, j) => {
    const cx = gridLeft + j * cellWidth + cellWidth / 2;
    const chipsY = top + columnHeader - 20;
    deckLabel(svg, { ...deck, label: null }, { x: cx - DECK_LABEL_WIDTH / 2, y: chipsY, theme });
    if (deck.label) {
      svg
        .append('text')
        .attr('transform', `translate(${cx + middle(11)},${chipsY - 12}) rotate(-90)`)
        .attr('font-size', 11)
        .attr('fill', theme.text)
        .text(fitText(deck.label, COLUMN_NAME_HEIGHT - 4, 11))
        .append('title')
        .text(deckTitle(deck));
    }
  });

  const byKey = new Map(cells.map((c) => [`${c.row}|${c.col}`, c]));
  const nameOf = new Map(decks.map((d) => [d.key, deckTitle(d)]));

  decks.forEach((rowDeck, i) => {
    const rowTop = gridTop + i * CELL_HEIGHT;
    deckLabel(svg, rowDeck, {
      x: PAD,
      y: rowTop + CELL_HEIGHT / 2,
      theme,
      maxWidth: LABEL_WIDTH + room - DECK_LABEL_WIDTH - 6,
    });

    decks.forEach((colDeck, j) => {
      const cell = byKey.get(`${rowDeck.key}|${colDeck.key}`);
      const enough = cell.games >= minGames && cell.winRate != null;
      const fill = cell.mirror || !enough ? theme.divergingMid : color(cell.winRate);
      const x = gridLeft + j * cellWidth;
      const g = svg.append('g');

      const tip = [`${nameOf.get(cell.row)} contre ${nameOf.get(cell.col)}`];
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
        if (cell.onPlay?.winRate != null && cell.onDraw?.winRate != null) {
          tip.push(
            `En commençant : ${formatPct(cell.onPlay.winRate)} · en second : ${formatPct(cell.onDraw.winRate)}`,
          );
        }
        if (!enough) tip.push(`Moins de ${minGames} ${unit.many} : non coloré`);
        if (cell.trend) {
          tip.push(
            `Cette semaine : ${formatPct(cell.thisWeek.winRate)} sur ${formatCount(
              cell.thisWeek.games,
              unit,
            )}, ${cell.trend === 'up' ? 'nettement au-dessus' : 'nettement en dessous'} des semaines d'avant (${formatPct(cell.before.winRate)})`,
          );
        }
      }

      g.append('rect')
        .attr('class', 'cell')
        .attr('x', x + 1)
        .attr('y', rowTop + 1)
        .attr('width', cellWidth - 2)
        .attr('height', CELL_HEIGHT - 2)
        .attr('rx', 2)
        .attr('fill', fill)
        .attr('tabindex', 0)
        .attr('data-tip', tip.join('\n'));

      const label = cell.mirror ? 'miroir' : enough ? String(Math.round(cell.winRate)) : '—';
      const size = cell.mirror ? 10 : 13;
      g.append('text')
        .attr('x', x + cellWidth / 2)
        .attr('y', rowTop + CELL_HEIGHT / 2 + middle(size))
        .attr('font-size', size)
        .attr('font-weight', enough && !cell.mirror ? 500 : 400)
        .attr('fill', enough && !cell.mirror ? inkOn(fill) : theme.muted)
        .attr('text-anchor', 'middle')
        .attr('pointer-events', 'none')
        .text(label);

      // ▲ / ▼ in the corner: this week clearly above / below the window's earlier weeks
      if (cell.trend) {
        const cx = x + cellWidth - 9;
        const cy = rowTop + 9;
        const d = cell.trend === 'up' ? -1 : 1;
        g.append('path')
          .attr('d', `M${cx - 4},${cy - 2.5 * d}L${cx + 4},${cy - 2.5 * d}L${cx},${cy + 3.5 * d}Z`)
          .attr('fill', enough ? inkOn(fill) : theme.text)
          .attr('pointer-events', 'none');
      }
    });
  });

  // Legend: diverging gradient + what the neutral cells mean
  const legendTop = gridTop + decks.length * CELL_HEIGHT + 26;
  const gradientId = `matchup-gradient-${theme.name}`;
  const gradient = svg
    .append('defs')
    .append('linearGradient')
    .attr('id', gradientId)
    .attr('x1', '0%')
    .attr('x2', '100%');
  for (let k = 0; k <= 10; k++) {
    gradient
      .append('stop')
      .attr('offset', `${k * 10}%`)
      .attr('stop-color', color(50 - MATCHUP_SPREAD + (k * 2 * MATCHUP_SPREAD) / 10));
  }
  const legendWidth = 180;
  const legendLeft = PAD + textWidth('défavorable', 11) + 8;
  svg
    .append('text')
    .attr('x', PAD)
    .attr('y', legendTop + 5 + middle(11))
    .attr('font-size', 11)
    .attr('fill', theme.text2)
    .text('défavorable');
  svg
    .append('rect')
    .attr('x', legendLeft)
    .attr('y', legendTop)
    .attr('width', legendWidth)
    .attr('height', 10)
    .attr('rx', 2)
    .attr('fill', `url(#${gradientId})`);
  svg
    .append('text')
    .attr('x', legendLeft + legendWidth + 8)
    .attr('y', legendTop + 5 + middle(11))
    .attr('font-size', 11)
    .attr('fill', theme.text2)
    .text('favorable');
  [50 - MATCHUP_SPREAD, 50, 50 + MATCHUP_SPREAD].forEach((v, k) => {
    svg
      .append('text')
      .attr('x', legendLeft + (k * legendWidth) / 2)
      .attr('y', legendTop + 24)
      .attr('font-size', 10)
      .attr('fill', theme.muted)
      .attr('text-anchor', 'middle')
      .text(`${k === 0 ? '≤ ' : k === 2 ? '≥ ' : ''}${formatPct(v, 0)}`);
  });
  svg
    .append('text')
    .attr('x', legendLeft + legendWidth + 8 + textWidth('favorable', 11) + 24)
    .attr('y', legendTop + 5 + middle(11))
    .attr('font-size', 11)
    .attr('fill', theme.text2)
    .text(`— : moins de ${minGames} ${unit.many}`);

  // Key for the ▲ / ▼ flags, only on weeks that have some
  let footerTop = legendTop + 50;
  if (cells.some((c) => c.trend)) {
    const ky = legendTop + 46;
    for (const [i, d] of [-1, 1].entries()) {
      const cx = PAD + 4 + i * 12;
      svg
        .append('path')
        .attr('d', `M${cx - 4},${ky - 2.5 * d}L${cx + 4},${ky - 2.5 * d}L${cx},${ky + 3.5 * d}Z`)
        .attr('fill', theme.text2);
    }
    svg
      .append('text')
      .attr('x', PAD + 26)
      .attr('y', ky + middle(11))
      .attr('font-size', 11)
      .attr('fill', theme.text2)
      .text(
        "cette semaine nettement au-dessus / en dessous des semaines d'avant (IC 99,7 %, ≥ 5 pts)",
      );
    footerTop += 22;
  }

  const height = footer(svg, {
    y: footerTop,
    theme,
    updatedAt,
    sampleSize,
    unit,
    note: `Semaines du ${formatDay(weeks[0])} au ${formatDay(endDate)}${
      report.era ? ', sans remonter avant la sortie du set en cours' : ''
    }`,
  });
  return finalize(svg, height);
}
