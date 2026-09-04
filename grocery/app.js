/* 菜篮 Basket — a weekly grocery list that sorts itself, takes dishes in
   English or Chinese and turns them into ingredients, and keeps a record of
   what you actually ate so the week can be judged on balance rather than
   memory. Everything lives in localStorage; there is no server. */

const STORE_KEY = 'basket.v1';

/* ── the lexicon ───────────────────────────────────────────────
   FOODS is a table; this turns it into objects plus a flat alias index
   sorted longest-first, so 大白菜 beats 白菜 and "green onion" beats
   "onion" no matter which order they were written in. */
const CJK_RE = /[㐀-鿿]/;
const hasCJK = s => CJK_RE.test(s || '');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function plurals(w) {
  const out = [w];
  if (/[^aeiou]y$/.test(w)) out.push(w.slice(0, -1) + 'ies');
  else if (/(s|sh|ch|x|z)$/.test(w)) out.push(w + 'es');
  else if (/[^aeiou]o$/.test(w)) out.push(w + 'es', w + 's');  /* tomatoes, mangos */
  else if (!/s$/.test(w)) out.push(w + 's');
  return out;
}

const FOOD_LIST = FOODS.map(([en, zh, aisle, groups]) => ({
  id: en.split(',')[0].trim(),
  en: en.split(',').map(s => s.trim()).filter(Boolean),
  zh: zh.split(',').map(s => s.trim()).filter(Boolean),
  aisle,
  groups: groups.split(' ').map(s => s.trim()).filter(Boolean),
}));
const FOOD_BY_ID = Object.fromEntries(FOOD_LIST.map(f => [f.id, f]));

const ALIASES = [];
for (const f of FOOD_LIST) {
  const seen = new Set();
  for (const n of f.en) for (const p of plurals(n.toLowerCase())) {
    if (seen.has(p)) continue; seen.add(p);
    ALIASES.push({ a: p, food: f, cjk: false, re: new RegExp('\\b' + esc(p) + '\\b', 'gi') });
  }
  for (const n of f.zh) {
    if (seen.has(n)) continue; seen.add(n);
    ALIASES.push({ a: n, food: f, cjk: true, re: null });
  }
}
ALIASES.sort((x, y) => y.a.length - x.a.length);

const RECIPE_LIST = RECIPES.map(([names, ing]) => ({
  id: names.split(',')[0].trim(),
  names: names.split(',').map(s => s.trim()).filter(Boolean),
  ingredients: ing.split(';').map(s => s.trim()).filter(Boolean),
}));
const RECIPE_BY_ID = Object.fromEntries(RECIPE_LIST.map(r => [r.id, r]));
const RECIPE_ALIASES = [];
for (const r of RECIPE_LIST) for (const n of r.names) {
  RECIPE_ALIASES.push({ a: n.toLowerCase(), recipe: r, cjk: hasCJK(n) });
}
RECIPE_ALIASES.sort((x, y) => y.a.length - x.a.length);

const AISLE_BY_ID = Object.fromEntries(AISLES.map(a => [a.id, a]));
const GROUP_BY_ID = Object.fromEntries(GROUPS.map(g => [g.id, g]));
const MEAL_BY_ID  = Object.fromEntries(MEALS.map(m => [m.id, m]));

