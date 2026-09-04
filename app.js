/* Étude — daily schedule tracker + weekly goal report.
   Everything is kept in localStorage; there is no server. */

const STORE_KEY = 'etude.v1';

/* ── your schedule ──────────────────────────────────────────────
   `plan` is the minutes budgeted. Where you gave a range ("10:30-12/12:30")
   the longer end is the plan and `soft` is the shorter one, so the row can
   show both and you are never marked short for stopping at the early end. */
const TEMPLATE = [
  { id: 'job1',  name: 'Find job',            cat: 'job',       start: '09:00', end: '10:00' },
  { id: 'brek',  name: 'Breakfast',           cat: 'life',      start: '10:00', end: '10:30' },
  { id: 'job2',  name: 'Find job',            cat: 'job',       start: '10:30', end: '12:30', soft: '12:00' },
  { id: 'fr',    name: 'French French French', cat: 'french',   start: '13:00', end: '16:00' },
  { id: 'chore', name: 'Chores + dinner',     cat: 'life',      start: '16:00', end: '18:00', soft: '17:00' },
  { id: 'port',  name: 'Portfolio + social',  cat: 'portfolio', start: '18:00', end: '22:00' },
  { id: 'mus',   name: 'Music production',    cat: 'music',     start: '22:00', end: '24:00', soft: '23:00' },
];

const CATS = {
  job:       { label: 'Job hunt',         color: '#e08a3c', goal: true },
  french:    { label: 'French',           color: '#4f8ff7', goal: true },
  portfolio: { label: 'Portfolio+social', color: '#3fb27f', goal: true },
  music:     { label: 'Music production', color: '#a273d8', goal: true },
  life:      { label: 'Chores + meals',   color: '#8b93a7', goal: false },
};

const GOAL_CATS = Object.keys(CATS).filter(c => CATS[c].goal);
const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

/* ── time + date helpers ───────────────────────────────────── */
const hhmmToMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const minToHhmm = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const planOf  = b => hhmmToMin(b.end) - hhmmToMin(b.start);
const softOf  = b => b.soft ? hhmmToMin(b.soft) - hhmmToMin(b.start) : planOf(b);

const key   = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
const today   = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
/* Monday-start week */
const monday  = d => addDays(d, -((d.getDay() + 6) % 7));

const fmtH = mins => {
  if (!mins) return '0h';
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return m ? (h ? `${h}h ${m}m` : `${m}m`) : `${h}h`;
};
const fmtHDec = mins => (mins / 60).toFixed(mins % 60 === 0 ? 0 : 1) + 'h';

/* ── store ─────────────────────────────────────────────────── */
const defaultGoals = () => {
  const g = {};
  for (const c of GOAL_CATS) {
    g[c] = +(TEMPLATE.filter(b => b.cat === c).reduce((s, b) => s + planOf(b), 0) * 7 / 60).toFixed(1);
  }
  return g;
};

let store;
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (raw && raw.days) {
      store = raw;
      store.settings = Object.assign({ wakeTarget: '09:00', goals: defaultGoals() }, store.settings);
      store.settings.goals = Object.assign(defaultGoals(), store.settings.goals);
      return;
    }
  } catch (e) { /* corrupt or blocked storage — start clean */ }
  store = { version: 1, settings: { wakeTarget: '09:00', goals: defaultGoals() }, days: {} };
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
  catch (e) { console.warn('Could not save — storage unavailable.', e); }
}
function dayRec(k) {
  if (!store.days[k]) store.days[k] = { wake: '', notes: '', blocks: {} };
  const d = store.days[k];
  d.blocks = d.blocks || {};
  return d;
}
const peek     = k => store.days[k] || null;
const blockRec = (k, id) => {
  const d = dayRec(k);
  if (!d.blocks[id]) d.blocks[id] = { done: false, mins: 0 };
  return d.blocks[id];
};
/* a day counts as "logged" once anything is recorded on it */
const isLogged = k => {
  const d = peek(k);
  if (!d) return false;
  return !!d.wake || !!(d.notes || '').trim() ||
         Object.values(d.blocks || {}).some(b => b.done || b.mins > 0);
};

/* ── state ─────────────────────────────────────────────────── */
let curDay  = today();
let curWeek = monday(today());

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

