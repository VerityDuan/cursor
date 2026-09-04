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
const STORE_BY_ID = Object.fromEntries(STORES.map(s => [s.id, s]));
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

/* ── store ───────────────────────────────────────────────────
   One living list rather than a new one every week: you tick things off,
   press Shopping done, and the same sections come back empty-handed and
   ready. Finished runs are kept so the list can tell you how long it has
   been since the last T&T trip. */
const defaultTargets = () => Object.fromEntries(GROUPS.map(g => [g.id, g.perDay]));
const blank = () => ({
  version: 2,
  settings: {
    targets: defaultTargets(),
    hideStaples: true,
    favourites: DEFAULT_FAVOURITES.slice(),
    store: 'all',
  },
  learned: {}, list: { items: [] }, runs: [], meals: {},
});

let store;

/* Anything that arrives — from storage, an import, or another device — is
   run through here, so a half-written or older shape can never crash a
   render. */
function normalise(raw) {
  const s = Object.assign(blank(), raw);
  s.settings = Object.assign(blank().settings, raw.settings);
  s.settings.targets = Object.assign(defaultTargets(), s.settings.targets);
  s.learned = s.learned || {};
  s.meals = s.meals || {};
  s.runs = s.runs || [];
  s.list = s.list || { items: [] };
  s.list.items = s.list.items || [];
  /* v1 kept a separate list per week — fold them all into the one list */
  if (raw.weeks) {
    for (const wk of Object.keys(raw.weeks)) {
      for (const it of (raw.weeks[wk].items || [])) {
        if (!s.list.items.some(x => (x.foodId || normalize(x.name)) === (it.foodId || normalize(it.name)))) {
          s.list.items.push(Object.assign({ store: storeOf(it.foodId) }, it));
        }
      }
    }
    delete s.weeks;
  }
  for (const it of s.list.items) if (!it.store) it.store = storeOf(it.foodId);
  return s;
}
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (raw && (raw.list || raw.weeks)) { store = normalise(raw); return; }
  } catch (e) { /* corrupt or blocked storage — start clean */ }
  store = blank();
}
function save() {
  store.updatedAt = Date.now();
  store.by = CLIENT_ID;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
  catch (e) { console.warn('Could not save — storage unavailable.', e); }
  cloudPush();
}

/* ── the same basket on your other device ───────────────────
   Everything above is complete on its own: the list lives in this browser.
   Where the page happens to be served somewhere that offers a shared
   document store — a published Artifact — the basket follows you from the
   laptop you wrote it on to the phone in the shop. Anywhere else, every
   line of this is inert. */
const CLIENT_ID = Math.random().toString(36).slice(2, 9);
const CLOUD_DOC = 'basket/state';
let cloudDoc = null, cloudTimer = null;

function cloudPush() {
  if (!cloudDoc) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    try { cloudDoc.set(JSON.parse(JSON.stringify(store))).catch(() => {}); }
    catch (e) { /* offline or revoked — localStorage already has it */ }
  }, 800);
}

/* null everywhere but a published Artifact — every caller branches on it */
async function useCap(name) {
  if (typeof window === 'undefined' || !window.claude || typeof window.claude.use !== 'function') return null;
  try { return await window.claude.use(name); } catch (e) { return null; }
}

async function startCloud() {
  const db = await useCap('db');
  if (!db) return;
  cloudDoc = db.doc(CLOUD_DOC);
  cloudDoc.onSnapshot(snap => {
    if (!snap.exists) { cloudPush(); return; }        /* first device seeds it */
    const remote = snap.data();
    if (!remote || remote.by === CLIENT_ID) return;   /* our own write, echoed */
    if ((remote.updatedAt || 0) <= (store.updatedAt || 0)) return;  /* ours is newer */
    store = normalise(JSON.parse(JSON.stringify(remote)));
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ }
    renderAll();
    toast('Updated from your other device');
  }, () => { cloudDoc = null; });
}
const uid = () => Math.random().toString(36).slice(2, 9);

const listItems = () => store.list.items;
const storeOf = foodId => STORE_OF[foodId] || DEFAULT_STORE;

function mealRec(dayK) {
  if (!store.meals[dayK]) store.meals[dayK] = {};
  const d = store.meals[dayK];
  for (const m of MEALS) d[m.id] = d[m.id] || [];
  return d;
}
const mealPeek = (dayK, id) => ((store.meals[dayK] || {})[id]) || [];
const dayLogged = dayK => MEALS.some(m => mealPeek(dayK, m.id).length);

/* ── finishing a shop ──────────────────────────────────────
   Nothing is thrown away: the run is recorded, every tick is cleared, and
   the same sections and items are waiting for next time. */
