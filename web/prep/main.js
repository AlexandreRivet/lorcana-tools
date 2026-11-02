import { config } from '../../src/config.js';
import {
  OTHER,
  VIEWS,
  adaptField,
  applyOverrides,
  cardPerformance,
  deckLists,
  deckOpenings,
  fieldWinRate,
  fieldWinRates,
  forecastField,
  gameRates,
  isRest,
  keyCards,
  ladderCards,
  ladderSignature,
  mulliganGuide,
  matchMatrix,
  quantile,
  random,
  reconcileArchetypes,
  sampleRates,
  withEdge,
} from '../../src/lib/forecast.js';
import { variantSummary } from '../../src/lib/archetypes.js';
import { formatInt, formatPct, formatUpdatedAt } from '../../src/lib/format.js';
import { INKS, deckName } from '../../src/lib/inks.js';
import { isWeekComplete } from '../../src/lib/queues.js';
import { eventsSince } from '../../src/lib/tournaments.js';

// Collected data is served at the site root (publicDir in vite.config.js), one level above this
// page: relative URLs keep working wherever the site is hosted.
const DATA_URL = '../';
const LADDER_QUEUE = config.queues.find((q) => q.includes('bo1'));
const { prep } = config;
const $ = (id) => document.getElementById(id);

const state = readUrlState();
let data = null;
let current = null;
// The last simulation, for the field it was run on (`signature`)
let simulation = null;
let worker = null;
let timer = null;

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (text != null) node.textContent = text;
  return node;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok)
    throw Object.assign(new Error(`HTTP ${res.status} on ${url}`), { status: res.status });
  return res.json();
}

// --- State in the URL: the blend, the adaptation, the field size, the overrides, the team's edges
// and the deck of the sheet ---

/** "amber/emerald:20,emerald/steel:15" → { 'amber/emerald': 20, 'emerald/steel': 15 } */
function readPairs(value) {
  const pairs = {};
  for (const pair of value?.split(',') ?? []) {
    const [key, number] = pair.split(':');
    if (key && Number.isFinite(Number(number))) pairs[key] = Number(number);
  }
  return pairs;
}

const writePairs = (pairs) =>
  Object.entries(pairs)
    .map(([k, v]) => `${k}:${v}`)
    .join(',');

function readUrlState() {
  const params = new URLSearchParams(location.search);
  const weight = Number(params.get('w'));
  const adaptation = Number(params.get('a'));
  const players = Number(params.get('n'));
  return {
    weight: params.has('w') && weight >= 0 && weight <= 1 ? weight : prep.tournamentWeight,
    adaptation:
      params.has('a') && adaptation >= 0 && adaptation <= 1 ? adaptation : prep.adaptation,
    players: players >= 16 ? Math.round(players) : prep.players,
    overrides: readPairs(params.get('f')),
    edges: readPairs(params.get('e')),
    deck: params.get('deck'),
  };
}

function writeUrlState() {
  const params = new URLSearchParams();
  if (state.weight !== prep.tournamentWeight) params.set('w', state.weight);
  if (state.adaptation !== prep.adaptation) params.set('a', state.adaptation);
  if (state.players !== prep.players) params.set('n', state.players);
  if (Object.keys(state.overrides).length) params.set('f', writePairs(state.overrides));
  if (Object.keys(state.edges).length) params.set('e', writePairs(state.edges));
  if (state.deck) params.set('deck', state.deck);
  const query = params.toString();
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
}

// --- Decks ---

/**
 * A deck as its ink chips. The name stays available: hidden text for screen readers (and
 * copy-paste), and a tooltip on hover. The decks summed as "Autres" have no chips.
 */
function chips(colors) {
  const wrapper = el('span', { class: 'chips', title: deckName(colors) });
  for (const ink of colors) {
    const chip = el('span', { class: 'chip', 'aria-hidden': 'true' });
    chip.style.background = INKS[ink]?.color ?? 'gray';
    wrapper.append(chip);
  }
  wrapper.append(el('span', { class: 'sr-only' }, deckName(colors)));
  return wrapper;
}

/** A deck in a table: its chips, then its archetype's name (by inks, the inks' names). */
function deckCell(deck) {
  if (deck.key === OTHER) return el('span', {}, 'Petits decks');
  const wrapper = el('span', { class: 'deck-cell' });
  wrapper.append(chips(deck.colors), el('span', {}, deck.label ?? deckName(deck.colors)));
  return wrapper;
}

/** A deck in text: its archetype's name with its inks, or its inks. */
function deckLabel(deck) {
  if (deck.key === OTHER) return 'Petits decks';
  if (isRest(deck.key)) return `Autres listes ${deckName(deck.colors)}`;
  return deck.name ?? deckName(deck.colors);
}

// --- Tables ---

/** A rate (%) as a thin bar scaled to `max`, then its value. */
function rateCell(value, max, digits = 1) {
  const wrapper = el('span', { class: 'rate' });
  const track = el('span', { class: 'presence-track', 'aria-hidden': 'true' });
  const fill = el('span', { class: 'presence-fill' });
  fill.style.width = `${Math.min(100, (100 * value) / max)}%`;
  track.append(fill);
  wrapper.append(track, el('span', {}, formatPct(value, digits)));
  return wrapper;
}

/** A match win rate (%), coloured above or below 50 %. */
function winCell(value, digits = 1) {
  const tone = value >= 50.5 ? 'good' : value <= 49.5 ? 'bad' : '';
  return el('span', tone ? { class: tone } : {}, formatPct(value, digits));
}

/** "51,2–55,0": a range of percentages, without the unit. */
const rangeText = ([low, high], digits = 1) =>
  `${low.toFixed(digits).replace('.', ',')}–${high.toFixed(digits).replace('.', ',')}`;

/** A figure, then its range in small muted type (the matchups' uncertainty, see uncertainty()). */
function withRange(node, bounds, digits = 1) {
  const wrapper = el('span', { class: 'with-range' });
  const note = el('span', { class: 'range' }, rangeText(bounds, digits));
  note.title = `${Math.round(100 * prep.uncertaintyLevel)} % de chances d’être dans cette fourchette, vu le nombre de parties derrière les matchups`;
  wrapper.append(node, note);
  return wrapper;
}

