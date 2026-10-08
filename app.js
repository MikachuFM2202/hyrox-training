import * as S from './store.js';

const COLORS = ['#ff6b2b', '#ffb020', '#2ecc71', '#4da6ff', '#b07cff', '#ff4d6d', '#ff5fc8', '#2ee6e6'];
const DAY = 864e5, ONLINE = 6 * 60e3;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const col = c => /^#[0-9a-f]{6}$/i.test(c) ? c : '#888888';   // other people's files are untrusted input
const safeUrl = u => /^https:\/\//.test(u || '') ? u : '';

let plan = null, sel = '', calMonth = null, viewing = null, screen = '', err = '', installEvt = null;
let intro = true, justSet = '', deferred = false;

// Site password. ponytail: client-side gate only (anyone reading the public repo can skip it); the access key is the real lock.
const PASS_HASH = '64d27cba265dd65d63ef0b8cb90436d3d4c5bbeb9c59b4ea0309ac4f26bd78e8';
let unlocked = S.ls.get('pass', '') === PASS_HASH;
const sha256 = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');

// The owner can share a one-tap link: https://…/#k=<key>. The key is read once, then wiped from the address bar.
const linkKey = new URLSearchParams(location.hash.slice(1)).get('k');
if (linkKey) history.replaceState(null, '', location.pathname + location.search);

// ---- dates ----------------------------------------------------------------
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = fromIso(s); d.setDate(d.getDate() + n); return iso(d); };
const todayIso = () => iso(new Date());
const dow = s => (fromIso(s).getDay() + 6) % 7;                // 0 = Monday
const monday = s => addDays(s, -dow(s));
const daysTo = s => Math.round((fromIso(s) - fromIso(todayIso())) / DAY);
const fmt = (s, o = { day: 'numeric', month: 'short' }) => fromIso(s).toLocaleDateString('en-GB', o);

// ---- plan + progress ------------------------------------------------------
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const val = (p, k) => p?.checks?.[k]?.v || 0;
const crew = () => Object.values(S.people).filter(p => typeof p?.id === 'string' && typeof p.name === 'string' && p.name)
  .sort((a, b) => (b.id === S.meId) - (a.id === S.meId) || a.name.localeCompare(b.name));
