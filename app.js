import * as S from './store.js';
import { muscleMap, MUSCLES } from './muscles.js';

const COLORS = ['#ff6b2b', '#ffb020', '#2ecc71', '#4da6ff', '#b07cff', '#ff4d6d', '#ff5fc8', '#2ee6e6'];
// Guest heads: freely licensed Wikimedia Commons photos, credits in README.md.
const HEADS = { arnold: 'Arnold', ronnie: 'Ronnie', lou: 'Lou', cbum: 'CBum', zane: 'Zane', cutler: 'Cutler' };
const MAX_GUESTS = 5;   // keeps polling + GitHub API use small enough to stay stable
const OWNER = { id: 'mika', name: 'Mika', head: 'mika', role: 'owner' };
const DAY = 864e5, ONLINE = 6 * 60e3;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const col = c => /^#[0-9a-f]{6}$/i.test(c) ? c : '#888888';   // other people's files are untrusted input
const safeUrl = u => /^https:\/\//.test(u || '') ? u : '';

let plan = null, sel = '', calMonth = null, viewing = null, screen = '', err = '', installEvt = null;
let tab = 'today', joinMode = '', intro = true, justSet = '', deferred = false, lastHtml = '', tabChanged = false;
let mm = { view: 'front', filter: 'all', muscle: 'chest' };
let seenOnline = null;   // who was online at the last render, to pop in newcomers

// Site password. ponytail: client-side gate only (anyone reading the public repo can skip it); the access key is the real lock.
const PASS_HASH = '64d27cba265dd65d63ef0b8cb90436d3d4c5bbeb9c59b4ea0309ac4f26bd78e8';
const MIKA_PIN_HASH = '31d8edb99534fd4800651db4d241d86e0380fa7376718b88590c2d772b41d5f4';   // same caveat: keeps guests honest, not attackers
let unlocked = S.ls.get('pass', '') === PASS_HASH;
let preview = S.ls.get('preview', false);   // look around before an access key exists; ticks stay on this device and sync once a key is added
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
const fmts = new Map();   // Intl formatters are slow to build; reuse one per option set
const fmt = (s, o = { day: 'numeric', month: 'short' }) => {
  const k = JSON.stringify(o);
  if (!fmts.has(k)) fmts.set(k, new Intl.DateTimeFormat('en-GB', o));
  return fmts.get(k).format(fromIso(s));
};

// ---- people ---------------------------------------------------------------
const crew = () => Object.values(S.people)
  .filter(p => typeof p?.id === 'string' && typeof p.name === 'string' && p.name && p.role && !p.removed)
  .sort((a, b) => (b.id === S.meId) - (a.id === S.meId) || (b.role === 'owner') - (a.role === 'owner') || a.name.localeCompare(b.name));
