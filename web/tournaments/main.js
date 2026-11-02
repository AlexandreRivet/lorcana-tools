import {
  conversionChart,
  conversionSignal,
  CONVERSION_SIGNALS,
} from '../../src/charts/conversion.js';
import { bracketChart } from '../../src/charts/bracket.js';
import { WIN_SIGNALS, matchupsMetChart, winSignal } from '../../src/charts/matchups-met.js';
import { fieldChart } from '../../src/charts/field.js';
import { themes } from '../../src/charts/theme.js';
import { LORCANAHUNTER_URL, config } from '../../src/config.js';
import {
  formatDay,
  formatInt,
  formatNumber1,
  formatPct,
  formatUpdatedAt,
  formatWeekRange,
} from '../../src/lib/format.js';
import { INKS, deckEmoji, deckName } from '../../src/lib/inks.js';
import { keyedProfiles, variantSummary } from '../../src/lib/archetypes.js';
import {
  VIEWS,
  assignArchetypes,
  assumedCutSize,
  bracketReport,
  cardReport,
  cutLists,
  eventsSince,
  fieldReport,
  listGroups,
  matchupReport,
  medianList,
  topCutLists,
} from '../../src/lib/tournaments.js';

// Collected data is served at the site root (publicDir in vite.config.js), one level above this
// page: relative URLs keep working wherever the site is hosted.
const DATA_URL = '../lorcanahunter/';
const $ = (id) => document.getElementById(id);
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const { minPlayers, assumedCutRatio } = config.tournaments;
// A deck needs this many players for its conversion rate to be drawn (the table has them all)
const MIN_DECK_PLAYERS = 10;

// Each card's default view: the cards of a list only make sense within an archetype
const DEFAULT_VIEWS = {
  field: VIEWS.colors,
  conversion: VIEWS.colors,
  rounds: VIEWS.colors,
  cards: VIEWS.archetypes,
};

// The views each card offers: by inks, the card analysis lists each pair's archetypes itself
const ALL_VIEWS = [VIEWS.colors, VIEWS.archetypes];
const CARD_VIEWS = {
  field: ALL_VIEWS,
  conversion: ALL_VIEWS,
  rounds: ALL_VIEWS,
  cards: ALL_VIEWS,
};

const VIEW_LABELS = {
  [VIEWS.colors]: 'Encres',
  [VIEWS.archetypes]: 'Archétypes',
};

// The ladder queue whose archetypes the lists are sorted into, as on the other pages
const LADDER_QUEUE = config.queues.find((q) => q.includes('bo1'));

const state = readUrlState();
let data = null;

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

// --- State in the URL: each card's view, and the deck whose cards are shown ---

function readUrlState() {
  const params = new URLSearchParams(location.search);
  const views = {};
  for (const [id, fallback] of Object.entries(DEFAULT_VIEWS)) {
    const value = params.get(id);
    views[id] = CARD_VIEWS[id].includes(value) ? value : fallback;
  }
  // deck: the card analysis' deck; vs: the deck whose matchups are shown
  return { views, deck: params.get('deck'), vs: params.get('vs') };
}

function writeUrlState() {
  const params = new URLSearchParams();
  for (const [id, view] of Object.entries(state.views)) {
    if (view !== DEFAULT_VIEWS[id]) params.set(id, view);
  }
  if (state.deck) params.set('deck', state.deck);
  if (state.vs) params.set('vs', state.vs);
  const query = params.toString();
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
}

// --- Decks ---

/**
 * A deck as its ink chips. The name stays available: hidden text for screen readers (and
 * copy-paste), and a tooltip on hover.
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

/** A deck in a table: its chips, then its archetype's name if it has one. */
function deckCell(deck) {
  if (!deck.label) return chips(deck.colors);
  const wrapper = el('span', { class: 'deck-cell' });
  wrapper.append(chips(deck.colors), el('span', {}, deck.label));
  return wrapper;
}

/**
 * The median list of one build, by cost, with a button copying it as "4 Angel - Siren Singer"
 * lines, the text format deck builders import.
 */