function finishRun(storeId, scope) {
  const got = scope.filter(i => i.got);
  /* A run at "All" is not a trip to every shop — it counts only for the
     shops the things you actually bought belong to. */
  const visited = storeId === 'all'
    ? [...new Set(got.map(i => i.store).filter(s => s && s !== 'any'))]
    : [storeId];
  store.runs.unshift({
    id: uid(), at: Date.now(), store: storeId, stores: visited,
    got: got.map(i => i.name), total: scope.length,
  });
  store.runs = store.runs.slice(0, 60);
  for (const i of scope) i.got = false;
  save();
  return got.length;
}
function undoRun(run, scope) {
  const names = new Set(run.got.map(normalize));
  for (const i of scope) if (names.has(normalize(i.name))) i.got = true;
  store.runs = store.runs.filter(r => r.id !== run.id);
  save();
}
const lastRunAt = storeId => {
  const r = store.runs.find(x => (x.stores || [x.store]).includes(storeId));
  return r ? r.at : 0;
};
const agoText = ts => {
  if (!ts) return 'not yet';
  const d = Math.round((Date.now() - ts) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago`
       : d < 60 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`;
};

/* ── adding to the list ────────────────────────────────────────
   One entry point for everything typed: a dish explodes into ingredients,
   anything else is an item, and a food already on the list gains a source
   rather than a duplicate row. */
function addToList(raw, fromDish, forStore) {
  const text = (raw || '').trim();
  if (!text) return null;
  const rec = store.list;
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
    store: forStore && forStore !== 'all' ? forStore : storeOf(cls.food ? cls.food.id : ''),
    from: fromDish ? [fromDish] : [], note: '',
    /* salt and soy sauce arrive with every dish and are already in your
       kitchen — they are folded away until you say otherwise */
    staple: !!fromDish && (cls.aisle === 'pantry' || cls.aisle === 'spice') && !cls.groups.length,
  };
  rec.items.push(item);
  return item;
}

/* returns { kind: 'dish'|'items', dish, added: [items] } */
function addOne(text, forStore) {
  const recipe = matchRecipe(text);
  if (recipe) {
    const added = recipe.ingredients.map(ing => addToList(ing, recipe.id, forStore)).filter(Boolean);
    return { kind: 'dish', dish: recipe.id, added };
  }
  const improvised = improviseDish(text);
  if (improvised) {
    const added = improvised
      .map(f => addToList(hasCJK(text) ? (f.zh[0] || f.en[0]) : f.en[0], text, forStore))
      .filter(Boolean);
    return { kind: 'dish', dish: text, added, improvised: true };
  }
  const item = addToList(text, '', forStore);
  return { kind: 'items', added: item ? [item] : [] };
}

/* A comma, a 、 or a newline separates things; each piece is then a dish or an
   item on its own terms. */
function addTyped(raw, forStore) {
  const text = (raw || '').trim();
  if (!text) return null;
  const parts = text.split(/[,，、;；\n]+/).map(s => s.trim()).filter(Boolean);
  if (parts.length === 1) return addOne(parts[0], forStore);

  const added = [];
  let dishes = 0, dish = '';
  for (const p of parts) {
    const r = addOne(p, forStore);
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
const btn = (cls, txt) => { const b = el('button', cls, txt); b.type = 'button'; return b; };

let toastTimer;
function toast(msg, actionLabel, action) {
  const t = $('#toast');
  t.innerHTML = '';
  t.append(el('span', null, msg));
  if (actionLabel) {
    const b = btn('undo', actionLabel);
    b.addEventListener('click', () => { t.classList.remove('show'); action(); });
    t.append(b);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), actionLabel ? 6000 : 2600);
}
function copyText(text, msg) {
  const done = () => toast(msg);
  const fallback = () => {
    const ta = el('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Could not copy'); }
    ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, fallback);
  } else fallback();
}

/* ── state ─────────────────────────────────────────────────── */
let curWeek = monday(today());
let curDay  = today();
const MEAL_C = { breakfast: '#F0B429', lunch: '#3FB27F', dinner: '#9B87E0', snack: '#FF7BA0' };

const weekLabel = wk => {
  const end = addDays(wk, 6);
  const diff = Math.round((wk - monday(today())) / 604800000);
  const rel = diff === 0 ? ' · this week' : diff === -1 ? ' · last week' : diff === 1 ? ' · next week' : '';
  return `${fmtDay(wk)} – ${fmtDay(end)}${rel}`;
};
const isThisWeek = () => +curWeek === +monday(today());
function setWeek(wk) {
  curWeek = monday(wk);
  if (+monday(curDay) !== +curWeek) curDay = curWeek;
  renderMeals(); renderBalance();
}
function renderAll() { renderList(); renderMeals(); renderBalance(); renderSetup(); }

/* ── tabs ──────────────────────────────────────────────────── */
function showTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === name));
  $$('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + name));
  window.scrollTo(0, 0);
}
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('.tab');
  if (b) showTab(b.dataset.view);
});
$('#gearBtn').addEventListener('click', () => { renderSetup(); showTab('setup'); });
$('#setupBack').addEventListener('click', () => showTab('list'));

/* ─────────────────────────── LIST ─────────────────────────── */
const inScope = i => {
  const f = store.settings.store;
  return f === 'all' || i.store === f || i.store === 'any';
};