const online = p => Date.now() - (p.seen || 0) < ONLINE;
const ago = t => { const m = Math.round((Date.now() - t) / 60e3); return !t ? 'never' : m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

/** Session id for a person on a date: their day swap if they made one, else the weekly schedule. */
function sessionId(p, date) {
  const o = p?.checks?.[`${date}|session`]?.v;
  return o === 'rest' || plan.sessions[o] ? o : plan.schedule[dow(date)];
}
const itemKey = (date, it) => `${date}|${slug(it.name)}`;
const secKey = (date, sec) => `${date}|sec:${slug(sec.name)}`;
const bonuses = (p, date) => Object.entries(p?.checks || {})
  .filter(([k, c]) => k.startsWith(`${date}|bonus:`) && c.v && typeof c.name === 'string').map(([k, c]) => ({ k, ...c }));

function secStats(p, date, sec) {
  const skipped = val(p, secKey(date, sec)) === 2;
  const vs = sec.items.map(it => val(p, itemKey(date, it)));
  const done = vs.filter(v => v === 1).length, handled = vs.filter(v => v).length;
  return { skipped, done, resolved: skipped ? sec.pick : Math.min(sec.pick, handled) };
}
/** Progress for one day. "Pick 3" sections count as complete once 3 are done or skipped. */
function dayStats(p, date) {
  const sid = sessionId(p, date), s = plan.sessions[sid];
  if (!s) return null;
  let pick = 0, resolved = 0, next = '';
  for (const sec of s.sections) {
    const st = secStats(p, date, sec);
    pick += sec.pick; resolved += st.resolved;
    if (!next && st.resolved < sec.pick) next = sec.items.find(it => !val(p, itemKey(date, it)))?.name || '';
  }
  return { sid, s, pick, resolved, left: pick - resolved, next, pct: pick ? Math.round(100 * resolved / pick) : 0 };
}
function weekPct(p, mon) {
  let pick = 0, resolved = 0;
  for (let i = 0; i < 7; i++) { const st = dayStats(p, addDays(mon, i)); if (st && !st.s.optional) { pick += st.pick; resolved += st.resolved; } }
  return pick ? Math.round(100 * resolved / pick) : 0;
}

// ---- render ---------------------------------------------------------------
function render() {
  if (!plan) { $app.innerHTML = '<div class="loading"><span>HYROX</span></div>'; return; }
  // Don't yank a half-typed bonus exercise or name out from under the user; render when they leave the field.
  const a = document.activeElement;
  if (screen === 'main' && a?.matches?.('#app input[type=text], #app input[name=name]')) { deferred = true; return; }
  const open = [...$app.querySelectorAll('details[open][data-keep]')].map(d => d.dataset.keep);
  const bars = Object.fromEntries([...$app.querySelectorAll('[data-bar]')].map(b => [b.dataset.bar, b.style.width]));

  screen = !unlocked ? 'pass' : !S.hasToken() ? 'gate' : !S.me() ? 'join' : 'main';
  $app.innerHTML = screen === 'pass' ? pass() : screen === 'gate' ? gate() : screen === 'join' ? join() : main();
  document.body.classList.toggle('intro', intro);

  open.forEach(k => { const d = $app.querySelector(`details[data-keep="${k}"]`); if (d) d.open = true; });
  // Progress bars grow from their previous width instead of jumping.
  const grow = [...$app.querySelectorAll('[data-bar]')].map(b => { const to = b.style.width; b.style.width = bars[b.dataset.bar] ?? '0%'; return [b, to]; });
  requestAnimationFrame(() => requestAnimationFrame(() => grow.forEach(([b, to]) => { b.style.width = to; })));
  if (intro && screen === 'main') { intro = false; countUp(); setTimeout(() => document.body.classList.remove('intro'), 1600); }
  justSet = '';
}

const brand = () => `<div class="brand"><span class="logo">HYROX</span><span class="slash"></span><span>Training</span></div>`;

function pass() {
  return `<section class="gate reveal">
    ${brand()}
    <div class="kicker">${esc(plan.race.season)} · ${esc(plan.race.venue)}</div>
    <h1>Road to<br><span class="grad">${esc(plan.race.name.replace(/^HYROX\s*/i, ''))}</span></h1>
    <p>Enter the site password.</p>
    <form data-form="pass">
      <input name="p" type="password" placeholder="Password" autocomplete="current-password" required aria-label="Password" autofocus>
      <button class="btn">Unlock</button>
    </form>
    <p class="err" role="alert">${esc(err)}</p>
  </section>`;
}

function gate() {
  return `<section class="gate reveal">
    ${brand()}
    <div class="kicker">${esc(plan.race.season)} · ${esc(plan.race.venue)}</div>
    <h1>Road to<br><span class="grad">${esc(plan.race.name.replace(/^HYROX\s*/i, ''))}</span></h1>
    <p>Private crew access. Paste the access key you were given.</p>
    <form data-form="gate">
      <input name="k" type="password" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false" required aria-label="Access key">
      <button class="btn">Enter</button>
    </form>
    <p class="err" role="alert">${esc(err || (S.status.state === 'error' ? S.status.error : ''))}</p>
  </section>`;
}

function join() {
  const taken = new Set(crew().map(p => p.color));
  const free = COLORS.find(c => !taken.has(c)) || COLORS[0];
  return `<section class="gate reveal">
    ${brand()}
    <h1>Join the<br><span class="grad">crew</span></h1>
    ${crew().length ? `<p>Already joined on another device? Tap your name.</p>
      <div class="claim">${crew().map(p => `<button data-act="claim" data-id="${esc(p.id)}"><span class="pdot" style="--c:${col(p.color)}"></span>${esc(p.name)}</button>`).join('')}</div>
      <p>New here? Pick a name and a colour.</p>` : '<p>Pick a name and a colour. Everyone sees your dot and your ticks.</p>'}
    <form data-form="join">
      <input name="name" maxlength="20" placeholder="Your name" required aria-label="Your name">
      ${swatches(free)}
      <button class="btn">Let's go</button>
    </form>
  </section>`;
}

const swatches = selC => `<div class="swatches" role="radiogroup" aria-label="Colour">${COLORS.map(c =>
  `<label><input type="radio" name="color" value="${c}" ${c === selC ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div>`;

function main() {
  const me = S.me(), today = todayIso();
  sel ||= today;
  calMonth ||= sel.slice(0, 7);
  const who = (viewing && S.people[viewing]) || me, mine = who.id === me.id;
  const people = crew(), live = people.filter(online), mon = monday(sel);
  const wk = weekPct(who, monday(today));

  return `<header class="top">
    ${brand()}
    <div class="crew-dots">
      <span class="count"><b>${live.length}</b> online</span>
      ${people.map(p => `<button class="dot ${online(p) ? 'on' : ''} ${p.id === who.id ? 'sel' : ''}" style="--c:${col(p.color)}" data-act="view" data-id="${esc(p.id)}" title="${esc(p.name)}${p.id === me.id ? ' (you)' : ''} · ${online(p) ? 'online' : 'seen ' + ago(p.seen)}" aria-label="${esc(p.name)}">${esc(p.name[0].toUpperCase())}</button>`).join('')}
    </div>
  </header>

  <section class="hero reveal">
    <div class="glow" aria-hidden="true"></div>
    <div class="kicker">${esc(plan.race.season)} · ${fmt(plan.race.date)}–${fmt(plan.race.end, { day: 'numeric', month: 'short', year: 'numeric' })} · ${esc(plan.race.venue)}</div>
    <h1>${mine ? 'Train' : esc(who.name)} <span class="grad">${mine ? 'like it’s race day' : 'is on the clock'}</span></h1>
    <div class="counts">${plan.countdowns.map(c => { const n = daysTo(c.date); return `<div class="count-tile">
      <b data-count="${Math.max(0, n)}">${Math.max(0, n)}</b><span>${n > 0 ? 'days to' : n === 0 ? 'today ·' : 'done ·'} ${esc(c.label)}</span><small>${fmt(c.date, { day: 'numeric', month: 'short', year: 'numeric' })}</small></div>`; }).join('')}
      <div class="count-tile"><b data-count="${wk}">${wk}</b><span>% this week</span><div class="bar"><i data-bar="wk" style="width:${wk}%"></i></div></div>
    </div>
  </section>

  ${mine ? '' : `<div class="viewing reveal" style="--c:${col(who.color)}"><span class="pdot"></span>Viewing <b>${esc(who.name)}</b>’s checklist · read only <button class="btn-ghost" data-act="view" data-id="${esc(me.id)}">Back to mine</button></div>`}

  <nav class="week reveal" aria-label="Week">
    <div class="week-head">
      <button class="nav" data-act="shift" data-d="-7" aria-label="Previous week">‹</button>
      <h2>Week of ${fmt(mon)}</h2>
      <button class="nav" data-act="shift" data-d="7" aria-label="Next week">›</button>
      ${monday(today) !== mon || sel !== today ? '<button class="btn-ghost" data-act="today">Today</button>' : ''}
    </div>
    <div class="strip">${DOW.map((d, i) => {
      const date = addDays(mon, i), st = dayStats(who, date);
      const kind = !st ? 'rest' : st.s.optional ? 'opt' : 'gym';
      return `<button class="tile ${kind} ${date === today ? 'today' : ''} ${date === sel ? 'sel' : ''} ${st?.pct === 100 ? 'done' : ''}" data-act="sel" data-date="${date}">
        <span class="t-dow">${d}</span><span class="t-num">${fromIso(date).getDate()}</span>
        <span class="t-name">${st ? esc(st.s.short) : 'Rest'}</span>
        ${st ? `<span class="t-bar"><i data-bar="t${i}" style="width:${st.pct}%"></i></span>` : '<span class="t-bar empty"></span>'}
      </button>`;
    }).join('')}</div>
  </nav>

  <div class="layout">
    <main class="day-panel reveal">${dayPanel(who, mine, people)}</main>
    <aside class="side">
      ${calendar(who)}
      <section class="card reveal crew">
        <h3>Crew</h3>
        ${people.map(p => `<button class="member ${p.id === who.id ? 'sel' : ''}" data-act="view" data-id="${esc(p.id)}" style="--c:${col(p.color)}">
          <span class="dot ${online(p) ? 'on' : ''}" style="--c:${col(p.color)}">${esc(p.name[0].toUpperCase())}</span>
          <span class="m-name">${esc(p.name)}${p.id === me.id ? ' <small>(you)</small>' : ''}<small class="sub">${online(p) ? 'online now' : 'seen ' + ago(p.seen)}</small></span>
          <span class="m-pct"><b>${weekPct(p, monday(today))}%</b><small>this week</small></span>
        </button>`).join('')}
      </section>
      <details class="card reveal rules" data-keep="rules"><summary><h3>Injury rules & goals</h3></summary>
        <ul>${plan.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
        <div class="goals">${plan.goals.map(g => `<span>${esc(g)}</span>`).join('')}</div>
      </details>
    </aside>
  </div>
  ${footer(me)}`;
}

function dayPanel(who, mine, people) {
  const st = dayStats(who, sel), def = plan.schedule[dow(sel)];
  const swap = mine ? `<label class="swap">Session
      <select data-act="session" aria-label="Session for this day">
        ${[...Object.entries(plan.sessions).map(([id, s]) => [id, `${s.title}${s.optional ? ' (optional)' : ''}`]), ['rest', 'Rest day']]
          .map(([id, t]) => `<option value="${id}" ${id === (st?.sid || 'rest') ? 'selected' : ''}>${esc(t)}${id === def ? ' · plan' : ''}</option>`).join('')}
      </select></label>` : '';
  const head = `<header class="dp-head">
      <div><div class="kicker">${fmt(sel, { weekday: 'long', day: 'numeric', month: 'long' })}${sel === todayIso() ? ' · Today' : ''}</div>
      <h2>${st ? esc(st.s.title) : 'Rest day'}</h2></div>${swap}</header>`;

  if (!st) return `${head}<div class="rest-card"><b>Recover.</b> Walk, stretch, sleep.${mine ? ' Feeling good? Pick a session above to add an extra one.' : ''}</div>${bonusBlock(who, mine)}`;

  const done = st.pct === 100;
  return `${head}
    <div class="dp-stats ${done ? 'complete' : ''}">
      <div class="big"><b>${st.pct}</b>%</div>
      <div class="dp-msg">${done ? '<b>Session complete!</b> 💪' : `<b>${st.left} left.</b> ${st.next ? `${esc(st.next)} next.` : ''}`}
        <div class="bar"><i data-bar="day" style="width:${st.pct}%"></i></div></div>
      ${mine && !done ? '<button class="btn" data-act="all">Mark all complete</button>' : ''}
    </div>
    <details class="warm" data-keep="warm"><summary>${esc(plan.warmup.title)} <small>${plan.warmup.items.filter(it => val(who, `${sel}|wu:${slug(it.name)}`)).length}/${plan.warmup.items.length}</small></summary>
      ${st.s.leg ? `<p class="note">${esc(plan.warmup.legExtra)}</p>` : ''}
      <ul class="rows">${plan.warmup.items.map(it => row(who, mine, people, `${sel}|wu:${slug(it.name)}`, it, false)).join('')}</ul>
    </details>
    ${st.s.sections.map(sec => {
      const ss = secStats(who, sel, sec), full = ss.resolved >= sec.pick;
      return `<section class="sec ${ss.skipped ? 'skipped' : ''} ${sec.pick && full && !ss.skipped ? 'full' : ''}">
        <header><h3>${esc(sec.name)}</h3>
          <span class="pick">${sec.pick ? `Pick ${sec.pick} · <b>${ss.resolved}/${sec.pick}</b>` : 'Optional'}</span>
          ${mine && sec.pick ? `<button class="btn-ghost sm" data-act="skipsec" data-k="${esc(secKey(sel, sec))}">${ss.skipped ? 'Undo skip' : 'Skip section'}</button>` : ''}</header>
        ${ss.skipped ? `<p class="note">Skipped${/core/i.test(sec.name) ? ' · core sore. Add an extra arm exercise under Bonus.' : '.'}</p>` : sec.note ? `<p class="note">${esc(sec.note)}</p>` : ''}
        ${ss.skipped ? '' : `<ul class="rows">${sec.items.map(it => row(who, mine, people, itemKey(sel, it), it, full)).join('')}</ul>`}
      </section>`;
    }).join('')}
    ${bonusBlock(who, mine)}`;
}

function row(who, mine, people, k, it, sectionFull) {
  const v = val(who, k), link = safeUrl(it.link);
  const others = people.filter(p => p.id !== who.id && val(p, k) === 1);
  return `<li class="${v === 1 ? 'done' : v === 2 ? 'skip' : sectionFull ? 'dim' : ''} ${k === justSet ? 'pop' : ''}">
    <label><input type="checkbox" data-k="${esc(k)}" data-l="${esc(it.name)}" ${v === 1 ? 'checked' : ''} ${mine ? '' : 'disabled'}>
      <span class="r-main"><span class="r-name">${esc(it.name)}</span>${it.muscles ? `<span class="r-mus">${esc(it.muscles)}</span>` : ''}${it.note ? `<span class="r-note">${esc(it.note)}</span>` : ''}</span></label>
    ${others.length ? `<span class="who">${others.map(p => `<i style="background:${col(p.color)}" title="${esc(p.name)} done"></i>`).join('')}</span>` : ''}
    <span class="r-sets">${v === 2 ? 'Skipped' : esc(it.sets || '')}</span>
    ${link ? `<a class="r-demo" href="${esc(link)}" target="_blank" rel="noopener" aria-label="Demo video: ${esc(it.name)}">▶</a>` : '<span class="r-demo none"></span>'}
    ${mine ? `<button class="r-skip" data-act="skip" data-k="${esc(k)}" data-l="${esc(it.name)}" aria-label="${v === 2 ? 'Undo skip' : 'Skip'} ${esc(it.name)}" title="${v === 2 ? 'Undo skip' : 'Skip'}">${v === 2 ? '↺' : '✕'}</button>` : ''}
  </li>`;
}

function bonusBlock(who, mine) {
  const list = bonuses(who, sel);
  if (!mine && !list.length) return '';
  return `<section class="sec bonus"><header><h3>Bonus</h3><span class="pick">Extra work outside the plan</span></header>
    <ul class="rows">${list.map(b => `<li class="done ${b.k === justSet ? 'pop' : ''}"><label><input type="checkbox" checked disabled><span class="r-main"><span class="r-name">${esc(b.name)}</span></span></label>
      <span class="r-sets">${esc(b.sets || '')}</span><span class="r-demo none"></span>${mine ? `<button class="r-skip" data-act="bonusdel" data-k="${esc(b.k)}" aria-label="Remove ${esc(b.name)}">✕</button>` : ''}</li>`).join('')}</ul>
    ${mine ? `<form class="bonus-form" data-form="bonus"><input type="text" name="name" maxlength="60" placeholder="e.g. Shoulder Press" required aria-label="Bonus exercise">
      <input type="text" name="sets" maxlength="20" placeholder="4 × 12" aria-label="Sets and reps"><button class="btn">Add</button></form>` : ''}
  </section>`;
}

function calendar(who) {
  const [y, m] = calMonth.split('-').map(Number);
  const first = `${calMonth}-01`, end = iso(new Date(y, m, 1)), today = todayIso();
  const cells = [];
  for (let d = monday(first); d < end || dow(d) !== 0; d = addDays(d, 1)) cells.push(d);
  return `<section class="card cal reveal">
    <div class="cal-head"><button class="nav" data-act="cal" data-d="-1" aria-label="Previous month">‹</button>
      <h3>${fromIso(first).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h3>
      <button class="nav" data-act="cal" data-d="1" aria-label="Next month">›</button></div>
    <div class="cal-grid">${DOW.map(d => `<span class="cal-dow">${d[0]}</span>`).join('')}
      ${cells.map(d => {
        const st = dayStats(who, d), other = d.slice(0, 7) !== calMonth;
        const mark = d >= plan.race.date && d <= plan.race.end ? 'race' : plan.countdowns.some(c => c.date === d) ? 'event' : '';
        return `<button class="cal-cell ${other ? 'other' : ''} ${!st ? 'rest' : st.s.optional ? 'opt' : 'gym'} ${st?.pct === 100 ? 'done' : ''} ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''} ${mark}" data-act="sel" data-date="${d}" aria-label="${fmt(d)}">
          <span>${fromIso(d).getDate()}</span>${st?.pct === 100 ? '<i>💪</i>' : st?.pct ? `<small>${st.pct}%</small>` : ''}</button>`;
      }).join('')}</div>
    <div class="legend"><span class="gym">Gym</span><span class="opt">Optional</span><span class="done">Done</span><span class="race">Race / wedding</span></div>
  </section>`;
}

function footer(me) {
  const st = S.status;
  return `<footer class="foot">
    <span class="sync ${st.state}">${st.state === 'error' ? '⚠ ' + esc(st.error) : st.state === 'saving' ? 'Saving…' : st.last ? 'Synced ' + ago(st.last) : 'Connecting…'}</span>
    ${installEvt ? '<button class="btn-ghost" data-act="install">Install app</button>' : /iphone|ipad/i.test(navigator.userAgent) && !navigator.standalone ? '<span class="hint">Install: Share → Add to Home Screen</span>' : ''}
    <details data-keep="profile"><summary>Profile</summary>
      <form data-form="profile"><input name="name" maxlength="20" value="${esc(me.name)}" required aria-label="Your name">${swatches(me.color)}<button class="btn">Save</button></form>
      <button class="link" data-act="signout">Sign out of this device</button>
    </details>
  </footer>`;
}

// ---- motion ---------------------------------------------------------------
const calm = matchMedia('(prefers-reduced-motion: reduce)');
function countUp() {
  if (calm.matches) return;
  $app.querySelectorAll('[data-count]').forEach(el => {
    const to = +el.dataset.count, t0 = performance.now();
    const step = t => { const k = Math.min(1, (t - t0) / 1100); el.textContent = Math.round(to * (1 - (1 - k) ** 3)); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
function celebrate() {
  if (calm.matches) return;
  const box = document.createElement('div');
  box.className = 'confetti'; box.setAttribute('aria-hidden', 'true');
  box.innerHTML = Array.from({ length: 48 }, (_, i) =>
    `<i style="--x:${(Math.random() * 2 - 1) * 46}vw;--y:${-30 - Math.random() * 45}vh;--r:${Math.random() * 720 - 360}deg;--d:${(i % 6) * 40}ms;background:${['#ff3d2e', '#ff6b2b', '#ffa41b', '#ffd23f', '#2ecc71'][i % 5]}"></i>`).join('');
  document.body.append(box);
  setTimeout(() => box.remove(), 2200);
}

// ---- events ---------------------------------------------------------------
/** Write entries for me, then fire confetti if that finished the day. */
function write(entries, label, key) {
  const before = dayStats(S.me(), sel)?.pct;
  justSet = key || '';
  S.set(entries, label);
  const after = dayStats(S.me(), sel)?.pct;
  if (after === 100 && before !== 100) celebrate();
}

$app.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.k && !viewing) write({ [t.dataset.k]: { v: t.checked ? 1 : 0 } }, `${t.checked ? '✓' : '○'} ${t.dataset.l} (${sel})`, t.dataset.k);
  else if (t.dataset.act === 'session') write({ [`${sel}|session`]: { v: t.value } }, `${sel} → ${plan.sessions[t.value]?.title || 'Rest'}`);
});

$app.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT') return;
  const act = b.dataset.act, k = b.dataset.k;
  if (act === 'view') { viewing = b.dataset.id === S.meId ? null : b.dataset.id; render(); }
  else if (act === 'sel') { sel = b.dataset.date; calMonth = sel.slice(0, 7); render(); if (innerWidth < 900) document.querySelector('.day-panel')?.scrollIntoView({ behavior: calm.matches ? 'auto' : 'smooth', block: 'start' }); }
  else if (act === 'shift') { sel = addDays(sel, +b.dataset.d); calMonth = sel.slice(0, 7); render(); }
  else if (act === 'today') { sel = todayIso(); calMonth = sel.slice(0, 7); render(); }
  else if (act === 'cal') { const [y, m] = calMonth.split('-').map(Number); calMonth = iso(new Date(y, m - 1 + +b.dataset.d, 1)).slice(0, 7); render(); }
  else if (act === 'skip') { const v = val(S.me(), k) === 2 ? 0 : 2; write({ [k]: { v } }, `${v ? '✕ skipped' : '↺ unskipped'} ${b.dataset.l} (${sel})`, k); }
  else if (act === 'skipsec') { const v = val(S.me(), k) === 2 ? 0 : 2; write({ [k]: { v } }, `${v ? 'skipped' : 'unskipped'} ${k.split(':')[1]} (${sel})`); }
  else if (act === 'bonusdel') write({ [k]: { v: 0 } }, `removed bonus (${sel})`);
  else if (act === 'all') {
    const me = S.me(), st = dayStats(me, sel), entries = {};
    for (const sec of st.s.sections) {
      let need = sec.pick - secStats(me, sel, sec).resolved;
      for (const it of sec.items) if (need > 0 && !val(me, itemKey(sel, it))) { entries[itemKey(sel, it)] = { v: 1 }; need--; }
    }
    write(entries, `✓ all of ${st.s.title} (${sel})`);
  }
  else if (act === 'claim') { const p = S.people[b.dataset.id]; S.join({ id: p.id, name: p.name, color: p.color }); }
  else if (act === 'install') { installEvt.prompt(); installEvt = null; render(); }
  else if (act === 'signout') { S.signOut(); viewing = null; }
});

$app.addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target), form = e.target.dataset.form;
  if (form === 'pass') {
    const h = await sha256(f.get('p'));
    if (h === PASS_HASH) { unlocked = true; S.ls.set('pass', h); err = ''; } else err = 'Wrong password';
    render();
  } else if (form === 'gate') {
    const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Checking…';
    try { err = ''; await S.connect(f.get('k')); } catch (x) { err = x.message; }
    render();
  } else if (form === 'join') S.join({ name: f.get('name').trim(), color: f.get('color') });
  else if (form === 'profile') { document.activeElement?.blur(); S.setProfile(f.get('name').trim(), f.get('color')); }
  else if (form === 'bonus') {
    document.activeElement?.blur();
    const name = f.get('name').trim(), k = `${sel}|bonus:${S.uid()}`;
    if (name) write({ [k]: { v: 1, name, sets: f.get('sets').trim() } }, `+ bonus ${name} (${sel})`, k);
  }
});
const typing = () => document.activeElement?.matches?.('#app input[type=text], #app input[name=name]');
$app.addEventListener('focusout', () => setTimeout(() => { if (deferred && !typing()) { deferred = false; render(); } }));

S.onChange(() => { if (screen !== 'pass' && (screen !== 'gate' || S.hasToken())) render(); });  // never wipe a half-typed key
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (screen === 'main') render(); });

// Stay live while the page is open: pull everyone's ticks every 15 s, say "I'm here" every few minutes.
const tick = () => { if (!document.hidden && S.hasToken()) { S.poll(); S.heartbeat(); } };
setInterval(tick, 15e3);
let lastDay = todayIso();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return void S.save();
  if (todayIso() !== lastDay) { lastDay = sel = todayIso(); calMonth = sel.slice(0, 7); }  // reopened on a new day
  tick();
});
addEventListener('online', tick);

(async () => {
  render();
  try { plan = await (await fetch('plan.json', { cache: 'no-cache' })).json(); }
  catch { $app.innerHTML = '<div class="loading">Offline. Open once with internet first.</div>'; return; }
  if (linkKey && !S.hasToken()) { try { await S.connect(linkKey); } catch (x) { err = x.message; } }
  render();
  tick();
  navigator.serviceWorker?.register('sw.js');
})();