const guests = () => crew().filter(p => p.role !== 'owner');
const online = p => Date.now() - (p.seen || 0) < ONLINE;
const ago = t => { const m = Math.round((Date.now() - t) / 60e3); return !t ? 'never' : m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const avatar = (p, cls = '') => `<span class="av ${cls} ${p.head === 'mika' ? 'owner' : ''}" style="--c:${col(p.color)}">${
  HEADS[p.head] ? `<img src="heads/${p.head}.jpg" alt="" decoding="async">` : `<b>${esc((p.name || '?')[0].toUpperCase())}</b>`}</span>`;

// ---- plan + progress ------------------------------------------------------
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const val = (p, k) => p?.checks?.[k]?.v || 0;

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
  return { skipped, resolved: skipped ? sec.pick : Math.min(sec.pick, vs.filter(v => v).length) };
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
const bar = (id, pct, cls = '') => `<span class="bar ${cls}"><i data-bar="${id}" style="--w:${pct / 100}"></i></span>`;

// ---- render ---------------------------------------------------------------
const typing = () => document.activeElement?.matches?.('#app input[type=text], #app input[name=name]');

// A sync landing mid-scroll would swap the DOM under the finger; hold it until the scroll settles.
let lastScroll = 0, lastTouch = 0, held = 0;
addEventListener('scroll', () => { lastScroll = performance.now(); }, { passive: true });
addEventListener('pointerdown', () => { lastTouch = performance.now(); }, { passive: true });   // taps always render at once

function render() {
  if (lastScroll > lastTouch && performance.now() - lastScroll < 250) { clearTimeout(held); held = setTimeout(render, 300); return; }
  if (!plan) { $app.innerHTML = '<div class="loading"><span>HYROX</span></div>'; return; }
  // Don't yank a half-typed bonus exercise out from under the user; render when they leave the field.
  if (screen === 'main' && typing()) { deferred = true; return; }

  const me = S.me();
  screen = !unlocked ? 'pass' : !S.hasToken() && !preview ? 'gate' : !me?.role || me.removed ? 'join' : 'main';
  const html = screen === 'pass' ? pass() : screen === 'gate' ? gate() : screen === 'join' ? join() : main();
  // Sync fires every 15 s; replacing identical markup would restart every animation, so skip it.
  if (html === lastHtml) return;
  lastHtml = html;

  const open = [...$app.querySelectorAll('details[open][data-keep]')].map(d => d.dataset.keep);
  const bars = Object.fromEntries([...$app.querySelectorAll('[data-bar]')].map(b => [b.dataset.bar, b.style.getPropertyValue('--w')]));
  $app.innerHTML = html;
  document.body.classList.toggle('intro', intro && screen === 'main');
  document.body.classList.toggle('in-main', screen === 'main');

  open.forEach(k => { const d = $app.querySelector(`details[data-keep="${k}"]`); if (d) d.open = true; });
  // Progress bars grow from their previous value instead of jumping.
  const grow = [...$app.querySelectorAll('[data-bar]')].map(b => {
    const to = b.style.getPropertyValue('--w');
    const from = bars[b.dataset.bar] ?? (intro ? '0' : null);
    if (from != null) b.style.setProperty('--w', from);
    return [b, to];
  });
  requestAnimationFrame(() => requestAnimationFrame(() => grow.forEach(([b, to]) => b.style.setProperty('--w', to))));
  if (intro && screen === 'main') { intro = false; countUp(); setTimeout(() => document.body.classList.remove('intro'), 1400); }
  justSet = ''; tabChanged = false;
}

const brand = () => `<div class="brand"><span class="logo">HYROX</span><span class="slash"></span><span class="sub">Training</span></div>`;
const raceTitle = () => `<div class="kicker">${esc(plan.race.season)} · ${esc(plan.race.venue)}</div>
  <h1>Road to<br><span class="grad">${esc(plan.race.name.replace(/^HYROX\s*/i, ''))}</span></h1>`;

function pass() {
  return `<section class="gate">${brand()}${raceTitle()}
    <p>Enter the site password.</p>
    <form data-form="pass">
      <input name="p" type="password" placeholder="Password" autocomplete="current-password" required aria-label="Password">
      <button class="btn">Unlock</button>
    </form>
    <p class="err" role="alert">${esc(err)}</p>
  </section>`;
}

function gate() {
  return `<section class="gate">${brand()}${raceTitle()}
    <p>Paste the access key you were given.</p>
    <form data-form="gate">
      <input name="k" type="password" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false" required aria-label="Access key">
      <button class="btn">Enter</button>
    </form>
    <p class="err" role="alert">${esc(err || (S.status.state === 'error' ? S.status.error : ''))}</p>
    <button class="link" data-act="preview">No key yet? Preview without syncing</button>
  </section>`;
}

function join() {
  const gs = guests(), full = gs.length >= MAX_GUESTS;
  if (joinMode === 'mika') return `<section class="gate">${brand()}
    <button class="link back" data-act="joinback">‹ Back</button>
    ${avatar({ ...OWNER, color: S.people.mika?.color || COLORS[0] }, 'xl')}
    <h1>Mika’s<br><span class="grad">PIN</span></h1>
    <form data-form="mika">
      <input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="PIN" autocomplete="off" required aria-label="Mika's PIN">
      <button class="btn">Enter</button>
    </form>
    <p class="err" role="alert">${esc(err)}</p>
  </section>`;
  if (joinMode !== 'guest') return `<section class="gate">${brand()}
    <h1>Who’s<br><span class="grad">training?</span></h1>
    <div class="pick2">
      <button class="pick-card mika" data-act="asmika">${avatar({ ...OWNER, color: S.people.mika?.color || COLORS[0] }, 'xl')}<b>Mika</b><small>Enter as Mika</small></button>
      <button class="pick-card" data-act="asguest"><span class="av xl guest-ic">+</span><b>Guest</b><small>${gs.length}/${MAX_GUESTS} spots taken</small></button>
    </div>
  </section>`;

  const taken = new Set(gs.map(g => g.head)), usedC = new Set(crew().map(p => p.color));
  const freeHead = Object.keys(HEADS).find(h => !taken.has(h)), freeC = COLORS.find(c => !usedC.has(c)) || COLORS[1];
  return `<section class="gate">${brand()}
    <button class="link back" data-act="joinback">‹ Back</button>
    <h1>Pick your<br><span class="grad">legend</span></h1>
    ${gs.length ? `<p>Joined before on another phone? Tap your head.</p>
      <div class="claim">${gs.map(g => `<button data-act="claim" data-id="${esc(g.id)}">${avatar(g)}<span>${esc(g.name)}</span></button>`).join('')}</div>` : ''}
    ${full ? `<p class="err">Crew is full (${MAX_GUESTS}/${MAX_GUESTS}). Ask Mika to free a spot.</p>` : `
    <form data-form="guest">
      <div class="heads" role="radiogroup" aria-label="Character">${Object.entries(HEADS).map(([h, n]) => `
        <label class="${taken.has(h) ? 'taken' : ''}"><input type="radio" name="head" value="${h}" ${h === freeHead ? 'checked' : ''} ${taken.has(h) ? 'disabled' : ''}>
          <img src="heads/${h}.jpg" alt=""><span>${n}${taken.has(h) ? ' · taken' : ''}</span></label>`).join('')}</div>
      <p>Your colour</p>
      ${swatches(freeC)}
      <button class="btn">Join as guest</button>
    </form>`}
    <p class="err" role="alert">${esc(err)}</p>
  </section>`;
}

const swatches = selC => `<div class="swatches" role="radiogroup" aria-label="Colour">${COLORS.map(c =>
  `<label><input type="radio" name="color" value="${c}" ${c === selC ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div>`;

const ICONS = {
  today: '<path d="M4 6h16M4 12h10M4 18h7"/><circle cx="18" cy="16" r="3"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="1"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  map: '<circle cx="12" cy="5" r="2.5"/><path d="M7 10h10M12 10v6M9 21l3-5 3 5M7 10l-2 5M17 10l2 5"/>',
  crew: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M15 14.5c3 0 6 2 6 5.5"/>',
};
const TABS = [['today', 'Today'], ['cal', 'Calendar'], ['map', 'Muscles'], ['crew', 'Crew']];

function main() {
  const me = S.me(), today = todayIso();
  sel ||= today;
  calMonth ||= sel.slice(0, 7);
  const v = viewing && S.people[viewing];
  const who = v && !v.removed ? v : me, mine = who.id === me.id;
  const people = crew(), live = people.filter(online);
  const fresh = seenOnline ? live.filter(p => !seenOnline.has(p.id) && p.id !== me.id) : [];
  seenOnline = new Set(live.map(p => p.id));
  if (fresh.length) toast(fresh.length === 1 ? `${fresh[0].name} is online` : `${fresh.slice(0, -1).map(p => p.name).join(', ')} & ${fresh.at(-1).name} are online`, fresh[0]);

  const body = tab === 'cal' ? calTab(who) : tab === 'map' ? muscleMap(plan, mm) : tab === 'crew' ? crewTab(me, people, who) : todayTab(me, who, mine, people, today);
  return `<header class="top">
    ${brand()}
    <div class="crew-dots" aria-label="${live.length} online">
      <span class="count"><b>${live.length}</b><i> online</i></span>
      ${people.map(p => `<button class="dot ${online(p) ? 'on' : ''} ${p.id === who.id ? 'sel' : ''} ${fresh.includes(p) ? 'pop-in' : ''}" style="--c:${col(p.color)}" data-act="view" data-id="${esc(p.id)}" title="${esc(p.name)}${p.id === me.id ? ' (you)' : ''} · ${online(p) ? 'online' : 'offline'}" aria-label="${esc(p.name)}">${avatar(p)}</button>`).join('')}
    </div>
  </header>
  <div class="view ${tabChanged ? 'tab-in' : ''}">${body}</div>
  <nav class="tabs" aria-label="Sections">${TABS.map(([id, label]) =>
    `<button class="${tab === id ? 'on' : ''}" data-act="tab" data-t="${id}" aria-current="${tab === id ? 'page' : 'false'}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[id]}</svg><span>${label}</span></button>`).join('')}</nav>`;
}

function banners(me, who, mine) {
  return `${S.hasToken() ? '' : '<div class="banner" style="--c:#ffa41b"><span>Preview · ticks stay on this phone</span><button class="btn-ghost" data-act="addkey">Add key</button></div>'}
  ${mine ? '' : `<div class="banner" style="--c:${col(who.color)}">${avatar(who)}<span>Viewing <b>${esc(who.name)}</b> · read only</span><button class="btn-ghost" data-act="view" data-id="${esc(me.id)}">Mine</button></div>`}`;
}

function todayTab(me, who, mine, people, today) {
  const mon = monday(sel), wk = weekPct(who, monday(today));
  return `<section class="hero reveal">
    <div class="glow" aria-hidden="true"></div>
    <div class="kicker">${esc(plan.race.season)} · ${fmt(plan.race.date)}–${fmt(plan.race.end)} · ${esc(plan.race.venue)}</div>
    <div class="counts">${plan.countdowns.map(c => { const n = Math.max(0, daysTo(c.date)); return `<div class="count-tile">
      <b data-count="${n}">${n}</b><span>days · ${esc(c.label)}</span></div>`; }).join('')}
      <div class="count-tile"><b data-count="${wk}">${wk}</b><span>% this week</span>${bar('wk', wk)}</div>
    </div>
  </section>
  ${banners(me, who, mine)}
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
      return `<button class="tile ${kind} ${date === today ? 'today' : ''} ${date === sel ? 'sel' : ''} ${st?.pct === 100 ? 'done' : ''}" data-act="sel" data-date="${date}" aria-label="${fmt(date, { weekday: 'long', day: 'numeric', month: 'short' })}${st ? ', ' + st.s.short + ', ' + st.pct + '%' : ', rest'}">
        <span class="t-dow">${d}</span><span class="t-num">${fromIso(date).getDate()}</span>
        ${st ? bar('t' + i, st.pct, 'thin') : '<span class="bar thin empty"></span>'}
      </button>`;
    }).join('')}</div>
  </nav>
  <main class="day-panel reveal" id="day">${dayPanel(who, mine, people)}</main>`;
}

function dayPanel(who, mine, people) {
  const st = dayStats(who, sel), def = plan.schedule[dow(sel)];
  const swap = mine ? `<label class="swap"><span>Session</span>
      <select data-act="session" aria-label="Session for this day">
        ${[...Object.entries(plan.sessions).map(([id, s]) => [id, `${s.title}${s.optional ? ' (optional)' : ''}`]), ['rest', 'Rest day']]
          .map(([id, t]) => `<option value="${id}" ${id === (st?.sid || 'rest') ? 'selected' : ''}>${esc(t)}${id === def ? ' · plan' : ''}</option>`).join('')}
      </select></label>` : '';
  const head = `<header class="dp-head">
      <div class="kicker">${fmt(sel, { weekday: 'long', day: 'numeric', month: 'long' })}${sel === todayIso() ? ' · Today' : ''}</div>
      <h2>${st ? esc(st.s.title) : 'Rest day'}</h2>${swap}</header>`;

  if (!st) return `${head}<div class="rest-card"><b>Recover.</b> Walk, stretch, sleep.${mine ? ' Feeling good? Pick a session above to add an extra one.' : ''}</div>${bonusBlock(who, mine)}`;

  const done = st.pct === 100;
  return `${head}
    <div class="dp-stats ${done ? 'complete' : ''}">
      <div class="big"><b>${st.pct}</b>%</div>
      <div class="dp-msg">${done ? '<b>Session complete!</b> 💪' : `<b>${st.left} left.</b> ${st.next ? `${esc(st.next)} next.` : ''}`}${bar('day', st.pct)}</div>
    </div>
    ${mine && !done ? '<button class="btn wide" data-act="all">Mark all complete</button>' : ''}
    <details class="warm" data-keep="warm"><summary>${esc(plan.warmup.title)} <small>${plan.warmup.items.filter(it => val(who, `${sel}|wu:${slug(it.name)}`)).length}/${plan.warmup.items.length}</small></summary>
      ${st.s.leg ? `<p class="note">${esc(plan.warmup.legExtra)}</p>` : ''}
      <ul class="rows">${plan.warmup.items.map(it => row(who, mine, people, `${sel}|wu:${slug(it.name)}`, it, false)).join('')}</ul>
    </details>
    ${st.s.sections.map(sec => {
      const ss = secStats(who, sel, sec), full = ss.resolved >= sec.pick;
      return `<section class="sec ${ss.skipped ? 'skipped' : ''} ${sec.pick && full && !ss.skipped ? 'full' : ''}">
        <header><h3>${esc(sec.name)}</h3>
          <span class="pick">${sec.pick ? `Pick ${sec.pick} · <b>${ss.resolved}/${sec.pick}</b>` : 'Optional'}</span>
          ${mine && sec.pick ? `<button class="btn-ghost sm" data-act="skipsec" data-k="${esc(secKey(sel, sec))}">${ss.skipped ? 'Undo' : 'Skip'}</button>` : ''}</header>
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
      <span class="r-main"><span class="r-name">${esc(it.name)}</span>
        <span class="r-meta">${v === 2 ? '<b class="skipped">Skipped</b>' : `<b>${esc(it.sets || '')}</b>`}${it.muscles ? ` · ${esc(it.muscles)}` : ''}</span>
        ${it.note ? `<span class="r-note">${esc(it.note)}</span>` : ''}
        ${others.length ? `<span class="who">${others.map(p => avatar(p, 'xs')).join('')}</span>` : ''}</span></label>
    ${link ? `<a class="r-demo" href="${esc(link)}" target="_blank" rel="noopener" aria-label="Demo video${it.clip ? ', ' + esc(it.clip) : ''}: ${esc(it.name)}">▶${it.clip ? `<small>${esc(it.clip)}</small>` : ''}</a>` : ''}
    ${mine ? `<button class="r-skip" data-act="skip" data-k="${esc(k)}" data-l="${esc(it.name)}" aria-label="${v === 2 ? 'Undo skip' : 'Skip'} ${esc(it.name)}">${v === 2 ? '↺' : '✕'}</button>` : ''}
  </li>`;
}

function bonusBlock(who, mine) {
  const list = bonuses(who, sel);
  if (!mine && !list.length) return '';
  return `<section class="sec bonus"><header><h3>Bonus</h3><span class="pick">Extra work</span></header>
    <ul class="rows">${list.map(b => `<li class="done ${b.k === justSet ? 'pop' : ''}"><label><input type="checkbox" checked disabled><span class="r-main"><span class="r-name">${esc(b.name)}</span>${b.sets ? `<span class="r-meta"><b>${esc(b.sets)}</b></span>` : ''}</span></label>
      ${mine ? `<button class="r-skip" data-act="bonusdel" data-k="${esc(b.k)}" aria-label="Remove ${esc(b.name)}">✕</button>` : ''}</li>`).join('')}</ul>
    ${mine ? `<form class="bonus-form" data-form="bonus"><input type="text" name="name" maxlength="60" placeholder="e.g. Shoulder Press" required aria-label="Bonus exercise" enterkeyhint="next">
      <input type="text" name="sets" maxlength="20" placeholder="4 × 12" aria-label="Sets and reps" enterkeyhint="done"><button class="btn">Add</button></form>` : ''}
  </section>`;
}

function calTab(who) {
  const [y, m] = calMonth.split('-').map(Number);
  const first = `${calMonth}-01`, end = iso(new Date(y, m, 1)), today = todayIso();
  const cells = [];
  for (let d = monday(first); d < end || dow(d) !== 0; d = addDays(d, 1)) cells.push(d);
  const stats = Object.fromEntries(cells.map(d => [d, dayStats(who, d)]));
  const gymDays = cells.filter(d => d.slice(0, 7) === calMonth && stats[d] && !stats[d].s.optional);
  const doneDays = gymDays.filter(d => stats[d].pct === 100).length;
  return `<section class="card cal reveal">
    <div class="cal-head"><button class="nav" data-act="cal" data-d="-1" aria-label="Previous month">‹</button>
      <h2>${fmt(first, { month: 'long', year: 'numeric' })}</h2>
      <button class="nav" data-act="cal" data-d="1" aria-label="Next month">›</button></div>
    <div class="cal-grid">${DOW.map(d => `<span class="cal-dow">${d[0]}</span>`).join('')}
      ${cells.map(d => {
        const st = stats[d], other = d.slice(0, 7) !== calMonth;
        const mark = d >= plan.race.date && d <= plan.race.end ? 'race' : plan.countdowns.some(c => c.date === d) ? 'event' : '';
        return `<button class="cal-cell ${other ? 'other' : ''} ${!st ? 'rest' : st.s.optional ? 'opt' : 'gym'} ${st?.pct === 100 ? 'done' : ''} ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''} ${mark}" data-act="sel" data-date="${d}" aria-label="${fmt(d)}${st ? ', ' + st.pct + '%' : ''}">
          <span>${fromIso(d).getDate()}</span>${st?.pct === 100 ? '<i>💪</i>' : st?.pct ? `<small>${st.pct}%</small>` : ''}</button>`;
      }).join('')}</div>
    <div class="legend"><span class="gym">Gym</span><span class="opt">Optional</span><span class="done">Done</span><span class="race">Race / wedding</span></div>
    <p class="cal-sum"><b>${doneDays}</b> of ${gymDays.length} gym days done this month</p>
  </section>`;
}

function crewTab(me, people, who) {
  const owner = me.role === 'owner', st = S.status;
  return `<section class="card reveal crew">
    <h2>Crew <small>${guests().length}/${MAX_GUESTS} guests</small></h2>
    ${people.map(p => `<div class="member ${p.id === who.id ? 'sel' : ''}" style="--c:${col(p.color)}">
      <button class="m-open" data-act="view" data-id="${esc(p.id)}">
        <span class="dot ${online(p) ? 'on' : ''}" style="--c:${col(p.color)}">${avatar(p)}</span>
        <span class="m-name">${esc(p.name)}${p.id === me.id ? ' <small>(you)</small>' : ''}<small class="sub">${p.role === 'owner' ? 'Owner · ' : ''}${online(p) ? 'online now' : 'seen ' + ago(p.seen)}</small></span>
        <span class="m-pct"><b>${weekPct(p, monday(todayIso()))}%</b><small>this week</small></span>
      </button>
      ${owner && p.role !== 'owner' ? `<button class="r-skip" data-act="kick" data-id="${esc(p.id)}" aria-label="Free ${esc(p.name)}'s spot">✕</button>` : ''}
    </div>`).join('')}
  </section>
  <details class="card reveal rules" data-keep="rules"><summary><h3>Injury rules & goals</h3></summary>
    <ul>${plan.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    <div class="goals">${plan.goals.map(g => `<span>${esc(g)}</span>`).join('')}</div>
  </details>
  <details class="card reveal" data-keep="profile"><summary><h3>Your profile</h3></summary>
    <form data-form="profile" class="profile">
      ${owner ? '' : `<div class="heads small">${Object.entries(HEADS).map(([h, n]) => {
        const taken = guests().some(g => g.head === h && g.id !== me.id);
        return `<label class="${taken ? 'taken' : ''}"><input type="radio" name="head" value="${h}" ${h === me.head ? 'checked' : ''} ${taken ? 'disabled' : ''}><img src="heads/${h}.jpg" alt=""><span>${n}</span></label>`; }).join('')}</div>`}
      ${swatches(me.color)}
      <button class="btn">Save</button>
    </form>
  </details>
  <section class="card reveal settings">
    <p class="sync ${st.state}">${!S.hasToken() ? 'Preview · not synced' : st.state === 'error' ? '⚠ ' + esc(st.error) : st.state === 'saving' ? 'Saving…' : st.last ? 'Synced ' + ago(st.last) : 'Connecting…'}</p>
    ${installEvt ? '<button class="btn wide" data-act="install">Install app</button>' : /iphone|ipad/i.test(navigator.userAgent) && !navigator.standalone ? '<p class="hint">Install: Safari → Share → Add to Home Screen</p>' : ''}
    <button class="btn-ghost wide" data-act="switch">Switch person</button>
    ${owner ? '' : '<button class="btn-ghost wide" data-act="leave">Leave crew (frees your spot)</button>'}
    ${S.hasToken() ? '<button class="link" data-act="signout">Forget access key on this phone</button>' : ''}
  </section>`;
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
  box.innerHTML = Array.from({ length: 40 }, (_, i) =>
    `<i style="--x:${(Math.random() * 2 - 1) * 46}vw;--y:${-30 - Math.random() * 40}vh;--r:${Math.random() * 720 - 360}deg;--d:${(i % 6) * 40}ms;background:${['#ff3d2e', '#ff6b2b', '#ffa41b', '#ffd23f', '#2ecc71'][i % 5]}"></i>`).join('');
  document.body.append(box);
  setTimeout(() => box.remove(), 2200);
}
// Toasts live outside #app so re-renders never cut them off.
function toast(msg, p) {
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status');
  t.innerHTML = `${p ? avatar(p) : ''}<span>${esc(msg)}</span>`;
  const host = document.querySelector('.toasts') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toasts' }));
  if (host.children.length >= 3) host.firstChild.remove();
  host.append(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3100);
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
const goTab = t => { if (t !== tab) { tab = t; tabChanged = true; } render(); scrollTo({ top: 0, behavior: 'instant' }); };
const showDay = () => { const d = document.getElementById('day'); if (d && d.getBoundingClientRect().top > innerHeight * .6) d.scrollIntoView({ behavior: calm.matches ? 'auto' : 'smooth', block: 'start' }); };

$app.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.k && !viewing) write({ [t.dataset.k]: { v: t.checked ? 1 : 0 } }, `${t.checked ? '✓' : '○'} ${t.dataset.l} (${sel})`, t.dataset.k);
  else if (t.dataset.act === 'session') write({ [`${sel}|session`]: { v: t.value } }, `${sel} → ${plan.sessions[t.value]?.title || 'Rest'}`);
});