function medianSection(lists) {
  const median = medianList(lists);
  const section = el('section', { class: 'median' });
  const head = el('div', { class: 'median-head' });
  const copy = el('button', { type: 'button', class: 'button-secondary' }, 'Copier la liste');
  const text = median.cards.map((c) => `${c.copies} ${c.name}`).join('\n');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Liste copiée';
    } catch {
      copy.textContent = 'Copie impossible';
    }
    setTimeout(() => (copy.textContent = 'Copier la liste'), 2000);
  });
  head.append(el('h3', {}, `Liste médiane (${median.size} cartes)`), copy);
  section.append(
    head,
    el(
      'p',
      { class: 'tier-hint' },
      `Chaque carte à son nombre médian de copies dans les ${lists.length} listes, ajusté à ${median.size} cartes au plus près des moyennes.`,
    ),
  );
  const list = el('ul', { class: 'median-cards' });
  for (const c of median.cards) {
    const item = el('li');
    item.append(
      el('span', { class: 'median-copies' }, `${c.copies}×`),
      el('span', { class: 'median-cost' }, c.cost == null ? '—' : String(c.cost)),
      el('span', {}, c.inkwell ? `${c.name} ◆` : c.name),
    );
    item.title = `${c.lists} liste${c.lists > 1 ? 's' : ''} sur ${lists.length} · ${formatNumber1(c.mean)} copies en moyenne`;
    list.append(item);
  }
  section.append(list);
  const { list: closest, shared } = median.closest;
  if (lists.length > 1) {
    const note = el('p', { class: 'tier-hint' });
    note.append(
      `Liste réelle la plus proche : ${closest.standing ?? '—'}e à `,
      el('a', { href: tournamentUrl(closest.event) }, closest.event.name),
      ` (${shared} cartes sur ${median.size} en commun).`,
    );
    section.append(note);
  }
  return section;
}

const tournamentUrl = (t) => `${LORCANAHUNTER_URL}/tournament/${t.id}${t.slug ? `/${t.slug}` : ''}`;

// --- Key figures ---

function kpi(label, value, detail) {
  const tile = el('div', { class: 'kpi' });
  tile.append(el('div', { class: 'kpi-label' }, label), el('div', { class: 'kpi-value' }, value));
  if (detail) tile.append(el('div', { class: 'kpi-delta' }, detail));
  return tile;
}

function renderKpis() {
  const { events } = data;
  const players = events.reduce((n, e) => n + e.players.length, 0);
  const cut = events.reduce((n, e) => n + e.players.filter((p) => p.topCut).length, 0);
  const known = events.reduce((n, e) => n + e.players.filter((p) => p.deck).length, 0);
  const assumed = events.filter((e) => e.cut.assumed).length;
  const lists = cutLists(events).length;
  $('kpis').replaceChildren(
    kpi('Tournois', formatInt(events.length), `core, plus de ${minPlayers} joueurs`),
    kpi(
      'Joueurs',
      formatInt(players),
      `${formatPct((100 * known) / players, 0)} avec un deck connu`,
    ),
    kpi(
      'Au top cut',
      formatInt(cut),
      assumed
        ? `top cut supposé pour ${assumed} tournoi${assumed > 1 ? 's' : ''}`
        : 'top cut des résultats',
    ),
    kpi('Listes du top cut', formatInt(lists), 'decklists publiques analysées'),
  );
}

// --- Table views: every chart has an equivalent readable without colour or hover ---

function table(headers, rows, { rowHeaders = true } = {}) {
  const node = el('table');
  const head = node.createTHead().insertRow();
  // Values are text, or nodes (a deck's chips)
  const cell = (tag, attrs, value) => {
    const node = el(tag, attrs);
    node.append(value);
    return node;
  };
  for (const label of headers) head.append(cell('th', { scope: 'col' }, label));
  const body = node.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    row.forEach((value, i) =>
      tr.append(
        i === 0 && rowHeaders ? cell('th', { scope: 'row' }, value) : cell('td', {}, value),
      ),
    );
  }
  return node;
}