/** Win-rate points (+0,85 / −1,20), coloured by their sign. */
function pointsCell(points) {
  const text = `${points >= 0 ? '+' : '−'}${Math.abs(points).toFixed(2).replace('.', ',')}`;
  const tone = points >= 0.05 ? 'good' : points <= -0.05 ? 'bad' : '';
  return el('span', tone ? { class: tone } : {}, text);
}

/** A column's classes: `num` right-aligns it, `print` shows it on paper only. */
const columnClass = (c) => ({
  ...(c?.num || c?.print
    ? { class: [c.num && 'num', c.print && 'print-only'].filter(Boolean).join(' ') }
    : {}),
});

function table(headers, rows) {
  const scroll = el('div', { class: 'table-scroll' });
  const t = el('table');
  const head = el('tr');
  for (const h of headers) {
    const th = el('th', { scope: 'col', ...columnClass(h) }, h.label);
    if (h.title) th.title = h.title;
    head.append(th);
  }
  t.append(el('thead'), el('tbody'));
  t.tHead.append(head);
  t.tBodies[0].append(...rows);
  scroll.append(t);
  return scroll;
}

function row(cells, attrs = {}) {
  const tr = el('tr', attrs);
  for (const cell of cells) {
    const td = el('td', columnClass(cell));
    const content = cell?.node ?? cell;
    if (content instanceof Node) td.append(content);
    else td.textContent = content ?? '—';
    tr.append(td);
  }
  return tr;
}

const num = (node) => ({ num: true, node });

function card(id, title, subtitle) {
  const figure = el('figure', { class: 'card card-html', id });
  const body = el('div', { class: 'card-body' });
  body.append(el('h2', { class: 'card-title' }, title));
  if (subtitle) body.append(el('p', { class: 'card-subtitle' }, subtitle));
  figure.append(body);
  return { figure, body };
}

// --- Computations ---

/**
 * Decks are the ladder's archetypes; by inks only when the archetype profiles are missing (they
 * are outside duels.ink's stable contract).
 */
const view = () => (data.profiles.length ? VIEWS.archetypes : VIEWS.colors);

const ratesCache = new Map();

/** The ladder's game win rates in the view, computed once per view. */
function viewRates() {
  if (!ratesCache.has(view())) {
    ratesCache.set(view(), gameRates(data.weeks, { view: view(), profiles: data.profiles }));
  }
  return ratesCache.get(view());
}

function compute() {
  const rates = viewRates();
  // The blend, then the players who adapt to it, then the user's overrides
  const blended = forecastField(data.events, data.recentWeeks, {
    view: view(),
    profiles: data.profiles,
    weight: state.weight,
    overrides: state.overrides,
  });
  const adapted = adaptField(
    blended,
    matchMatrix(blended, rates, prep.swissBestOf),
    state.adaptation,
  );
  const field = applyOverrides(adapted, state.overrides);
  const swiss = matchMatrix(field, rates, prep.swissBestOf);
  const top = matchMatrix(field, rates, prep.topCutBestOf);
  // Our players: each deck played with the team's edge on it, against average players
  const teamSwiss = matchMatrix(field, rates, prep.swissBestOf, state.edges);
  const teamTop = matchMatrix(field, rates, prep.topCutBestOf, state.edges);
  // The stress test: every player picks again against the forecast, and our deck faces that room
  const countered = adaptField(field, swiss, 1).map((d) => d.share);
  const signature = JSON.stringify([
    field.map((d) => [d.key, d.share.toFixed(3), state.edges[d.key] ?? 0]),
    state.players,
  ]);
  return {
    rates,
    field,
    swiss,
    top,
    teamSwiss,
    teamTop,
    winRates: fieldWinRates(field, teamSwiss),
    counterWinRates: field.map((_, i) => fieldWinRate(teamSwiss, countered, i)),
    ...uncertainty(field, rates),
    signature,
  };
}

/** The range holding `uncertaintyLevel` of some draws, as [low, high]. */
function range(values) {
  const tail = (1 - prep.uncertaintyLevel) / 2;
  return [quantile(values, tail), quantile(values, 1 - tail)];
}

/**
 * How much the figures can move with the matchups' uncertainty: the matchups drawn again
 * `uncertaintySamples` times from the games they rest on (same seed every time, so a figure
 * doesn't flicker between redraws). Gives each deck's range of win rate against the field, and
 * the first `uncertaintyBatches` draws as the simulation's batches.
 */
function uncertainty(field, rates) {
  const rand = random(1);
  const shares = field.map((d) => d.share);
  const draws = field.map(() => []);
  const batches = [];
  for (let k = 0; k < prep.uncertaintySamples; k++) {
    const sample = sampleRates(rates, rand);
    const teamSwiss = matchMatrix(field, sample, prep.swissBestOf, state.edges);
    field.forEach((_, i) => draws[i].push(fieldWinRate(teamSwiss, shares, i)));
    if (k < prep.uncertaintyBatches) {
      batches.push({
        swiss: matchMatrix(field, sample, prep.swissBestOf),
        top: matchMatrix(field, sample, prep.topCutBestOf),
        teamSwiss,
        teamTop: matchMatrix(field, sample, prep.topCutBestOf, state.edges),
      });
    }
  }
  return { winRanges: draws.map(range), batches };
}

/** The team's edge on a deck, in points of game win rate (0: an average player). */
const edgeOf = (deck) => state.edges[deck.key] ?? 0;

/** Runs the simulation in a worker, a moment after the last change; replaces a running one. */
function scheduleSimulation() {
  clearTimeout(timer);
  timer = setTimeout(runSimulation, 300);
}

