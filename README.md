# duels-meta-tracker

Weekly tracking of the Lorcana meta from the public statistics of
[duels.ink](https://duels.ink/stats) (`/api/stats/meta` endpoint):

- **collection** every morning into `data/`: finished weeks, to keep the history, and the week
  in progress;
- **web page** (d3.js), refreshed every morning: meta of the week, trends, matchup matrix;
- **Discord digest** posted on Sunday morning for the week that just ended, with the same charts
  as images, one message for BO1 and one for BO3, to prepare the team's training sessions;
- **podcast**, posted with it: Camille and Sacha comment the week in about five minutes (script
  by Claude, voices by OpenAI text-to-speech), each episode also kept on the site.

The page is one tool of a small site whose homepage lists them, each in its own folder: the meta
page in `meta/`, a [proxy generator](#proxy-generator) in `proxies/`, which prints a
dreamborn.ink deck to try it before buying the cards, and the weekly podcast in `podcast/`: the
episodes, each with its transcript scrolling along with the audio and links to the meta page on
the week it covers.

The code and docs are in English; the charts, the page and the Discord message are in French,
for the team. Decks are shown by their two ink chips (coloured-circle emoji in the Discord
text); names remain in tooltips and for screen readers.

> Data: © Duels.ink — `updatedAt` and the number of games are shown under every chart, with a
> link to https://duels.ink/stats, as the API docs ask.

## How it works

```
Daily data aggregation — every day at 4:30 in Paris (02:30 / 03:30 UTC)
  npm run collect    → data/<queue>/weeks/<start>.json   (committed automatically)
  Website deploy     → npm run build → dist/ (homepage, meta/, data) → GitHub Pages

Weekly Discord report — right after the daily aggregation, on Sundays
  npm run digest          → out/digest/{bo1,bo3}/*.png + digest.json + facts.json   (last finished week)
  npm run podcast:script  → out/podcast/script.json   (Claude; every figure checked against facts.json)
  npm run podcast:audio   → data/episodes/<start>/episode.mp3 + script.json   (committed automatically)
  Website deploy          → the new episode on the site, before Discord links to it
  post-discord.js         → two messages: the episode, its MP3 attached; then the charts, one
                            compact card per format (BO1, then BO3), each in a 2×2 grid
```

The podcast steps may fail (an API down, a script whose figures aren't all in the data): the
charts still go out, without an episode.

Every push to `main` (a merged pull request included) also rebuilds and redeploys the page
([website-deploy.yml](.github/workflows/website-deploy.yml)), the same workflow the daily
aggregation calls after committing its data; deployments run one at a time.

The charts are written once (`src/charts/`): the page renders them in the browser, the digest
renders them in Node (jsdom + resvg, bundled Inter font), with no headless browser.

Discord gets the charts that compare the week with the previous one (S−1):

| Chart                        | What it shows                                                                                                                        | Discord |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| Méta de la semaine           | Play rate and win rate (95% interval), with last week's values and the changes (Δ)                                                   | ✓       |
| Carte du méta                | Each deck's ink chips at play rate × win rate, with an arrow from where it stood last week                                           | ✓       |
| Mouvements de la semaine     | Change in play rate and in win rate per deck, coloured only when it beats the noise                                                  | ✓       |
| Matchups — 4 semaines        | Win rate of the row deck against the column deck; ▲▼ when this week clearly differs                                                  |         |
| Évolution                    | Each deck's play rate (left scale) and win rate (right scale) week by week, on one plot: 12 weeks on the page, the last 2 in Discord | ✓       |
| Fiche deck                   | One deck (picked on the page) against the other shown decks, most frequent opponents first                                           |         |
| Commencer ou jouer en second | Each deck's win rate going first and going second, and the gap                                                                       |         |

Settings (collected queues, number of decks shown — `topDecks`, the 12 most played, used by every
chart, table and summary —, number of weeks, thresholds) live in [src/config.js](src/config.js).

### Queues and set betas

`config.queues` lists the collected queues in priority order. The page features the first one
that has data for the last finished week and lets you switch to the others. The digest does the
same per format (BO1, BO3) and skips a format whose queue has no data for the week that just
ended, so a closed queue never gets its last week posted again.

The ranked queues keep their id from one set to the next (`core-bo1` is "Core Set 14 BO1" since
Set 14's release), so they are collected as `<queue>@<era>`, with the API's `era` filter: only
that set's games, stored in `data/<queue>@<era>/`. The release week then holds only the games
played after the release, rather than a mix of two sets. Era keys are in the API's `meta.eras`;
an unknown key would silently give the current era, so the collector rejects it.

Every stat is kept to the top of the ladder: a `+<rank>` suffix applies the API's `ranks` filter,
which keeps the games where **both** players are at that rank or above (`+legendary`: Legendary,
Epic, Enchanted, Iconic; `+super-rare` and the others work the same way). An unknown rank would be
silently ignored, so the collector checks `meta.appliedRanks`. The filter only exists on ranked
queues: the unranked betas can't be collected this way. In the week of October 11, Legendary and
above was 23 569 of the 137 103 BO1 games, and 828 of the 31 858 BO3 matches: BO3 matchups stay
thin until a few weeks add up.

Right now: `core-bo1@set-14-core+legendary` and `core-bo3@set-14-core+legendary`. At a new set,
switch both to `<queue>@<new era>+legendary` at release. A closed queue keeps the eras it had while
open, since the API then answers with its format's eras, and a ranked queue kept to an earlier set
keeps that set's name.

In BO3 queues the API counts decks and matchups in **matches** (and `activity.totalGames` in
single games): win rates are match win rates, and every count is shown as "matchs".

## Proxy generator

`proxies/` turns a public [dreamborn.ink](https://dreamborn.ink) deck into a PDF to print: paste
the deck's link, set the copies to print (0 for cards already owned), pick French or English
images, download. Cards come at their real size (63 × 88 mm), 3 × 3 per A4 page, edge to edge:
one cut separates two cards, and a cut a little off the line still lands on their black borders.
A thin grey guide runs along every card edge, light over the cards, where black borders hide the
edge, and out to the page's edges to line up a ruler or a paper trimmer. Print at 100 %, not "fit
to page". `?deck=<id>` opens the page on a deck.

It all runs in the browser. dreamborn has no public deck API, but a public deck's page embeds the
deck list (card ids and counts) in its Nuxt payload, and both the page and the card images
(`cdn.dreamborn.ink`) are served with `Access-Control-Allow-Origin: *`. That shape isn't a
contract: if dreamborn changes it, the page says the deck can't be read and
[src/lib/dreamborn.js](src/lib/dreamborn.js) needs updating. Cards missing in French (often
promos) are printed in English.

## Setup

```bash
nvm use        # Node 24 (.nvmrc)
npm install

npm run collect    # first run: backfills every week the API exposes (~40 s)
npm run dev        # homepage on http://localhost:5173, then /meta/ and /proxies/
npm run digest     # out/digest/bo1/ and bo3/ (--theme light, --week 2026-09-27, --queue core-bo1)
```

## GitHub setup

1. In Discord: channel settings → Integrations → Webhooks → New Webhook → copy the URL.
2. Store it as a repository secret: `gh secret set DISCORD_WEBHOOK_URL` (or **Settings →
   Secrets and variables → Actions**).
3. For the podcast, store the API keys the same way: `gh secret set ANTHROPIC_API_KEY` and
   `gh secret set OPENAI_API_KEY`. Without them the podcast steps fail and the charts go out
   alone.
4. Optional: **Settings → Pages → Source: GitHub Actions** to publish the page. On a private
   repo this needs GitHub Pro, and the published site is public. Without Pages, the deploy job
   fails but the Discord message still goes out, without a link.
5. **Actions → Weekly Discord report → Run workflow** to test: the episode then stays in the
   run's artifact; tick "Post to Discord and publish the podcast episode" to send the messages
   and commit the episode.

Both workflows then run on their own: the aggregation every morning, the report on Sundays.
Locally, `npm run post:discord` reads the webhook from `.env` (see `.env.example`);
`-- --dry-run` prints the messages without sending them.

## Scripts

| Command                  | Purpose                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| `npm run collect`        | Stores finished weeks that are missing or have changed            |
| `npm run digest`         | Renders one digest (images + message) per format                  |
| `npm run post:discord`   | Posts the podcast, then the charts, to Discord                    |
| `npm run podcast:script` | Writes the podcast script with Claude (`ANTHROPIC_API_KEY`)       |
| `npm run podcast:audio`  | Reads the script aloud into an MP3 (`OPENAI_API_KEY`, ffmpeg)     |
| `npm run costs`          | Local API costs dashboard, never published (admin keys in `.env`) |
| `npm run dev`            | Web page locally                                                  |
| `npm run build`          | Static build into `dist/`                                         |
| `npm run check:api`      | API smoke test + payload summary                                  |
| `npm run format`         | Prettier formatting                                               |

## Notes on the data

- Only the fields documented as **stable** are stored. Play rate isn't one of them, so it is
  recomputed (the deck's `games` / total decks played).
- Weeks run Sunday to Saturday. duels.ink computes them every night around 01:30 UTC and
  freezes them after Saturday's computation, so the rest of Saturday is never counted. The
  collector stores the week in progress too and fetches a week again whenever its game count
  in `availableWeeks` changes: daily while it runs, rarely afterwards. The page shows the week
  in progress, marked "en cours"; the digest always covers the last finished week.
- A chart is only shown with enough data to say something (`minWeekSample`, 500 games or BO3
  matches a week; a previous week under it isn't compared with; Évolution needs two such weeks;
  the matchup matrix and deck sheet need half their cells over 100 games). Otherwise the page
  shows a note with the reason and Discord leaves the chart out — a text-only card if none is
  left.
- A single week is too thin for matchups (many cells under 100 games): the matrix sums 4
  weeks, never reaching back before the current set's release.
- A change is shown as real only when its 95% interval excludes 0 (grey otherwise). Matchup
  flags compare this week alone with the window's earlier weeks (independent samples) and need a
  ≥ 5-point gap at ~99.7%, since about a hundred cells are tested each week.
- "Meilleur win rate" (best win rate) is ranked on the lower bound of the confidence interval,
  so a rarely played deck that got lucky doesn't come out on top.

## Structure

```
src/config.js          settings
src/lib/               API client, storage, computations, formatting, PNG rendering;
                       dreamborn deck reader and proxy PDF for the proxy generator
src/charts/            d3 charts (shared by the page and the digest)
scripts/               collection, digest, podcast script and audio, Discord posting
web/                   site (Vite): homepage, common.css shared by every page, one folder per tool
web/meta/              meta page
web/proxies/           proxy generator
web/podcast/           podcast playlist; episode/ plays one, its transcript following the audio
data/                  collected data and podcast episodes (committed)
assets/fonts/          Inter (OFL) for PNG rendering
```