function fieldTableView(report) {
  return table(
    ['Deck', 'Joueurs', 'Ligne de départ', 'Top cut', 'Part du top cut'],
    report.decks.map((d) => [
      deckCell(d),
      formatInt(d.players),
      formatPct(d.share),
      formatInt(d.topCut),
      formatPct(d.cutShare),
    ]),
  );
}

function conversionTableView(report) {
  return table(
    ['Deck', 'Joueurs', 'Top cut', 'Conversion', 'IC 95 %', 'Indice', 'Écart'],
    report.decks.map((d) => [
      deckCell(d),
      formatInt(d.players),
      formatInt(d.topCut),
      formatPct(d.conversion),
      `${formatPct(d.ci[0])} – ${formatPct(d.ci[1])}`,
      `×${formatNumber1(d.index)}`,
      CONVERSION_SIGNALS[conversionSignal(d, report.baseline)],
    ]),
  );
}

function roundsTableView(field, bracket) {
  const cell = ({ from, to, rate }) => (from ? `${formatPct(rate, 0)} (${to}/${from})` : '—');
  return table(
    ['Deck', 'Top cut', ...bracket.columns.map((c) => (c.n === 2 ? 'Finale' : `Top ${c.n}`))],
    [
      [
        'Ensemble',
        cell({ from: field.known, to: field.knownCut, rate: field.baseline }),
        ...bracket.columns.map(cell),
      ],
      ...bracket.decks.map((d) => [
        deckCell(d),
        cell({ from: d.players, to: d.topCut, rate: d.conversion }),
        ...bracket.columns.map((c) => cell(d.rounds[c.n])),
      ]),
    ],
  );
}

// --- Cards ---

const openedTables = () =>
  new Set([...$('charts').querySelectorAll('details[open]')].map((d) => d.closest('figure').id));

function card({ id, svg, table: tableNode, controls }, opened) {
  const figure = el('figure', { class: 'card', id });
  if (controls) figure.append(controls);
  const details = el('details', { class: 'table-view' });
  if (opened.has(id)) details.open = true;
  const scroll = el('div', { class: 'table-scroll' });
  scroll.append(tableNode);
  details.append(el('summary', {}, 'Voir les données en tableau'), scroll);
  figure.append(svg, details);
  return figure;
}

/** Stand-in for a chart without enough data: its title and why it isn't shown. */
function emptyCard({ id, title, reason, controls }) {
  const figure = el('figure', { class: 'card card-empty', id });
  if (controls) figure.append(controls);
  figure.append(
    el('h2', { class: 'card-empty-title' }, title),
    el('p', { class: 'card-empty-reason' }, reason),
  );
  return figure;
}

/** Redraws one card, keeping the focus on the control that changed it. */
function refresh(id, focusSelector) {
  const fresh = buildCard(id, openedTables());
  $(id).replaceWith(fresh);
  fresh.querySelector(focusSelector)?.focus();
}

/** What each view keeps of the known decks, for the switch's note. */
const VIEW_NOTES = {
  [VIEWS.archetypes]: (share) => {
    const left = data.events.filter((e) => !data.listedEvents.includes(e));
    const out = left.length
      ? ` Hors de cette vue, faute de listes publiques pour ${listRule()} : ${left.map((e) => e.name).join(', ')}.`
      : '';
    return `${share} des decks connus ont une liste publique, rangée dans l’archétype du ladder dont la liste moyenne lui ressemble le plus (comme sur les autres pages) ; les autres sont laissés de côté dans cette vue.${out}`;
  },
};

/** The inks / archetypes switch of a card; switching redraws only that card. */
function viewSwitch(id) {
  const view = state.views[id];
  const group = el('div', { class: 'view-switch', role: 'group', 'aria-label': 'Vue' });
  for (const value of CARD_VIEWS[id]) {
    const label = VIEW_LABELS[value];
    const button = el('button', { type: 'button', 'aria-pressed': String(view === value) }, label);
    button.dataset.view = value;
    if (VIEW_NOTES[value]) {
      // Share of the known decks the view keeps, among the tournaments it counts, kept short to
      // fit on the title's line
      const known = eventsFor(value).reduce(
        (n, e) => n + e.players.filter((p) => p.deck).length,
        0,
      );
      const share = formatPct(known ? (100 * data.reports[value].known) / known : 0, 0);
      button.append(el('span', { class: 'view-note' }, ` · ${share}`));
      button.title = VIEW_NOTES[value](share);
    }
    button.addEventListener('click', () => {
      if (value === state.views[id]) return;
      state.views[id] = value;
      if (id === 'cards') state.deck = null;
      writeUrlState();
      refresh(id, `.view-switch [data-view="${value}"]`);
    });
    group.append(button);
  }
  const controls = el('div', { class: 'card-controls switch-only' });
  controls.append(group);
  return controls;
}