/* ── tabs ──────────────────────────────────────────────────── */
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('.tab');
  if (!b) return;
  $$('.tab').forEach(t => t.classList.toggle('is-active', t === b));
  $$('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + b.dataset.view));
  if (b.dataset.view === 'week') renderWeek();
  if (b.dataset.view === 'settings') renderSettings();
});
function showTab(name) {
  const b = $$('.tab').find(t => t.dataset.view === name);
  if (b) b.click();
}

/* ─────────────────────────── DAY VIEW ─────────────────────── */
function renderDay() {
  const k = key(curDay);
  const rec = peek(k) || { wake: '', notes: '', blocks: {} };

  $('#dayPicker').value = k;
  $('#dayTitle').textContent = curDay.toLocaleDateString(undefined,
    { weekday: 'long', day: 'numeric', month: 'long' });

  const diff = Math.round((curDay - today()) / 86400000);
  const rel = diff === 0 ? 'Today'
            : diff === -1 ? 'Yesterday — fill it in while you still remember'
            : diff === 1 ? 'Tomorrow'
            : diff < 0 ? `${-diff} days ago`
            : `in ${diff} days`;
  $('#dayRel').textContent = rel + (isLogged(k) ? '' : ' · nothing logged yet');

  /* wake-up */
  $('#wakeInput').value = rec.wake || '';
  $('#wakeTargetLabel').textContent = store.settings.wakeTarget;
  const v = $('#wakeVerdict');
  if (!rec.wake) {
    v.textContent = 'not logged';
    v.className = 'verdict';
  } else {
    const late = hhmmToMin(rec.wake) - hhmmToMin(store.settings.wakeTarget);
    v.textContent = late <= 0 ? `up ${fmtH(-late) === '0h' ? 'right on time' : fmtH(-late) + ' early'}`
                              : `${fmtH(late)} late`;
    v.className = 'verdict ' + (late <= 0 ? 'good' : late <= 45 ? 'warn' : 'bad');
  }

  /* blocks */
  const list = $('#blocks');
  list.innerHTML = '';
  for (const b of TEMPLATE) {
    const br = (rec.blocks || {})[b.id] || { done: false, mins: 0 };
    const li = el('li', 'block' + (br.done ? ' is-done' : ''));

    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!br.done;
    cb.addEventListener('change', () => {
      const r = blockRec(k, b.id);
      r.done = cb.checked;
      /* checking it off fills in the planned time so a normal day is one click */
      if (r.done && !r.mins) r.mins = planOf(b);
      if (!r.done) r.mins = 0;
      save(); renderDay();
    });
    li.append(cb);

    const range = b.soft ? `${b.start}–${b.soft}/${b.end}` : `${b.start}–${b.end === '24:00' ? '00:00' : b.end}`;
    li.append(el('span', 'time', range));

    const lab = el('div', 'label');
    const dot = el('span', 'dot');
    dot.style.background = CATS[b.cat].color;
    lab.append(dot, el('span', 'name', b.name));
    li.append(lab);

    const mins = el('div', 'mins');
    const inp = el('input');
    inp.type = 'number'; inp.min = '0'; inp.max = '1440'; inp.step = '5';
    inp.value = br.mins || '';
    inp.placeholder = '0';
    inp.addEventListener('change', () => {
      const r = blockRec(k, b.id);
      r.mins = Math.max(0, Math.min(1440, Math.round(+inp.value || 0)));
      r.done = r.mins > 0;
      save(); renderDay();
    });
    mins.append(inp, el('span', 'unit', 'min'));
    mins.append(el('span', 'plan', 'of ' + fmtH(planOf(b))));
    li.append(mins);

    list.append(li);
  }

  /* totals */
  const byCat = catTotals(k);
  const done    = Object.values(byCat).reduce((s, n) => s + n, 0);
  const planned = TEMPLATE.reduce((s, b) => s + planOf(b), 0);
  const goalDone = GOAL_CATS.reduce((s, c) => s + (byCat[c] || 0), 0);
  const goalPlan = TEMPLATE.filter(b => CATS[b.cat].goal).reduce((s, b) => s + planOf(b), 0);

  const t = $('#dayTotals');
  t.innerHTML = '';
  t.append(mk('Logged', `${fmtH(done)} of ${fmtH(planned)}`));
  t.append(mk('Goal work', `${fmtH(goalDone)} of ${fmtH(goalPlan)}`));
  t.append(mk('Day score', planned ? Math.round(done / planned * 100) + '%' : '—'));

  $('#dayNotes').value = rec.notes || '';
}
function mk(label, val) {
  const s = el('span');
  s.append(el('span', 'muted', label + ' '), el('b', null, val));
  return s;
}

