/**
 * Reads and writes the collected data (Node only).
 *
 * data/<queue>/index.json         available weeks, eras, queue name
 * data/<queue>/weeks/<start>.json  snapshot of a week (stable fields, plus archetypes if any)
 * data/episodes/index.json         podcast episodes, newest first
 * data/episodes/<start>/           an episode's script.json and episode.mp3
 */
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url));

const queueDir = (queue) => path.join(DATA_DIR, queue);
const weeksDir = (queue) => path.join(queueDir(queue), 'weeks');

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJson(file, data, { pretty = false } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, pretty ? 2 : undefined)}\n`);
}

export const readIndex = (queue) => readJson(path.join(queueDir(queue), 'index.json'));

export const writeIndex = (queue, index) =>
  writeJson(path.join(queueDir(queue), 'index.json'), index, { pretty: true });

export const readWeek = (queue, startDate) =>
  readJson(path.join(weeksDir(queue), `${startDate}.json`));

export const writeWeek = (queue, snapshot) =>
  writeJson(path.join(weeksDir(queue), `${snapshot.week.startDate}.json`), snapshot);

export async function readAllWeeks(queue) {
  let files;
  try {
    files = await readdir(weeksDir(queue));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const names = files.filter((f) => f.endsWith('.json')).sort();
  return Promise.all(names.map((f) => readJson(path.join(weeksDir(queue), f))));
}

const EPISODES_DIR = path.join(DATA_DIR, 'episodes');

/**
 * Stores a podcast episode under data/episodes/<start>/ and lists it in the index, replacing
 * the week's earlier episode if any. Paths in the index are relative to data/episodes/, as the
 * site serves it.
 *
 * @param {object} script out/podcast/script.json
 * @param {string} audioFile the episode's MP3
 * @param {object} details { duration (seconds), voiceModel }
 */
export async function writeEpisode(script, audioFile, details) {
  const { startDate } = script.week;
  const dir = path.join(EPISODES_DIR, startDate);
  await writeJson(path.join(dir, 'script.json'), script, { pretty: true });
  await copyFile(audioFile, path.join(dir, 'episode.mp3'));

  const indexFile = path.join(EPISODES_DIR, 'index.json');
  const index = (await readJson(indexFile)) ?? { episodes: [] };
  const episode = {
    week: script.week,
    title: script.title,
    summary: script.summary,
    formats: script.formats ?? [],
    duration: Math.round(details.duration),
    audio: `${startDate}/episode.mp3`,
    script: `${startDate}/script.json`,
    scriptModel: script.model,
    voiceModel: details.voiceModel,
  };
  const episodes = [episode, ...index.episodes.filter((e) => e.week.startDate !== startDate)];
  episodes.sort((a, b) => b.week.startDate.localeCompare(a.week.startDate));
  await writeJson(indexFile, { episodes }, { pretty: true });
  return path.relative(process.cwd(), dir);
}