/** The tournaments a view counts: by archetype, those with enough public lists. */
const eventsFor = (view) => (view === VIEWS.archetypes ? data.listedEvents : data.events);

const context = () => ({
  period: formatWeekRange(data.index.window.from, data.index.window.to),
  minPlayers,
  minDeckPlayers: MIN_DECK_PLAYERS,
});

/** "50 % de ses joueurs hors top cut": the share of public lists a tournament needs. */
const listRule = () =>
  `${formatPct(100 * config.tournaments.minListShare, 0)} de ses joueurs hors top cut`;

/**
 * A card's stand-in by archetype when no tournament has enough public lists, or null. A
 * tournament publishing only its top cut's lists would show nearly every listed player in it.
 */
function noListsCard(id, title, controls) {
  if (state.views[id] !== VIEWS.archetypes || data.listedEvents.length) return null;
  return emptyCard({
    id,
    title,
    reason: `Pas assez de listes publiques : par archétype, un tournoi ne compte que si au moins ${listRule()} ont publié leur liste, et aucun ne le fait sur la période.`,
    controls,
  });
}

function fieldCard(opened) {
  const id = 'field';
  const report = data.reports[state.views[id]];
  const controls = viewSwitch(id);
  const none = noListsCard(id, 'Ligne de départ et top cut', controls);
  if (none) return none;
  if (!report.knownCut) {
    return emptyCard({
      id,
      title: 'Ligne de départ et top cut',
      reason: 'Aucun deck connu sur la période.',
      controls,
    });
  }
  const theme = darkQuery.matches ? themes.dark : themes.light;
  return card(
    {
      id,
      svg: fieldChart(report, context(), { document, theme }),
      table: fieldTableView(report),
      controls,
    },
    opened,
  );
}

function conversionCard(opened) {
  const id = 'conversion';
  const report = data.reports[state.views[id]];
  const controls = viewSwitch(id);
  const decks = report.decks.filter((d) => d.players >= MIN_DECK_PLAYERS).slice(0, config.maxDecks);
  const none = noListsCard(id, 'Conversion au top cut', controls);
  if (none) return none;
  if (!decks.length) {
    return emptyCard({
      id,
      title: 'Conversion au top cut',
      reason: `Aucun deck n'a ${MIN_DECK_PLAYERS} joueurs ou plus sur la période.`,
      controls,
    });
  }
  const theme = darkQuery.matches ? themes.dark : themes.light;
  return card(
    {
      id,
      svg: conversionChart(report, decks, context(), { document, theme }),
      table: conversionTableView(report),
      controls,
    },
    opened,
  );
}

function matchupsTableView(deck) {
  return table(
    ['Contre', 'Part des matchs', 'Par joueur', 'Win rate', 'IC 95 %', 'Matchs', 'Écart'],
    deck.opponents.map((o) => [
      o.mirror ? 'Miroir' : deckCell(o),
      formatPct(o.share),
      o.perPlayer == null ? '—' : formatNumber1(o.perPlayer),
      formatPct(o.winRate),
      `${formatPct(o.ci[0])} – ${formatPct(o.ci[1])}`,
      `${formatInt(o.wins)} / ${formatInt(o.matches)}`,
      WIN_SIGNALS[winSignal(o)],
    ]),
  );
}

