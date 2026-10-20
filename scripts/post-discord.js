// Posts the week to a Discord channel through a webhook, in two messages: the podcast episode
// when there is one (out/podcast/, from npm run podcast:script and podcast:audio), its MP3
// attached; then the digests rendered by `npm run digest`, one card per format, BO1 first.
// Env: DISCORD_WEBHOOK_URL (required). In CI, the Weekly Discord report workflow also sets
// SITE_URL to the GitHub Pages address (the site's root) so each message links to the meta page
// on its queue, and the podcast to its episode page; it's empty when Pages is off.
// Usage: npm run post:discord [-- --dry-run]
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { SOURCE_URL } from '../src/config.js';

const OUT_DIR = fileURLToPath(new URL('../out/digest/', import.meta.url));
const PODCAST_DIR = fileURLToPath(new URL('../out/podcast/', import.meta.url));
// The charts' accent blue, as an integer for the embeds' side bar.
const EMBED_COLOR = 0x3987e5;

const { values: args } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });

// out/digest/bo1/, out/digest/bo3/: alphabetical order is the posting order.
const entries = await readdir(OUT_DIR, { withFileTypes: true }).catch(() => []);
const digests = [];
for (const entry of entries
  .filter((e) => e.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name))) {
  const dir = path.join(OUT_DIR, entry.name);
  const digest = JSON.parse(await readFile(path.join(dir, 'digest.json'), 'utf8'));
  digests.push({ dir, digest });
}

// The episode, only once its audio exists (the script alone isn't worth a message)
const episodeScript = await readFile(path.join(PODCAST_DIR, 'script.json'), 'utf8')
  .then(JSON.parse)
  .catch(() => null);
const episodeAudio = episodeScript
  ? await readFile(path.join(PODCAST_DIR, 'episode.mp3')).catch(() => null)
  : null;
const episode = episodeAudio ? { script: episodeScript, audio: episodeAudio } : null;

if (!digests.length && !episode) {
  console.log('No digest to post.');
  process.exit(0);
}

/** A page of the published site (null when Pages is off). */
function siteLink(pagePath, params) {
  // Missing or not a URL (e.g. an API error message): no link rather than a crash
  if (!process.env.SITE_URL || !URL.canParse(process.env.SITE_URL)) return null;
  // The root's trailing slash keeps its last path segment
  const root = process.env.SITE_URL.replace(/\/?$/, '/');
  const link = new URL(pagePath, root);
  for (const [name, value] of Object.entries(params)) link.searchParams.set(name, value);
  return link.href;
}

/** Every chart of the meta page (its card ids), to open them all by archetype. */
const PAGE_CHARTS = ['meta', 'carte', 'mouvements', 'evolution', 'matchups', 'fiche', 'premier'];

/**
 * The meta page, opened on the digest's queue and week, in the digest's view. The week matters:
 * the page otherwise opens on the week in progress, not the one the card describes.
 */
const pageLink = (digest) =>
  siteLink('meta/', {
    queue: digest.queue,
    week: digest.week.startDate,
    ...(digest.view === 'archetypes' ? { archetypes: PAGE_CHARTS.join(',') } : {}),
  });

/**
 * A digest's images, named after their format (bo1-meta.png): both formats' cards share one
 * message, where the attachment names must be unique.
 */
const imagesOf = ({ dir, digest }) =>
  digest.images.map((image) => ({
    name: `${path.basename(dir)}-${image.file}`,
    file: path.join(dir, image.file),
  }));

/** A format's card: one embed per image, the first carrying the text. */
function cardEmbeds(entry) {
  const { digest } = entry;
  const page = pageLink(digest);
  const { title, description, footer } = digest.card;
  // Embeds sharing the same url are shown by Discord as a single card with a 2×2 image grid;
  // the other format's card, with its own url, stays a card of its own.
  const url = page ?? SOURCE_URL;
  // A card can come without images, when the week had too little data
  const [first, ...others] = imagesOf(entry);
  return [
    {
      author: { name: 'Source : duels.ink', url: SOURCE_URL },
      title,
      url,
      description: page ? `${description}\n[Graphes interactifs](${page})` : description,
      color: EMBED_COLOR,
      ...(first ? { image: { url: `attachment://${first.name}` } } : {}),
      footer: { text: footer },
    },
    ...others.map((image) => ({ url, image: { url: `attachment://${image.name}` } })),
  ];
}

/** The charts message: every format's card (BO1, then BO3) in one message. */
function chartsPayload(entries) {
  const images = entries.flatMap(imagesOf);
  return {
    embeds: entries.flatMap(cardEmbeds),
    attachments: images.map((image, id) => ({ id, filename: image.name })),
    allowed_mentions: { parse: [] },
  };
}

/**
 * The podcast message: plain text, so Discord shows the attached MP3 with its own player right
 * under it (an embed would push the player below the card).
 */
function episodePayload({ script }) {
  const page = siteLink('podcast/episode/', { week: script.week.startDate });
  const lines = [`🎙️ **Le podcast de la semaine · ${script.title}**`, script.summary];
  if (page) lines.push(`[Écouter avec la transcription](<${page}>)`);
  lines.push('-# Épisode généré automatiquement : script écrit par Claude, voix synthétisées.');
  return {
    content: lines.join('\n'),
    attachments: [{ id: 0, filename: 'episode.mp3', description: script.title }],
    allowed_mentions: { parse: [] },
  };
}

if (args['dry-run']) {
  const payloads = [];
  if (episode) payloads.push(episodePayload(episode));
  if (digests.length) payloads.push(chartsPayload(digests));
  console.log(JSON.stringify(payloads, null, 2));
  process.exit(0);
}

const webhook = process.env.DISCORD_WEBHOOK_URL;
if (!webhook) throw new Error('DISCORD_WEBHOOK_URL is missing (see .env.example)');

/** One message: its payload and files ({ name, bytes, type }). */
function send(payload, files) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  for (const [id, file] of files.entries()) {
    form.append(`files[${id}]`, new Blob([file.bytes], { type: file.type }), file.name);
  }
  const url = new URL(webhook);
  url.searchParams.set('wait', 'true');
  return fetch(url, { method: 'POST', body: form });
}

async function post(label, payload, files) {
  let res = await send(payload, files);
  if (res.status === 429) {
    const { retry_after: retryAfter = 5 } = await res.json();
    await sleep(retryAfter * 1000);
    res = await send(payload, files);
  }
  if (!res.ok) throw new Error(`Discord answered ${res.status} for ${label}: ${await res.text()}`);
}

// The podcast first, then the charts it talks about
const messages = [];
if (episode) {
  messages.push(async () => {
    const file = { name: 'episode.mp3', bytes: episode.audio, type: 'audio/mpeg' };
    await post('the podcast', episodePayload(episode), [file]);
    console.log(`Posted the podcast for the week of ${episode.script.week.startDate}.`);
  });
}
if (digests.length) {
  messages.push(async () => {
    const files = [];
    for (const image of digests.flatMap(imagesOf)) {
      files.push({ name: image.name, bytes: await readFile(image.file), type: 'image/png' });
    }
    await post('the charts', chartsPayload(digests), files);
    for (const { digest } of digests) {
      console.log(`Posted the ${digest.queue} digest for the week of ${digest.week.startDate}.`);
    }
  });
}

for (const [i, message] of messages.entries()) {
  // A short pause keeps the messages in order and clear of Discord's rate limit.
  if (i > 0) await sleep(1000);
  await message();
}