$app.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT') return;
  const act = b.dataset.act, k = b.dataset.k;
  if (act === 'tab') goTab(b.dataset.t);
  else if (act === 'view') { viewing = b.dataset.id === S.meId ? null : b.dataset.id; goTab('today'); }
  else if (act === 'sel') { sel = b.dataset.date; calMonth = sel.slice(0, 7); if (tab !== 'today') goTab('today'); else { render(); showDay(); } }
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
  else if (act === 'muscle') { mm.muscle = b.dataset.m; if (b.tagName === 'BUTTON') mm.view = MUSCLES[mm.muscle].view; render(); }
  else if (act === 'mfilter') { mm.filter = b.dataset.f; render(); }
  else if (act === 'mview') { mm.view = b.dataset.v; render(); }
  else if (act === 'asmika') { err = ''; joinMode = 'mika'; render(); $app.querySelector('input[name=pin]')?.focus(); }
  else if (act === 'asguest') { joinMode = 'guest'; err = ''; render(); }
  else if (act === 'joinback') { joinMode = ''; err = ''; render(); }
  else if (act === 'claim') { const p = S.people[b.dataset.id]; err = ''; intro = true; S.join({ id: p.id, name: p.name, color: p.color, head: p.head, role: 'guest' }); }
  else if (act === 'kick') { const p = S.people[b.dataset.id]; if (p) { if (viewing === p.id) viewing = null; S.remove(p.id); toast(`${p.name}'s spot is free`); } }
  else if (act === 'switch') { viewing = null; joinMode = ''; tab = 'today'; await S.switchPerson(); }
  else if (act === 'leave') { const id = S.meId; viewing = null; joinMode = ''; tab = 'today'; await S.switchPerson(); await S.remove(id); }
  else if (act === 'install') { installEvt.prompt(); installEvt = null; render(); }
  else if (act === 'signout') { viewing = null; preview = false; S.ls.set('preview', false); S.signOut(); }
  else if (act === 'preview' || act === 'addkey') { preview = act === 'preview'; S.ls.set('preview', preview); err = ''; render(); }
});