function runSimulation() {
  worker?.terminate();
  const { field, swiss, top, teamSwiss, teamTop, batches, signature } = current;
  worker = new Worker(new URL('./simulate.js', import.meta.url), { type: 'module' });
  const runs = prep.simulations;
  worker.onmessage = ({ data: message }) => {
    if (message.done != null) {
      const progress = $('progress');
      if (progress)
        progress.textContent = `Simulation… ${Math.round((100 * message.done) / runs)} %`;
      return;
    }
    worker.terminate();
    worker = null;
    simulation = { signature, runs, ...message.counts };
    renderResults();
  };
  worker.postMessage({
    shares: field.map((d) => d.share),
    swiss,
    top,
    teamSwiss,
    teamTop,
    // Each batch of runs on its own draw of the matchups: the chances come with their range
    batches,
    edged: field.map((d) => edgeOf(d) !== 0),
    format: { ...prep, players: state.players },
    runs,
    seed: 1,
  });
}

/**
 * The simulation's figures per deck, when it was run on the current field: the team's players on
 * a deck with an edge, its average players otherwise. Day 2's field counts them all. Each chance
 * comes with its range over the batches (`…Range`), each on its own draw of the matchups.
 */
function simulated() {
  if (simulation?.signature !== current.signature) return null;
  const { counts, team, batches, runs } = simulation;
  const spread = (i, deck, field) =>
    range(
      batches
        .map((b) => (edgeOf(deck) ? b.team[i] : b.counts[i]))
        .filter((c) => c.players)
        .map((c) => (100 * c[field]) / c.players),
    );
  const sum = (field) => [...counts, ...team].reduce((total, c) => total + c[field], 0);
  const day2 = sum('day2');
  const players = sum('players');
  return {
    runs,
    day2PerRun: day2 / runs,
    baseline: {
      day2: (100 * day2) / players,
      top: (100 * prep.topCut) / state.players,
      wins: 100 / state.players,
    },
    decks: current.field.map((deck, i) => {
      const c = edgeOf(deck) ? team[i] : counts[i];
      return {
        day2: (100 * c.day2) / c.players,
        day2Range: spread(i, deck, 'day2'),
        top: (100 * c.top) / c.players,
        topRange: spread(i, deck, 'top'),
        wins: (100 * c.wins) / c.players,
        winsRange: spread(i, deck, 'wins'),
        day2Share: (100 * (counts[i].day2 + team[i].day2)) / day2,
        players: c.players,
      };
    }),
  };
}

// --- Rendering ---

function update() {
  current = compute();
  writeUrlState();
  renderAll();
  $('progress').textContent = 'Simulation…';
  scheduleSimulation();
}

function renderAll() {
  $('charts').replaceChildren(fieldCard(), decksCard(), sheetCard(), contentCard());
  renderKpis();
}

/** The cards fed by the simulation, once it is done. */
function renderResults() {
  $('progress').textContent = '';
  $('decks').replaceWith(decksCard());
  $('sheet').replaceWith(sheetCard());
  renderKpis();
}

function kpi(label, value, detail) {
  const tile = el('div', { class: 'kpi' });
  const valueNode = el('div', { class: 'kpi-value' });
  valueNode.append(value);
  tile.append(el('div', { class: 'kpi-label' }, label), valueNode);
  if (detail) tile.append(el('div', { class: 'kpi-delta' }, detail));
  return tile;
}

function renderKpis() {
  const { events, tournamentPlayers, ladderGames } = data;
  const tiles = [
    kpi(
      'Format',
      `${prep.day1Rounds} + ${prep.day2Rounds} rondes`,
      `BO${prep.swissBestOf}, J2 à ${prep.day2Points} pts, top ${prep.topCut} en BO${prep.topCutBestOf}`,
    ),
    kpi(
      'Tournois',
      formatInt(events.length),
      `${formatInt(tournamentPlayers)} joueurs, ${formatPct(100 * state.weight, 0)} de la prévision`,
    ),
    kpi('Parties ladder', formatInt(ladderGames), 'BO1 Legendary et plus, pour les matchups'),
  ];
  $('kpis').replaceChildren(...tiles);
  renderBest();
}

/** The chances of the "best chances" band: label, figure, its range, its digits. */
const CHANCES = [
  { field: 'day2', range: 'day2Range', label: 'J2', digits: 1 },
  { field: 'top', range: 'topRange', label: `Top ${prep.topCut}`, digits: 2 },
  { field: 'wins', range: 'winsRange', label: 'victoire', digits: 2 },
];

/**
 * The best deck for each chance of the simulation (Day 2, top cut, title), among the decks one can
 * play (no "Petits decks" nor "Autres listes") and, when some are, those played enough for their
 * figures to hold (SHEET_MIN_SHARE): a rare deck's title chance is mostly the simulation's luck.
 * Placeholders while the simulation runs.
 */
function renderBest() {
  const sim = simulated();
  const playable = current.field
    .map((deck, i) => ({ deck, ...sim?.decks[i] }))
    .filter(({ deck }) => deck.key !== OTHER && !isRest(deck.key));
  const played = playable.filter(({ deck }) => deck.share >= SHEET_MIN_SHARE);
  const candidates = played.length ? played : playable;
  const tiles = CHANCES.map(({ field, range, label, digits }) => {
    const title = `Meilleure chance de ${label}`;
    if (!sim || !candidates.length) return kpi(title, '…', 'Simulation en cours');
    const best = [...candidates].sort((a, b) => b[field] - a[field])[0];
    const value = el('span', { class: 'deck-cell' });
    value.append(chips(best.deck.colors), el('span', {}, formatPct(best[field], digits)));
    const baseline = sim.baseline[field];
    return kpi(
      title,
      value,
      `${deckLabel(best.deck)}, entre ${rangeText(best[range], digits)} % ; ×${(best[field] / baseline).toFixed(1).replace('.', ',')} un joueur moyen (${formatPct(baseline, digits)})`,
    );
  });
  $('best').replaceChildren(...tiles);
  $('best').hidden = false;
}

/**
 * A slider of the scenario bar: its label, the slider (0 to 1), and its value as `describe` puts
 * it, updated while dragging; the page is recomputed once released.
 */
function scenarioSlider({ label, title, step, value, describe, onChange }) {
  const control = el('label', { class: 'scenario-control', title });
  const slider = el('input', { type: 'range', min: '0', max: '1', step: String(step) });
  slider.value = value;
  const shown = el('span', { class: 'scenario-value' });
  const show = () => (shown.textContent = describe(Number(slider.value)));
  show();
  slider.addEventListener('input', show);
  slider.addEventListener('change', () => onChange(Number(slider.value)));
  control.append(el('span', { class: 'scenario-label' }, label), slider, shown);
  return control;
}