/* ── reading what you typed ────────────────────────────────── */
const normalize = s => (s || '')
  .toLowerCase()
  .replace(/[，,。、；;!！?？"'“”‘’()（）\[\]【】]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const UNIT_LIST = [
  '个','颗','把','根','条','片','块','盒','包','袋','瓶','罐','斤','两','克','千克','公斤',
  '杯','碗','只','头','棵','串','扎','份',
  'g','kg','ml','l','lb','lbs','oz','cup','cups','tbsp','tsp','bunch','bunches','pack','packs',
  'can','cans','bottle','bottles','box','boxes','dozen','clove','cloves','piece','pieces','slice','slices',
];
/* longest first, or the alternation would let "l" swallow the l of "lbs" */
const UNITS = UNIT_LIST.slice().sort((a, b) => b.length - a.length).join('|');
const NUM = '\\d+(?:\\.\\d+)?(?:\\s*[-~]\\s*\\d+(?:\\.\\d+)?)?|[半一二两三四五六七八九十]+';
/* a number only counts as a quantity when a unit, a space or a Chinese
   character follows it — otherwise "7up" would arrive as 7 of "up" */
const LEAD_QTY = new RegExp('^\\s*(' + NUM + ')(?:\\s*(' + UNITS + ')(?![a-z])|\\s+|(?=[㐀-鿿]))\\s*(?:of\\s+)?', 'i');
const TAIL_QTY = new RegExp('\\s*(\\d+(?:\\.\\d+)?)\\s*(' + UNITS + ')\\s*$', 'i');

/* "2 lbs chicken breast" and "鸡胸肉 500克" both come back as
   { qty: '2 lbs' | '500克', name: 'chicken breast' | '鸡胸肉' }. */
function splitQty(raw) {
  const text = (raw || '').trim();
  let m = text.match(LEAD_QTY);
  if (m && m[0].trim() && text.slice(m[0].length).trim()) {
    return { qty: m[0].trim(), name: text.slice(m[0].length).trim() };
  }
  m = text.match(TAIL_QTY);
  if (m && text.slice(0, m.index).trim()) {
    return { qty: m[0].trim(), name: text.slice(0, m.index).trim() };
  }
  return { qty: '', name: text };
}

/* longest alias that is exactly, or sits inside, the text */
function matchFood(text) {
  const t = normalize(text);
  if (!t) return null;
  for (const e of ALIASES) if (e.a === t) return e.food;
  for (const e of ALIASES) {
    if (e.cjk ? t.includes(e.a) : new RegExp('\\b' + esc(e.a) + '\\b').test(t)) return e.food;
  }
  return null;
}

/* Every distinct food named anywhere in the text, longest names first.
   minCjk raises the bar for Chinese aliases: single characters (油, 蛋, 鱼)
   turn up inside compound words that are one ingredient, not two. */
function scanFoods(text, minCjk) {
  let t = normalize(text);
  const found = [];
  for (const e of ALIASES) {
    if (found.includes(e.food)) continue;
    if (e.cjk && e.a.length < (minCjk || 1)) continue;
    if (e.cjk) {
      if (t.includes(e.a)) { found.push(e.food); t = t.split(e.a).join(' '); }
    } else if (e.re.test(t)) {
      e.re.lastIndex = 0;
      found.push(e.food);
      t = t.replace(e.re, ' ');
    }
    e.re && (e.re.lastIndex = 0);
  }
  return found;
}

function matchRecipe(text) {
  const t = normalize(text);
  if (!t) return null;
  for (const e of RECIPE_ALIASES) if (e.a === t) return e.recipe;
  for (const e of RECIPE_ALIASES) if (t.length > e.a.length && t.includes(e.a)) return e.recipe;
  return null;
}

const COOKED_RE = /salad|soup|stew|roast|grill|bake[d]?|fried|fry|sandwich|bowl|curry|with /i;

/* An unknown dish is still a dish when it names more than one food. Chinese
   says so by construction — 青椒土豆丝 is two ingredients and a knife cut —
   so two is enough there; English needs a cooking word or a third food before
   "apple banana" is taken for a recipe. */
function improviseDish(text) {
  const foods = scanFoods(text, 2);
  if (foods.length < 2) return null;
  if (hasCJK(text)) return foods;
  if (COOKED_RE.test(text) || foods.length >= 3) return foods;
  return null;
}

/* what the other language calls it, for the subtitle under an item */
function otherName(food, typed) {
  if (!food) return '';
  const wantZh = !hasCJK(typed);
  const list = wantZh ? food.zh : food.en;
  const alt = list && list.length ? list[0] : '';
  return normalize(alt) === normalize(typed) ? '' : alt;
}

/* ── classification, with anything you taught it winning ────── */
function classify(name) {
  const learned = store.learned[normalize(name)];
  const food = matchFood(name);
  if (learned) return { aisle: learned.aisle, groups: learned.groups.slice(), food };
  if (food) return { aisle: food.aisle, groups: food.groups.slice(), food };
  return { aisle: 'other', groups: [], food: null };
}

/* Bought as fruit, used as seasoning: a wedge of lemon in the roast chicken is
   not a serving of fruit, so these score nothing when they turn up inside a
   recipe. On the shopping list they are ordinary foods. */
const GARNISH = new Set(['lemon', 'lime', 'goji berry', 'sesame seed']);

/* the food groups one written thing puts on your plate */
function groupsOf(text) {
  const r = matchRecipe(text);
  const set = new Set();
  if (r) {
    for (const ing of r.ingredients) {
      const c = classify(splitQty(ing).name);
      if (c.food && GARNISH.has(c.food.id)) continue;
      for (const g of c.groups) set.add(g);
    }
    return [...set];
  }
  const improvised = improviseDish(text);
  if (improvised) {
    for (const f of improvised) for (const g of f.groups) set.add(g);
    if (set.size) return [...set];
  }
  return classify(splitQty(text).name).groups;
}

/* ── dates ─────────────────────────────────────────────────── */
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_ZH    = ['一', '二', '三', '四', '五', '六', '日'];
const key     = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
const today   = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const monday  = d => addDays(d, -((d.getDay() + 6) % 7));
const weekDays = wk => Array.from({ length: 7 }, (_, i) => addDays(wk, i));
const fmtDay  = d => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/* ── store ─────────────────────────────────────────────────── */
const defaultTargets = () => Object.fromEntries(GROUPS.map(g => [g.id, g.perDay]));

let store;
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (raw && raw.weeks) {
      store = raw;
      store.settings = Object.assign({ targets: defaultTargets(), hideStaples: true }, store.settings);
      store.settings.targets = Object.assign(defaultTargets(), store.settings.targets);
      store.learned = store.learned || {};
      store.meals = store.meals || {};
      return;
    }
  } catch (e) { /* corrupt or blocked storage — start clean */ }
  store = { version: 1, settings: { targets: defaultTargets(), hideStaples: true }, learned: {}, weeks: {}, meals: {} };
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
  catch (e) { console.warn('Could not save — storage unavailable.', e); }
}
const uid = () => Math.random().toString(36).slice(2, 9);

function weekRec(k) {
  if (!store.weeks[k]) store.weeks[k] = { items: [] };
  store.weeks[k].items = store.weeks[k].items || [];
  return store.weeks[k];
}
const weekPeek = k => store.weeks[k] || null;

function mealRec(dayK) {
  if (!store.meals[dayK]) store.meals[dayK] = {};
  const d = store.meals[dayK];
  for (const m of MEALS) d[m.id] = d[m.id] || [];
  return d;
}
const mealPeek = (dayK, id) => ((store.meals[dayK] || {})[id]) || [];
const dayLogged = dayK => MEALS.some(m => mealPeek(dayK, m.id).length);

/* ── adding to the list ────────────────────────────────────────
   One entry point for everything typed: a dish explodes into ingredients,
   anything else is an item, and a food already on the list gains a source
   rather than a duplicate row. */
function addToList(weekK, raw, fromDish) {
  const text = (raw || '').trim();
  if (!text) return null;
  const rec = weekRec(weekK);
  const { qty, name } = splitQty(text);
  const cls = classify(name);
  const canonical = cls.food ? cls.food.id : normalize(name);

  const existing = rec.items.find(it => (it.foodId || normalize(it.name)) === canonical);
  if (existing) {
    if (fromDish && !existing.from.includes(fromDish)) existing.from.push(fromDish);
    if (qty && !existing.qty) existing.qty = qty;
    else if (qty && existing.qty && existing.qty !== qty) existing.qty = existing.qty + ' + ' + qty;
    existing.got = false;
    return existing;
  }
  const item = {
    id: uid(), name, qty, aisle: cls.aisle, groups: cls.groups,
    foodId: cls.food ? cls.food.id : '', got: false, pinned: false,
    from: fromDish ? [fromDish] : [], note: '',
    /* salt and soy sauce arrive with every dish and are already in your
       kitchen — they are folded away until you say otherwise */
    staple: !!fromDish && (cls.aisle === 'pantry' || cls.aisle === 'spice') && !cls.groups.length,
  };
  rec.items.push(item);
  return item;
}

/* returns { kind: 'dish'|'items', dish, added: [items] } */
function addOne(weekK, text) {
  const recipe = matchRecipe(text);
  if (recipe) {
    const added = recipe.ingredients.map(ing => addToList(weekK, ing, recipe.id)).filter(Boolean);
    return { kind: 'dish', dish: recipe.id, added };
  }
  const improvised = improviseDish(text);
  if (improvised) {
    const added = improvised
      .map(f => addToList(weekK, hasCJK(text) ? (f.zh[0] || f.en[0]) : f.en[0], text))
      .filter(Boolean);
    return { kind: 'dish', dish: text, added, improvised: true };
  }
  const item = addToList(weekK, text, '');
  return { kind: 'items', added: item ? [item] : [] };
}

/* A comma, a 、 or a newline separates things; each piece is then a dish or an
   item on its own terms. */