// SVG muscles are role=button; give them the keyboard behaviour real buttons have.
$app.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('path[data-act]')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });

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
  } else if (form === 'mika') {
    if (await sha256(f.get('pin')) !== MIKA_PIN_HASH) { err = 'Wrong PIN'; render(); return; }
    err = ''; joinMode = ''; intro = true;
    S.join({ ...OWNER, color: S.people.mika?.color || COLORS[0] });
  } else if (form === 'guest') {
    const head = f.get('head');
    if (!HEADS[head] || guests().length >= MAX_GUESTS || guests().some(g => g.head === head)) { err = 'That legend was just taken. Pick another.'; render(); return; }
    err = ''; intro = true;
    S.join({ name: HEADS[head], color: f.get('color'), head, role: 'guest' });
  } else if (form === 'profile') {
    const head = f.get('head');
    S.setProfile(head && HEADS[head] ? { head, name: HEADS[head], color: f.get('color') } : { color: f.get('color') });
    toast('Profile saved');
  } else if (form === 'bonus') {
    document.activeElement?.blur();
    const name = f.get('name').trim(), k = `${sel}|bonus:${S.uid()}`;
    if (name) write({ [k]: { v: 1, name, sets: f.get('sets').trim() } }, `+ bonus ${name} (${sel})`, k);
  }
});
$app.addEventListener('focusout', () => setTimeout(() => { if (deferred && !typing()) { deferred = false; render(); } }));

S.onChange(() => { if (screen !== 'pass' && (screen !== 'gate' || S.hasToken())) render(); });  // never wipe a half-typed password or key
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (screen === 'main') render(); });

// Stay live while the page is open: pull everyone's ticks every 15 s, say "I'm here" every few minutes.
const tick = () => { if (!document.hidden && S.hasToken()) { S.poll(); S.heartbeat(); } };
setInterval(tick, 15e3);
setInterval(() => { if (!document.hidden) render(); }, 60e3);   // "seen 3 min ago" and online dots age even without new data
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