/**
 * The scenario bar, above the cards and kept in view while scrolling: the settings every card
 * depends on (the field's blend, its adaptation, the players expected), and the simulation's
 * progress. Drawn once: the cards are redrawn under it.
 */
function renderScenario() {
  const players = el('input', { type: 'number', min: '16', step: '50', class: 'players-input' });
  players.value = state.players;
  players.addEventListener('change', () => {
    const value = Math.round(Number(players.value));
    if (value >= 16) {
      state.players = value;
      update();
    }
  });
  const playersControl = el('label', {
    class: 'scenario-control',
    title: 'La taille du tournoi simulé : elle change les chances de J2, de top cut et de victoire',
  });
  playersControl.append(el('span', { class: 'scenario-label' }, 'Joueurs'), players);

  $('scenario').replaceChildren(
    el('span', { class: 'scenario-title' }, 'Scénario'),
    scenarioSlider({
      label: 'Field',
      title:
        'D’où vient le field prévu : les gros tournois récents, le ladder Legendary+ des dernières semaines, ou un mélange des deux',
      step: 0.05,
      value: state.weight,
      describe: (w) => `${formatPct(100 * w, 0)} tournois / ${formatPct(100 - 100 * w, 0)} ladder`,
      onChange: (w) => {
        state.weight = w;
        update();
      },
    }),
    scenarioSlider({
      label: 'Adaptation',
      title:
        'Part des joueurs qui choisissent leur deck en fonction du field prévu : ils vont vers les decks qui le battent. Un scénario, pas une mesure : le ladder du set ne montre pas encore cet effet.',
      step: 0.1,
      value: state.adaptation,
      describe: (a) => (a > 0 ? `${formatPct(100 * a, 0)} des joueurs` : 'aucune'),
      onChange: (a) => {
        state.adaptation = a;
        update();
      },
    }),
    playersControl,
    el('span', { class: 'progress', id: 'progress', role: 'status' }),
  );
  $('scenario').hidden = false;
}

/** A deck's share once the field adapts, with its gap to the blend (points). */
function adaptedCell(deck) {
  const wrapper = el('span', { class: 'rate' });
  const gap = deck.adapted - deck.blended;
  const tone = gap >= 0.1 ? 'good' : gap <= -0.1 ? 'bad' : '';
  const sign = gap >= 0 ? '+' : '−';
  wrapper.append(
    el('span', {}, formatPct(deck.adapted)),
    el('span', tone ? { class: tone } : {}, `${sign}${Math.abs(gap).toFixed(1).replace('.', ',')}`),
  );
  return wrapper;
}

function fieldCard() {
  const { figure, body } = card(
    'field',
    `Field attendu à ${prep.event}`,
    `Part de chaque deck : celle des gros tournois récents mélangée à celle du ladder Legendary+ des dernières semaines. Corrigez une part à la main (ce que jouent les équipes connues, la hype) : elle est gardée telle quelle, les autres decks se partagent le reste et tout se recalcule.${view() === VIEWS.archetypes ? ' Par archétype : chaque liste de tournoi va à l’archétype du ladder dont la liste moyenne lui ressemble le plus, et chaque paire d’encres se répartit comme ses listes (top cut et reste du tournoi à part). « Autres listes » : celles qu’aucun archétype ne reconnaît.' : ''}`,
  );

  if (Object.keys(state.overrides).length) {
    const controls = el('div', { class: 'card-controls' });
    const reset = el(
      'button',
      { type: 'button', class: 'button-secondary' },
      'Annuler les corrections',
    );
    reset.addEventListener('click', () => {
      state.overrides = {};
      update();
    });
    controls.append(reset);
    figure.append(controls);
  }

  const max = Math.max(...current.field.map((d) => Math.max(d.tournament, d.ladder, d.share)));
  const adapting = state.adaptation > 0;
  const rows = current.field.map((d) => {
    const input = el('input', {
      type: 'number',
      min: '0',
      max: '100',
      step: '0.5',
      class: `share-input${d.overridden ? ' overridden' : ''}`,
      'aria-label': `Part prévue de ${deckLabel(d)} (%)`,
    });
    input.value = d.share.toFixed(1);
    input.addEventListener('change', () => {
      const value = Number(input.value);
      if (input.value === '' || !Number.isFinite(value)) delete state.overrides[d.key];
      else state.overrides[d.key] = Math.max(0, value);
      update();
    });
    const cells = [
      deckCell(d),
      num(rateCell(d.tournament, max)),
      num(rateCell(d.ladder, max)),
      num(formatPct(d.blended)),
    ];
    if (adapting) cells.push(num(adaptedCell(d)));
    return row([...cells, num(input)]);
  });
  const tableBody = el('div', { class: 'card-body' });
  tableBody.append(
    table(
      [
        { label: 'Deck' },
        {
          label: 'Tournois',
          num: true,
          title: 'Part des joueurs (deck connu) des tournois retenus',
        },
        {
          label: 'Ladder',
          num: true,
          title: `Taux de jeu BO1 Legendary+, ${prep.ladderWeeks} dernières semaines`,
        },
        { label: 'Mélange', num: true },
        ...(adapting
          ? [
              {
                label: 'Adapté',
                num: true,
                title:
                  'La part une fois que les joueurs qui s’adaptent ont choisi, et l’écart au mélange',
              },
            ]
          : []),
        { label: 'Prévision (%)', num: true, title: 'Modifiable : vide pour revenir au calcul' },
      ],
      rows,
    ),
  );
  figure.append(tableBody);
  return figure;
}

/**
 * The team's edge on a deck, editable: points of game win rate over its average player, from −15
 * to +15. Empty or 0 for an average player.
 */
