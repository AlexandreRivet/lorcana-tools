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
dreamborn.ink deck to try it before buying the cards, the weekly podcast in `podcast/`: the
episodes, each with its transcript scrolling along with the audio and links to the meta page on
the week it covers, and the [tournaments page](#tournaments) in `tournaments/`, from
Lorcanahunter's results.

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

### Archetypes

Every page (meta, digest and podcast, tournaments, preparation) knows the same archetypes, the
ladder's, told apart by what they play rather than by their ids or names
([src/lib/archetypes.js](src/lib/archetypes.js)). duels.ink gives an archetype a new id whenever it
clusters the lists again, and a new slug and name when it picks other key cards (Detectives went
from `higgins-mickey` to `judy-darkwing`), so weeks collected on different days know one archetype
under several.

- `npm run collect` stores each week's archetypes with their average list (`cards`: average copies
  per card, by name; weeks stored before are fetched once more), and `data/<queue>/profiles.json`,
  today's archetypes over the set: each profile's average list and signature cards (the API's
  `profiles`, outside its stable contract like the archetypes). Card names come from the
  [Lorcast API](https://lorcast.com/docs/api), kept in `data/cards.json` and fetched again only for
  a set not seen yet.
- `reconcileArchetypes` matches each week's archetypes to today's (keyed by their slug), one to one
  per week, the pairs sharing the most cards first (copies counted, same inks), if at least
  `config.archetypes.weekShared` of 60. One archetype shares 50 to 60 cards with itself from week
  to week; two near builds of one inks up to 48 (He Hurled and Woolter), hence one to one. A week's
  archetype matching nothing makes one of its own, which older weeks can match. Every week then
  names an archetype by today's name. With fresh ids, slugs and names on every past week, the
  matching comes out the same.
- Today's name of an archetype (`archetypeNames`) is that of its profiles with the most games:
  duels.ink names each profile, and those of one archetype don't always agree (He Hurled's are
  "Midrange" for 33 000 games and "Touch Paradise" for 17 000).
- Near twins are merged into one deck: two of today's archetypes of one inks whose average lists
  share at least `config.archetypes.mergeShared` (45) cards are variants of it, keyed by the most
  played one. That merges Midrange He Hurled with Midrange Woolter (48 cards in common, both
  "Midrange" for duels.ink) and Midrange Merlin Ursula with Midrange Hades (49); the next closest
  pair shares 43.5, where merging would start chaining distinct Amethyst/Ruby decks together.
  Weeks are still matched variant by variant (one to one keeps them apart), then each goes to its
  deck: their games add up, and the games between two variants, now a mirror, are left out. A
  tournament list keeps its variant, and the card analyses say how a deck's lists split between
  them.
- `listArchetype` gives a tournament decklist the archetype whose average list shares the most
  cards with it, if at least `config.archetypes.listShared`; otherwise its ink pair's "Autres
  listes".

## Tournaments