function addTyped(weekK, raw) {
  const text = (raw || '').trim();
  if (!text) return null;
  const parts = text.split(/[,，、;；\n]+/).map(s => s.trim()).filter(Boolean);
  if (parts.length === 1) return addOne(weekK, parts[0]);

  const added = [];
  let dishes = 0, dish = '';
  for (const p of parts) {
    const r = addOne(weekK, p);
    added.push(...r.added);
    if (r.kind === 'dish') { dishes++; dish = r.dish; }
  }
  return dishes === parts.length && dishes === 1
    ? { kind: 'dish', dish, added }
    : { kind: 'items', added, dishes };
}

/* ── weekly balance ────────────────────────────────────────────
   Each thing eaten scores one serving of every group it contains, capped at
   two per group per meal so a single enormous salad cannot carry a week. */
const PER_MEAL_CAP = 2;

function mealServings(dayK, mealId) {
  const counts = {};
  for (const entry of mealPeek(dayK, mealId)) {
    for (const g of groupsOf(entry.text)) {
      counts[g] = Math.min(PER_MEAL_CAP, (counts[g] || 0) + 1);
    }
  }
  return counts;
}
function dayServings(dayK) {
  const total = {};
  for (const m of MEALS) {
    const c = mealServings(dayK, m.id);
    for (const g in c) total[g] = (total[g] || 0) + c[g];
  }
  return total;
}
function weekReport(wk) {
  const days = weekDays(wk).map(key);
  const t = today();
  const elapsed = days.filter(k => fromKey(k) <= t).length;
  const logged = days.filter(dayLogged);
  const byDay = Object.fromEntries(days.map(k => [k, dayServings(k)]));
  const totals = {};
  for (const g of GROUPS) totals[g.id] = days.reduce((s, k) => s + (byDay[k][g.id] || 0), 0);

  /* judge a week in progress on the days that have happened */
  const paceDays = Math.max(1, Math.min(7, elapsed || 7));
  const goals = {}, paceGoals = {};
  for (const g of GROUPS) {
    goals[g.id] = store.settings.targets[g.id] * 7;
    paceGoals[g.id] = store.settings.targets[g.id] * paceDays;
  }
  let earned = 0, possible = 0;
  for (const g of GROUPS) {
    earned += Math.min(totals[g.id], paceGoals[g.id]);
    possible += paceGoals[g.id];
  }
  const pct = possible ? Math.round(earned / possible * 100) : 0;
  return { days, elapsed, logged, byDay, totals, goals, paceGoals, paceDays, pct };
}

/* ── DOM plumbing ──────────────────────────────────────────── */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function copyText(text, msg) {
  const done = () => toast(msg);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallback());
  } else fallback();
  function fallback() {
    const ta = el('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Could not copy'); }
    ta.remove();
  }
}

/* ── state ─────────────────────────────────────────────────── */
let curWeek = monday(today());
let curDay  = today();

const weekLabel = wk => {
  const end = addDays(wk, 6);
  const now = monday(today());
  const diff = Math.round((wk - now) / 604800000);
  const rel = diff === 0 ? ' · this week' : diff === -1 ? ' · last week' : diff === 1 ? ' · next week' : '';
  return `${fmtDay(wk)} – ${fmtDay(end)}${rel}`;
};

function setWeek(wk) {
  curWeek = monday(wk);
  if (monday(curDay) - curWeek !== 0) curDay = curWeek;
  renderAll();
}

function renderAll() {
  renderList();
  renderMeals();
  renderBalance();
  renderSetup();
}

/* ── tabs ──────────────────────────────────────────────────── */
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('.tab');
  if (!b) return;
  $$('.tab').forEach(t => t.classList.toggle('is-active', t === b));
  $$('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + b.dataset.view));
  window.scrollTo(0, 0);
});
const showTab = name => { const b = $$('.tab').find(t => t.dataset.view === name); if (b) b.click(); };

/* ─────────────────────────── LIST VIEW ────────────────────── */
const isThisWeek = () => +curWeek === +monday(today());
function renderList() {
  const wk = key(curWeek);
  const items = (weekPeek(wk) || { items: [] }).items;
  $('#weekLabel').textContent = weekLabel(curWeek);
  $('#goThisWeek').hidden = isThisWeek();

  const hiding = store.settings.hideStaples !== false;
  const folded = hiding ? items.filter(i => i.staple) : [];
  const shown  = hiding ? items.filter(i => !i.staple) : items;

  const got = shown.filter(i => i.got).length;
  $('#listBar').style.width = (shown.length ? got / shown.length * 100 : 0) + '%';
  $('#listCount').textContent = items.length
    ? `${got} of ${shown.length} in the basket` + (folded.length ? ` · ${folded.length} folded away` : '')
    : 'nothing on the list yet — type a dish above and see';

  const host = $('#sections');
  host.innerHTML = '';

  for (const aisle of AISLES) {
    const mine = shown.filter(i => i.aisle === aisle.id);
    if (!mine.length) continue;
    mine.sort((a, b) => (a.got === b.got) ? 0 : a.got ? 1 : -1);

    const sec = el('section', 'aisle');
    const head = el('div', 'aislehead');
    head.append(el('h3', null, aisle.en));
    head.append(el('span', 'zh', aisle.zh));
    head.append(el('span', 'count', `${mine.filter(i => !i.got).length}/${mine.length}`));
    sec.append(head);

    const ul = el('ul', 'items');
    for (const it of mine) ul.append(itemRow(wk, it));
    sec.append(ul);
    host.append(sec);
  }

  const fold = $('#staples');
  fold.innerHTML = '';
  if (folded.length) {
    fold.append(el('span', null,
      `${folded.length} seasoning${folded.length === 1 ? '' : 's'} the dishes asked for — ` +
      `${folded.slice(0, 5).map(i => i.name).join('、')}${folded.length > 5 ? '…' : ''} — folded away.`));
    const b = el('button', 'ghost', 'Show them 显示');
    b.addEventListener('click', () => { store.settings.hideStaples = false; save(); renderList(); });
    fold.append(b);
  } else if (!hiding && items.some(i => i.staple)) {
    fold.append(el('span', null, 'Seasonings are showing.'));
    const b = el('button', 'ghost', 'Fold them away 折叠');
    b.addEventListener('click', () => { store.settings.hideStaples = true; save(); renderList(); });
    fold.append(b);
  }
}