function edgeInput(deck) {
  const input = el('input', {
    type: 'number',
    min: '-15',
    max: '15',
    step: '1',
    placeholder: '0',
    class: `share-input${edgeOf(deck) ? ' overridden' : ''}`,
    'aria-label': `Votre niveau sur ${deckLabel(deck)}, en points`,
  });
  if (edgeOf(deck)) input.value = edgeOf(deck);
  // A click in the field shouldn't open the deck's sheet
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('keydown', (event) => event.stopPropagation());
  input.addEventListener('change', () => {
    const value = Math.max(-15, Math.min(15, Math.round(Number(input.value))));
    if (!input.value || !value) delete state.edges[deck.key];
    else state.edges[deck.key] = value;
    update();
  });
  return input;
}

function decksCard() {
  const sim = simulated();
  const { figure } = card(
    'decks',
    'Quel deck jouer',
    `Win rate en BO${prep.swissBestOf} contre ce field (matchups du ladder, joueur 1 tiré au sort puis le perdant commence), son pire cas si le field glisse de ${prep.stressPoints} points vers un deck, et ${formatInt(prep.simulations)} ${prep.event} simulés : passage au J2 (${prep.day2Points} pts après ${prep.day1Rounds} rondes), top ${prep.topCut} après ${prep.day2Rounds} rondes de plus, victoire au bout du top ${prep.topCut} en BO${prep.topCutBestOf}. « Votre niveau » : l’avance de vos joueurs sur le joueur moyen du deck, pour peser un deck plus dur à jouer mais que vous maîtrisez. Cliquez un deck pour sa fiche.`,
  );

  const order = current.field
    .map((deck, i) => ({
      deck,
      i,
      rate: current.winRates[i],
      winRange: current.winRanges[i],
      countered: current.counterWinRates[i],
      sim: sim?.decks[i],
    }))
    .sort((a, b) => (sim ? b.sim.top - a.sim.top : b.rate.winRate - a.rate.winRate));
  const byKey = new Map(current.field.map((d) => [d.key, d]));
  const maxTop = sim ? Math.max(...sim.decks.map((d) => d.top)) : 1;
  const maxDay2 = sim ? Math.max(...sim.decks.map((d) => d.day2)) : 1;

  const rows = order.map(({ deck, rate, winRange, countered, sim: s }) => {
    const worst = el('span', { class: 'deck-cell' });
    worst.append(winCell(100 * rate.worst.winRate), el('span', {}, 'si plus de'));
    const against = byKey.get(rate.worst.against);
    // By inks the chips say it all; by archetype, the name tells apart the decks of one pair
    worst.append(
      view() === VIEWS.archetypes || against.key === OTHER
        ? deckCell(against)
        : chips(against.colors),
    );
    const tr = row(
      [
        deckCell(deck),
        num(deck.key === OTHER ? '' : edgeInput(deck)),
        num(formatPct(deck.share)),
        num(
          withRange(
            winCell(100 * rate.winRate),
            winRange.map((v) => 100 * v),
          ),
        ),
        worst,
        num(winCell(100 * countered)),
        num(s ? withRange(rateCell(s.day2, maxDay2), s.day2Range) : '…'),
        num(s ? withRange(rateCell(s.top, maxTop, 2), s.topRange, 2) : '…'),
        num(s ? formatPct(s.wins, 2) : '…'),
        num(s ? formatPct(s.day2Share) : '…'),
      ],
      {
        class: 'deck-row',
        tabindex: deck.key === OTHER ? '-1' : '0',
        'aria-selected': String(deck.key === sheetDeck()?.key),
      },
    );
    if (deck.key !== OTHER) {
      const open = () => {
        state.deck = deck.key;
        writeUrlState();
        showSheet();
        for (const r of figure.querySelectorAll('.deck-row'))
          r.setAttribute('aria-selected', 'false');
        tr.setAttribute('aria-selected', 'true');
        $('sheet').scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
    }
    return tr;
  });
  if (sim) {
    rows.push(
      row(
        [
          'Joueur moyen',
          num(''),
          num(''),
          num(formatPct(50)),
          '',
          '',
          num(formatPct(sim.baseline.day2)),
          num(formatPct(sim.baseline.top, 2)),
          num(formatPct(sim.baseline.wins, 2)),
          num(''),
        ],
        { class: 'baseline-row' },
      ),
    );
  }

  const body = el('div', { class: 'card-body' });
  body.append(
    table(
      [
        { label: 'Deck' },
        {
          label: 'Votre niveau',
          num: true,
          title:
            'Votre avantage sur le joueur moyen du deck, en points de win rate par partie : +5, c’est 55 % dans une partie à 50 %. Tout le reste du tableau en tient compte.',
        },
        { label: 'Part prévue', num: true },
        {
          label: `WR BO${prep.swissBestOf}`,
          num: true,
          title: 'Win rate en match contre le field prévu',
        },
        {
          label: 'Pire cas',
          title: `Le win rate si le field glisse de ${prep.stressPoints} points vers le pire adversaire`,
        },
        {
          label: 'Si le field s’adapte',
          num: true,
          title:
            'Le win rate si tous les joueurs choisissaient leur deck contre le field prévu, en allant vers ceux qui le battent : le deck tient-il quand la salle a contré le méta ?',
        },
        {
          label: 'J2',
          num: true,
          title: `Part des joueurs du deck à ${prep.day2Points} pts ou plus après ${prep.day1Rounds} rondes`,
        },
        {
          label: `Top ${prep.topCut}`,
          num: true,
          title: 'Part des joueurs du deck dans le top cut',
        },
        { label: 'Victoire', num: true, title: 'Part des joueurs du deck qui gagnent le tournoi' },
        { label: 'Part du J2', num: true, title: 'Le field du J2 : il n’est plus celui du J1' },
      ],
      rows,
    ),
  );
  if (sim) {
    body.append(
      el(
        'p',
        { class: 'card-note' },
        `${formatInt(sim.runs)} tournois de ${formatInt(state.players)} joueurs simulés, ${formatInt(Math.round(sim.day2PerRun))} au J2 en moyenne. Sous chaque chiffre, sa fourchette à ${Math.round(100 * prep.uncertaintyLevel)} % : les matchups tirés à nouveau selon le nombre de parties qui les fondent (et le hasard de la simulation pour les chances). Deux decks dont les fourchettes se chevauchent largement ne se départagent pas avec ces données. Les chances de victoire restent bruitées pour les decks rares.`,
      ),
    );
  }
  figure.append(body);
  return figure;
}

/** Below this share of the field (%), a deck isn't opened by default: its figures are thin. */
const SHEET_MIN_SHARE = 2;

/**
 * The deck of the matchup sheet: the one picked, or else the best against the field among those
 * played enough, a rest deck never being one.
 */
function sheetDeck() {
  const decks = current.field.filter((d) => d.key !== OTHER);
  const picked = decks.find((d) => d.key === state.deck);
  if (picked) return picked;
  const candidates = current.field
    .map((d, i) => ({ d, rate: current.winRates[i].winRate }))
    .filter(({ d }) => d.key !== OTHER && !isRest(d.key))
    .sort((a, b) => b.rate - a.rate);
  return (candidates.find(({ d }) => d.share >= SHEET_MIN_SHARE) ?? candidates[0])?.d ?? null;
}

/** The sheet and the card analysis, for the deck now picked. */
function showSheet() {
  $('sheet').replaceWith(sheetCard());
  $('content').replaceWith(contentCard());
}

const keyCardsCache = new Map();

/**
 * A deck's four key cards by their short names (two versions of one character named once),
 * cached: the lists don't change once loaded. An archetype's are its ladder signature, the cards
 * that tell it apart on millions of games; otherwise, what sets its tournament lists apart.
 */
function keyCardNames(key) {
  const id = `${view()}|${key}`;
  if (!keyCardsCache.has(id)) {
    const signature = view() === VIEWS.archetypes ? ladderSignature(data.profiles, key) : [];
    const cards = signature.length
      ? signature
      : keyCards(data.events, key, 8, view(), data.profiles).map((c) => c.name);
    const names = cards.map((name) => name.split(' - ')[0]);
    keyCardsCache.set(id, [...new Set(names)].slice(0, 4));
  }
  return keyCardsCache.get(id);
}

function sheetCard() {
  const deck = sheetDeck();
  const edge = deck ? edgeOf(deck) : 0;
  const { figure, body } = card(
    'sheet',
    deck ? `Fiche matchups : ${deckLabel(deck)}` : 'Fiche matchups',
    `Ses adversaires les plus attendus d’abord. Win rates par partie au ladder, ramenés vers la moyenne quand l’échantillon est mince, puis en match${edge ? `, avec votre niveau (${edge > 0 ? '+' : ''}${edge} points)` : ''} ; « Cartes clés » : ${view() === VIEWS.archetypes ? 'les cartes signature de l’archétype au ladder' : 'ce qui distingue leurs listes en tournoi'} ; « Poids » : ce que le matchup ajoute ou retire au win rate contre le field, en points.`,
  );
  if (!deck) return figure;
  const title = body.querySelector('.card-title');
  title.prepend(chips(deck.colors));
  body.append(
    el(
      'p',
      { class: 'print-only card-note' },
      `${prep.event} · field prévu à ${formatPct(100 * state.weight, 0)} sur les tournois${state.adaptation ? `, ${formatPct(100 * state.adaptation, 0)} des joueurs qui s’adaptent` : ''}${Object.keys(state.overrides).length ? ', corrigé à la main' : ''} · ${formatInt(state.players)} joueurs`,
    ),
  );

  const controls = el('div', { class: 'card-controls' });
  const picker = el('label', { class: 'card-control' });
  const select = el('select');
  for (const d of current.field) {
    if (d.key === OTHER) continue;
    const option = el('option', { value: d.key }, deckLabel(d));
    if (d.key === deck.key) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', () => {
    state.deck = select.value;
    writeUrlState();
    $('decks').replaceWith(decksCard());
    showSheet();
  });
  picker.append('Deck', select);
  const print = el('button', { type: 'button', class: 'button-secondary' }, 'Imprimer la fiche');
  print.addEventListener('click', () => {
    document.body.classList.add('print-sheet');
    window.print();
  });
  controls.append(picker, print);
  figure.append(controls);

  const sim = simulated();
  const i = current.field.indexOf(deck);
  const rows = current.field
    .map((opponent, j) => ({ opponent, j }))
    .sort((a, b) => b.opponent.share - a.opponent.share)
    .map(({ opponent, j }) => {
      const rate = current.rates.rate(deck.key, opponent.key);
      const own = withEdge(rate, edge);
      const match = 100 * current.teamSwiss[i][j];
      const bo5 = 100 * current.teamTop[i][j];
      const mirror = deck.key === opponent.key;
      // By archetype, a rest deck (or a pair never met) plays its inks' figures: say so
      const observed =
        rate.raw == null
          ? '—'
          : `${formatPct(100 * rate.raw)} sur ${formatInt(rate.games)}${view() === VIEWS.archetypes && rate.inks ? ' (encres)' : ''}`;
      const known = opponent.key !== OTHER && (!mirror || edge);
      return row([
        deckCell(opponent),
        num(formatPct(opponent.share)),
        num(sim ? formatPct(sim.decks[j].day2Share) : '…'),
        num(known ? formatPct(100 * own.onPlay) : '—'),
        num(known ? formatPct(100 * own.onDraw) : '—'),
        num(mirror ? 'miroir' : observed),
        num(winCell(match)),
        num(winCell(bo5)),
        num(pointsCell((opponent.share / 100) * (match - 50))),
        opponent.key === OTHER ? '' : keyCardNames(opponent.key).join(', ') || '—',
        { print: true, node: '' },
      ]);
    });
  const tableBody = el('div', { class: 'card-body' });
  tableBody.append(
    table(
      [
        { label: 'Adversaire' },
        { label: 'Part prévue', num: true },
        { label: 'Part du J2', num: true },
        { label: 'En 1er', num: true, title: 'Win rate par partie en commençant' },
        { label: 'En 2e', num: true, title: 'Win rate par partie en jouant en second' },
        { label: 'Ladder brut', num: true, title: 'Win rate observé et nombre de parties BO1' },
        { label: `BO${prep.swissBestOf}`, num: true },
        { label: `BO${prep.topCutBestOf}`, num: true, title: `Le match en top ${prep.topCut}` },
        {
          label: 'Poids',
          num: true,
          title: 'Points de win rate contre le field apportés par ce matchup',
        },
        {
          label: 'Cartes clés',
          title:
            view() === VIEWS.archetypes
              ? 'Les cartes signature de l’archétype au ladder (celles de sa liste la plus jouée)'
              : 'Dans au moins la moitié de leurs listes, et le moins dans celles des autres decks',
        },
        { label: 'Plan de jeu', print: true },
      ],
      rows,
    ),
  );
  figure.append(tableBody);
  const mulligan = mulliganSection(deck);
  if (mulligan) figure.append(mulligan);
  return figure;
}