/** The matchups one deck met, picked in the card; by ink pair, the only pairings known. */
function matchupsCard(opened) {
  const id = 'matchups';
  const title = 'Matchups rencontrés';
  const report = data.matchups;
  if (!report.decks.length) {
    return emptyCard({
      id,
      title,
      reason:
        'Les résultats collectés ne disent pas qui a joué contre qui : pas de matchups pour la période.',
    });
  }
  const deck = report.decks.find((d) => d.key === state.vs) ?? report.decks[0];
  const select = el('select', { 'aria-label': 'Deck des matchups' });
  select.replaceChildren(
    ...report.decks.map((d) =>
      el(
        'option',
        { value: d.key },
        `${deckEmoji(d.colors)} ${deckName(d.colors)} · ${formatInt(d.matches)} matchs`,
      ),
    ),
  );
  select.value = deck.key;
  select.addEventListener('change', () => {
    state.vs = select.value === report.decks[0].key ? null : select.value;
    writeUrlState();
    refresh(id, 'select');
  });
  const controls = el('div', { class: 'card-controls' });
  const picker = el('label', { class: 'card-control' });
  picker.append(el('span', {}, 'Deck'), select);
  controls.append(picker, el('span', { class: 'view-note' }, 'par paire d’encres'));
  const theme = darkQuery.matches ? themes.dark : themes.light;
  return card(
    {
      id,
      svg: matchupsMetChart(deck, report, context(), { document, theme }),
      table: matchupsTableView(deck),
      controls,
    },
    opened,
  );
}

function roundsCard(opened) {
  const id = 'rounds';
  const view = state.views[id];
  const field = data.reports[view];
  const bracket = bracketReport(eventsFor(view), view, field);
  const controls = viewSwitch(id);
  const none = noListsCard(id, 'Conversion tour par tour', controls);
  if (none) return none;
  if (!bracket.columns.length || !bracket.decks.length) {
    return emptyCard({
      id,
      title: 'Conversion tour par tour',
      reason: 'Aucun top cut joué dans les résultats de la période.',
      controls,
    });
  }
  const theme = darkQuery.matches ? themes.dark : themes.light;
  return card(
    {
      id,
      svg: bracketChart(field, bracket, context(), { document, theme }),
      table: roundsTableView(field, bracket),
      controls,
    },
    opened,
  );
}

/** "4 × 6 · 3 × 1": the copies played, most first, and in how many lists. */
const distributionText = (distribution) =>
  distribution.map(([copies, lists]) => `${copies} × ${lists}`).join(' · ');

/** Share of the lists playing a card: a thin bar, then "7 / 8". */
function presence(row, lists) {
  const wrapper = el('span', { class: 'presence' });
  const track = el('span', { class: 'presence-track', 'aria-hidden': 'true' });
  const fill = el('span', { class: 'presence-fill' });
  fill.style.width = `${row.share}%`;
  track.append(fill);
  wrapper.append(track, el('span', {}, `${row.lists} / ${lists}`));
  return wrapper;
}

function tierTable(tier, lists) {
  return table(
    ['Coût', 'Carte', 'Listes', 'Copies (moy.)', 'Répartition'],
    tier.cards.map((c) => [
      c.cost == null ? '—' : String(c.cost),
      c.inkwell ? `${c.name} ◆` : c.name,
      presence(c, lists),
      formatNumber1(c.meanCopies),
      distributionText(c.distribution),
    ]),
    { rowHeaders: false },
  );
}

