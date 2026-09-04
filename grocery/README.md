# 菜篮 Basket

A weekly grocery list for a phone. Everything on it is editable, it files each
item into the right aisle by itself, it takes a **dish** — written in English or
中文 — and puts the ingredients on the list for you, and it keeps a record of
what you actually ate so a week can be judged on balance rather than memory.

No build step, no server, no account. Open `index.html` — or
`basket-standalone.html`, the same app inlined into one file you can email to
yourself and add to a phone's home screen. Regenerate it with `node build.js`
after editing any source.

## Typing into it

One box takes everything, and what you typed decides what happens.

| You type | What happens |
|---|---|
| `苹果` / `apples` | one item, filed under Fruit 水果 |
| `2 lbs chicken breast` | quantity split off, filed under Meat |
| `鸡胸肉 500克` | the same, with the quantity written the other way round |
| `番茄炒蛋` | a known dish — six ingredients land in five sections |
| `spaghetti bolognese` | the same in English |
| `青椒土豆丝` | not a known dish, but it names two foods and it is clearly cooked, so both go on |
| `苹果, 酸奶、oat milk` | commas — Chinese or English — split it into three items |

It knows 318 foods and 75 dishes, each answering to both its English and its
Chinese name. Anything it does not recognise still goes on the list; it just
lands under **Other**, where you can file it once and it will remember
(**Setup → Teach it**).

Adding the same food twice does not duplicate the row — the row records both
dishes that wanted it, so the tomato you need for 番茄炒蛋 and for
西红柿鸡蛋汤 is one line that says what it is for.

Seasonings that arrive with a dish — 盐, 生抽, olive oil — are folded away at
the bottom of the list rather than shown, because you already have them. One
tap shows them.

## Editing

Every field on the list is live. Tap the name to rewrite it — retype it and it
re-files itself. Tap **⋯** for the section, the food groups it counts toward,
a note, and remove. A section or group you pick by hand is remembered for that
name from then on.

## Meals 每餐

Seven days, four slots. Write what you are making — a dish name in either
language is enough — and each entry shows the food groups it puts on the
plate. **＋** on an entry sends that dish's ingredients to the shopping list;
one button does the whole day.

## Balance 均衡

The record of the week, in four parts:

- **The score ring** — how much of the week's target is covered. A week in
  progress is judged on the days that have actually happened, so Tuesday does
  not read as failure.
- **Every food group** — vegetables, fruit, grains, protein, dairy, nuts and
  fats against the weekly goal, with the pace marker showing where you should
  be today.
- **Day by day** — every group against every day. Any cell opens that day.
- **Every meal** — whether each breakfast, lunch and dinner carried
  vegetables, protein and a grain, because a good weekly total hides three
  days of noodles.
- **What to fix** — written from that week's numbers. Every line carries the
  figure it came from: the biggest gap and what it costs a day to close, what
  is already on your list that would have closed it, which meal keeps going
  without vegetables, your thinnest and fullest day, and the days you have not
  logged. When a gap is too large to close in the days left, it says so and
  tells you to start Monday instead.

**Copy report** puts the whole week on the clipboard as plain text.

## Servings

Each thing you eat scores one serving of every food group it contains, capped
at two per group per meal so one enormous salad cannot carry a week. Cooking
oil and seasonings score nothing, and a squeeze of lemon in the roast chicken
is not a serving of fruit — though a lemon on the shopping list is still
fruit. Targets are per day and editable under **Setup**; defaults are 3
vegetables, 2 fruit, 3 grains, 3 protein, 1 dairy, 1 nuts/fats.

## Data

Everything lives in this browser's `localStorage` under `basket.v1` — it never
leaves the machine. Clearing site data erases it, so use **Export JSON** under
Setup now and then; **Import JSON** restores a backup.

## Files

| File | |
|---|---|
| `index.html` | markup for the four tabs |
| `styles.css` | tokens + layout, light and dark, phone first |
| `data.js` | the food lexicon, the aisles, the food groups, the recipe book |
| `app.js` | parsing, the list, the meal log, the weekly report and its advice |
| `build.js` | inlines the above into `basket-standalone.html` |
| `basket-standalone.html` | generated — the whole app in one file |

To teach it a food or a dish permanently, add a row to `FOODS` or `RECIPES` in
`data.js`; both are plain tables and everything else follows from them.