/** Cards of the mulligan guide shown per list, at most. */
const MULLIGAN_SHOWN = 6;

/** One list of the mulligan guide: each card, how often it's kept, and the gap it makes. */
function mulliganList(title, cards, empty) {
  const section = el('div', { class: 'mulligan-list' });
  section.append(el('h4', {}, title));
  if (!cards.length) {
    section.append(el('p', { class: 'card-note' }, empty));
    return section;
  }
  const list = el('ul');
  for (const c of cards.slice(0, MULLIGAN_SHOWN)) {
    const item = el('li');
    const gap = c.kept - c.tossed;
    item.title = `Gardée : ${formatPct(c.kept)} de victoires · renvoyée : ${formatPct(c.tossed)} · vue dans ${formatInt(c.seen)} mains de départ`;
    // The figures stay together on one line, the card's name wrapping instead
    const figures = el(
      'span',
      { class: 'mulligan-figures' },
      `gardée ${formatPct(c.keepRate, 0)} du temps · `,
    );
    figures.append(pointsCell(gap));
    item.append(el('span', { class: 'mulligan-card' }, c.name), figures);
    list.append(item);
  }
  section.append(list);
  return section;
}

/**
 * The deck's mulligan guide, on the play and on the draw, from its ladder opening hands
 * (Legendary+): the cards whose keeping clearly wins more games, and those clearly better sent
 * back. Printed with the sheet.
 */