/** The top cut's decklists of one deck, card by card, in three tiers. */
function cardsCard() {
  const id = 'cards';
  const view = state.views[id];
  const title = 'Cartes du top cut';
  const controls = viewSwitch(id);
  const groups = listGroups(data.events, view);
  if (!groups.length) {
    return emptyCard({
      id,
      title,
      reason: 'Aucune decklist publique dans les top cuts de la période.',
      controls,
    });
  }

  // Each deck's builds among its top-cut lists, as sorted over the whole field
  const listCount = (n) => `${n} liste${n > 1 ? 's' : ''}`;
  const choices = [];
  const select = el('select', { 'aria-label': 'Deck analysé' });
  for (const g of groups) {
    const lists = topCutLists(data.events, view, g.key);
    const builds = new Map();
    for (const list of lists) {
      const { sub } = list.deck;
      if (!builds.has(sub.key)) builds.set(sub.key, { ...sub, lists: [] });
      builds.get(sub.key).lists.push(list);
    }
    const subs = [...builds.values()].sort((a, b) => b.lists.length - a.lists.length);
    const name = g.label ?? deckName(g.colors);
    // Options are text only: the inks as coloured-circle emoji, then the names
    if (subs.length < 2) {
      // By archetype, the deck is its one build: its name once
      const label = subs[0]?.label === name ? null : subs[0]?.label;
      choices.push({ key: g.key, group: g, lists, sub: null, subs });
      select.append(
        el(
          'option',
          { value: g.key },
          `${deckEmoji(g.colors)} ${name}${label ? ` · ${label}` : ''} · ${listCount(lists.length)}`,
        ),
      );
      continue;
    }
    const optgroup = el('optgroup', { label: `${deckEmoji(g.colors)} ${name}` });
    // The largest build first: the cards of one build are the clearest
    for (const sub of subs) {
      choices.push({ key: sub.key, group: g, lists: sub.lists, sub, subs });
      optgroup.append(
        el('option', { value: sub.key }, `${sub.label} · ${listCount(sub.lists.length)}`),
      );
    }
    choices.push({ key: g.key, group: g, lists, sub: null, subs });
    optgroup.append(
      el('option', { value: g.key }, `Toutes les listes ${name} · ${listCount(lists.length)}`),
    );
    select.append(optgroup);
  }
  const choice = choices.find((c) => c.key === state.deck) ?? choices[0];
  select.value = choice.key;
  select.addEventListener('change', () => {
    state.deck = select.value === choices[0].key ? null : select.value;
    writeUrlState();
    refresh(id, 'select');
  });
  const picker = el('label', { class: 'card-control' });
  picker.append(el('span', {}, 'Deck'), select);
  controls.prepend(picker);
  controls.classList.remove('switch-only');

  const { group, lists, sub, subs } = choice;
  const report = cardReport(lists);
  const eventCount = new Set(lists.map((l) => l.event.id)).size;

  const figure = el('figure', { class: 'card card-html', id });
  const body = el('div', { class: 'card-body' });
  const heading = el('h2', { class: 'card-title' });
  heading.append(
    chips(group.colors),
    el(
      'span',
      {},
      ` ${title} · ${group.label ?? deckName(group.colors)}${sub ? ` · ${sub.label}` : ''}`,
    ),
  );
  body.append(
    heading,
    el(
      'p',
      { class: 'card-subtitle' },
      `${report.lists} liste${report.lists > 1 ? 's' : ''} du top cut sur ${eventCount} tournoi${eventCount > 1 ? 's' : ''} · ${report.cards.length} cartes différentes · ◆ encrable`,
    ),
  );
  if (sub) {
    const total = subs.reduce((n, s) => n + s.lists.length, 0);
    body.append(
      el(
        'p',
        { class: 'card-note' },
        `Archétype : ${listCount(sub.lists.length)} sur ${total}${sub.signature.length ? `, reconnu à ${sub.signature.join(' et ')}` : ', proches d’aucun archétype du ladder'}.`,
      ),
    );
  } else if (subs.length > 1) {
    body.append(
      el(
        'p',
        { class: 'card-note' },
        `${subs.length} archétypes mélangés ici : ${subs.map((s) => `${s.label} (${s.lists.length})`).join(', ')}. Les choisir dans la liste donne des cartes plus nettes.`,
      ),
    );
  }
  // An archetype merged from near twins: how its lists split between them
  const variants = view === VIEWS.archetypes || sub ? variantSummary(lists) : null;
  if (variants) {
    body.append(el('p', { class: 'card-note' }, `Variantes de ce deck : ${variants}.`));
  }
  if (report.lists < 2) {
    body.append(
      el(
        'p',
        { class: 'card-note' },
        'Une seule liste : rien à comparer, elle est donnée telle quelle.',
      ),
    );
  }
  // A median of several builds would be none of them: only for one build
  if (sub || subs.length < 2) body.append(medianSection(lists));
  // Side by side when the card is wide enough
  const tiers = el('div', { class: 'tiers' });
  body.append(tiers);
  for (const tier of report.tiers) {
    if (!tier.cards.length) continue;
    const section = el('section', { class: 'tier' });
    const hint = {
      core: 'dans toutes les listes',
      near: `dans au moins ${formatPct(100 * config.tournaments.nearShare, 0)} des listes`,
      tech: `dans moins de ${formatPct(100 * config.tournaments.nearShare, 0)} des listes`,
    }[tier.tier];
    section.append(
      el('h3', {}, `${tier.label} (${tier.cards.length})`),
      el('p', { class: 'tier-hint' }, hint),
    );
    const scroll = el('div', { class: 'table-scroll' });
    scroll.append(tierTable(tier, report.lists));
    section.append(scroll);
    tiers.append(section);
  }
  // Where the lists come from
  const sources = el('details', { class: 'table-view' });
  const scroll = el('div', { class: 'table-scroll' });
  scroll.append(
    table(
      ['Tournoi', 'Date', 'Place', 'Deck'],
      lists.map((l) => {
        const link = el('a', { href: tournamentUrl(l.event) }, l.event.name);
        return [
          link,
          formatDay(l.event.date),
          l.standing == null ? '—' : `${l.standing}e`,
          deckCell({ colors: l.deck.colors, label: l.deck.archetype?.name }),
        ];
      }),
    ),
  );
  sources.append(el('summary', {}, 'Voir les listes analysées'), scroll);
  figure.append(controls, body, sources);
  return figure;
}

