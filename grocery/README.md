# 菜篮 Basket

A grocery list for a phone. Big coloured sections, one tap to tick something
off, and a **Shopping done** button that clears every tick and hands the same
list straight back — the sections and everything in them stay, you just edit
what's inside.

It also takes a **dish** — written in English or 中文 — and puts the
ingredients on the list for you, splits the list by which shop you're standing
in, and keeps a weekly record of what you actually ate.

No build step, no server, no account. Open `index.html` — or
`basket-standalone.html`, the whole app in one file you can mail to yourself
and add to a phone's home screen. Regenerate it with `node build.js`.

## The list

One living list, not a new one every week.

- **Tap a row** to tick it off. Tap **⋯** to edit it: name, how much, which
  shop, which section, what it counts as, a note, or remove.
- **Shopping done ✓** records the run, clears every tick, and leaves the list
  standing for next time. There's an **Undo** in the toast if you hit it early.
- Sections colour-code themselves and sort into the order you walk a shop.
- A section or food group you pick by hand is remembered for that name.

## Your shops

Chips across the top: **All · Safeway · T&T · Lina's**. Each item carries its
own shop, and the list shows only what that shop sells. New items pick a shop
automatically — 生抽 and 豆腐 go to T&T, parmesan and pasta to Lina's,
everything else to Safeway — and one tap in **⋯** moves any of them.

Finishing while filtered to a shop says *Done at T&T ✓* and only resets that
shop's items. Under the button, each shop shows when you were last there —
*Safeway 2 days ago · T&T 3 weeks ago* — which is the answer when you can't
remember your own schedule. A run at **All** only counts as a trip to the
shops you actually bought something from.

## Your dishes

The coloured buttons under the search box are yours: **sesame noodles ·
tuna rice bowl · salmon soy bowl · sandwich · marinated eggs**. One tap puts
the whole ingredient list in the basket, filed and de-duplicated. The same
buttons sit under every meal so logging what you ate is one tap too. Star any
other dish under **Setup** and it joins them.

## Typing into it

One box takes everything, and what you typed decides what happens.

| You type | What happens |
|---|---|
| `苹果` / `apples` | one item, filed under Fruit 水果 |
| `2 lbs chicken breast` | quantity split off, filed under Meat |
| `鸡胸肉 500克` | the same, quantity written the other way round |
| `番茄炒蛋` / `sesame noodles` | a known dish — its ingredients land across the sections |
| `青椒土豆丝` | not a known dish, but it names two foods and is clearly cooked, so both go on |
| `苹果, 酸奶、oat milk` | commas, Chinese or English, split it into three items |

322 foods and 80 dishes, each answering to both its English and Chinese name.
Anything unknown still goes on the list — it lands under **Other**, where you
file it once under **Setup → Teach it** and it remembers.

Adding the same food twice doesn't duplicate the row; it records both dishes
that wanted it. Seasonings that arrive with a dish — 盐, 生抽, olive oil — fold
away at the bottom, because you already own them.

## Meals 每餐 and Balance 均衡

Seven days, four slots, one tap per dish. Then the weekly record:

- **The score ring** — how much of the week's target is covered. A week in
  progress is judged on the days that have happened, so Tuesday isn't failure.
- **Every food group** — vegetables, fruit, grains, protein, dairy, nuts and
  fats against the weekly goal, with a pace marker for where you should be.
- **Day by day** — every group against every day; any cell opens that day.
- **Every meal** — whether each breakfast, lunch and dinner carried
  vegetables, protein and a grain, because a good weekly total hides three
  days of noodles.
- **What to fix** — written from that week's numbers: the biggest gap and what
  it costs a day, what's sitting on your list that would close it, which meal
  keeps skipping vegetables, your thinnest and fullest day, days not logged.

**Copy report** puts the whole week on the clipboard as plain text.

## Servings

Each thing you eat scores one serving of every group it contains, capped at
two per group per meal so one enormous salad can't carry a week. Cooking oil
and seasonings score nothing; a squeeze of lemon in the roast chicken isn't a
serving of fruit, though a lemon on the list is still fruit; and avocado
counts as a fat rather than your daily fruit. Targets are per day and editable
under **Setup** — 3 vegetables, 2 fruit, 3 grains, 3 protein, 1 dairy, 1
nuts/fats.

## Data

Everything lives in this browser's `localStorage` under `basket.v1` — it never
leaves the machine. Use **Export JSON** under Setup now and then; **Import
JSON** restores it.

## Files

| File | |
|---|---|
| `index.html` | markup for the three tabs plus Setup |
| `styles.css` | tokens + layout, light and dark, phone first |
| `data.js` | foods, aisles and their colours, shops, food groups, recipes |
| `app.js` | parsing, the list, shopping runs, the meal log, the weekly report |
| `build.js` | inlines the above into `basket-standalone.html` |
| `basket-standalone.html` | generated — the whole app in one file |

To teach it a food or a dish permanently, add a row to `FOODS` or `RECIPES` in
`data.js`; to send a food to a different shop by default, add its id to
`STORE_OF`.