function catTotals(k) {
  const rec = peek(k);
  const out = {};
  for (const c of Object.keys(CATS)) out[c] = 0;
  if (!rec) return out;
  for (const b of TEMPLATE) {
    const r = (rec.blocks || {})[b.id];
    if (r && r.mins) out[b.cat] += r.mins;
  }
  return out;
}

/* day controls */
$('#dayPrev').onclick = () => { curDay = addDays(curDay, -1); renderDay(); };
$('#dayNext').onclick = () => { curDay = addDays(curDay, 1); renderDay(); };
$('#goToday').onclick = () => { curDay = today(); renderDay(); };
$('#goYesterday').onclick = () => { curDay = addDays(today(), -1); renderDay(); };
$('#dayPicker').onchange = e => { if (e.target.value) { curDay = fromKey(e.target.value); renderDay(); } };
$('#wakeInput').onchange = e => { dayRec(key(curDay)).wake = e.target.value; save(); renderDay(); };
$('#dayNotes').oninput  = e => { dayRec(key(curDay)).notes = e.target.value; save(); };
$('#fillPlanned').onclick = () => {
  const k = key(curDay);
  for (const b of TEMPLATE) { const r = blockRec(k, b.id); r.done = true; r.mins = planOf(b); }
  if (!dayRec(k).wake) dayRec(k).wake = store.settings.wakeTarget;
  save(); renderDay();
};
$('#clearDay').onclick = () => {
  const k = key(curDay);
  if (!isLogged(k) || confirm('Clear everything logged on this day?')) { delete store.days[k]; save(); renderDay(); }
};

/* ────────────────────────── WEEK VIEW ─────────────────────── */
function weekData(mon) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i), k = key(d);
    days.push({
      date: d, key: k, name: DAY_NAMES[i],
      future: d > today(),
      logged: isLogged(k),
      wake: (peek(k) || {}).wake || '',
      cats: catTotals(k),
    });
  }

  const goals = store.settings.goals;
  const cats = {};
  for (const c of Object.keys(CATS)) {
    const actual = days.reduce((s, d) => s + d.cats[c], 0);
    const goalMin = CATS[c].goal ? Math.round((goals[c] || 0) * 60)
                                 : TEMPLATE.filter(b => b.cat === c).reduce((s, b) => s + planOf(b), 0) * 7;
    cats[c] = { actual, goal: goalMin, pct: goalMin ? actual / goalMin : 0 };
  }

  /* headline: credit capped per category so a big week on one thing
     cannot paper over a category you dropped entirely */
  let earned = 0, target = 0;
  for (const c of GOAL_CATS) { earned += Math.min(cats[c].actual, cats[c].goal); target += cats[c].goal; }
  const score = target ? Math.round(earned / target * 100) : 0;

  const wakeDays = days.filter(d => d.wake);
  const targetMin = hhmmToMin(store.settings.wakeTarget);
  const onTime = wakeDays.filter(d => hhmmToMin(d.wake) <= targetMin).length;
  const avgWake = wakeDays.length
    ? Math.round(wakeDays.reduce((s, d) => s + hhmmToMin(d.wake), 0) / wakeDays.length) : null;

  /* A week in progress is judged against the days that have actually
     happened, not the whole week — otherwise Tuesday always looks like failure. */
  const elapsed = days.filter(d => !d.future);
  const isCurrent = key(mon) === key(monday(today()));
  const remaining = 7 - elapsed.length;
  const paceTarget = Math.round(target * elapsed.length / 7);
  const paceScore = paceTarget ? Math.round(Math.min(earned, paceTarget) / paceTarget * 100) : 0;

  return {
    mon, days, cats, score, target, earned,
    isCurrent, remaining, paceTarget, paceScore,
    logged: days.filter(d => d.logged).length,
    elapsed: elapsed.length,
    missed: elapsed.filter(d => !d.logged).length,
    wake: { logged: wakeDays.length, onTime, avg: avgWake },
  };
}