function renderList() {
  const all = listItems();
  const f = store.settings.store;
  const hiding = store.settings.hideStaples !== false;
  const scoped = all.filter(inScope);
  const folded = hiding ? scoped.filter(i => i.staple) : [];
  const shown  = hiding ? scoped.filter(i => !i.staple) : scoped;
  const got = shown.filter(i => i.got).length;

  /* which shop am I in */
  const chips = $('#storeChips');
  chips.innerHTML = '';
  const opts = [{ id: 'all', name: 'All', zh: '全部', c: '#1A1712' }].concat(STORES.filter(s => s.id !== 'any'));
  const countable = hiding ? all.filter(i => !i.staple) : all;
  for (const s of opts) {
    const n = countable.filter(i => s.id === 'all' ? true : (i.store === s.id || i.store === 'any')).length;
    const b = btn('schip' + (f === s.id ? ' on' : ''));
    b.style.setProperty('--c', s.c);
    b.append(el('b', null, s.name));
    if (n) b.append(el('i', null, String(n)));
    b.addEventListener('click', () => { store.settings.store = s.id; save(); renderList(); });
    chips.append(b);
  }

  /* your dishes, one tap each */
  const favs = $('#favs');
  favs.innerHTML = '';
  (store.settings.favourites || []).forEach((id, n) => {
    const r = RECIPE_BY_ID[id];
    if (!r) return;
    const b = btn('fav');
    b.style.setProperty('--c', FAV_COLORS[n % FAV_COLORS.length]);
    b.append(el('b', null, r.names[0]));
    const alt = r.names.find(x => hasCJK(x) !== hasCJK(r.names[0]));
    b.append(el('i', null, alt || `${r.ingredients.length} items`));
    b.addEventListener('click', () => {
      const res = addTyped(r.names[0], f);
      save(); renderList();
      toast(`${r.names[0]} → ${res.added.length} on the list`);
    });
    favs.append(b);
  });

  /* how far along */
  $('#listBar').style.width = (shown.length ? got / shown.length * 100 : 0) + '%';
  $('#listBar').style.background = got && got === shown.length ? 'var(--good)' : 'var(--ink)';
  $('#listCount').textContent = shown.length ? `${got} / ${shown.length}` : '—';
  $('#listWhere').textContent = f === 'all' ? 'Everything 全部'
    : `${STORE_BY_ID[f].name} ${STORE_BY_ID[f].zh}`.trim();

  /* the sections */
  const host = $('#sections');
  host.innerHTML = '';
  if (!shown.length) {
    const empty = el('div', 'empty');
    empty.append(el('p', 'big', all.length ? 'Nothing here for this shop.' : 'Empty list.'));
    empty.append(el('p', null, all.length
      ? 'Try All 全部, or add something above.'
      : 'Tap one of your dishes up there, or type anything — 苹果, 2 lbs chicken, 番茄炒蛋.'));
    host.append(empty);
  }
  for (const aisle of AISLES) {
    const mine = shown.filter(i => i.aisle === aisle.id);
    if (!mine.length) continue;
    mine.sort((a, b) => (a.got === b.got) ? 0 : a.got ? 1 : -1);

    const sec = el('section', 'aisle');
    sec.style.setProperty('--c', aisle.c);
    const head = el('div', 'aislehead');
    head.append(el('b', null, aisle.en));
    head.append(el('i', null, aisle.zh));
    sec.append(head);

    const ul = el('ul', 'items');
    for (const it of mine) ul.append(itemRow(it));
    sec.append(ul);
    host.append(sec);
  }

  /* seasonings you already own */
  const fold = $('#staples');
  fold.innerHTML = '';
  if (folded.length) {
    fold.append(el('span', null,
      `${folded.length} seasoning${folded.length === 1 ? '' : 's'} folded away — ` +
      folded.slice(0, 4).map(i => i.name).join('、') + (folded.length > 4 ? '…' : '')));
    const b = btn('ghost', 'Show');
    b.addEventListener('click', () => { store.settings.hideStaples = false; save(); renderList(); });
    fold.append(b);
  } else if (!hiding && scoped.some(i => i.staple)) {
    fold.append(el('span', null, 'Seasonings are showing.'));
    const b = btn('ghost', 'Fold away');
    b.addEventListener('click', () => { store.settings.hideStaples = true; save(); renderList(); });
    fold.append(b);
  }

  /* the big button */
  const done = $('#doneBtn');
  done.hidden = !scoped.length;
  done.textContent = f === 'all' ? 'Shopping done ✓' : `Done at ${STORE_BY_ID[f].name} ✓`;
  done.classList.toggle('ready', got > 0);

  /* when you last went where */
  const runs = $('#runs');
  runs.innerHTML = '';
  for (const s of STORES.filter(x => x.id !== 'any')) {
    const chip = el('span', 'run');
    chip.style.setProperty('--c', s.c);
    chip.append(el('b', null, s.name));
    chip.append(el('i', null, agoText(lastRunAt(s.id))));
    runs.append(chip);
  }
}