function itemRow(wk, it) {
  const li = el('li', 'item' + (it.got ? ' is-got' : ''));

  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = !!it.got;
  cb.setAttribute('aria-label', 'Got ' + it.name);
  cb.addEventListener('change', () => { it.got = cb.checked; save(); renderList(); });
  li.append(cb);

  const mid = el('div', 'imid');
  const name = el('input', 'iname');
  name.value = it.name;
  name.setAttribute('aria-label', 'Item name');
  name.addEventListener('change', () => {
    const v = name.value.trim();
    if (!v) { removeItem(wk, it.id); return; }
    const { qty, name: n } = splitQty(v);
    it.name = n;
    if (qty) it.qty = qty;
    const cls = classify(n);
    it.foodId = cls.food ? cls.food.id : '';
    /* a hand-picked section sticks; otherwise the new name decides */
    if (!it.pinned) { it.aisle = cls.aisle; it.groups = cls.groups; }
    save(); renderList();
  });
  mid.append(name);

  const sub = el('div', 'isub');
  const alt = otherName(FOOD_BY_ID[it.foodId], it.name);
  if (alt) sub.append(el('span', 'alt', alt));
  for (const g of it.groups) {
    const dot = el('span', 'gdot');
    dot.style.background = GROUP_BY_ID[g] ? GROUP_BY_ID[g].color : 'var(--line)';
    dot.title = GROUP_BY_ID[g] ? GROUP_BY_ID[g].en : g;
    sub.append(dot);
  }
  if (it.from.length) sub.append(el('span', 'from', 'for ' + it.from.join(', ')));
  if (it.note) sub.append(el('span', 'note', it.note));
  if (sub.childNodes.length) mid.append(sub);
  li.append(mid);

  const qty = el('input', 'iqty');
  qty.value = it.qty || '';
  qty.placeholder = 'qty';
  qty.setAttribute('aria-label', 'Quantity');
  qty.addEventListener('change', () => { it.qty = qty.value.trim(); save(); });
  li.append(qty);

  const more = el('button', 'imore', '⋯');
  more.title = 'Edit this item';
  more.setAttribute('aria-label', 'Edit this item');
  li.append(more);

  const panel = el('div', 'ipanel');
  more.addEventListener('click', () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open') && !panel.childNodes.length) fillPanel(panel, wk, it);
  });
  li.append(panel);
  return li;
}

function fillPanel(panel, wk, it) {
  const row1 = el('div', 'prow');
  row1.append(el('label', null, 'Section 分类'));
  const sel = el('select');
  for (const a of AISLES) {
    const o = el('option', null, `${a.en} ${a.zh}`);
    o.value = a.id;
    if (a.id === it.aisle) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', () => {
    it.aisle = sel.value; it.pinned = true;
    learn(it);
    save(); renderList();
  });
  row1.append(sel);
  panel.append(row1);

  const row2 = el('div', 'prow');
  row2.append(el('label', null, 'Counts as 营养'));
  const chips = el('div', 'gchips');
  for (const g of GROUPS) {
    const b = el('button', 'gchip' + (it.groups.includes(g.id) ? ' on' : ''), `${g.en} ${g.zh}`);
    b.style.setProperty('--gc', g.color);
    b.addEventListener('click', () => {
      const i = it.groups.indexOf(g.id);
      if (i < 0) it.groups.push(g.id); else it.groups.splice(i, 1);
      b.classList.toggle('on');
      it.pinned = true;
      learn(it);
      save(); renderList();
    });
    chips.append(b);
  }
  row2.append(chips);
  panel.append(row2);

  const row3 = el('div', 'prow');
  row3.append(el('label', null, 'Note 备注'));
  const note = el('input');
  note.value = it.note || '';
  note.placeholder = 'ripe ones, the small pack…';
  note.addEventListener('change', () => { it.note = note.value.trim(); save(); renderList(); });
  row3.append(note);
  panel.append(row3);

  const row4 = el('div', 'prow');
  const del = el('button', 'ghost danger', 'Remove from list');
  del.addEventListener('click', () => removeItem(wk, it.id));
  row4.append(del);
  panel.append(row4);
}

/* a section or group you picked by hand is remembered for next time */
function learn(it) {
  store.learned[normalize(it.name)] = { aisle: it.aisle, groups: it.groups.slice() };
}
function removeItem(wk, id) {
  const rec = weekRec(wk);
  rec.items = rec.items.filter(i => i.id !== id);
  save(); renderList();
}