/** The tournaments counted, with their top cut and whether it was assumed. */
function tournamentsCard() {
  const figure = el('figure', { class: 'card card-html', id: 'tournaments' });
  const body = el('div', { class: 'card-body' });
  body.append(
    el('h2', { class: 'card-title' }, 'Tournois retenus'),
    el(
      'p',
      { class: 'card-subtitle' },
      `Tournois core de plus de ${minPlayers} joueurs, du ${formatDay(data.index.window.from)} au ${formatDay(data.index.window.to)}`,
    ),
  );
  const scroll = el('div', { class: 'table-scroll' });
  scroll.append(
    table(
      ['Tournoi', 'Date', 'Lieu', 'Joueurs', 'Decks connus', 'Top cut', 'Listes publiques'],
      data.events.map((e) => [
        el('a', { href: tournamentUrl(e) }, e.name),
        formatDay(e.date),
        [e.city, e.country].filter(Boolean).join(', ') || '—',
        formatInt(e.players.length),
        formatInt(e.players.filter((p) => p.deck).length),
        `top ${e.cut.size}${e.cut.assumed ? ' (supposé)' : ''}`,
        e.decklistsAvailable
          ? `${formatInt(e.players.filter((p) => p.list).length)} (${formatInt(e.players.filter((p) => p.list && p.topCut).length)} au top cut)`
          : 'privées',
      ]),
    ),
  );
  body.append(scroll);
  figure.append(body);
  return figure;
}

const CARDS = {
  field: fieldCard,
  conversion: conversionCard,
  rounds: roundsCard,
  matchups: matchupsCard,
  cards: cardsCard,
  tournaments: tournamentsCard,
};

function buildCard(id, opened) {
  return CARDS[id](opened);
}

function renderCharts() {
  const opened = openedTables();
  $('charts').replaceChildren(...Object.keys(CARDS).map((id) => buildCard(id, opened)));
}

// --- Data ---

/** "top 8 de 64 à 127 joueurs, top 16 de 128 à 255…": the assumed cut, from the settings. */
function cutRuleText() {
  const first = assumedCutSize(minPlayers + 1);
  const steps = [first, first * 2, first * 4].map(
    (size) =>
      `top ${size} de ${Math.max(size * assumedCutRatio, minPlayers + 1)} à ${size * 2 * assumedCutRatio - 1} joueurs`,
  );
  return `Sans top cut dans les résultats, on retient la plus grande puissance de 2 jusqu'à un joueur sur ${assumedCutRatio} : ${steps.join(', ')}…`;
}

