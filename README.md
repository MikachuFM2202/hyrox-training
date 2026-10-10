# HYROX Training

A private crew training checklist for HYROX Kuala Lumpur (11–13 Dec 2026, MITEC). It is a static site on GitHub Pages with no build step and no server.

- **This week:** a Mon–Sun strip shows each day's session (Tue Push/Pull, Thu Legs, Sat Push/Pull, Sun optional recovery) and progress. It sits under countdowns to HYROX KL and to a personal goal date (Mika's is fixed; everyone else taps the Goal tile to pick a day from a calendar).
- **Day checklist:** sections with "Pick N" targets. Each row shows the exercise, the muscles it works, sets and reps, and a demo video link, with tick (✅) and skip (✕) buttons. Above the rows: an "X left · next" counter, a 5-minute warm-up, Mark all complete, and confetti when the session is done.
- **Rules from the plan:** "Skip section" (core sore), swapping any day's session (no legs this week, extra session on a rest day), and a Bonus section for work outside the plan.
- **Calendar:** a month view with gym and optional days, % done per day, 💪 on completed days, and the race and goal dates marked.
- **Weight log:** every rep-based exercise has a kg box. It shows your last weight for that exercise (green when you beat it), and under the exercise name everyone else's latest weight in their colour (▲ when it's heavier than yours), so the crew can compare. Tap "last …" under the kg box for a weight-over-time chart with one line per person.
- **Muscle map:** front/back body with a day filter (All/Tue/Thu/Sat/Sun). Tap a muscle to see which exercises hit it. Orange = primary, blue = secondary, green = core/rehab, dark = rest. It is built from each exercise's `muscles` text in `plan.json` (`muscles.js`). Muscle shapes are traced from [innerbody.com's muscular system map](https://www.innerbody.com/image/musfov.html).
- **Arnold soundboard:** a fold-out panel on the Today tab with 9 short Arnold clips (`sounds/*.m4a`, each under 3 s).
- **Sync icon:** top right. Green = synced (tap to sync now), spinning = saving, red dot = error (tap to retry), grey dot = preview, not syncing (tap to add a key).
- **Phone first:** a bottom tab bar with Today, Calendar, Muscles and Crew.
- **Crew:** the top-right corner shows how many people are online and a dot for each person. Tap a dot to see that person's checklist (read only). Everyone's ticks show as coloured dots on each exercise.
- **Install:** the site is a PWA. On Android or Chrome use "Install app". On iPhone, use Safari: Share → Add to Home Screen.

## Signing in

1. Enter the site password.
2. Paste the access key, or tap "Preview without syncing" to try the site without saving to GitHub.
3. Pick **Mika**, **Aidan** or **Barath** (each needs their own PIN), or **Guest**. A guest picks a bodybuilder head and a colour. Named members all follow the same plan.

There are at most 5 guests, which keeps polling and GitHub API use small. Mika can free a guest's spot from the Crew tab (✕), and a guest can use "Leave crew". When someone comes online, their head pops into the top-right corner.

## Guest head photos

The photos come from Wikimedia Commons, cropped to the face, and are used here under their free licences:

| Head | Source | Licence | Author |
|---|---|---|---|
| Arnold | [Arnold Schwarzenegger 1974](https://commons.wikimedia.org/wiki/File:Arnold_Schwarzenegger_1974.jpg) | Public domain | Madison Square Garden Center |
| Ronnie | [Ronnie Coleman FIBO2014](https://commons.wikimedia.org/wiki/File:Ronnie_Coleman_FIBO2014.jpg) | CC BY 2.0 | Health Gauge |
| Lou | [Lou Ferrigno (16432300998)](https://commons.wikimedia.org/wiki/File:Lou_Ferrigno_(16432300998).jpg) | CC BY 2.0 | Paula R. Lively |
| CBum | [Chris Bumstead on Gymshark](https://commons.wikimedia.org/wiki/File:Chris_Bumstead_on_Gymshark.jpg) | CC BY 3.0 | Gymshark |
| Zane | [Frank Zane 2011 Shankbone](https://commons.wikimedia.org/wiki/File:Frank_Zane_2011_Shankbone.JPG) | CC BY 3.0 | David Shankbone |
| Cutler | [Jay Cutler bodybuilder 2008-crop](https://commons.wikimedia.org/wiki/File:Jay_Cutler_bodybuilder_2008-crop.jpg) | CC BY 3.0 | robbden, Nesnad |

## How it works

- `plan.json` is the weekly template: `schedule` maps Mon..Sun to session ids, and `sessions` hold the sections and exercises. Edit it and push to `main` to change the plan.
- Ticks are stored per calendar day, as the key `<yyyy-mm-dd>|<exercise-slug>`. Renaming an exercise starts it fresh; past ticks stay on the old name.
- Check-ins sync through the GitHub contents API to the **`data` branch**. Each person owns one file, `people/<id>.json`, so two people never write the same file. One person on two devices is merged per entry, and the newer one wins (see `merge()` in `store.js`).
- Pages builds from `main`, so check-ins never trigger a rebuild.
- `_items/` holds the raw training export and is gitignored. Never commit it.
- The official HYROX font, Brutal Type, is licensed, so the site uses Archivo Expanded, Inter and JetBrains Mono from Google Fonts instead.

## Access key (one shared fine-grained token)

1. Go to GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token.
2. Under Repository access, choose **Only select repositories** and pick `hyrox-training`.
3. Under Permissions, set **Contents: Read and write**. Leave everything else as is.
4. Set the expiry to cover race day (after 13 Dec 2026).
5. Share the key privately, or share a one-tap link: `https://mikachufm2202.github.io/hyrox-training/#k=<token>`. The site wipes the key from the address bar after reading it.

Never commit the token: GitHub revokes leaked tokens automatically. To cut someone off, rotate the token and share the new one with everyone else.

**Limits:** the repo is public, so the plan and check-in files can be read by anyone who finds the repo. Only people with the key can use the site and write check-ins. Anyone holding the key can also write to `main`.

## Dev

```sh
python3 -m http.server 8765   # then open http://localhost:8765
node merge.test.mjs           # sync merge rules + muscle-map word mapping
```