function renderWeek() {
  const w = weekData(curWeek);
  const end = addDays(curWeek, 6);
  const sameMonth = curWeek.getMonth() === end.getMonth();
  const withMonth = d => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const dayOnly   = d => d.toLocaleDateString(undefined, { day: 'numeric' });
  $('#weekLabel').textContent = sameMonth
    ? `${withMonth(curWeek)} – ${dayOnly(end)}`
    : `${withMonth(curWeek)} – ${withMonth(end)}`;

  /* headline */
  $('#scoreRing').style.setProperty('--p', Math.min(100, w.score));
  $('#scorePct').textContent = w.score + '%';

  const shortfall = GOAL_CATS.reduce((s, c) => s + Math.max(0, w.cats[c].goal - w.cats[c].actual), 0);
  $('#scoreHeadline').textContent =
      w.logged === 0 ? 'Nothing logged this week'
    : w.score >= 95  ? 'You hit the week.'
    : w.score >= 80  ? 'Close — a good week.'
    : w.score >= 55  ? 'Halfway there.'
    : w.score >= 25  ? 'A slow week.'
    :                  'The week got away from you.';
  let sub;
  if (w.logged === 0) {
    sub = 'Log a day or two and this fills in.';
  } else if (w.isCurrent && w.remaining > 0) {
    sub = `${fmtHDec(w.earned)} of your ${fmtHDec(w.target)} weekly goal. ` +
          `${w.elapsed} ${w.elapsed === 1 ? 'day' : 'days'} in you are at <b>${w.paceScore}% of pace</b>` +
          (shortfall > 0
            ? `, with ${fmtHDec(shortfall)} left across ${w.remaining} ${w.remaining === 1 ? 'day' : 'days'}.`
            : ' — already clear of the whole week.');
  } else {
    sub = `${fmtHDec(w.earned)} of your ${fmtHDec(w.target)} goal. ` +
          (shortfall > 0 ? `${fmtHDec(shortfall)} short — that is ${fmtH(Math.round(shortfall / 7))} a day.`
                         : 'Nothing left on the table.');
  }
  $('#scoreSub').innerHTML = sub;

  /* per-category bars */
  const cw = $('#weekCats');
  cw.innerHTML = '';
  for (const c of Object.keys(CATS)) {
    const d = w.cats[c], meta = CATS[c];
    const box = el('div', 'cat');

    const row = el('div', 'catrow');
    const nm = el('div', 'catname');
    const dot = el('span', 'dot'); dot.style.background = meta.color;
    nm.append(dot, document.createTextNode(meta.label + (meta.goal ? '' : ' (not scored)')));
    const num = el('div', 'catnum');
    num.append(el('b', null, fmtHDec(d.actual)), document.createTextNode(' / ' + fmtHDec(d.goal)));
    row.append(nm, num);

    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.width = Math.min(100, Math.round(d.pct * 100)) + '%';
    fill.style.background = meta.color;
    bar.append(fill);

    const gap = d.actual - d.goal;
    const delta = !meta.goal
      ? el('div', 'delta', `${Math.round(d.pct * 100)}% of the time your schedule sets aside — tracked, but it does not count for or against you`)
      : el('div', 'delta ' + (gap >= 0 ? 'over' : 'under'),
          gap >= 0 ? `${Math.round(d.pct * 100)}% — ${fmtHDec(gap)} over`
                   : `${Math.round(d.pct * 100)}% — ${fmtHDec(-gap)} short`);

    box.append(row, bar, delta);
    cw.append(box);
  }

  /* day grid */
  const g = $('#weekGrid');
  g.innerHTML = '';
  const dayPlan = TEMPLATE.reduce((s, b) => s + planOf(b), 0);
  for (const d of w.days) {
    const total = Object.values(d.cats).reduce((s, n) => s + n, 0);
    const cell = el('button', 'gcell' + (d.future ? ' future' : total ? '' : ' empty'));
    cell.append(el('div', 'gd', d.name));
    cell.append(el('div', 'gn', d.future ? '·' : total ? fmtHDec(total) : '—'));
    const bar = el('div', 'gbar'), fill = el('i');
    fill.style.width = Math.min(100, Math.round(total / dayPlan * 100)) + '%';
    fill.style.background = total / dayPlan >= .8 ? 'var(--good)' : total / dayPlan >= .4 ? 'var(--warn)' : 'var(--bad)';
    bar.append(fill); cell.append(bar);
    if (!d.future) {
      cell.title = 'Edit ' + d.date.toLocaleDateString();
      cell.onclick = () => { curDay = d.date; showTab('day'); renderDay(); };
    }
    g.append(cell);
  }

  $('#weekWake').innerHTML = '';
  $('#weekWake').append(
    mk('Wake-ups logged', `${w.wake.logged}/${w.elapsed}`),
    document.createTextNode('  '),
    mk(`Up by ${store.settings.wakeTarget}`, `${w.wake.onTime}/${w.wake.logged || 0}`),
    document.createTextNode('  '),
    mk('Average', w.wake.avg == null ? '—' : minToHhmm(w.wake.avg)),
  );

  /* advice */
  const list = $('#adviceList');
  list.innerHTML = '';
  for (const line of advice(w)) {
    const li = el('li');
    li.innerHTML = line;
    list.append(li);
  }
}