function itemRow(it) {
  const li = el('li', 'item' + (it.got ? ' is-got' : ''));

  const toggle = () => { it.got = !it.got; save(); renderList(); };

  const tick = btn('tick' + (it.got ? ' on' : ''));
  tick.setAttribute('aria-pressed', it.got ? 'true' : 'false');
  tick.setAttribute('aria-label', (it.got ? 'Untick ' : 'Tick ') + it.name);
  tick.addEventListener('click', toggle);
  li.append(tick);

  const body = btn('ibody');
  const nm = el('span', 'nm', it.name);
  body.append(nm);
  const bits = [];
  const alt = otherName(FOOD_BY_ID[it.foodId], it.name);
  if (alt) bits.push(alt);
  if (it.from.length) bits.push('for ' + it.from.join(', '));
  if (it.note) bits.push(it.note);
  if (bits.length) body.append(el('span', 'sub', bits.join(' · ')));
  body.addEventListener('click', toggle);
  li.append(body);

  if (it.qty) li.append(el('span', 'qtytag', it.qty));

  const more = btn('edit', '⋯');
  more.setAttribute('aria-label', 'Edit ' + it.name);
  const panel = el('div', 'panel');
  more.addEventListener('click', () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open') && !panel.childNodes.length) fillPanel(panel, it);
  });
  li.append(more, panel);
  return li;
}

