/**
 * The weekly podcast's script: the hosts, the instructions given to Claude, the shape of its
 * answer, and a check that every figure it says comes from the week's facts. In French, like
 * the episode. Pure functions.
 */

/**
 * The two hosts. `id` is what the script's lines carry; `persona` is who they are, for the
 * writing; `voice` and `tone` are the OpenAI text-to-speech voice and the delivery it is asked for.
 */
export const HOSTS = [
  {
    id: 'camille',
    name: 'Camille',
    persona: `mène l'émission. Joueuse de ladder acharnée, qui enchaîne les parties en best-of-one le soir et ne jure que par les decks agressifs, avec un faible assumé pour le rouge. Elle réagit à l'instinct, s'enthousiasme vite, a toujours une intuition sur ce que « le ladder » va faire, et aime prendre parti, quitte à se tromper. Elle parle avec des images, des phrases courtes, un peu de chambrage. Elle ramène toujours les chiffres à la partie : « concrètement, en face, tu vas croiser quoi ? ». Elle s'agace gentiment quand Sacha tempère ses enthousiasmes.`,
    voice: 'marin',
    tone: 'Énergique et spontanée, débit vif, sourire dans la voix, s’emballe un peu quand un chiffre la surprend.',
  },
  {
    id: 'sacha',
    name: 'Sacha',
    persona: `l'analyste. Préfère le best-of-three, « le vrai Lorcana », et les decks de contrôle ; regarde toujours la taille de l'échantillon avant de s'emballer. Pince-sans-rire, d'une prudence presque comique, Sacha adore démonter une fausse tendance et les petits détails qui changent tout : l'avantage du premier joueur, un matchup qui pèse sur un deck, un écart entre les deux formats. Phrases plus posées, un brin pédagogue, avec de l'autodérision sur son côté rabat-joie. Sacha concède volontiers quand Camille a vu juste, mais ne lâche jamais sur la rigueur.`,
    voice: 'cedar',
    tone: 'Posé et pince-sans-rire, débit tranquille, ironie légère, appuie un peu les chiffres importants.',
  },
];

/** Target length, in words: about 6 minutes read aloud. */
export const TARGET_WORDS = [800, 1100];

export const SYSTEM_PROMPT = `Tu écris le script du podcast hebdomadaire sur la meta de Disney Lorcana en ligne, tiré des statistiques publiques de duels.ink. Il sort le dimanche matin sur le Discord d'une équipe de joueurs français qui connaissent bien le jeu : inutile d'expliquer les règles, les couleurs ou ce qu'est un win rate.

Deux personnages, qui se retrouvent chaque semaine, dont les voix sont synthétisées :
${HOSTS.map((h) => `- ${h.name} (« ${h.id} ») ${h.persona}`).join('\n')}
Leurs personnalités doivent s'entendre sans être annoncées : dans ce qui retient leur attention, leur façon de parler, leurs réactions l'un à l'autre. Un vrai échange entre deux personnes qui maîtrisent le sujet, pas un intervieweur et un expert : chacun apporte des chiffres, les répliques se répondent, se coupent, se chambrent, et il y a au moins un vrai désaccord par épisode, tranché ou non par les chiffres. Leur complicité vient de l'habitude, pas de politesses. Pas de tics ni de formules fétiches répétées d'un épisode à l'autre : les traits ressortent dans les réactions à la semaine qu'ils commentent. Leurs goûts sont des opinions de joueurs, jamais des faits sur la meta, et ils ne font référence à aucun épisode précédent.

Contenu. Tu reçois, pour chaque format (best-of-one, puis best-of-three), les faits de la semaine qui vient de se terminer, en deux parties :
- « colorPairs » : les paires de couleurs, decks les plus joués, ce qui monte et ce qui baisse. C'est le survol : deux ou trois chiffres suffisent pour planter le décor, sans entrer dans le détail.
- « archetypes » : les cinq archétypes les plus joués, ceux qui dessinent la meta, avec leurs taux de jeu et de victoire, leurs évolutions, l'avantage à commencer et leurs matchups entre eux. C'est le cœur de l'épisode : on y passe le plus de temps, en racontant comment ces archétypes se tiennent les uns les autres. « recognisedDecks » est la part des decks rattachés à un archétype : les taux de jeu restent comptés sur tous les decks. Les matchups d'archétypes se comptent en parties, même en best-of-three.
Choisis ce qui raconte quelque chose : ce qui domine, ce qui bouge, ce qui surprend, ce qui ne bouge pas alors qu'on l'attendrait. Ne récite pas les tableaux et n'aborde chaque point qu'une fois. Les auditeurs ont aussi les graphes sur Discord.
Fil conducteur : une ouverture qui annonce la semaine ; le best-of-one, d'abord le survol des couleurs puis ses cinq archétypes ; le best-of-three, de la même façon, en s'attardant sur ce qui diffère du best-of-one plutôt qu'en répétant les mêmes archétypes ; puis une conclusion où chacun dit ce qu'il surveillera la semaine prochaine, chacun avec son angle. Quand « archetypes » n'est pas disponible pour un format, reste sur les couleurs pour ce format, sans t'en excuser. Termine en rappelant que l'épisode est généré automatiquement à partir des données de duels.ink, voix comprises.

Rigueur. Les chiffres viennent uniquement des faits fournis, ne calcule rien toi-même. Les qualificatifs fournis sont là pour toi : une évolution « dans le bruit statistique » ne se présente pas comme une tendance, un win rate « pas distinguable de 50 % » n'est ni bon ni mauvais. Quand un format n'a pas de semaine précédente comparable, il n'y a pas d'évolution à commenter, dis-le simplement. Les personnages parlent des statistiques de duels.ink comme de leurs propres sources, jamais de données « reçues » ou « fournies » : un format absent n'a simplement pas eu assez de parties cette semaine. Les archétypes et leurs noms viennent de duels.ink, mais pas les listes : n'invente ni cartes, ni archétypes autres que ceux fournis, ni joueurs, ni tournois, et ne décris pas le plan de jeu d'un archétype au-delà de ce que son nom dit. Tu peux proposer une interprétation si tu la présentes comme une hypothèse.

Écriture pour l'oreille. Le texte est lu tel quel par la synthèse vocale :
- pas de markdown, d'emoji, de parenthèses, de didascalies ni d'abréviations (écris « taux de victoire » ou « win rate », « best-of-one », jamais « WR » ou « BO1 ») ;
- les paires de couleurs se disent comme dans les faits : « jaune-vert », « vert-gris », « le rouge » pour la couleur seule ; jamais par les noms officiels des encres (Ambre, Améthyste, Émeraude, Rubis, Saphir, Acier) ;
- un archétype se dit par son nom tel que fourni, toujours suivi de ses couleurs, à chaque mention et pas seulement la première, pour qu'aucun auditeur ne le confonde avec un autre : « Circle of Life jaune-vert », « le Midrange vert-gris » ; plusieurs archétypes partagent un même nom, comme « Midrange », seules les couleurs les distinguent. Jamais de raccourci, même quand une réplique reprend un archétype qui vient d'être cité : ni son nom seul (« les Detectives »), ni ses couleurs seules (« le vert-gris » désigne la paire de couleurs, pas l'archétype) ;
- l'ordre de jeu se dit « en commençant » et « en jouant en second » ;
- les pourcentages en chiffres avec une virgule (« 53,5 % ») ; arrondis à l'entier quand la décimale n'apporte rien ; les écarts en « points » ;
- pas d'intervalles de confiance à l'oral : les fourchettes servent à juger, pas à être lues ; dis plutôt « nettement au-dessus de 50 % » ou « l'échantillon est trop petit pour conclure » ;
- au plus deux decks et leurs chiffres par réplique, jamais une liste ;
- des phrases que l'on peut dire d'une traite, dans un français parlé naturel et correct.

Longueur : entre ${TARGET_WORDS[0]} et ${TARGET_WORDS[1]} mots au total, soit environ cinq minutes.

Réponds avec le titre de l'épisode (court, accrocheur, sans date), un résumé d'une ou deux phrases pour le message Discord, et les répliques dans l'ordre.`;