/* ── the "what can I do next week" engine ───────────────────
   Deterministic rules over the week's numbers — no vague pep talk,
   every line carries the figure it came from. */
function advice(w) {
  const out = [];
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  if (w.logged === 0) {
    return ['<b>Log one day first.</b> Open <b>Day</b>, hit <i>Mark all as planned</i>, then correct the rows that did not happen. The report needs a week of data before it can tell you anything useful.'];
  }

  /* 1. biggest shortfall gets a concrete daily ask */
  const gaps = GOAL_CATS
    .map(c => ({ c, gap: w.cats[c].goal - w.cats[c].actual, pct: w.cats[c].pct }))
    .filter(x => x.gap > 30)
    .sort((a, b) => b.gap - a.gap);

  if (gaps.length) {
    const g = gaps[0];
    /* what your own schedule already sets aside for this each day */
    const dailyPlan = TEMPLATE.filter(b => b.cat === g.c).reduce((s, b) => s + planOf(b), 0);
    let spread;
    if (w.isCurrent && w.remaining > 0) {
      const perDay = g.gap / w.remaining;
      spread = perDay > dailyPlan * 2
        /* the gap is arithmetically closable but not humanly — say so */
        ? `That is ${fmtH(Math.round(perDay))} a day across the ${w.remaining} ${w.remaining === 1 ? 'day' : 'days'} left, which is not a real plan. ` +
          `<b>Write this week off for ${esc(CATS[g.c].label)}</b> — do the normal ${fmtH(dailyPlan)} block for the days that remain and start Monday clean.`
        : `You have <b>${w.remaining} ${w.remaining === 1 ? 'day' : 'days'} left this week</b> — ${fmtH(Math.round(perDay))} a day closes it, against the ${fmtH(dailyPlan)} you already plan.`;
    } else {
      spread = `Spread over seven days that is <b>${fmtH(Math.round(g.gap / 7))} more a day</b>; over five weekdays, ${fmtH(Math.round(g.gap / 5))}.`;
    }
    out.push(`<b>${esc(CATS[g.c].label)} is the gap that matters</b> — ${fmtHDec(g.gap)} short (${Math.round(g.pct * 100)}% of goal). ` +
             spread + ` Put it in the block you already own rather than adding a new one.`);
  }
  if (gaps.length > 1) {
    const rest = gaps.slice(1, 3).map(g => `${esc(CATS[g.c].label)} (${fmtHDec(g.gap)})`).join(' and ');
    out.push(`Also behind: <b>${rest}</b>. Do not chase every one at once — fix the first, keep these from sliding further.`);
  }

  /* 2. a category dropped entirely */
  const dropped = GOAL_CATS.filter(c => w.cats[c].actual === 0 && w.cats[c].goal > 0);
  if (dropped.length && w.logged >= 3) {
    out.push(`<b>${dropped.map(c => esc(CATS[c].label)).join(' and ')} did not happen at all this week.</b> ` +
             `Next week give it one short honest session — 30 minutes on a single day — instead of the full block. A zero is much harder to come back from than a small number.`);
  }

  /* 3. wake-up */
  if (w.wake.logged === 0) {
    out.push(`<b>You did not log a wake-up time.</b> It is the cheapest number to record and it explains most missed 9–10 job blocks.`);
  } else {
    const rate = w.wake.onTime / w.wake.logged;
    const lateBy = w.wake.avg - hhmmToMin(store.settings.wakeTarget);
    if (rate < 0.6) {
      out.push(`<b>Wake-up is the upstream problem</b> — up by ${store.settings.wakeTarget} on ${w.wake.onTime} of ${w.wake.logged} logged days, averaging ${minToHhmm(w.wake.avg)} ` +
               `(${fmtH(Math.abs(lateBy))} ${lateBy > 0 ? 'late' : 'early'}). ` +
               `The 9–10 job hour is the first thing that ${lateBy > 0 ? 'disappears' : 'holds'}. Try moving the music-production block ${fmtH(Math.min(60, Math.max(15, Math.abs(lateBy))))} earlier for a week and see whether mornings follow.`);
    } else if (rate >= 0.85) {
      out.push(`<b>Mornings are working</b> — up by ${store.settings.wakeTarget} on ${w.wake.onTime} of ${w.wake.logged} days. Leave this alone; it is carrying the rest of the schedule.`);
    }
  }

  /* 4. unlogged days */
  if (w.missed >= 2) {
    const names = w.days.filter(d => !d.future && !d.logged).map(d => d.name).join(', ');
    out.push(`<b>${w.missed} ${w.missed === 1 ? 'day has' : 'days have'} gone unlogged</b> (${esc(names)}). Backfill ${w.missed === 1 ? 'it' : 'them'} with <i>Edit yesterday</i> — an unlogged day is counted as a zero, so your real number is probably better than ${w.score}%.`);
  }

  /* 5. weakest / strongest weekday */
  const rated = w.days.filter(d => !d.future && d.logged)
    .map(d => ({ d, total: Object.values(d.cats).reduce((s, n) => s + n, 0) }))
    .sort((a, b) => a.total - b.total);
  if (rated.length >= 4) {
    const worst = rated[0], best = rated[rated.length - 1];
    if (best.total - worst.total > 120) {
      out.push(`<b>${esc(worst.d.name)} was your thinnest day</b> (${fmtHDec(worst.total)}) and <b>${esc(best.d.name)} your fullest</b> (${fmtHDec(best.total)}). ` +
               `Rather than trying to make ${esc(worst.d.name)} a full day, plan it deliberately short — one goal block, then stop. A planned light day beats a collapsed one.`);
    }
  }

  /* 6. where the headroom is */
  const over = GOAL_CATS
    .map(c => ({ c, gap: w.cats[c].actual - w.cats[c].goal }))
    .filter(x => x.gap > 60)
    .sort((a, b) => b.gap - a.gap);
  if (over.length && gaps.length) {
    out.push(`You put <b>${fmtHDec(over[0].gap)} extra into ${esc(CATS[over[0].c].label)}</b>. That is where next week's ${esc(CATS[gaps[0].c].label)} time can come from — trade it directly rather than adding hours to the day.`);
  }

  /* 7. on track */
  if (w.score >= 95) {
    out.push(`<b>You cleared the whole target.</b> Either bank the win and hold this exact schedule next week, or raise one goal in <b>Goals</b> by an hour — not all four.`);
  } else if (w.score >= 80 && !gaps.length) {
    out.push(`<b>You are within ${100 - w.score}% of the target with no single big gap.</b> Nothing to restructure — repeat the week.`);
  }

  /* 8. always end with the concrete next step */
  const focus = gaps.length ? CATS[gaps[0].c].label : 'the schedule you already have';
  out.push(`<b>Next week in one line:</b> protect ${esc(focus)}, log every day (even the bad ones), and check this page next ${DAY_NAMES[0] === 'Mon' ? 'Sunday night' : 'week'}.`);

  return out;
}