function fillPanel(panel, it) {
  const row = (label, node) => {
    const r = el('div', 'prow');
    r.append(el('label', null, label));
    r.append(node);
    panel.append(r);
    return r;
  };

  const name = el('input', 'pname');
  name.value = it.name;
  name.setAttribute('aria-label', 'Item name');
  name.addEventListener('change', () => {
    const v = name.value.trim();
    if (!v) { removeItem(it.id); return; }
    const { qty, name: n } = splitQty(v);
    it.name = n;
    if (qty) it.qty = qty;
    const cls = classify(n);
    it.foodId = cls.food ? cls.food.id : '';
    if (!it.pinned) { it.aisle = cls.aisle; it.groups = cls.groups; }
    save(); renderList();
  });
  row('Name 名称', name);

  const qty = el('input');
  qty.value = it.qty || '';
  qty.placeholder = '2 lbs · 500克 · 3';
  qty.addEventListener('change', () => { it.qty = qty.value.trim(); save(); renderList(); });
  row('How much 数量', qty);

  const shops = el('div', 'chiprow');
  for (const s of STORES) {
    const b = btn('pchip' + (it.store === s.id ? ' on' : ''), s.name);
    b.style.setProperty('--c', s.c);
    b.addEventListener('click', () => { it.store = s.id; save(); renderList(); });
    shops.append(b);
  }
  row('Shop 商店', shops);

  const sel = el('select');
  for (const a of AISLES) {
    const o = el('option', null, `${a.en} ${a.zh}`);
    o.value = a.id;
    if (a.id === it.aisle) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', () => { it.aisle = sel.value; it.pinned = true; learn(it); save(); renderList(); });
  row('Section 分类', sel);

  const gs = el('div', 'chiprow');
  for (const g of GROUPS) {
    const b = btn('pchip' + (it.groups.includes(g.id) ? ' on' : ''), g.zh);
    b.style.setProperty('--c', g.color);
    b.addEventListener('click', () => {
      const i = it.groups.indexOf(g.id);
      if (i < 0) it.groups.push(g.id); else it.groups.splice(i, 1);
      b.classList.toggle('on');
      it.pinned = true; learn(it); save(); renderList();
    });
    gs.append(b);
  }
  row('Counts as 营养', gs);

  const note = el('input');
  note.value = it.note || '';
  note.placeholder = 'ripe ones, the small pack…';
  note.addEventListener('change', () => { it.note = note.value.trim(); save(); renderList(); });
  row('Note 备注', note);

  const del = btn('ghost danger', 'Remove from the list');
  del.addEventListener('click', () => removeItem(it.id));
  panel.append(del);
}

function learn(it) { store.learned[normalize(it.name)] = { aisle: it.aisle, groups: it.groups.slice() }; }
function removeItem(id) {
  store.list.items = listItems().filter(i => i.id !== id);
  save(); renderList();
}

/* ── the add bar ───────────────────────────────────────────── */
function submitAdd() {
  const input = $('#addInput');
  const res = addTyped(input.value, store.settings.store);
  if (!res) return;
  save();
  input.value = '';
  renderSuggests('');
  renderList(); renderSetup();
  if (res.kind === 'dish') {
    toast(`${res.dish} → ${res.added.length} ingredient${res.added.length === 1 ? '' : 's'}` +
          (res.improvised ? ' (guessed)' : ''));
  } else {
    toast(res.added.length === 1 ? `Added ${res.added[0].name}` : `Added ${res.added.length} items`);
  }
  input.focus();
}
$('#addBtn').addEventListener('click', submitAdd);
$('#addInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitAdd(); } });
$('#addInput').addEventListener('input', e => renderSuggests(e.target.value));

function renderSuggests(raw) {
  const host = $('#suggests');
  host.innerHTML = '';
  const t = normalize(raw);
  if (!t) return;
  const hits = [];
  for (const r of RECIPE_LIST) {
    if (hits.length >= 4) break;
    if (r.names.some(n => normalize(n).includes(t))) hits.push({ label: r.names[0], sub: 'dish 菜' });
  }
  for (const f of FOOD_LIST) {
    if (hits.length >= 8) break;
    if (f.en.concat(f.zh).some(n => normalize(n).includes(t))) {
      hits.push({ label: hasCJK(raw) ? (f.zh[0] || f.en[0]) : f.en[0], sub: AISLE_BY_ID[f.aisle].zh });
    }
  }
  for (const h of hits) {
    const b = btn('sug');
    b.append(el('b', null, h.label));
    b.append(el('i', null, h.sub));
    b.addEventListener('click', () => {
      const lead = splitQty($('#addInput').value).qty;
      $('#addInput').value = (lead ? lead + ' ' : '') + h.label;
      submitAdd();
    });
    host.append(b);
  }
}

/* ── shopping done ─────────────────────────────────────────── */
$('#doneBtn').addEventListener('click', () => {
  const scoped = listItems().filter(inScope);
  const f = store.settings.store;
  if (!scoped.some(i => i.got) && !confirm('Nothing is ticked. Start the list over anyway?')) return;
  const n = finishRun(f, scoped);
  const run = store.runs[0];
  renderList();
  toast(n ? `${n} bought · fresh list ready` : 'List reset', 'Undo', () => {
    undoRun(run, listItems().filter(inScope));
    renderList();
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('#copyList').addEventListener('click', () => {
  const items = listItems().filter(inScope);
  if (!items.length) return toast('Nothing to copy');
  const f = store.settings.store;
  const lines = [f === 'all' ? 'Grocery list' : `Grocery list · ${STORE_BY_ID[f].name}`, ''];
  for (const a of AISLES) {
    const mine = items.filter(i => i.aisle === a.id);
    if (!mine.length) continue;
    lines.push(`${a.en} ${a.zh}`);
    for (const i of mine) lines.push(`  ${i.got ? '[x]' : '[ ]'} ${i.name}${i.qty ? ' — ' + i.qty : ''}`);
    lines.push('');
  }
  copyText(lines.join('\n').trim(), 'List copied');
});

$('#emptyList').addEventListener('click', () => {
  const f = store.settings.store;
  const scoped = listItems().filter(inScope);
  if (!scoped.length) return;
  if (!confirm(f === 'all' ? 'Delete every item on the list?' : `Delete the ${STORE_BY_ID[f].name} items?`)) return;
  const keep = listItems().filter(i => !inScope(i));
  store.list.items = keep;
  save(); renderList();
});

/* ─────────────────────────── MEALS ────────────────────────── */
function renderMeals() {
  $('#mWeekLabel').textContent = weekLabel(curWeek);
  $('#goToday').hidden = key(curDay) === key(today());

  const chips = $('#dayChips');
  chips.innerHTML = '';
  weekDays(curWeek).forEach((d, i) => {
    const k = key(d);
    const b = btn('daychip' + (k === key(curDay) ? ' is-active' : '') + (k === key(today()) ? ' is-today' : ''));
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
  card.style.setProperty('--c', MEAL_C[m.id]);
  const head = el('div', 'mealhead');
  head.append(el('b', null, m.en));
  head.append(el('i', null, m.zh));
  const badges = el('div', 'badges');
  const counts = mealServings(dayK, m.id);
  for (const g of CORE_GROUPS) {
    const b = el('span', 'badge' + (counts[g] ? ' on' : ''), GROUP_BY_ID[g].short);
    b.style.setProperty('--gc', GROUP_BY_ID[g].color);
    b.title = GROUP_BY_ID[g].en;
    badges.append(b);
  }
  head.append(badges);
  card.append(head);

  const ul = el('ul', 'entries');
  for (const e of mealPeek(dayK, m.id)) {
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

    const shop = btn('esmall', '＋');
    shop.title = 'Send its ingredients to the list';
    shop.addEventListener('click', () => {
      const res = addTyped(e.text, store.settings.store);
      save(); renderList();
      toast(res && res.added.length ? `${res.added.length} on the list` : 'Nothing to add');
    });
    li.append(shop);

    const del = btn('esmall', '×');
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
  inp.type = 'text'; inp.autocomplete = 'off'; inp.enterKeyHint = 'done';
  inp.placeholder = m.id === 'breakfast' ? 'marinated eggs · yogurt' : 'sesame noodles · 米饭';
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
  const b = btn('add', '＋');
  b.addEventListener('click', commit);
  add.append(inp, b);
  card.append(add);

  /* your dishes, again, where you are writing down what you ate */
  const quick = el('div', 'quickfavs');
  (store.settings.favourites || []).forEach((id, n) => {
    const r = RECIPE_BY_ID[id];
    if (!r) return;
    const q = btn('quick', r.names[0]);
    q.style.setProperty('--c', FAV_COLORS[n % FAV_COLORS.length]);
    q.addEventListener('click', () => {
      mealRec(dayK)[m.id].push({ id: uid(), text: r.names[0] });
      save(); renderMeals(); renderBalance();
    });
    quick.append(q);
  });
  card.append(quick);
  return card;
}

$('#mWeekPrev').addEventListener('click', () => setWeek(addDays(curWeek, -7)));
$('#mWeekNext').addEventListener('click', () => setWeek(addDays(curWeek, 7)));
$('#goToday').addEventListener('click', () => { curDay = today(); setWeek(today()); });

$('#dayToList').addEventListener('click', () => {
  const dayK = key(curDay);
  let n = 0;
  for (const m of MEALS) for (const e of mealPeek(dayK, m.id)) {
    const res = addTyped(e.text, store.settings.store);
    if (res) n += res.added.length;
  }
  save(); renderList();
  toast(n ? `${n} ingredients on the list` : 'Nothing written on this day yet');
});

/* ────────────────────────── BALANCE ───────────────────────── */
const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${a.toFixed(2)})`;
};

function renderBalance() {
  $('#bWeekLabel').textContent = weekLabel(curWeek);
  $('#bThisWeek').hidden = isThisWeek();
  const r = weekReport(curWeek);

  $('#scoreRing').style.setProperty('--p', r.pct);
  $('#scorePct').textContent = r.pct + '%';
  const worst = GROUPS.map(g => ({ g, gap: r.paceGoals[g.id] - r.totals[g.id] })).sort((a, b) => b.gap - a.gap)[0];
  if (!r.logged.length) {
    $('#scoreHeadline').textContent = 'Nothing logged yet';
    $('#scoreSub').textContent = 'Write what you ate under Meals 每餐 and this fills in.';
  } else if (r.pct >= 90) {
    $('#scoreHeadline').textContent = 'Balanced week 很均衡';
    $('#scoreSub').textContent = `${r.logged.length} of ${r.elapsed || 7} days logged · every group close to target.`;
  } else {
    $('#scoreHeadline').textContent = `Short on ${worst.g.en.toLowerCase()} ${worst.g.zh}`;
    $('#scoreSub').textContent = `${r.totals[worst.g.id]} of ${r.paceGoals[worst.g.id]} servings by now · ` +
      `${r.logged.length} of ${r.elapsed || 7} days logged.`;
  }

  const cats = $('#balanceGroups');
  cats.innerHTML = '';
  for (const g of GROUPS) {
    const had = r.totals[g.id], goal = r.goals[g.id];
    const c = el('div', 'cat');
    c.style.setProperty('--c', g.color);
    const row = el('div', 'catrow');
    const nm = el('div', 'catname');
    const dot = el('span', 'dot'); dot.style.background = g.color;
    nm.append(dot, el('b', null, g.en), el('i', null, g.zh));
    row.append(nm);
    const num = el('div', 'catnum');
    num.append(el('b', null, String(had)), document.createTextNode(` / ${goal}`));
    row.append(num);
    c.append(row);
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.width = Math.min(100, goal ? had / goal * 100 : 0) + '%';
    fill.style.background = g.color;
    bar.append(fill);
    const pace = el('u');
    pace.style.left = Math.min(100, goal ? r.paceGoals[g.id] / goal * 100 : 0) + '%';
    bar.append(pace);
    c.append(bar);
    const gap = r.paceGoals[g.id] - had;
    const left = Math.max(1, 7 - r.paceDays);
    c.append(el('div', 'delta ' + (gap > 0 ? 'under' : 'over'),
      gap > 0 ? `${gap} behind · ${((goal - had) / left).toFixed(1)} a day to finish the week`
              : `on pace${-gap ? ` · ${-gap} ahead` : ''}`));
    cats.append(c);
  }

  const grid = $('#balanceGrid');
  grid.innerHTML = '';
  grid.append(el('span', 'hcorner', ''));
  weekDays(curWeek).forEach((d, i) => grid.append(el('span', 'hcol' + (key(d) === key(today()) ? ' is-today' : ''), DAY_NAMES[i])));
  for (const g of GROUPS) {
    const lab = el('span', 'hrow');
    lab.append(el('span', 'zh', g.short || g.zh));
    lab.title = g.en;
    grid.append(lab);
    weekDays(curWeek).forEach((d, i) => {
      const k = key(d);
      const n = r.byDay[k][g.id] || 0;
      const target = store.settings.targets[g.id];
      const cell = btn('hcell', n ? String(n) : '');
      const ratio = target ? Math.min(1, n / target) : 0;
      if (n) cell.style.background = hexA(g.color, .2 + ratio * .6);
      if (ratio >= .75) cell.style.color = '#fff';
      if (fromKey(k) > today()) cell.classList.add('future');
      cell.title = `${g.en} · ${DAY_NAMES[i]} · ${n}/${target}`;
      cell.addEventListener('click', () => { curDay = d; renderMeals(); showTab('meals'); });
      grid.append(cell);
    });
  }

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
    weekDays(curWeek).forEach((d, i) => {
      const k = key(d);
      const c = mealServings(k, m.id);
      const have = CORE_GROUPS.filter(g => c[g]);
      const eaten = mealPeek(k, m.id).length > 0;
      if (eaten) { slotStats[m.id].eaten++; for (const g of have) slotStats[m.id][g]++; }
      const cell = btn('hcell', eaten ? `${have.length}/3` : '');
      if (eaten) cell.style.background = hexA(have.length === 3 ? '#3FB27F' : have.length === 2 ? '#F0B429' : '#FF6B6B', .25 + have.length * .18);
      if (fromKey(k) > today()) cell.classList.add('future');
      cell.title = eaten ? `${m.en}: ${mealPeek(k, m.id).map(e => e.text).join(', ')}` : `${m.en} — not logged`;
      cell.addEventListener('click', () => { curDay = d; renderMeals(); showTab('meals'); });
      mm.append(cell);
    });
  }

  const stats = $('#mealStats');
  stats.innerHTML = '';
  for (const m of slots) {
    const s = slotStats[m.id];
    const line = el('div', 'mstat');
    line.append(el('b', null, `${m.en} ${m.zh}`));
    line.append(el('span', 'muted', s.eaten
      ? ` · veg ${s.veg}/${s.eaten} · protein ${s.protein}/${s.eaten} · grain ${s.grain}/${s.eaten}`
      : ' · not logged this week'));
    stats.append(line);
  }

  const host = $('#adviceList');
  host.innerHTML = '';
  for (const t of advice(curWeek, r, slotStats)) {
    const li = el('li');
    li.innerHTML = t;
    host.append(li);
  }
}

/* Every line carries the number it came from — something to do tonight,
   not a grade. */
function advice(wk, r, slotStats) {
  const out = [];
  const items = listItems();
  const daysLeft = Math.max(0, 7 - r.paceDays);
  const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  if (!r.logged.length) {
    return ['Nothing logged for this week yet. Open <b>Meals 每餐</b>, tap one of your dishes or write what you ate, and every number here fills itself in.'];
  }

  const gaps = GROUPS.map(g => ({ g, gap: r.paceGoals[g.id] - r.totals[g.id], had: r.totals[g.id] }))
                     .filter(x => x.gap > 0).sort((a, b) => b.gap - a.gap);
  if (gaps.length) {
    const w = gaps[0];
    const weekGap = r.goals[w.g.id] - w.had;
    const perDay = daysLeft ? (weekGap / daysLeft) : 0;
    if (daysLeft && perDay > store.settings.targets[w.g.id] * 2) {
      out.push(`<b>${w.g.en} ${w.g.zh}</b> is ${weekGap} servings short with ${daysLeft} day${daysLeft === 1 ? '' : 's'} left — ` +
               `${perDay.toFixed(1)} a day is more than you eat. Take the week as it is and start Monday with ${w.g.en.toLowerCase()} at breakfast.`);
    } else if (daysLeft) {
      out.push(`<b>${w.g.en} ${w.g.zh}</b>: ${w.had} of ${r.paceGoals[w.g.id]} by now. ` +
               `${perDay.toFixed(1)} a day over the ${daysLeft} day${daysLeft === 1 ? '' : 's'} left closes the week.`);
    } else {
      out.push(`<b>${w.g.en} ${w.g.zh}</b> finished ${weekGap} short of ${r.goals[w.g.id]} — the gap to carry into next week.`);
    }
    const cure = items.filter(i => i.groups.includes(w.g.id) && !i.got).slice(0, 3);
    if (cure.length) {
      out.push(`<b>${cure.map(i => escHtml(i.name)).join('</b>, <b>')}</b> ${cure.length === 1 ? 'is' : 'are'} on your list — ` +
               `that is ${w.g.en.toLowerCase()} waiting in the shop rather than on the plate.`);
    }
  }

  const zero = GROUPS.filter(g => !r.totals[g.id]);
  if (zero.length) {
    out.push(`No ${zero.map(g => `<b>${g.en.toLowerCase()} ${g.zh}</b>`).join(', ')} at all this week. One serving a day of each is the whole ask.`);
  }

  const slots = MEALS.filter(m => !m.optional);
  const weakest = slots.map(m => ({ m, s: slotStats[m.id], miss: slotStats[m.id].eaten ? slotStats[m.id].eaten - slotStats[m.id].veg : 0 }))
                       .sort((a, b) => b.miss - a.miss)[0];
  if (weakest && weakest.miss >= 2) {
    out.push(`<b>${weakest.m.en} ${weakest.m.zh}</b> went without vegetables on ${weakest.miss} of ${weakest.s.eaten} logged days — ` +
             `${weakest.m.id === 'breakfast' ? 'spinach in the eggs, tomato on the toast' : '黄瓜 on the side of whatever you make'} is the cheapest fix here.`);
  }
  const noProtein = slots.filter(m => slotStats[m.id].eaten && slotStats[m.id].protein < slotStats[m.id].eaten / 2);
  if (noProtein.length) {
    out.push(`Protein 蛋白质 is missing from most of your ${noProtein.map(m => m.en.toLowerCase()).join(' and ')} — ` +
             `a marinated egg, 豆腐, yogurt or a handful of nuts is a serving.`);
  }

  const ranked = r.days.filter(dayLogged).map(k => ({
    k, n: GROUPS.reduce((s, g) => s + Math.min(r.byDay[k][g.id] || 0, store.settings.targets[g.id]), 0),
  })).sort((a, b) => b.n - a.n);
  if (ranked.length >= 2) {
    const dn = k => DAY_NAMES[weekDays(wk).findIndex(d => key(d) === k)];
    const best = ranked[0], worst = ranked[ranked.length - 1];
    out.push(`Fullest day <b>${dn(best.k)}</b> (${best.n} servings), thinnest <b>${dn(worst.k)}</b> (${worst.n}). ` +
             `Cook double on the good days and the thin ones stop happening.`);
  }
  const unlogged = r.days.filter(k => fromKey(k) <= today() && !dayLogged(k));
  if (unlogged.length) {
    const dn = k => DAY_NAMES[weekDays(wk).findIndex(d => key(d) === k)];
    out.push(`${unlogged.length} day${unlogged.length === 1 ? '' : 's'} unlogged (${unlogged.map(dn).join(', ')}). ` +
             `The score treats them as empty, so fill them in while you still remember.`);
  }

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
  for (const t of advice(curWeek, r, slotStats)) {
    lines.push('- ' + t.replace(/<[^>]+>/g, '').replace(/&rsquo;/g, '’').replace(/&amp;/g, '&').replace(/&lt;/g, '<'));
  }
  copyText(lines.join('\n'), 'Report copied');
});

/* ─────────────────────────── SETUP ────────────────────────── */
function renderSetup() {
  const host = $('#targetInputs');
  host.innerHTML = '';
  for (const g of GROUPS) {
    const wrap = el('div', 'goal');
    wrap.style.setProperty('--c', g.color);
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

  /* dishes — starred ones become the buttons on the list */
  const dishes = $('#dishList');
  dishes.innerHTML = '';
  const favs = store.settings.favourites || [];
  const sorted = RECIPE_LIST.slice().sort((a, b) => (favs.includes(b.id) ? 1 : 0) - (favs.includes(a.id) ? 1 : 0));
  for (const r of sorted) {
    const on = favs.includes(r.id);
    const b = btn('dish' + (on ? ' on' : ''));
    b.append(el('b', null, (on ? '★ ' : '☆ ') + r.names[0]));
    const alt = r.names.find(x => hasCJK(x) !== hasCJK(r.names[0]));
    b.append(el('i', null, alt || `${r.ingredients.length} items`));
    b.addEventListener('click', () => {
      const i = favs.indexOf(r.id);
      if (i < 0) favs.push(r.id); else favs.splice(i, 1);
      store.settings.favourites = favs;
      save(); renderSetup(); renderList(); renderMeals();
    });
    dishes.append(b);
  }

  const teach = $('#teachList');
  teach.innerHTML = '';
  const names = new Map();
  for (const it of listItems()) {
    if (it.aisle === 'other' && !names.has(normalize(it.name))) names.set(normalize(it.name), it.name);
  }
  if (!names.size) {
    teach.append(el('p', 'sub', 'Nothing unfiled — every item on your list found a section.'));
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
      const chips = el('div', 'chiprow');
      const learned = ((store.learned[norm] || {}).groups || []).slice();
      const commit = () => {
        store.learned[norm] = { aisle: sel.value, groups: learned.slice() };
        for (const it of listItems()) {
          if (normalize(it.name) === norm) { it.aisle = sel.value; it.groups = learned.slice(); }
        }
        save(); renderList(); renderBalance();
      };
      sel.addEventListener('change', commit);
      for (const g of GROUPS) {
        const b = btn('pchip' + (learned.includes(g.id) ? ' on' : ''), g.zh);
        b.style.setProperty('--c', g.color);
        b.addEventListener('click', () => {
          const i = learned.indexOf(g.id);
          if (i < 0) learned.push(g.id); else learned.splice(i, 1);
          b.classList.toggle('on');
          commit();
        });
        chips.append(b);
      }
      row.append(sel, chips);
      teach.append(row);
    }
  }

  const runs = $('#runHistory');
  runs.innerHTML = '';
  if (!store.runs.length) {
    runs.append(el('p', 'sub', 'No finished shops yet. The Shopping done button on the list records them.'));
  } else {
    for (const r of store.runs.slice(0, 12)) {
      const line = el('div', 'runline');
      const s = STORE_BY_ID[r.store] || { name: 'Everywhere', c: '#8E959B' };
      const tag = el('span', 'runtag', s.name);
      tag.style.setProperty('--c', s.c);
      line.append(tag);
      line.append(el('b', null, new Date(r.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })));
      line.append(el('span', 'muted', ` · ${r.got.length} of ${r.total} bought`));
      runs.append(line);
    }
  }

  $('#lexStats').textContent =
    `${FOOD_LIST.length} foods and ${RECIPE_LIST.length} dishes, each answering to both its English and Chinese name. ` +
    `Anything it does not know still goes on the list — it just lands under Other.`;
}

$('#resetTargets').addEventListener('click', () => {
  store.settings.targets = defaultTargets();
  save(); renderSetup(); renderBalance();
  toast('Targets reset');
});

$('#exportData').addEventListener('click', async () => {
  const json = JSON.stringify(store, null, 2);
  const filename = `basket-${key(today())}.json`;
  /* Hosted, the viewer has to be handed the file through the platform;
     opened as a local file, an ordinary download link does it. */
  const downloads = await useCap('downloads');
  if (downloads) {
    try { await downloads.save({ filename, data: json }); toast('Backup saved'); }
    catch (e) { if (!e || e.code !== 'declined') toast('Could not save the backup'); }
    return;
  }
  const blob = new Blob([json], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
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
      if (!data || (!data.list && !data.weeks)) throw new Error('not a Basket export');
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      load(); renderAll();
      toast('Imported');
    } catch (err) { alert('That file could not be read: ' + err.message); }
    e.target.value = '';
  };
  fr.readAsText(file);
});
$('#wipeData').addEventListener('click', () => {
  if (!confirm('Erase the list, every meal and all settings on this device?')) return;
  localStorage.removeItem(STORE_KEY);
  load(); renderAll();
  toast('Erased');
});

/* ── go ────────────────────────────────────────────────────── */
load();
renderAll();
startCloud();