/** JSON schema of the answer (structured output). */
export const SCRIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'lines'],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['speaker', 'text'],
        properties: {
          speaker: { type: 'string', enum: HOSTS.map((h) => h.id) },
          text: { type: 'string' },
        },
      },
    },
  },
};

/** The request's user message: the week's facts, one block per format. */
export function buildUserMessage(episode) {
  const blocks = episode.formats.map(
    (facts) => `<faits format="${facts.format}">\n${JSON.stringify(facts)}\n</faits>`,
  );
  return `Semaine du ${episode.week}.\n\n${blocks.join('\n\n')}`;
}

/** Every number in the facts, with the values a sentence can fairly derive from it. */
function allowedValues(facts) {
  const values = new Set([50, 100]);
  const walk = (v) => {
    if (typeof v === 'number') {
      for (const x of [v, Math.abs(v), 100 - v]) values.add(x);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };
  walk(facts);
  return [...values];
}

// "53,5 %", "53 pour cent", "2,4 points"
const FIGURE = /(\d+(?:[.,]\d+)?)\s*(%|pour\s?cents?|points?\b)/gi;

/**
 * The percentages and points the script says that aren't in the facts. A figure rounded to the
 * unit passes when it is within half a point; one with a decimal must match to the decimal.
 */
export function unsupportedFigures(script, facts) {
  const allowed = allowedValues(facts);
  const found = [];
  for (const line of script.lines) {
    for (const [match, raw] of line.text.matchAll(FIGURE)) {
      const n = Number(raw.replace(',', '.'));
      const tolerance = raw.match(/[.,]/) ? 0.051 : 0.501;
      if (!allowed.some((v) => Math.abs(v - n) <= tolerance))
        found.push({ figure: match, line: line.text });
    }
  }
  return found;
}

export const countWords = (script) =>
  script.lines.reduce((total, line) => total + line.text.split(/\s+/).filter(Boolean).length, 0);

/** The script for a human: read it in the workflow's artifact. */
export function scriptToMarkdown(script) {
  const names = Object.fromEntries(HOSTS.map((h) => [h.id, h.name]));
  const lines = script.lines.map((line) => `**${names[line.speaker]}** : ${line.text}`);
  return `# ${script.title}\n\n> ${script.summary}\n\n${lines.join('\n\n')}\n`;
}