$('#weekPrev').onclick = () => { curWeek = addDays(curWeek, -7); renderWeek(); };
$('#weekNext').onclick = () => { curWeek = addDays(curWeek, 7); renderWeek(); };
$('#goThisWeek').onclick = () => { curWeek = monday(today()); renderWeek(); };
$('#goLastWeek').onclick = () => { curWeek = addDays(monday(today()), -7); renderWeek(); };

$('#copyReport').onclick = async () => {
  const w = weekData(curWeek);
  const lines = [
    `Week of ${curWeek.toDateString()} — ${w.score}% of goal`,
    '',
    ...Object.keys(CATS).map(c =>
      `${CATS[c].label.padEnd(18)} ${fmtHDec(w.cats[c].actual).padStart(6)} / ${fmtHDec(w.cats[c].goal)}`),
    '',
    `Days logged: ${w.logged}/7   Wake-ups on target: ${w.wake.onTime}/${w.wake.logged || 0}` +
      (w.wake.avg != null ? `   Average wake: ${minToHhmm(w.wake.avg)}` : ''),
    '',
    'Next week:',
    ...advice(w).map((a, i) => `${i + 1}. ${a.replace(/<[^>]+>/g, '')}`),
  ].join('\n');
  try {
    await navigator.clipboard.writeText(lines);
    $('#copyReport').textContent = 'Copied';
  } catch (e) {
    $('#copyReport').textContent = 'Press Ctrl+C';
    window.prompt('Copy the report:', lines);
  }
  setTimeout(() => { $('#copyReport').textContent = 'Copy report'; }, 1600);
};