function showError(message) {
  $('subtitle').textContent = message;
  $('kpis').replaceChildren();
  $('charts').replaceChildren();
}

async function load() {
  $('cut-rule').textContent = cutRuleText();
  let index;
  try {
    index = await fetchJson(`${DATA_URL}index.json`);
  } catch (error) {
    console.error(error);
    // Missing: a 404, or the dev server's fallback page in place of the JSON
    showError(
      error.status === 404 || error instanceof SyntaxError
        ? 'Pas encore de données : la collecte des tournois Lorcanahunter n’a pas encore tourné.'
        : 'Impossible de charger les données.',
    );
    return;
  }
  const listed = eventsSince(index.tournaments, index.window.from);
  const events = await Promise.all(listed.map((t) => fetchJson(`${DATA_URL}events/${t.id}.json`)));
  // Every public list of the period into its ladder archetype, once: every view by archetype
  // reads it. Without the archetypes' average lists, each list goes to its inks' "Autres listes"
  const stored = await fetchJson(`../${LADDER_QUEUE}/profiles.json`).catch(() => null);
  assignArchetypes(events, keyedProfiles(stored?.profiles ?? []));
  // By archetype, only the tournaments whose field outside the top cut is mostly listed: the
  // top cut's lists are all public, so a thin sample of the others would inflate every conversion
  const { minListShare } = config.tournaments;
  const listedEvents = events.filter((e) => {
    const rest = e.players.filter((p) => p.deck && !p.topCut);
    return rest.filter((p) => p.list).length >= minListShare * rest.length;
  });
  data = { index, events, listedEvents, matchups: matchupReport(events) };
  data.reports = Object.fromEntries(
    ALL_VIEWS.map((view) => [view, fieldReport(eventsFor(view), view)]),
  );
  $('subtitle').textContent =
    `Tournois core de plus de ${minPlayers} joueurs sur ${config.tournaments.windowDays} jours, du ${formatWeekRange(index.window.from, index.window.to)} · données Lorcanahunter du ${formatUpdatedAt(index.collectedAt)}`;
  if (!events.length) {
    $('kpis').replaceChildren();
    $('charts').replaceChildren(
      el('p', { class: 'error' }, 'Aucun tournoi core de cette taille sur la période.'),
    );
    return;
  }
  renderKpis();
  renderCharts();
}

// --- Single tooltip: first line = context, second line = the highlighted value ---

const tooltip = $('tooltip');

function showTip(target, x, y) {
  const [label, value, ...rest] = target.getAttribute('data-tip').split('\n');
  const nodes = [];
  if (value) nodes.push(el('strong', {}, value));
  nodes.push(el('div', {}, label));
  for (const line of rest) nodes.push(el('div', {}, line));
  tooltip.replaceChildren(...nodes);
  tooltip.hidden = false;
  placeTip(x, y);
}

function placeTip(x, y) {
  const { width, height } = tooltip.getBoundingClientRect();
  const left = x + 14 + width > window.innerWidth ? x - 14 - width : x + 14;
  const top = y + 14 + height > window.innerHeight ? y - 14 - height : y + 14;
  tooltip.style.left = `${Math.max(4, left)}px`;
  tooltip.style.top = `${Math.max(4, top)}px`;
}

const tipTarget = (event) => event.target.closest?.('[data-tip]');

document.addEventListener('pointerover', (event) => {
  const target = tipTarget(event);
  if (target) showTip(target, event.clientX, event.clientY);
});
document.addEventListener('pointermove', (event) => {
  if (!tooltip.hidden && tipTarget(event)) placeTip(event.clientX, event.clientY);
});
document.addEventListener('pointerout', (event) => {
  if (tipTarget(event)) tooltip.hidden = true;
});
document.addEventListener('focusin', (event) => {
  const target = tipTarget(event);
  if (!target) return;
  const rect = target.getBoundingClientRect();
  showTip(target, rect.right, rect.top);
});
document.addEventListener('focusout', () => {
  tooltip.hidden = true;
});

darkQuery.addEventListener('change', () => {
  if (data?.events.length) renderCharts();
});

load();