/* ── the add bar ───────────────────────────────────────────── */
function submitAdd() {
  const input = $('#addInput');
  const res = addTyped(key(curWeek), input.value);
  if (!res) return;
  save();
  input.value = '';
  renderSuggests('');
  renderList(); renderSetup();
  if (res.kind === 'dish') {
    toast(`${res.dish} → ${res.added.length} ingredient${res.added.length === 1 ? '' : 's'}` +
          (res.improvised ? ' (guessed from the name)' : ''));
  } else {
    toast(res.added.length === 1 ? `Added ${res.added[0].name}` : `Added ${res.added.length} items`);
  }
  input.focus();
}
$('#addBtn').addEventListener('click', submitAdd);
$('#addInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitAdd(); } });
$('#addInput').addEventListener('input', e => renderSuggests(e.target.value));

/* live suggestions: dishes first, then foods — tap to fill */
function renderSuggests(raw) {
  const host = $('#suggests');
  host.innerHTML = '';
  const t = normalize(raw);
  if (t.length < 1) return;

  const hits = [];
  for (const r of RECIPE_LIST) {
    if (r.names.some(n => normalize(n).includes(t))) hits.push({ label: r.names[0], sub: 'dish 菜', text: r.names[0] });
    if (hits.length >= 4) break;
  }
  for (const f of FOOD_LIST) {
    if (hits.length >= 8) break;
    const all = f.en.concat(f.zh);
    if (all.some(n => normalize(n).includes(t))) {
      const label = hasCJK(raw) ? (f.zh[0] || f.en[0]) : f.en[0];
      hits.push({ label, sub: AISLE_BY_ID[f.aisle].zh, text: label });
    }
  }
  for (const h of hits.slice(0, 8)) {
    const b = el('button', 'sug');
    b.append(el('b', null, h.label));
    b.append(el('i', null, h.sub));
    b.addEventListener('click', () => {
      const input = $('#addInput');
      const lead = splitQty(input.value).qty;
      input.value = (lead ? lead + ' ' : '') + h.text;
      submitAdd();
    });
    host.append(b);
  }
}

/* ── list-wide actions ─────────────────────────────────────── */
$('#weekPrev').addEventListener('click', () => setWeek(addDays(curWeek, -7)));
$('#weekNext').addEventListener('click', () => setWeek(addDays(curWeek, 7)));
$('#goThisWeek').addEventListener('click', () => { curDay = today(); setWeek(today()); });

$('#carryOver').addEventListener('click', () => {
  const prev = weekPeek(key(addDays(curWeek, -7)));
  if (!prev || !prev.items.length) return toast('Last week had no list');
  const left = prev.items.filter(i => !i.got);
  if (!left.length) return toast('Last week was finished — nothing to carry');
  let n = 0;
  for (const i of left) {
    const added = addToList(key(curWeek), (i.qty ? i.qty + ' ' : '') + i.name, i.from[0] || '');
    if (added) n++;
  }
  save(); renderList();
  toast(`Carried ${n} unbought item${n === 1 ? '' : 's'} forward`);
});

$('#copyList').addEventListener('click', () => {
  const items = (weekPeek(key(curWeek)) || { items: [] }).items;
  if (!items.length) return toast('Nothing to copy');
  const lines = [`Grocery list · ${weekLabel(curWeek)}`, ''];
  for (const a of AISLES) {
    const mine = items.filter(i => i.aisle === a.id);
    if (!mine.length) continue;
    lines.push(`${a.en} ${a.zh}`);
    for (const i of mine) {
      lines.push(`  ${i.got ? '[x]' : '[ ]'} ${i.name}${i.qty ? ' — ' + i.qty : ''}${i.from.length ? ' (' + i.from.join(', ') + ')' : ''}`);
    }
    lines.push('');
  }
  copyText(lines.join('\n').trim(), 'List copied');
});

$('#clearGot').addEventListener('click', () => {
  const rec = weekRec(key(curWeek));
  const before = rec.items.length;
  rec.items = rec.items.filter(i => !i.got);
  save(); renderList();
  toast(`Cleared ${before - rec.items.length}`);
});
$('#clearAll').addEventListener('click', () => {
  if (!confirm('Clear this week’s whole list?')) return;
  weekRec(key(curWeek)).items = [];
  save(); renderList();
});

/* ─────────────────────────── MEALS VIEW ───────────────────── */
function renderMeals() {
  $('#mWeekLabel').textContent = weekLabel(curWeek);
  $('#goToday').hidden = key(curDay) === key(today());

  /* day chips */
  const chips = $('#dayChips');
  chips.innerHTML = '';
  weekDays(curWeek).forEach((d, i) => {
    const k = key(d);
    const b = el('button', 'daychip' + (k === key(curDay) ? ' is-active' : '') + (k === key(today()) ? ' is-today' : ''));
    b.append(el('b', null, DAY_NAMES[i]));
    b.append(el('i', null, '周' + DAY_ZH[i]));
    const dots = el('span', 'dots');
    const s = dayServings(k);
    for (const g of CORE_GROUPS) {
      const dot = el('span', 'dot');
      if (s[g]) dot.style.background = GROUP_BY_ID[g].color;
      dots.append(dot);
    }
    b.append(dots);
    b.addEventListener('click', () => { curDay = d; renderMeals(); });
    chips.append(b);
  });

  const dayK = key(curDay);
  $('#mealDayTitle').textContent = curDay.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const diff = Math.round((curDay - today()) / 86400000);
  const rel = diff === 0 ? 'Today' : diff === -1 ? 'Yesterday' : diff === 1 ? 'Tomorrow'
            : diff < 0 ? `${-diff} days ago` : `in ${diff} days`;
  const s = dayServings(dayK);
  const missing = GROUPS.filter(g => (s[g.id] || 0) < store.settings.targets[g.id]);
  $('#mealDaySub').textContent = rel + (dayLogged(dayK)
    ? (missing.length ? ' · short on ' + missing.map(g => g.en.toLowerCase()).join(', ') : ' · every group covered')
    : ' · nothing written down yet');

  const host = $('#mealList');
  host.innerHTML = '';
  for (const m of MEALS) host.append(mealCard(dayK, m));
}

function mealCard(dayK, m) {
  const card = el('div', 'card meal');
  const head = el('div', 'cardhead');
  const h = el('h2', null, m.en + ' ');
  h.append(el('span', 'zh', m.zh));
  head.append(h);

  const badges = el('div', 'badges');
  const counts = mealServings(dayK, m.id);
  for (const g of CORE_GROUPS) {
    const b = el('span', 'badge' + (counts[g] ? ' on' : ''), GROUP_BY_ID[g].zh);
    b.style.setProperty('--gc', GROUP_BY_ID[g].color);
    b.title = GROUP_BY_ID[g].en;
    badges.append(b);
  }
  head.append(badges);
  card.append(head);

  const entries = mealPeek(dayK, m.id);
  const ul = el('ul', 'entries');
  for (const e of entries) {
    const li = el('li', 'entry');
    const txt = el('input', 'etext');
    txt.value = e.text;
    txt.setAttribute('aria-label', m.en + ' entry');
    txt.addEventListener('change', () => {
      const v = txt.value.trim();
      const rec = mealRec(dayK)[m.id];
      const i = rec.findIndex(x => x.id === e.id);
      if (i < 0) return;
      if (!v) rec.splice(i, 1); else rec[i].text = v;
      save(); renderMeals(); renderBalance();
    });
    li.append(txt);

    const gs = groupsOf(e.text);
    const dots = el('span', 'edots');
    for (const g of gs) {
      const d = el('span', 'gdot');
      d.style.background = GROUP_BY_ID[g] ? GROUP_BY_ID[g].color : 'var(--line)';
      d.title = GROUP_BY_ID[g] ? GROUP_BY_ID[g].en : g;
      dots.append(d);
    }
    if (!gs.length) dots.append(el('span', 'unknown', '?'));
    li.append(dots);

    const shop = el('button', 'esmall', '＋');
    shop.title = 'Add its ingredients to the list';
    shop.addEventListener('click', () => {
      const res = addTyped(key(curWeek), e.text);
      save(); renderList();
      toast(res && res.added.length ? `${res.added.length} on the list` : 'Nothing to add');
    });
    li.append(shop);

    const del = el('button', 'esmall', '×');
    del.title = 'Remove';
    del.addEventListener('click', () => {
      const rec = mealRec(dayK)[m.id];
      const i = rec.findIndex(x => x.id === e.id);
      if (i >= 0) rec.splice(i, 1);
      save(); renderMeals(); renderBalance();
    });
    li.append(del);
    ul.append(li);
  }
  card.append(ul);

  const add = el('div', 'mealadd');
  const inp = el('input');
  inp.type = 'text';
  inp.autocomplete = 'off';
  inp.enterKeyHint = 'done';
  inp.placeholder = m.id === 'breakfast' ? '燕麦粥 · yogurt · 2 eggs' : '番茄炒蛋 · 米饭 · salad';
  const commit = () => {
    const v = inp.value.trim();
    if (!v) return;
    for (const part of v.split(/[,，、;；\n]+/).map(x => x.trim()).filter(Boolean)) {
      mealRec(dayK)[m.id].push({ id: uid(), text: part });
    }
    inp.value = '';
    save(); renderMeals(); renderBalance();
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  const btn = el('button', 'add', '＋');
  btn.addEventListener('click', commit);
  add.append(inp, btn);
  card.append(add);
  return card;
}

$('#mWeekPrev').addEventListener('click', () => setWeek(addDays(curWeek, -7)));
$('#mWeekNext').addEventListener('click', () => setWeek(addDays(curWeek, 7)));
$('#goToday').addEventListener('click', () => { curDay = today(); setWeek(today()); });

$('#dayToList').addEventListener('click', () => {
  const dayK = key(curDay);
  let n = 0;
  for (const m of MEALS) for (const e of mealPeek(dayK, m.id)) {
    const res = addTyped(key(curWeek), e.text);
    if (res) n += res.added.length;
  }
  save(); renderList();
  toast(n ? `${n} ingredients on this week’s list` : 'Nothing written on this day yet');
});

$('#copyDay').addEventListener('click', () => {
  const dayK = key(curDay);
  const lines = [curDay.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }), ''];
  for (const m of MEALS) {
    const entries = mealPeek(dayK, m.id);
    if (!entries.length) continue;
    lines.push(`${m.en} ${m.zh}: ${entries.map(e => e.text).join(', ')}`);
  }
  const s = dayServings(dayK);
  lines.push('', GROUPS.map(g => `${g.en} ${s[g.id] || 0}/${store.settings.targets[g.id]}`).join(' · '));
  copyText(lines.join('\n'), 'Day copied');
});