/* ───────────────────────── SETTINGS ───────────────────────── */
function renderSettings() {
  const box = $('#goalInputs');
  box.innerHTML = '';
  for (const c of GOAL_CATS) {
    const wrap = el('div', 'goal');
    const lab = el('label');
    const dot = el('span', 'dot'); dot.style.background = CATS[c].color;
    lab.append(dot, document.createTextNode(CATS[c].label + ' (h/week)'));
    const inp = el('input');
    inp.type = 'number'; inp.min = '0'; inp.max = '112'; inp.step = '0.5';
    inp.value = store.settings.goals[c];
    inp.onchange = () => {
      store.settings.goals[c] = Math.max(0, Math.min(112, +inp.value || 0));
      save(); renderSettings();
    };
    wrap.append(lab, inp);
    box.append(wrap);
  }

  $('#wakeTargetInput').value = store.settings.wakeTarget;

  const t = $('#templateList');
  t.innerHTML = '';
  const wake = el('li');
  wake.append(el('span', 'time', store.settings.wakeTarget), el('span', null, 'Wake up'));
  t.append(wake);
  for (const b of TEMPLATE) {
    const li = el('li');
    const range = b.soft ? `${b.start}–${b.soft}/${b.end}` : `${b.start}–${b.end === '24:00' ? '00:00' : b.end}`;
    const dot = el('span', 'dot'); dot.style.background = CATS[b.cat].color;
    li.append(el('span', 'time', range), dot, el('span', null, b.name),
              el('span', 'muted', ' · ' + fmtH(planOf(b))));
    t.append(li);
  }
}

$('#wakeTargetInput').onchange = e => {
  store.settings.wakeTarget = e.target.value || '09:00';
  save(); renderSettings(); renderDay();
};
$('#resetGoals').onclick = () => { store.settings.goals = defaultGoals(); save(); renderSettings(); };

$('#exportData').onclick = () => {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `etude-${key(today())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('#importData').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (!data || typeof data !== 'object' || !data.days) throw new Error('not an Étude export');
      store = data;
      store.settings = Object.assign({ wakeTarget: '09:00', goals: defaultGoals() }, store.settings);
      store.settings.goals = Object.assign(defaultGoals(), store.settings.goals);
      save(); renderDay(); renderSettings();
      alert('Imported.');
    } catch (err) { alert('Could not read that file: ' + err.message); }
  };
  r.readAsText(file);
  e.target.value = '';
};
$('#wipeData').onclick = () => {
  if (confirm('Erase every logged day and reset goals? This cannot be undone.')) {
    localStorage.removeItem(STORE_KEY);
    load(); renderDay(); renderSettings();
  }
};

/* ── go ────────────────────────────────────────────────────── */
load();
renderDay();
