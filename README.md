# Étude

A day tracker built around one specific schedule — mine — with a weekly report
that answers three questions: **how close am I to my goal**, **what did the week
actually look like**, and **what should I change next week**.

No build step, no server, no account. Open `index.html` in a browser — or
`etude-standalone.html`, which is the same app inlined into a single file you
can move anywhere. Regenerate it with `node build.js` after editing any source.

## The schedule

| Time | Block | Counts toward |
|---|---|---|
| 09:00 | Wake up | — |
| 09:00–10:00 | Find job | Job hunt |
| 10:00–10:30 | Breakfast | Chores + meals |
| 10:30–12:00/12:30 | Find job | Job hunt |
| 13:00–16:00 | French French French | French |
| 16:00–17:00/18:00 | Chores + dinner | Chores + meals |
| 18:00–22:00 | Portfolio + social media | Portfolio+social |
| 22:00–23:00/24:00 | Music production | Music production |

Where a block has two end times, the longer one is the budget and both are
shown — stopping at the early end never counts as falling short.

Weekly goals default to each block's daily time × 7 (job 21h, French 21h,
portfolio 28h, music 14h) and are editable under **Goals**. Chores and meals are
tracked but deliberately not scored.

## Editing a past day

The headline feature. **Edit yesterday** is one click on the Day tab; the arrows
and the date picker reach any day at all, and every non-future cell in the
weekly grid opens that day for editing. There is no window that closes.

Logging a day is meant to take seconds: **Mark all as planned** fills the whole
day, then you correct the rows that did not happen. Ticking a row fills in its
planned minutes; typing minutes ticks the row.

## The weekly report

- **Score ring** — hours earned against your weekly goal, credit capped per
  category so a huge week on one thing cannot hide a category you dropped.
- **A week in progress is judged on pace**, against the days that have actually
  happened, so Tuesday does not read as failure.
- **Per-category bars** with the exact shortfall or surplus.
- **Day by day**, colour-coded against your planned day; click any day to edit it.
- **Wake-up stats** — days logged, days on target, weekly average.
- **What to do next week** — generated from that week's numbers. Every line
  carries the figure it came from: the biggest gap and what it costs per day,
  categories that hit zero, whether wake-up is upstream of the missed 9–10 job
  hour, unlogged days, your thinnest and fullest day, and where the hours can be
  traded from. When a gap is too large to close in the days left, it says so
  and tells you to reset Monday instead of inventing a 12-hour day.

**Copy report** puts the whole thing on the clipboard as plain text.

## Data

Everything lives in this browser's `localStorage` under `etude.v1` — it never
leaves the machine. Clearing site data erases it, so use **Export JSON** under
Goals now and then; **Import JSON** restores a backup.

## Files

| File | |
|---|---|
| `index.html` | markup for the three tabs |
| `styles.css` | tokens + layout, light and dark |
| `app.js` | schedule model, storage, day editor, report and advice engine |
| `build.js` | inlines the three into `etude-standalone.html` |
| `etude-standalone.html` | generated — the whole app in one file |

To change the schedule itself, edit `TEMPLATE` at the top of `app.js`; goals,
bars, reports and advice all follow from it.

## Also here

[`grocery/`](grocery/) — **菜篮 Basket**, a grocery list for a phone: coloured
sections that sort themselves, one tap to tick something off, a Shopping done
button that clears the ticks and keeps the list, a shop filter for Safeway /
T&T / Lina's, and your own dishes as one-tap buttons that turn into
ingredients. A weekly record shows whether every meal actually carried
vegetables, protein and a grain. No build step.