/* ────────────────────────── BALANCE VIEW ──────────────────── */
const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${a.toFixed(2)})`;
};

function renderBalance() {
  $('#bWeekLabel').textContent = weekLabel(curWeek);
  $('#bThisWeek').hidden = isThisWeek();
  const r = weekReport(curWeek);

  /* score ring */
  $('#scoreRing').style.setProperty('--p', r.pct);
  $('#scorePct').textContent = r.pct + '%';
  const worst = GROUPS.map(g => ({ g, gap: r.paceGoals[g.id] - r.totals[g.id] }))
                      .sort((a, b) => b.gap - a.gap)[0];
  if (!r.logged.length) {
    $('#scoreHeadline').textContent = 'Nothing logged yet';
    $('#scoreSub').textContent = 'Write what you ate under Meals 每餐 and this fills in.';
  } else if (r.pct >= 90) {
    $('#scoreHeadline').textContent = 'A balanced week 很均衡';
    $('#scoreSub').textContent = `${r.logged.length} of ${r.elapsed || 7} days logged · every group close to target.`;
  } else {
    $('#scoreHeadline').textContent = `Short on ${worst.g.en.toLowerCase()} ${worst.g.zh}`;
    $('#scoreSub').textContent = `${r.totals[worst.g.id]} of ${r.paceGoals[worst.g.id]} servings by now · ` +
      `${r.logged.length} of ${r.elapsed || 7} days logged.`;
  }

  /* per-group bars, measured against the whole week */
  const cats = $('#balanceGroups');
  cats.innerHTML = '';
  for (const g of GROUPS) {
    const had = r.totals[g.id], goal = r.goals[g.id];
    const c = el('div', 'cat');
    const row = el('div', 'catrow');
    const nm = el('div', 'catname');
    const dot = el('span', 'dot'); dot.style.background = g.color;
    nm.append(dot, el('span', null, g.en + ' '), el('span', 'zh', g.zh));
    row.append(nm);
    const num = el('div', 'catnum');
    num.append(el('b', null, String(had)), document.createTextNode(` / ${goal} servings`));
    row.append(num);
    c.append(row);
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.width = Math.min(100, goal ? had / goal * 100 : 0) + '%';
    fill.style.background = g.color;
    bar.append(fill);
    /* the pace marker: where you should be today */
    const pace = el('u');
    pace.style.left = Math.min(100, goal ? r.paceGoals[g.id] / goal * 100 : 0) + '%';
    bar.append(pace);
    c.append(bar);
    const gap = r.paceGoals[g.id] - had;
    const left = Math.max(1, 7 - r.paceDays);
    const d = el('div', 'delta ' + (gap > 0 ? 'under' : 'over'),
      gap > 0 ? `${gap} behind pace · ${((r.goals[g.id] - had) / left).toFixed(1)} a day to finish the week`
              : `on pace${-gap ? ` · ${-gap} ahead` : ''}`);
    c.append(d);
    cats.append(c);
  }

  /* day × group heat */
  const grid = $('#balanceGrid');
  grid.innerHTML = '';
  grid.append(el('span', 'hcorner', ''));
  weekDays(curWeek).forEach((d, i) => {
    const h = el('span', 'hcol' + (key(d) === key(today()) ? ' is-today' : ''), DAY_NAMES[i]);
    grid.append(h);
  });
  for (const g of GROUPS) {
    const lab = el('span', 'hrow');
    lab.append(el('span', 'zh', g.short || g.zh));
    lab.title = g.en;
    grid.append(lab);
    for (const d of weekDays(curWeek)) {
      const k = key(d);
      const n = r.byDay[k][g.id] || 0;
      const target = store.settings.targets[g.id];
      const cell = el('span', 'hcell', n ? String(n) : '');
      const ratio = target ? Math.min(1, n / target) : 0;
      if (n) cell.style.background = hexA(g.color, .18 + ratio * .62);
      if (ratio >= .75) cell.style.color = '#fff';
      if (fromKey(k) > today()) cell.classList.add('future');
      cell.title = `${g.en} · ${DAY_NAMES[weekDays(curWeek).findIndex(x => key(x) === k)]} · ${n}/${target}`;
      cell.addEventListener('click', () => { curDay = d; renderMeals(); showTab('meals'); });
      grid.append(cell);
    }
  }

  /* meal × day: is each meal carrying vegetables, protein and a grain? */
  const mm = $('#mealMatrix');
  mm.innerHTML = '';
  mm.append(el('span', 'hcorner', ''));
  weekDays(curWeek).forEach((d, i) => mm.append(el('span', 'hcol' + (key(d) === key(today()) ? ' is-today' : ''), DAY_NAMES[i])));
  const slots = MEALS.filter(m => !m.optional);
  const slotStats = {};
  for (const m of slots) {
    const lab = el('span', 'hrow');
    lab.append(el('span', 'zh', m.zh));
    mm.append(lab);
    slotStats[m.id] = { veg: 0, protein: 0, grain: 0, eaten: 0 };
    for (const d of weekDays(curWeek)) {
      const k = key(d);
      const c = mealServings(k, m.id);
      const have = CORE_GROUPS.filter(g => c[g]);
      const eaten = mealPeek(k, m.id).length > 0;
      if (eaten) { slotStats[m.id].eaten++; for (const g of have) slotStats[m.id][g]++; }
      const cell = el('span', 'hcell', eaten ? `${have.length}/3` : '');
      if (eaten) {
        cell.style.background = hexA(have.length === 3 ? '#3fb27f' : have.length === 2 ? '#d9a441' : '#e0705a',
                                     .2 + have.length * .18);
      }
      if (fromKey(k) > today()) cell.classList.add('future');
      cell.title = eaten ? `${m.en}: ${mealPeek(k, m.id).map(e => e.text).join(', ')}` : `${m.en} — not logged`;
      cell.addEventListener('click', () => { curDay = d; renderMeals(); showTab('meals'); });
      mm.append(cell);
    }
  }

  const stats = $('#mealStats');
  stats.innerHTML = '';
  for (const m of slots) {
    const s = slotStats[m.id];
    const line = el('div', 'mstat');
    line.append(el('b', null, `${m.en} ${m.zh}`));
    line.append(el('span', 'muted', s.eaten
      ? ` · vegetables ${s.veg}/${s.eaten} · protein ${s.protein}/${s.eaten} · grain ${s.grain}/${s.eaten}`
      : ' · not logged this week'));
    stats.append(line);
  }

  renderAdvice(r, slotStats);
}

function renderAdvice(r, slotStats) {
  const host = $('#adviceList');
  host.innerHTML = '';
  const lines = advice(curWeek, r, slotStats);
  for (const t of lines) {
    const li = el('li');
    li.innerHTML = t;
    host.append(li);
  }
}

/* Every line carries the number it came from — an instruction you can act on
   tonight, not a grade. */
function advice(wk, r, slotStats) {
  const out = [];
  const items = (weekPeek(key(wk)) || { items: [] }).items;
  const daysLeft = Math.max(0, 7 - r.paceDays);
  const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  if (!r.logged.length) {
    return ['Nothing is logged for this week yet. Open <b>Meals 每餐</b>, write what you ate — ' +
            'a dish name in either language is enough — and every number here fills itself in.'];
  }

  /* 1. the biggest hole, and what it costs a day to close */
  const gaps = GROUPS.map(g => ({ g, gap: r.paceGoals[g.id] - r.totals[g.id], had: r.totals[g.id] }))
                     .filter(x => x.gap > 0).sort((a, b) => b.gap - a.gap);
  if (gaps.length) {
    const w = gaps[0];
    const weekGap = r.goals[w.g.id] - w.had;
    const perDay = daysLeft ? (weekGap / daysLeft) : 0;
    if (daysLeft && perDay > store.settings.targets[w.g.id] * 2) {
      out.push(`<b>${w.g.en} ${w.g.zh}</b> is ${weekGap} servings short of the week with ${daysLeft} day${daysLeft === 1 ? '' : 's'} left — ` +
               `${perDay.toFixed(1)} a day is more than you eat. Take the week as it is and start Monday with ${w.g.en.toLowerCase()} at breakfast.`);
    } else if (daysLeft) {
      out.push(`<b>${w.g.en} ${w.g.zh}</b>: ${w.had} of ${r.paceGoals[w.g.id]} by now. ` +
               `${perDay.toFixed(1)} servings a day over the ${daysLeft} day${daysLeft === 1 ? '' : 's'} left closes the week.`);
    } else {
      out.push(`<b>${w.g.en} ${w.g.zh}</b> finished ${weekGap} short of ${r.goals[w.g.id]}. It is the gap to carry into next week.`);
    }
    /* what is already in the basket that would have fixed it */
    const cure = items.filter(i => i.groups.includes(w.g.id)).slice(0, 3);
    if (cure.length) {
      out.push(`You already have <b>${cure.map(i => escHtml(i.name)).join('</b>, <b>')}</b> on this week&rsquo;s list — ` +
               `that is ${w.g.en.toLowerCase()} sitting in the fridge rather than on the plate.`);
    }
  }

  /* 2. anything that never appeared at all */
  const zero = GROUPS.filter(g => !r.totals[g.id]);
  if (zero.length) {
    out.push(`No ${zero.map(g => `<b>${g.en.toLowerCase()} ${g.zh}</b>`).join(', ')} at all this week. ` +
             `One serving a day of each is the whole ask.`);
  }

  /* 3. which meal is the weak one */
  const slots = MEALS.filter(m => !m.optional);
  const weakest = slots.map(m => {
    const s = slotStats[m.id];
    return { m, s, miss: s.eaten ? (s.eaten - s.veg) : 0 };
  }).sort((a, b) => b.miss - a.miss)[0];
  if (weakest && weakest.miss >= 2) {
    out.push(`<b>${weakest.m.en} ${weakest.m.zh}</b> went without vegetables on ${weakest.miss} of ` +
             `${weakest.s.eaten} logged days. It is the cheapest fix on this page — ` +
             `${weakest.m.id === 'breakfast' ? 'spinach in the eggs, tomato on the toast' : 'one green dish alongside whatever else you make'}.`);
  }
  const noProtein = slots.filter(m => slotStats[m.id].eaten && slotStats[m.id].protein < slotStats[m.id].eaten / 2);
  if (noProtein.length) {
    out.push(`Protein 蛋白质 is missing from most of your ${noProtein.map(m => m.en.toLowerCase()).join(' and ')} — ` +
             `an egg, 豆腐, yogurt or a handful of nuts is a serving.`);
  }

  /* 4. the shape of the week */
  const loggedDays = r.days.filter(dayLogged);
  const ranked = loggedDays.map(k => ({
    k, n: GROUPS.reduce((s, g) => s + Math.min(r.byDay[k][g.id] || 0, store.settings.targets[g.id]), 0),
  })).sort((a, b) => b.n - a.n);
  if (ranked.length >= 2) {
    const best = ranked[0], worst = ranked[ranked.length - 1];
    const dn = k => weekDays(wk).findIndex(d => key(d) === k);
    out.push(`Your fullest day was <b>${DAY_NAMES[dn(best.k)]}</b> (${best.n} servings), your thinnest ` +
             `<b>${DAY_NAMES[dn(worst.k)]}</b> (${worst.n}). Cook double on the good days and the thin ones stop happening.`);
  }
  const unlogged = r.days.filter(k => fromKey(k) <= today() && !dayLogged(k));
  if (unlogged.length) {
    const dn = k => DAY_NAMES[weekDays(wk).findIndex(d => key(d) === k)];
    out.push(`${unlogged.length} day${unlogged.length === 1 ? '' : 's'} unlogged (${unlogged.map(dn).join(', ')}). ` +
             `The score treats them as empty, so fill them in while you still remember.`);
  }

  /* 5. and the credit where it is due */
  const strong = GROUPS.filter(g => r.totals[g.id] >= r.paceGoals[g.id] && r.paceGoals[g.id] > 0);
  if (strong.length) {
    out.push(`On or ahead of pace: ${strong.map(g => `<b>${g.en} ${g.zh}</b> (${r.totals[g.id]}/${r.paceGoals[g.id]})`).join(', ')}.`);
  }
  return out;
}

$('#bWeekPrev').addEventListener('click', () => setWeek(addDays(curWeek, -7)));
$('#bWeekNext').addEventListener('click', () => setWeek(addDays(curWeek, 7)));
$('#bThisWeek').addEventListener('click', () => { curDay = today(); setWeek(today()); });

$('#copyReport').addEventListener('click', () => {
  const r = weekReport(curWeek);
  const lines = [`Weekly balance · ${weekLabel(curWeek)}`, `Score ${r.pct}% · ${r.logged.length} of ${r.elapsed || 7} days logged`, ''];
  for (const g of GROUPS) lines.push(`${g.en} ${g.zh}: ${r.totals[g.id]} / ${r.goals[g.id]} servings`);
  lines.push('');
  for (const d of weekDays(curWeek)) {
    const k = key(d);
    if (!dayLogged(k)) continue;
    const eaten = MEALS.map(m => {
      const e = mealPeek(k, m.id);
      return e.length ? `${m.en}: ${e.map(x => x.text).join(', ')}` : null;
    }).filter(Boolean);
    lines.push(`${DAY_NAMES[weekDays(curWeek).findIndex(x => key(x) === k)]} — ${eaten.join(' | ')}`);
  }
  lines.push('');
  const slotStats = {};
  for (const m of MEALS.filter(x => !x.optional)) {
    slotStats[m.id] = { veg: 0, protein: 0, grain: 0, eaten: 0 };
    for (const d of weekDays(curWeek)) {
      const c = mealServings(key(d), m.id);
      if (mealPeek(key(d), m.id).length) {
        slotStats[m.id].eaten++;
        for (const g of CORE_GROUPS) if (c[g]) slotStats[m.id][g]++;
      }
    }
  }
  for (const t of advice(curWeek, r, slotStats)) lines.push('- ' + t.replace(/<[^>]+>/g, '').replace(/&rsquo;/g, '’').replace(/&amp;/g, '&').replace(/&lt;/g, '<'));
  copyText(lines.join('\n'), 'Report copied');
});

/* ─────────────────────────── SETUP VIEW ───────────────────── */
function renderSetup() {
  /* targets */
  const host = $('#targetInputs');
  host.innerHTML = '';
  for (const g of GROUPS) {
    const wrap = el('div', 'goal');
    const lab = el('label');
    const dot = el('span', 'dot'); dot.style.background = g.color;
    lab.append(dot, el('span', null, `${g.en} ${g.zh}`));
    const inp = el('input');
    inp.type = 'number'; inp.min = '0'; inp.max = '12'; inp.step = '1';
    inp.value = store.settings.targets[g.id];
    inp.addEventListener('change', () => {
      store.settings.targets[g.id] = Math.max(0, Math.min(12, Math.round(+inp.value || 0)));
      save(); renderBalance(); renderMeals(); renderSetup();
    });
    wrap.append(lab, inp);
    host.append(wrap);
  }

  /* things it could not place */
  const teach = $('#teachList');
  teach.innerHTML = '';
  const names = new Map();
  for (const wk of Object.keys(store.weeks)) {
    for (const it of store.weeks[wk].items) {
      if (it.aisle === 'other' && !names.has(normalize(it.name))) names.set(normalize(it.name), it.name);
    }
  }
  if (!names.size) {
    teach.append(el('p', 'sub', 'Nothing unfiled — every item on your lists found a section.'));
  } else {
    for (const [norm, display] of names) {
      const row = el('div', 'teach');
      row.append(el('b', null, display));
      const sel = el('select');
      for (const a of AISLES) {
        const o = el('option', null, `${a.en} ${a.zh}`);
        o.value = a.id;
        if (a.id === (store.learned[norm] || {}).aisle) o.selected = true;
        sel.append(o);
      }
      const chips = el('div', 'gchips');
      const learnedGroups = ((store.learned[norm] || {}).groups || []).slice();
      const commit = () => {
        store.learned[norm] = { aisle: sel.value, groups: learnedGroups.slice() };
        for (const wk of Object.keys(store.weeks)) {
          for (const it of store.weeks[wk].items) {
            if (normalize(it.name) === norm) { it.aisle = sel.value; it.groups = learnedGroups.slice(); }
          }
        }
        save(); renderList(); renderBalance();
      };
      sel.addEventListener('change', commit);
      for (const g of GROUPS) {
        const b = el('button', 'gchip' + (learnedGroups.includes(g.id) ? ' on' : ''), `${g.en} ${g.zh}`);
        b.style.setProperty('--gc', g.color);
        b.addEventListener('click', () => {
          const i = learnedGroups.indexOf(g.id);
          if (i < 0) learnedGroups.push(g.id); else learnedGroups.splice(i, 1);
          b.classList.toggle('on');
          commit();
        });
        chips.append(b);
      }
      row.append(sel, chips);
      teach.append(row);
    }
  }

  /* what it knows */
  $('#lexStats').textContent =
    `${FOOD_LIST.length} foods and ${RECIPE_LIST.length} dishes, each answering to both its English and Chinese name ` +
    `(${ALIASES.length} names in all). Anything it does not know still goes on the list — it just lands under Other.`;
  const dishes = $('#dishList');
  if (!dishes.childNodes.length) {
    for (const r of RECIPE_LIST) {
      const b = el('button', 'sug');
      b.append(el('b', null, r.names[0]));
      const alt = r.names.find(n => hasCJK(n) !== hasCJK(r.names[0]));
      b.append(el('i', null, alt || `${r.ingredients.length} ingredients`));
      b.addEventListener('click', () => {
        const res = addTyped(key(curWeek), r.names[0]);
        save(); renderList();
        toast(`${r.names[0]} → ${res.added.length} ingredients on the list`);
      });
      dishes.append(b);
    }
  }
}

$('#resetTargets').addEventListener('click', () => {
  store.settings.targets = defaultTargets();
  save(); renderSetup(); renderBalance();
  toast('Targets reset');
});

$('#exportData').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `basket-${key(today())}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#importData').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const data = JSON.parse(fr.result);
      if (!data || !data.weeks) throw new Error('not a Basket export');
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      load();
      renderAll();
      toast('Imported');
    } catch (err) { alert('That file could not be read: ' + err.message); }
    e.target.value = '';
  };
  fr.readAsText(file);
});

$('#wipeData').addEventListener('click', () => {
  if (!confirm('Erase every list, meal and setting on this device?')) return;
  localStorage.removeItem(STORE_KEY);
  load(); renderAll();
  toast('Erased');
});

/* ── go ────────────────────────────────────────────────────── */
load();
renderAll();