function mulliganSection(deck) {
  const guide = mulliganGuide(data.openings, deck.key);
  if (!guide) return null;
  const section = el('div', { class: 'card-body mulligan' });
  section.append(
    el('h3', { class: 'tier-title' }, 'Mulligan'),
    el(
      'p',
      { class: 'card-note' },
      'Win rate par partie quand la carte est gardée dans la main de départ, comparé à quand elle est renvoyée (ladder Legendary+, sur le set). Seuls les écarts nets sont listés. Une carte gardée dit aussi quelque chose du reste de la main : c’est un guide, pas la valeur de la carte. « Gardée x % du temps » : ce que font les joueurs ; un écart net sur une carte peu gardée, c’est une carte à garder plus souvent.',
    ),
  );
  const columns = el('div', { class: 'mulligan-seats' });
  for (const [seat, label] of [
    ['play', 'En 1er'],
    ['draw', 'En 2e'],
  ]) {
    const column = el('div', { class: 'mulligan-seat' });
    column.append(
      el('h4', { class: 'mulligan-seat-title' }, label),
      mulliganList('À garder', guide[seat].keep, 'Aucune carte ne se détache.'),
      mulliganList('À renvoyer', guide[seat].toss, 'Aucune carte ne se détache.'),
    );
    columns.append(column);
  }
  section.append(columns);
  return section;
}

/** A gap in win rate (points), coloured only when its interval excludes 0. */
function gapCell(card) {
  if (card.withIt == null || card.without == null) return '—';
  const points = card.withIt - card.without;
  const text = `${points >= 0 ? '+' : '−'}${Math.abs(points).toFixed(1).replace('.', ',')}`;
  const tone = card.gap[0] > 0 ? 'good' : card.gap[1] < 0 ? 'bad' : '';
  const span = el('span', tone ? { class: tone } : {}, tone ? `${text} ●` : text);
  span.title = `Intervalle à 99 % : ${card.gap.map((v) => v.toFixed(1).replace('.', ',')).join(' à ')} points`;
  return span;
}

/**
 * The cards that swing the deck's ink pair on the ladder (Legendary+): the API gives them by ink
 * pair, not by archetype.
 */
function ladderSection(deck) {
  const cards = ladderCards(data.pairLift, deck.colors);
  if (!cards.length) return null;
  const section = el('div', { class: 'card-body' });
  section.append(
    el(
      'h3',
      { class: 'tier-title' },
      `Au ladder : les cartes qui font la différence en ${deckName(deck.colors)}`,
    ),
    el(
      'p',
      { class: 'card-note' },
      'Win rate par partie des decks de cette paire d’encres qui jouent la carte, comparé à celui de toute la paire (Legendary+, sur le set). duels.ink ne les donne que par paire d’encres, pas par archétype.',
    ),
    table(
      [
        { label: 'Carte' },
        { label: 'Présence', num: true, title: 'Part des decks de la paire qui la jouent' },
        { label: 'Parties', num: true },
        { label: 'WR avec', num: true },
        { label: 'Écart', num: true, title: 'WR avec − WR de la paire, en points' },
      ],
      cards.map((c) =>
        row([
          c.card,
          num(rateCell(100 * c.presence, 100, 0)),
          num(formatInt(c.games)),
          num(formatPct(c.winRate)),
          num(pointsCell(c.lift)),
        ]),
      ),
    ),
  );
  return section;
}