`tournaments/` looks at the big paper tournaments rather than the ladder: the core tournaments of
the last 14 days with more than 75 players, from the
[Lorcanahunter developer API](https://lorcanahunter.com/developers/reference). Every morning,
`npm run collect:tournaments` stores each one's standings with the players' decks (inks and
archetype) and their lists when public in `data/lorcanahunter/`; no player names are kept. Each
card is stored once per tournament and each list as [card, copies] pairs, so a 700-player
tournament stays around 100 kB.

| Card                       | What it shows                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Ligne de départ et top cut | Two donuts: each deck's share of the players, then of the top cut. The 8 most played one by one, the others as "Autres"     |
| Conversion au top cut      | Share of each deck's players who made the top cut, with its 95% interval, against the field's rate                          |
| Conversion tour par tour   | Each bracket round down to the final: share of each deck's players still in who go through, against the field's rate        |
| Matchups rencontrés        | One deck's opponents: share of its matches, meetings per player, win rate with its 95% interval, by ink pair                |
| Cartes du top cut          | One deck's top-cut lists, card by card: in every list, in at least half of them ("proches"), or fewer (possible tech cards) |
| Tournois retenus           | The tournaments counted, with their top cut                                                                                 |

Lorcanahunter's own archetypes are ink pairs, so the page uses the ladder's, as every page does
(see [Archetypes](#archetypes)): on loading, every public list of the period goes to the closest
ladder archetype of its inks.

Every card has an inks / archetypes switch. By archetype, a player without a public list is left
out, and a tournament only counts when at least half its players outside the top cut published
theirs (`minListShare`): the top cut's lists are all public, so lists of a thin share of the others
would put nearly every listed player in it. The switch's tooltip names the tournaments left out.
By inks, the card analysis offers each pair's archetypes in its picker.

For one build, the card analysis also gives a median list to play: each card at its median
copies over the lists (a missing card counting 0), then copies added or removed where the mean is
the farthest until the deck has the lists' median size (60 at least), with the real list closest
to it. A copy button gives it as "4 Angel - Siren Singer" lines, the format deck builders import. Players whose deck is unknown (private decklists), or by archetype without a public list, are
left out of the shares, and the cards say how many are kept.

Once a top cut is played, the standings follow the bracket (winner, finalist, semi-finalists…),
so reaching the top N is finishing N-th or better; each round only counts the tournaments whose
bracket went through it.

The top cut is the one the results flag (`isTopCut`). A tournament without one gets the largest
power of 2 up to one player in 8 of its announced players (top 8 from 76 to 127 players, top 16
from 128 to 255), marked "supposé": never played, it is left out of the rounds. The window, the player threshold, that ratio and the card tiers live in
`config.tournaments` ([src/config.js](src/config.js)).

The API only gives each player's record, not who they played: "Matchups rencontrés" reads the
`matchups` of a tournament (rows of deck, opponent, matches, wins, by ink pair) and says so when
none of them has any. The collector never writes them until Lorcanahunter exposes pairings.
It needs an application approved by Lorcanahunter (scopes `tournaments:read` and `decks:read`):
its credentials go in `.env` locally and in the repository secrets for the daily run (see
[GitHub setup](#github-setup)), which skips the step until they are set.

## Tournament preparation

`prep/` prepares one event (London by default, its format in `config.prep`): which deck to play
against the field it will most likely meet. Decks are the ladder's archetypes (by inks only when
the archetype profiles are missing). The settings every card depends on sit in a "Scénario" bar
kept in view while scrolling: where the field comes from (tournaments / ladder), how much it
adapts, and the players expected.

Archetypes are the ladder's, as on every page (see [Archetypes](#archetypes)): every tournament
decklist goes to the closest one, and the ladder decks no archetype recognises, like the lists
close to none, make their ink pair's "Autres listes". Each ink pair's tournament share is then
split as its lists are, its top cut and the rest of its players apart (the lists are mostly the
top cut's), or as on the ladder when it has no list. An archetype matchup is pulled toward its ink
pairs' one rather than toward even, so a thin one stays close to what its inks do. The ladder's
card swings (`pairCardLift`) only come by ink pair with the rank filter: the content card shows
them by pair.

| Card            | What it shows                                                                                                                                                                                                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Field attendu   | Each deck's share of the tournaments' players, its ladder play rate (BO1 Legendary+, last finished weeks), their blend (a slider), and the forecast, which can be set by hand                                                                                                                                                             |
| Quel deck jouer | Match win rate against the forecast field, the worst of it if the field shifts 10 points toward one deck, and the simulated event: Day 2, top cut, title, Day 2's field                                                                                                                                                                   |
| Fiche matchups  | One deck against each opponent, most expected first: game win rates on the play and on the draw, the raw ladder figures, the match in BO3 and BO5, its weight on the total, and the opponent's key cards (by archetype, its ladder signature cards). Then its mulligan guide. Prints alone, with an empty "Plan de jeu" column to fill in |
| Contenu         | The cards of the deck's public lists: their share in the top cut's lists and in the others, copies, and the match win rate of the players with each card and without it; then its ink pair's card swings on the ladder                                                                                                                    |

Game win rates come from every ladder BO1 week of the set, each pulled toward the queue's
average on the play (or on the draw) by `priorGames` games, so a thin matchup stays near "even".
A match is played from them exactly: game 1's first player at random, then the loser of each game
goes first. The simulation ([src/lib/forecast.js](src/lib/forecast.js), in a web worker) plays the
whole event 2 000 times: swiss rounds paired by points, the Day 2 cut on points, more rounds, the
top cut by points then a seeded bracket. Players differ by their deck alone (no real tiebreakers,
no rematch avoidance), except the team's: "Votre niveau" gives our players an edge on a deck, in
points of game win rate over its average player (+5: 55 % in an even game, every rate moved as
much in log-odds). On such a deck, `teamShare` of its simulated players play with the edge and
its figures are theirs. Every setting, the overrides, the edges and the deck shown are in the URL,
to share a scenario.

Every win rate against the field, and the Day 2 and top-cut chances, come with their range (90 %
of the draws): the matchups are drawn again `uncertaintySamples` times, each game win rate from
its Beta distribution given the games behind it (prior included), its reverse as its complement
(`sampleRates`). The simulation's runs are split into `uncertaintyBatches` batches, each on its own
draw, so a chance's range also holds the simulation's own chance. Two decks whose ranges overlap
widely aren't told apart by these data.

The card analysis compares players of one deck: the public lists are mostly the top cut's, so
every win rate is high and only the gap between players with and without a card means something.
Its interval is at 99 %, since every card of the deck is tested at once.

The mulligan guide comes from the ladder's opening hands (`archetypeOpening`, kept to the rank
filter): `npm run collect` sums them per archetype and seat into `openings` in profiles.json (the
API gives them per profile, under ids only valid within one response). For each card, the game
win rate when it was kept and when it was sent back: the cards whose keeping clearly wins more (99
% interval of the gap) are to keep, those clearly winning less to send back, with how often
players keep them. A kept card also tells of the rest of the hand, so it's a guide, not the
card's own worth.

The forecast can also adapt to the matchups, as a scenario (the "Adaptation" slider, 0 by
default): a share of the players picks its deck again against the blended field, each deck drawing
them in proportion to its share times exp(`adaptationSelectivity` × its match win rate gap to the
field, in points), one step only; the overrides come last, each share kept as typed, the other
decks sharing what's left of 100 %. The "Si le field s'adapte" column is
each deck's win rate once every player has done so: whether it holds up once the room has
countered the meta. It isn't fitted on data because the data doesn't show it: on the set's first
ladder weeks (Legendary+, October 2026), a deck's win rate one week didn't raise its play rate the
next (r = −0.40 by inks, none by archetype), and a rising deck didn't keep rising either. Early in
a set, play rates follow novelty more than results; worth measuring again over a longer set.

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
4. For the tournaments page, create an application on
   [Lorcanahunter's developer space](https://lorcanahunter.com/profile/developer) with the
   `tournaments:read` and `decks:read` scopes, then `gh secret set LORCANAHUNTER_CLIENT_ID` and
   `gh secret set LORCANAHUNTER_CLIENT_SECRET`. Without them the daily run skips the tournaments.
5. Optional: **Settings → Pages → Source: GitHub Actions** to publish the page. On a private
   repo this needs GitHub Pro, and the published site is public. Without Pages, the deploy job
   fails but the Discord message still goes out, without a link.
6. **Actions → Weekly Discord report → Run workflow** to test: the episode then stays in the
   run's artifact; tick "Post to Discord and publish the podcast episode" to send the messages
   and commit the episode.

Both workflows then run on their own: the aggregation every morning, the report on Sundays.
Locally, `npm run post:discord` reads the webhook from `.env` (see `.env.example`);
`-- --dry-run` prints the messages without sending them.

## Scripts

| Command                       | Purpose                                                           |
| ----------------------------- | ----------------------------------------------------------------- |
| `npm run collect`             | Stores finished weeks that are missing or have changed            |
| `npm run collect:tournaments` | Stores the Lorcanahunter tournaments of the window (`.env` keys)  |
| `npm run digest`              | Renders one digest (images + message) per format                  |
| `npm run post:discord`        | Posts the podcast, then the charts, to Discord                    |
| `npm run podcast:script`      | Writes the podcast script with Claude (`ANTHROPIC_API_KEY`)       |
| `npm run podcast:audio`       | Reads the script aloud into an MP3 (`OPENAI_API_KEY`, ffmpeg)     |
| `npm run costs`               | Local API costs dashboard, never published (admin keys in `.env`) |
| `npm run dev`                 | Web page locally                                                  |
| `npm run build`               | Static build into `dist/`                                         |
| `npm run check:api`           | API smoke test + payload summary                                  |
| `npm run format`              | Prettier formatting                                               |

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
web/tournaments/       tournaments page (Lorcanahunter)
web/prep/              tournament preparation: field forecast, deck choice, simulated event
web/podcast/           podcast playlist; episode/ plays one, its transcript following the audio
data/                  collected data, Lorcanahunter tournaments and podcast episodes (committed)
assets/fonts/          Inter (OFL) for PNG rendering
```