function contentCard() {
  const deck = sheetDeck();
  const lists = deck ? deckLists(data.events, deck.key, view(), data.profiles) : [];
  const { figure, body } = card(
    'content',
    deck ? `Contenu : ${deckLabel(deck)}` : 'Contenu du deck',
    `Les cartes de ses listes publiques en tournoi${view() === VIEWS.archetypes ? ' (celles classées dans cet archétype)' : ''}, des plus jouées aux plus rares, avec le win rate en match des joueurs qui la jouent et des autres. Les listes publiques sont surtout celles des top cuts : les win rates sont tous hauts, seul l’écart compte, et seulement pour une carte que des listes laissent de côté. ● : écart net (intervalle à 99 % hors de 0).`,
  );
  if (!deck) return figure;
  body.querySelector('.card-title').prepend(chips(deck.colors));
  const ladder = ladderSection(deck);
  if (!lists.length) {
    body.append(
      el('p', { class: 'card-note' }, 'Aucune liste publique de ce deck sur la période.'),
    );
    if (ladder) figure.append(ladder);
    return figure;
  }
  const cut = lists.filter((l) => l.topCut).length;
  const variants = variantSummary(lists);
  const note = el(
    'p',
    { class: 'card-note' },
    `${formatInt(lists.length)} listes, dont ${formatInt(cut)} du top cut.${variants ? ` Variantes de ce deck : ${variants}.` : ''}`,
  );
  // The tournaments page knows the same decks: its median list of this one
  if (!isRest(deck.key)) {
    const median = el('a', {
      href: `../tournaments/?cards=${view()}&deck=${encodeURIComponent(deck.key)}`,
    });
    median.textContent = 'sa liste médiane du top cut';
    note.append(' Voir aussi ', median, '.');
  }
  body.append(note);

  const rows = cardPerformance(lists).map((c) =>
    row([
      c.name,
      num(c.cost ?? '—'),
      num(rateCell(c.share, 100, 0)),
      num(c.cutShare == null ? '—' : formatPct(c.cutShare, 0)),
      num(c.otherShare == null ? '—' : formatPct(c.otherShare, 0)),
      num(c.meanCopies.toFixed(1).replace('.', ',')),
      num(c.withIt == null ? '—' : formatPct(c.withIt)),
      num(c.without == null ? '—' : `${formatPct(c.without)} (${formatInt(c.withoutLists)})`),
      num(gapCell(c)),
    ]),
  );
  const tableBody = el('div', { class: 'card-body' });
  tableBody.append(
    table(
      [
        { label: 'Carte' },
        { label: 'Coût', num: true },
        { label: 'Listes', num: true, title: 'Part des listes qui la jouent' },
        { label: 'Top cut', num: true, title: 'Part des listes du top cut qui la jouent' },
        { label: 'Hors top cut', num: true, title: 'Part des autres listes qui la jouent' },
        { label: 'Copies', num: true, title: 'Copies en moyenne, quand elle est jouée' },
        { label: 'WR avec', num: true, title: 'Win rate en match des joueurs qui la jouent' },
        {
          label: 'WR sans',
          num: true,
          title: 'Win rate en match des autres joueurs du deck (leur nombre de listes)',
        },
        { label: 'Écart', num: true, title: 'WR avec − WR sans, en points' },
      ],
      rows,
    ),
  );
  figure.append(tableBody);
  if (ladder) figure.append(ladder);
  return figure;
}

// --- Loading ---

async function loadLadder() {
  const index = await fetchJson(`${DATA_URL}${LADDER_QUEUE}/index.json`);
  const fetched = await Promise.all(
    index.weeks.map((w) => fetchJson(`${DATA_URL}${LADDER_QUEUE}/weeks/${w.startDate}.json`)),
  );
  // The archetypes' average lists: without them, decks are by inks only
  const stored = await fetchJson(`${DATA_URL}${LADDER_QUEUE}/profiles.json`).catch(() => null);
  // Archetypes by what they play: their ids, slugs and names change from one collection to the next
  const { weeks, profiles } = reconcileArchetypes(fetched, stored?.profiles ?? []);
  weeks.sort((a, b) => a.week.startDate.localeCompare(b.week.startDate));
  const finished = weeks.filter((w) => isWeekComplete(w.week));
  // Play rates: the last finished weeks (the week in progress when none is over yet)
  const recentWeeks = (finished.length ? finished : weeks).slice(-prep.ladderWeeks);
  return {
    index,
    weeks,
    recentWeeks,
    profiles,
    pairLift: stored?.pairLift ?? {},
    // Opening hands per deck, its variants' added up
    openings: deckOpenings(stored?.openings, profiles),
  };
}

async function loadTournaments() {
  try {
    const index = await fetchJson(`${DATA_URL}lorcanahunter/index.json`);
    const listed = eventsSince(index.tournaments, index.window.from);
    const events = await Promise.all(
      listed.map((t) => fetchJson(`${DATA_URL}lorcanahunter/events/${t.id}.json`)),
    );
    return { index, events };
  } catch (error) {
    console.error(error);
    return { index: null, events: [] };
  }
}

function showError(message) {
  $('subtitle').textContent = '';
  $('charts').replaceChildren(el('p', { class: 'error' }, message));
}

async function load() {
  document.title = `Préparer ${prep.event}`;
  $('title').textContent = `Préparer ${prep.event}`;
  let ladder;
  try {
    ladder = await loadLadder();
  } catch (error) {
    console.error(error);
    showError('Impossible de charger les données du ladder : les matchups en dépendent.');
    return;
  }
  const tournaments = await loadTournaments();
  const ladderGames = ladder.weeks.reduce(
    (sum, w) => sum + w.colorPairs.reduce((s, p) => s + p.games, 0) / 2,
    0,
  );
  data = {
    ...ladder,
    events: tournaments.events,
    ladderGames,
    tournamentPlayers: tournaments.events.reduce((sum, e) => sum + e.players.length, 0),
  };

  const last = ladder.weeks.at(-1);
  $('subtitle').textContent =
    `Ladder du ${formatUpdatedAt(last?.updatedAt)}` +
    (tournaments.index
      ? ` · tournois Lorcanahunter du ${formatUpdatedAt(tournaments.index.collectedAt)}`
      : '');
  const warnings = [];
  if (tournaments.index?.mock) {
    warnings.push(
      'Données de tournois de test : le field prévu ne reflète pas encore les vrais résultats.',
    );
  }
  if (!tournaments.events.length)
    warnings.push('Aucun tournoi : le field prévu vient du ladder seul.');
  if (warnings.length) {
    $('warning').textContent = warnings.join(' ');
    $('warning').hidden = false;
  }
  renderScenario();
  update();
}

// "Imprimer la fiche" prints the sheet alone; the browser's own print, the whole page
window.addEventListener('afterprint', () => document.body.classList.remove('print-sheet'));

load();
