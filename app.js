import * as S from './store.js';
import { muscleMap, MUSCLES } from './muscles.js';

const COLORS = ['#ff6b2b', '#ffb020', '#2ecc71', '#4da6ff', '#b07cff', '#ff5fc8', '#2ee6e6'];   // no near-duplicates: these tell people apart in charts
// Guest heads: freely licensed Wikimedia Commons photos, credits in README.md.
const HEADS = { arnold: 'Arnold', ronnie: 'Ronnie', lou: 'Lou', cbum: 'CBum', zane: 'Zane', cutler: 'Cutler' };
const MAX_GUESTS = 5;   // keeps polling + GitHub API use small enough to stay stable
// Named crew: a fixed id each, so all of one person's devices share one file. Same plan for both.
const MEMBERS = {
  mika:  { id: 'mika',  name: 'Mika',  head: 'mika',  role: 'owner',  color: '#ff6b2b', pin: '31d8edb99534fd4800651db4d241d86e0380fa7376718b88590c2d772b41d5f4' },
  aidan: { id: 'aidan', name: 'Aidan', head: 'aidan', role: 'member', color: '#4da6ff', pin: '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4' },
  barath: { id: 'barath', name: 'Barath', head: 'barath', role: 'member', color: '#b07cff', pin: '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4' },
};
const memberProfile = id => { const { pin, ...m } = MEMBERS[id]; return { ...m, color: S.people[id]?.color || m.color }; };
// Arnold soundboard: sounds/<file>.m4a, each under 3 s. Playback is also cut at 3 s in case a longer clip slips in.
const SOUNDS = [['do-it', 'Do it!'], ['belong', 'You belong to me'], ['cookie', 'Put that cookie down'], ['stop-it', 'Stop it'], ['problemo', 'No problemo'],
  ['mick', 'Mick!'], ['roar', 'Roar'], ['augh', 'Aaugh aaugh'], ['eaugh', 'Eaugh']];
const DAY = 864e5, ONLINE = 6 * 60e3;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const col = c => /^#[0-9a-f]{6}$/i.test(c) ? c : '#888888';   // other people's files are untrusted input
const safeUrl = u => /^https:\/\//.test(u || '') ? u : '';

let plan = null, sel = '', calMonth = null, viewing = null, screen = '', err = '', installEvt = null;
let tab = 'today', joinMode = '', intro = true, justSet = '', deferred = false, lastHtml = '', tabChanged = false;
let mm = { view: 'front', filter: 'all', muscle: 'chest' };
let clip = null;   // the soundboard clip playing now; a new tap cuts it off
let trendOpen = new Set();   // exercise slugs whose weight chart is expanded
let altOpen = new Set();   // exercise slugs whose free-weight alternatives are listed
let clubFilter = 'all', clubQ = '';   // Clubs tab: chip/dropdown filter and the search box
let seenOnline = null;   // who was online at the last render, to pop in newcomers

// Site password. ponytail: client-side gate only (anyone reading the public repo can skip it); the access key is the real lock.
const PASS_HASH = '64d27cba265dd65d63ef0b8cb90436d3d4c5bbeb9c59b4ea0309ac4f26bd78e8';
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
  .sort((a, b) => (b.id === S.meId) - (a.id === S.meId) || rank(a) - rank(b) || a.name.localeCompare(b.name));
function rank(p) { return { owner: 0, member: 1 }[p.role] ?? 2; }
const guests = () => crew().filter(p => p.role === 'guest');
const online = p => Date.now() - (p.seen || 0) < ONLINE;
const ago = t => { const m = Math.round((Date.now() - t) / 60e3); return !t ? 'never' : m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const avatar = (p, cls = '') => `<span class="av ${cls} ${MEMBERS[p.head] ? 'named' : ''}" style="--c:${col(p.color)}">${
  HEADS[p.head] ? `<img src="heads/${p.head}.jpg" alt="" decoding="async">` : `<b>${esc((p.name || '?')[0].toUpperCase())}</b>`}</span>`;

// ---- plan + progress ------------------------------------------------------
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const val = (p, k) => p?.checks?.[k]?.v || 0;

/** Session id for a person on a date: their day swap if they made one, else the weekly schedule. */
function sessionId(p, date) {
  const o = p?.checks?.[`${date}|session`]?.v;
  return o === 'rest' || Object.hasOwn(plan.sessions, o) ? o : plan.schedule[dow(date)];
}
const itemKey = (date, it) => `${date}|${slug(it.name)}`;
const kgKey = (date, it) => `${date}|kg:${slug(it.name)}`;
// Free-weight alternatives (plan.alts): same muscles, knee- and Achilles-safe. "(light)" variants share the base list.
const altsFor = it => plan.alts?.[it.name] || plan.alts?.[it.name.replace(/\s*\((very )?light( only)?\)/i, '')] || [];
const altKey = (date, it) => `${date}|alt:${slug(it.name)}`;
/** What a person actually does for a plan item on a date: the item, or the alternative they swapped in. Ticks stay on the item's key. */
function shown(p, date, it) {
  const a = p?.checks?.[altKey(date, it)]?.v;
  return typeof a === 'string' && altsFor(it).includes(a) ? { ...plan.altInfo[a], name: a, sets: it.sets, from: it.name } : it;   // synced files are untrusted: only known alternatives
}
const lifts = it => /×\s*\d+$/.test(it.sets || '');   // rep-based sets get a weight box; timed ones (plank, stretches, rowing) don't
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
    if (!next && st.resolved < sec.pick) { const it = sec.items.find(it => !val(p, itemKey(date, it))); next = it ? shown(p, date, it).name : ''; }
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
const typing = () => document.activeElement?.matches?.('#app input[type=text], #app input[type=search], #app input[name=name]');

// A sync landing mid-scroll would swap the DOM under the finger; hold it until the scroll settles.
let lastScroll = 0, lastTouch = 0, held = 0;
addEventListener('scroll', () => { lastScroll = performance.now(); }, { passive: true });
addEventListener('pointerdown', () => { lastTouch = performance.now(); }, { passive: true });   // taps always render at once
// Swapping the DOM between a finger going down and coming up eats the tap (e.g. a weight saving on blur
// while the finger lands on the tick box). Hold renders while a pointer is down; the click still runs first.
let pointerDown = 0, afterTap = false;
addEventListener('pointerdown', () => { pointerDown = performance.now(); }, { capture: true, passive: true });
for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, () => { pointerDown = 0; if (afterTap) { afterTap = false; setTimeout(render); } }, { capture: true, passive: true });

function render() {
  if (pointerDown && performance.now() - pointerDown < 1500) { afterTap = true; clearTimeout(held); held = setTimeout(render, 1600); return; }   // a lost pointerup can't freeze the page
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
  if (MEMBERS[joinMode]) { const m = memberProfile(joinMode); return `<section class="gate">${brand()}
    <button class="link back" data-act="joinback">‹ Back</button>
    ${avatar(m, 'xl')}
    <h1>${m.name}’s<br><span class="grad">PIN</span></h1>
    <form data-form="member">
      <input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="PIN" autocomplete="off" required aria-label="${m.name}'s PIN">
      <button class="btn">Enter</button>
    </form>
    <p class="err" role="alert">${esc(err)}</p>
  </section>`; }
  if (joinMode !== 'guest') return `<section class="gate">${brand()}
    <h1>Who’s<br><span class="grad">training?</span></h1>
    <div class="pick2">
      ${Object.keys(MEMBERS).map(id => { const m = memberProfile(id); return `<button class="pick-card member" style="--c:${col(m.color)}" data-act="asmember" data-id="${id}">${avatar(m, 'xl')}<b>${m.name}</b><small>Enter as ${m.name}</small></button>`; }).join('')}
      <button class="pick-card guest" data-act="asguest"><span class="av xl guest-ic">+</span><b>Guest</b><small>${gs.length}/${MAX_GUESTS} spots taken</small></button>
    </div>
  </section>`;

  const taken = new Set(gs.map(g => g.head)), usedC = new Set(crew().map(p => p.color));
  const freeHead = Object.keys(HEADS).find(h => !taken.has(h)), freeC = pickable('').find(c => !usedC.has(c)) || pickable('')[0];
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
      ${swatches(freeC, '')}
      <button class="btn">Join as guest</button>
    </form>`}
    <p class="err" role="alert">${esc(err)}</p>
  </section>`;
}

/** Colours a person may pick: never Mika's or Aidan's (unless it's their own), so weights and charts stay readable. */
const pickable = id => COLORS.filter(c => !Object.keys(MEMBERS).some(m => m !== id && memberProfile(m).color === c));
const swatches = (selC, id) => `<div class="swatches" role="radiogroup" aria-label="Colour">${pickable(id).map(c =>
  `<label><input type="radio" name="color" value="${c}" ${c === selC ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div>`;

const ICONS = {
  today: '<path d="M4 6h16M4 12h10M4 18h7"/><circle cx="18" cy="16" r="3"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="1"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  map: '<circle cx="12" cy="5" r="2.5"/><path d="M7 10h10M12 10v6M9 21l3-5 3 5M7 10l-2 5M17 10l2 5"/>',
  // Anytime Fitness running man, from the brand's own logo SVG; filled, not stroked (see .tabs svg.fill).
  clubs: '<path d="M32.4383 1.57752C31.2676 0.406825 29.2321 0.23328 28.1526 1.42457C28.1526 1.42457 21.0196 10.7166 19.1488 12.5668C16.3838 15.3082 13.4483 17.4937 10.5304 19.0938C10.1803 19.285 9.76559 19.2909 9.48027 19.0085L5.18576 14.7405C3.52679 13.0815 1.60308 13.2139 0.635345 14.1816C-0.217674 15.0346 -0.376512 16.5995 1.19128 18.1673L7.45656 24.3973C8.50665 25.4473 10.1715 25.6091 11.401 24.8091L11.554 24.7061C13.4218 23.353 16.4338 19.8645 18.4458 17.2878C18.7929 16.8436 19.4165 16.7436 19.8665 17.0613C25.7553 21.1999 27.9878 22.8765 28.8232 23.5531C29.6409 24.2149 29.9704 24.6267 29.9586 24.9738C29.938 25.668 28.5085 26.7886 26.9701 27.8946C25.0729 29.2565 23.8522 30.2066 23.008 30.9773C21.8226 32.095 21.3872 32.6627 21.1166 33.5657C20.9225 34.2158 21.049 34.9659 21.149 35.2453C21.4402 36.0777 22.0932 36.8013 23.0639 37.4014L32.0559 42.6313C34.7296 44.0785 36.0709 43.2049 36.8416 42.0489C37.5623 40.9664 37.8888 38.9456 35.4121 37.4426L28.9468 33.3775C28.2408 32.9539 28.5144 32.4803 28.6614 32.3186C28.9879 31.9656 30.3734 30.6714 30.7146 30.336C32.8883 28.2064 33.9384 26.321 33.9266 24.5796C33.9149 22.7853 32.7589 21.4529 31.7529 20.494C30.7999 19.585 29.8998 18.6997 28.5408 17.3643C27.4613 16.3024 26.0965 14.9611 24.1934 13.105C23.9463 12.8638 23.811 12.5373 23.8257 12.2108C23.8375 11.9196 23.9698 11.6549 24.1993 11.4696C24.9493 10.8578 25.9112 9.99888 26.8436 9.17233C27.7967 8.3252 28.6967 7.52512 29.3321 7.01331C29.6498 6.75741 30.1145 6.778 30.4087 7.06332L34.709 11.2284C35.7474 12.2667 37.0416 12.705 38.1741 12.402C38.53 12.3079 38.8447 12.1432 39.1065 11.9255C39.4507 11.6373 39.7007 11.2578 39.8183 10.8195C39.9684 10.2577 40.0242 9.11939 38.7035 7.80162L32.4383 1.57752Z"/><path d="M14.3513 12.1285C16.9197 12.1285 19.0017 10.0464 19.0017 7.47806C19.0017 4.9097 16.9197 2.82764 14.3513 2.82764C11.7829 2.82764 9.70087 4.9097 9.70087 7.47806C9.70087 10.0464 11.7829 12.1285 14.3513 12.1285Z"/>',
  crew: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M15 14.5c3 0 6 2 6 5.5"/>',
};
const TABS = [['today', 'Today'], ['cal', 'Calendar'], ['map', 'Muscles'], ['clubs', 'Clubs'], ['crew', 'Crew']];

function main() {
  const me = S.me(), today = todayIso();
  sel ||= today;
  calMonth ||= sel.slice(0, 7);
  if (viewing && (!S.people[viewing] || S.people[viewing].removed)) viewing = null;   // they left: back to my own page, editable again
  const v = viewing && S.people[viewing];
  const who = v || me, mine = who.id === me.id;
  const people = crew(), live = people.filter(online);
  const fresh = seenOnline ? live.filter(p => !seenOnline.has(p.id) && p.id !== me.id) : [];
  seenOnline = new Set(live.map(p => p.id));
  if (fresh.length) toast(fresh.length === 1 ? `${fresh[0].name} is online` : `${fresh.slice(0, -1).map(p => p.name).join(', ')} & ${fresh.at(-1).name} are online`, fresh[0]);

  const body = tab === 'cal' ? calTab(who) : tab === 'map' ? muscleMap(plan, mm) : tab === 'clubs' ? clubsTab(me, who, people) : tab === 'crew' ? crewTab(me, people, who) : todayTab(me, who, mine, people, today);
  return `<header class="top">
    ${brand()}
    <div class="crew-dots" aria-label="${live.length} online">
      <span class="count"><b>${live.length}</b><i> online</i></span>
      ${people.map(p => `<button class="dot ${online(p) ? 'on' : ''} ${p.id === who.id ? 'sel' : ''} ${fresh.includes(p) ? 'pop-in' : ''}" style="--c:${col(p.color)}" data-act="view" data-id="${esc(p.id)}" title="${esc(p.name)}${p.id === me.id ? ' (you)' : ''} · ${online(p) ? 'online' : 'offline'}" aria-label="${esc(p.name)}">${avatar(p)}</button>`).join('')}
    </div>
    ${syncIcon()}
  </header>
  <div class="view ${tabChanged ? 'tab-in' : ''}">${body}</div>
  <nav class="tabs" aria-label="Sections">${TABS.map(([id, label]) =>
    `<button class="${tab === id ? 'on' : ''}" data-act="tab" data-t="${id}" aria-current="${tab === id ? 'page' : 'false'}"><svg ${id === 'clubs' ? 'class="fill" viewBox="0 0 41 44"' : 'viewBox="0 0 24 24"'} aria-hidden="true">${ICONS[id]}</svg><span>${label}</span></button>`).join('')}</nav>`;
}

const SYNC_SVG = '<path d="M20 12a8 8 0 0 1-14.5 4.7M4 12a8 8 0 0 1 14.5-4.7"/><path d="M19 3v4.5h-4.5M5 21v-4.5h4.5"/>';
/** Top-right sync state: green synced, spinning while saving, red on error, grey in preview. Tap to sync now. */
function syncIcon() {
  const st = S.status, k = !S.hasToken() ? 'off' : st.state === 'error' ? 'err' : st.state === 'saving' ? 'busy' : st.last ? 'ok' : 'busy';
  const label = { off: 'Preview: not synced. Tap to add a key', err: `Sync error: ${st.error}. Tap to retry`, busy: 'Syncing…', ok: `Synced ${ago(st.last)}. Tap to sync now` }[k];
  return `<button class="sync-ic ${k}" data-act="sync" aria-label="${esc(label)}" title="${esc(label)}"><svg viewBox="0 0 24 24" aria-hidden="true">${SYNC_SVG}</svg></button>`;
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
    <div class="counts">${plan.countdowns.map(c => {
      if (c.goal) return goalTile(who, mine, c);
      const n = Math.max(0, daysTo(c.date)); return `<div class="count-tile">
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
  <details class="warm sb reveal" data-keep="sb"><summary>Arnold soundboard <small>tap to pump</small></summary>
    <div class="sb-grid">${SOUNDS.map(([f, t]) => `<button class="btn-ghost" data-act="sound" data-f="${f}">${esc(t)}</button>`).join('')}</div>
  </details>
  <main class="day-panel reveal" id="day">${dayPanel(who, mine, people)}</main>`;
}

// Goal countdown: Mika's is fixed to the plan date; everyone else picks their own day (synced in their file as `goal`).
const isIso = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(fromIso(s));
const goalDate = (p, c) => p?.role === 'owner' ? c.date : isIso(p?.goal) ? p.goal : '';
function goalTile(who, mine, c) {
  const d = goalDate(who, c), n = d ? Math.max(0, daysTo(d)) : 0, edit = mine && who.role !== 'owner';
  const text = d ? `<b data-count="${n}">${n}</b><span>days · ${esc(c.label)}${edit ? ' ✎' : ''}</span>` : `<b>–</b><span>${edit ? 'Tap to set goal' : esc(c.label)}</span>`;
  return edit ? `<label class="count-tile goal-tile">${text}<input type="date" data-act="goal" min="${todayIso()}" value="${d}" aria-label="Pick your goal date"></label>`
    : `<div class="count-tile">${text}</div>`;
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
      const ss = secStats(who, sel, sec), full = sec.pick > 0 && ss.resolved >= sec.pick;   // optional sections (pick 0) never grey out
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

function row(who, mine, people, k, base, sectionFull) {
  const wu = k.includes('|wu:'), it = wu ? base : shown(who, sel, base), alts = wu ? [] : altsFor(base);
  const v = val(who, k), link = safeUrl(it.link), open = alts.length && altOpen.has(slug(base.name));
  const others = people.filter(p => p.id !== who.id && val(p, k) === 1);
  return `<li class="${v === 1 ? 'done' : v === 2 ? 'skip' : sectionFull ? 'dim' : ''} ${k === justSet ? 'pop' : ''}">
    <label><input type="checkbox" data-k="${esc(k)}" data-l="${esc(it.name)}" ${v === 1 ? 'checked' : ''} ${mine ? '' : 'disabled'}>
      <span class="r-main"><span class="r-name">${esc(it.name)}</span>
        <span class="r-meta">${v === 2 ? '<b class="skipped">Skipped</b>' : `<b>${esc(it.sets || '')}</b>`}${it.muscles ? ` · ${esc(it.muscles)}` : ''}</span>
        ${it.from ? `<span class="r-note">Swapped in for ${esc(it.from)}</span>` : ''}${it.note ? `<span class="r-note">${esc(it.note)}</span>` : ''}
        ${alts.length ? `<button class="r-alt" data-act="alt" data-s="${esc(slug(base.name))}" aria-expanded="${!!open}">⇄ ${open ? 'Hide options' : `Can’t do it? <small>${alts.length} free-weight option${alts.length > 1 ? 's' : ''}</small>`}</button>` : ''}
        ${kgVs(who, people, k, it)}
        ${others.length ? `<span class="who">${others.map(p => avatar(p, 'xs')).join('')}</span>` : ''}</span></label>
    ${kgBox(who, mine, k, it)}
    ${link ? `<a class="r-demo" href="${esc(link)}" target="_blank" rel="noopener" aria-label="Demo video${it.clip ? ', ' + esc(it.clip) : ''}: ${esc(it.name)}">▶${it.clip ? `<small>${esc(it.clip)}</small>` : ''}</a>` : ''}
    ${mine ? `<button class="r-skip" data-act="skip" data-k="${esc(k)}" data-l="${esc(it.name)}" aria-label="${v === 2 ? 'Undo skip' : 'Skip'} ${esc(it.name)}">${v === 2 ? '↺' : '✕'}</button>` : ''}
    ${!wu && trendOpen.has(slug(it.name)) ? trendChart(who, people, it) : ''}
    ${open ? altList(who, mine, base, it) : ''}
  </li>`;
}

/** The swap panel under a row: the plan item plus its free-weight alternatives, each with its demo video. */
function altList(who, mine, base, cur) {
  return `<ul class="alts">${[base.name, ...altsFor(base)].map(n => {
    const a = n === base.name ? base : plan.altInfo[n], on = n === cur.name, link = safeUrl(a.link);
    return `<li class="${on ? 'on' : ''}"><span class="a-main"><b>${esc(n)}</b><small>${n === base.name ? 'Plan · ' : ''}${esc(a.muscles || '')}</small>${a.note && n !== base.name ? `<small class="r-note">${esc(a.note)}</small>` : ''}</span>
      ${link ? `<a class="r-demo" href="${esc(link)}" target="_blank" rel="noopener" aria-label="Demo video: ${esc(n)}">▶${a.clip ? `<small>${esc(a.clip)}</small>` : ''}</a>` : ''}
      ${mine ? (on ? '<span class="a-use">Doing</span>' : `<button class="btn-ghost sm" data-act="useAlt" data-k="${esc(altKey(sel, base))}" data-v="${n === base.name ? '' : esc(n)}" data-l="${esc(n)}">Use</button>`) : on ? '<span class="a-use">Doing</span>' : ''}</li>`;
  }).join('')}</ul>`;
}

// Other people's files are untrusted: only finite numbers reach the markup.
const num = x => typeof x === 'number' && isFinite(x) ? x : 0;
/** Everyone else's weight for this exercise: on this day if logged, else their most recent before it. */
function kgVs(who, people, k, it) {
  if (k.includes('|wu:') || !lifts(it)) return '';
  const mine = num(val(who, kgKey(sel, it))) || S.lastKg(who.checks, sel, slug(it.name))?.kg || 0;
  const vs = people.filter(p => p.id !== who.id).map(p => [p, S.lastKg(p.checks, addDays(sel, 1), slug(it.name))]).filter(([, l]) => l);
  if (!vs.length) return '';
  return `<span class="r-vs">${vs.map(([p, l]) => `<span style="--c:${col(p.color)}" title="${esc(p.name)}">${avatar(p, 'xs')}<b>${mine && l.kg > mine ? '▲' : ''}${l.kg}</b>kg${l.date !== sel ? `<small>${fmt(l.date, { day: 'numeric', month: 'short' })}</small>` : ''}</span>`).join('')}</span>`;
}

const TREND_MAX = 12;   // points per person; older logs scroll off the left
const trendSeries = (who, people, it) => [who, ...people.filter(p => p.id !== who.id)]
  .map(p => ({ p, pts: S.kgHistory(p.checks, slug(it.name), sel).slice(-TREND_MAX) })).filter(s => s.pts.length);
const hasTrend = (who, people, it) => trendSeries(who, people, it).some(s => s.pts.length >= 2);

/** Weight over time for one exercise: one line per person in their colour, dates on a shared axis. */
function trendChart(who, people, it) {
  const series = trendSeries(who, people, it);
  const dates = [...new Set(series.flatMap(s => s.pts.map(p => p.date)))].sort();
  const kgs = series.flatMap(s => s.pts.map(p => p.kg));
  let lo = Math.min(...kgs), hi = Math.max(...kgs);
  if (hi - lo < 5) { const mid = (hi + lo) / 2; lo = Math.max(0, mid - 2.5); hi = lo + 5; }   // flat lines still get a readable scale
  const W = 300, H = 110, L = 34, R = 44, T = 10, B = 20;
  const t0 = +fromIso(dates[0]), span = Math.max(1, +fromIso(dates.at(-1)) - t0);
  const x = d => dates.length < 2 ? (L + W - R) / 2 : L + (W - L - R) * (+fromIso(d) - t0) / span;
  const y = kg => T + (H - T - B) * (1 - (kg - lo) / (hi - lo));
  const kgTxt = n => String(Math.round(n * 10) / 10);
  const grid = [lo, (lo + hi) / 2, hi].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${kgTxt(v)}</text>`).join('');
  const ends = [dates[0], dates.at(-1)].filter((d, i, a) => a.indexOf(d) === i)
    .map((d, i, a) => `<text x="${x(d)}" y="${H - 5}" text-anchor="${a.length < 2 ? 'middle' : i ? 'end' : 'start'}">${fmt(d, { day: 'numeric', month: 'short' })}</text>`).join('');
  const labelY = series.map(s => y(s.pts.at(-1).kg) + 4);
  [...labelY.keys()].sort((a, b) => labelY[a] - labelY[b]).forEach((i, n, order) => { if (n && labelY[i] - labelY[order[n - 1]] < 11) labelY[i] = labelY[order[n - 1]] + 11; });
  const lines = series.map(({ p, pts }, si) => `<g style="--c:${col(p.color)}">
    ${pts.length > 1 ? `<polyline points="${pts.map(q => `${x(q.date)},${y(q.kg)}`).join(' ')}"/>` : ''}
    ${pts.map(q => `<circle cx="${x(q.date)}" cy="${y(q.kg)}" r="4"><title>${esc(p.name)} · ${fmt(q.date, { day: 'numeric', month: 'short' })} · ${q.kg} kg</title></circle>`).join('')}
    <text class="end" x="${W - R + 8}" y="${labelY[si]}">${pts.at(-1).kg}</text></g>`).join('');
  return `<div class="trend" role="img" aria-label="${esc(it.name)} weight trend: ${series.map(({ p, pts }) => `${esc(p.name)} ${pts.map(q => q.kg).join(', ')} kg`).join('; ')}">
    ${series.length > 1 ? `<div class="t-legend">${series.map(({ p }) => `<span style="--c:${col(p.color)}">${esc(p.name)}</span>`).join('')}</div>` : ''}
    <svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><g class="t-grid">${grid}${ends}</g>${lines}</svg>
    <table class="sr-only"><tr><th>Date</th>${series.map(({ p }) => `<th>${esc(p.name)}</th>`).join('')}</tr>${dates.map(d => `<tr><td>${d}</td>${series.map(({ pts }) => `<td>${pts.find(q => q.date === d)?.kg ?? ''}</td>`).join('')}</tr>`).join('')}</table>
  </div>`;
}

function kgBox(who, mine, k, it) {
  if (k.includes('|wu:') || !lifts(it)) return '';   // warm-up rows share row() but aren't lifts
  const cur = num(val(who, kgKey(sel, it))), last = S.lastKg(who.checks, sel, slug(it.name));
  if (!mine && !cur && !hasTrend(who, crew(), it)) return '';
  return `<span class="r-kg ${cur && last && cur > last.kg ? 'up' : ''}"><input type="text" inputmode="decimal" enterkeyhint="done" maxlength="6"
    data-kg="${esc(kgKey(sel, it))}" data-l="${esc(it.name)}" value="${cur || ''}" placeholder="${last ? last.kg : 'kg'}" ${mine ? '' : 'disabled'}
    aria-label="Weight in kg for ${esc(it.name)}${last ? `, last time ${last.kg}` : ''}">${hasTrend(who, crew(), it)
    ? `<button class="r-trend" data-act="trend" data-s="${esc(slug(it.name))}" aria-expanded="${trendOpen.has(slug(it.name))}" aria-label="Weight trend for ${esc(it.name)}">${last ? `last ${last.kg}` : 'trend'} ${trendOpen.has(slug(it.name)) ? '▴' : '▾'}</button>`
    : last ? `<small>last ${last.kg}</small>` : ''}</span>`;
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
        const mark = d >= plan.race.date && d <= plan.race.end ? 'race' : plan.countdowns.some(c => (c.goal ? goalDate(who, c) : c.date) === d) ? 'event' : '';
        return `<button class="cal-cell ${other ? 'other' : ''} ${!st ? 'rest' : st.s.optional ? 'opt' : 'gym'} ${st?.pct === 100 ? 'done' : ''} ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''} ${mark}" data-act="sel" data-date="${d}" aria-label="${fmt(d)}${st ? ', ' + st.pct + '%' : ''}">
          <span>${fromIso(d).getDate()}</span>${st?.pct === 100 ? '<i>💪</i>' : st?.pct ? `<small>${st.pct}%</small>` : ''}</button>`;
      }).join('')}</div>
    <div class="legend"><span class="gym">Gym</span><span class="opt">Optional</span><span class="done">Done</span><span class="race">Race / goal</span></div>
    <p class="cal-sum"><b>${doneDays}</b> of ${gymDays.length} gym days done this month</p>
  </section>`;
}

// Anytime Fitness clubs with kit most clubs don't have (plan.clubs). Per-person checks, synced like ticks:
// `club:<id>` been here, `fav:<id>` favourite, `clubnote:<id>` remark, `clubsize:<id>` size vote, `<date>|crowd:<id>` 6–8 pm headcount,
// `kit:<id>:<slug>` {v: 1 has it / 2 doesn't, name} equipment edit: the latest edit by anyone wins over plan.json.
const clubKey = c => `club:${c.id}`, noteKey = c => `clubnote:${c.id}`, favKey = c => `fav:${c.id}`, sizeKey = c => `clubsize:${c.id}`;
const note = (p, c) => { const v = p?.checks?.[noteKey(c)]?.v; return typeof v === 'string' ? v : ''; };   // synced files are untrusted
const SIZES = { S: 'Small', M: 'Medium', L: 'Large' };   // small < 3,000 sq ft, medium 3,000–5,999, large 6,000+ (a typical club is 2,000–4,000)
const PEAK_DAYS = 90;   // headcounts older than this drop out of the average
const mapUrl = c => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Anytime Fitness ${c.name}, ${c.addr}, Singapore`)}`;
const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>';
/** Size: the club's own figure if known, else the crew's most common vote. */
function clubSize(c, people) {
  if (c.size) return { s: c.size, src: c.sizeSrc };
  const votes = people.map(p => p.checks?.[sizeKey(c)]?.v).filter(v => Object.hasOwn(SIZES, v));
  if (!votes.length) return null;
  const n = k => votes.filter(v => v === k).length, [s, s2] = Object.keys(SIZES).sort((a, b) => n(b) - n(a));
  if (n(s) === n(s2)) return { s: '', src: `crew split: ${Object.keys(SIZES).filter(n).map(k => `${n(k)} ${SIZES[k]}`).join(', ')}` };   // a tie isn't an answer
  return { s, src: `crew vote (${votes.length})` };
}
/** Average 6–8 pm headcount per club across everyone's logs from the last PEAK_DAYS days. One pass over all checks, not one per club. */
function peaks(people) {
  const from = addDays(todayIso(), -PEAK_DAYS), xs = new Map();   // Map, not {}: ids come from other people's files ("__proto__")
  for (const p of people) for (const [k, e] of Object.entries(p.checks || {})) {
    const id = k.startsWith('|crowd:', 10) && k.slice(17);
    if (id && k.slice(0, 10) >= from && Number.isInteger(e.v) && e.v > 0 && e.v < 500) xs.set(id, [...(xs.get(id) || []), e.v]);
  }
  return id => { const v = xs.get(id); return v ? { avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length), n: v.length } : null; };
}
const KIT_IDEAS = ['Ice bath', 'Sauna', 'Cold plunge', 'Punching bag', 'Rope pull machine', 'Sled', 'SkiErg', 'Wall balls', 'Air bike', 'Curved treadmill', 'Watt bike', 'Lifting platform', 'Belt squat', 'Hack squat', 'Glute machine', 'T-bar row'];
const kitName = n => typeof n === 'string' ? n.trim().replace(/\s+/g, ' ').slice(0, 30) : '';
/** Equipment per club: plan.json's list, then every crew edit, newest edit per item winning. One pass over all checks. */
function kits(people) {
  const edits = new Map();   // clubId -> Map(slug -> latest {v, name, t, by}). Maps, not {}: keys come from other people's files ("__proto__")
  for (const p of people) for (const [k, e] of Object.entries(p.checks || {})) {
    if (!k.startsWith('kit:') || (e.v !== 1 && e.v !== 2) || !kitName(e.name)) continue;
    const [, id, sl] = k.split(':');
    if (!sl) continue;
    if (!edits.has(id)) edits.set(id, new Map());
    const cur = edits.get(id).get(sl);
    if (!cur || (e.t || 0) > cur.t) edits.get(id).set(sl, { v: e.v, name: kitName(e.name), t: e.t || 0, by: p.name });
  }
  return c => {
    const out = new Map(c.kit.map(n => [slug(n), { name: n, on: true }]));
    for (const [sl, e] of edits.get(c.id) || []) out.set(sl, { name: out.get(sl)?.name || e.name, on: e.v === 1, by: e.by, crew: !c.kit.some(n => slug(n) === sl) });
    return [...out.entries()].map(([sl, k]) => ({ ...k, sl }));   // includes items marked "not here" (on: false) for the edit panel
  };
}
const clubText = (c, kit) => `${c.name} ${c.addr} ${kit.join(' ')}`.toLowerCase();
const clubHit = (c, kit) => clubQ.trim().toLowerCase().split(/\s+/).every(w => clubText(c, kit).includes(w));   // every word must match somewhere
function clubsTab(me, who, people) {
  const been = c => people.filter(p => val(p, clubKey(c)) === 1);
  const kitAll = kits(people), kitMemo = new Map();
  const kitOf = c => kitMemo.get(c.id) || kitMemo.set(c.id, kitAll(c)).get(c.id);
  const kit = c => kitOf(c).filter(k => k.on).map(k => k.name);
  const kitNames = [...new Set(plan.clubs.flatMap(kit))].sort();
  const fav = c => val(who, favKey(c)) === 1;
  const list = plan.clubs.filter(c => clubFilter === 'all' ? true : clubFilter === 'fav' ? fav(c) : clubFilter === 'special' ? kit(c).length > 0 : clubFilter === 'todo' ? !val(who, clubKey(c)) : clubFilter === 'done' ? val(who, clubKey(c)) === 1
    : Object.hasOwn(SIZES, clubFilter) ? clubSize(c, people)?.s === clubFilter : kit(c).includes(clubFilter))
    .sort((a, b) => fav(b) - fav(a));   // favourites first; otherwise plan order
  const mine = who.id === me.id, n = plan.clubs.filter(c => val(who, clubKey(c)) === 1).length, today = todayIso(), peak = peaks(people);
  return `${banners(me, who, mine)}<section class="card reveal">
    <div class="kicker">Anytime Fitness · Singapore</div>
    <h2>Anytime <span class="grad">clubs</span></h2>
    <p class="note">Every Anytime Fitness club in Singapore. Special kit is listed where known: check with the club before a special trip. ${esc(who.name)} has been to <b>${n}</b> of ${plan.clubs.length}. Peak crowd is the crew's own 6–8 pm headcounts.</p>
    <input type="search" class="c-search" data-act="csearch" value="${esc(clubQ)}" placeholder="Search clubs, areas, postcodes or kit" aria-label="Search clubs" enterkeyhint="search" autocomplete="off">
    <div class="c-filters">${[['all', 'All'], ['fav', '★ Favs'], ['todo', 'Not been'], ['done', 'Been']].map(([f, t]) =>
      `<button class="btn-ghost sm ${clubFilter === f ? 'on' : ''}" data-act="cfilter" data-f="${f}">${t}</button>`).join('')}
      <select data-act="ckit" aria-label="Filter by size or equipment"><option value="all">Any size or equipment</option><option value="special" ${clubFilter === 'special' ? 'selected' : ''}>Any special kit</option>
        <optgroup label="Size">${Object.entries(SIZES).map(([k, t]) => `<option value="${k}" ${clubFilter === k ? 'selected' : ''}>${t}</option>`).join('')}</optgroup>
        <optgroup label="Equipment">${kitNames.map(k => `<option ${clubFilter === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</optgroup></select></div>
    <ul class="clubs">${list.map(c => {
      const ps = been(c), on = val(who, clubKey(c)) === 1, f = fav(c), sz = clubSize(c, people), pk = peak(c.id);
      const myVote = me.checks?.[sizeKey(c)]?.v, crowdK = `${today}|crowd:${c.id}`, myCrowd = num(val(me, crowdK));
      return `<li class="club ${on ? 'visited' : ''} ${f ? 'fav' : ''}" data-q="${esc(clubText(c, kit(c)))}" ${clubHit(c, kit(c)) ? '' : 'hidden'}>
      <h3>${mine ? `<button class="star ${f ? 'on' : ''}" data-act="fav" data-k="${esc(favKey(c))}" data-l="${esc(c.name)}" aria-pressed="${f}" aria-label="${f ? 'Remove' : 'Add'} ${esc(c.name)} ${f ? 'from' : 'to'} favourites">${f ? '★' : '☆'}</button>` : f ? '<span class="star on">★</span>' : ''}${esc(c.name)}${c.home ? '<small>HOME GYM</small>' : ''}${c.soon ? '<small>OPENING SOON</small>' : ''}</h3>
      <div class="addr"><a class="pin" href="${mapUrl(c)}" target="_blank" rel="noopener" aria-label="Open ${esc(c.name)} in Google Maps">${PIN}</a><a href="${mapUrl(c)}" target="_blank" rel="noopener">${esc(c.addr)}</a></div>
      <div class="been">${mine ? `<button class="visit ${on ? 'on' : ''}" data-act="club" data-k="${esc(clubKey(c))}" data-l="${esc(c.name)}" aria-pressed="${on}">${on ? '✓ Been' : 'Been here?'}</button>` : `<span class="visit ${on ? 'on' : ''}">${on ? '✓ Been' : 'Not yet'}</span>`}
        ${ps.length ? `<span class="who">${ps.map(p => avatar(p, 'xs')).join('')}</span>` : ''}</div>
      <div class="c-stats"><span class="sz ${sz?.s ? 'sz-' + sz.s : ''}" title="${sz ? esc(sz.src) : 'Size unknown'}">${sz?.s ? `${SIZES[sz.s]}${c.sqft ? ` · ${c.sqft.toLocaleString('en-GB')} sq ft` : ''}` : sz ? 'Size split' : 'Size ?'}</span>
        <span class="pk">${pk ? `≈ <b>${pk.avg}</b> people at 6–8 pm <small>${pk.n} log${pk.n > 1 ? 's' : ''}</small>` : '6–8 pm crowd: no counts yet'}</span></div>
      <div class="kit">${kitOf(c).filter(k => k.on).map(k => `<span class="${clubFilter === k.name ? 'hot' : ''} ${k.crew ? 'crew' : ''}" ${k.by ? `title="${k.crew ? 'Added' : 'Confirmed'} by ${esc(k.by)}"` : ''}>${esc(k.name)}</span>`).join('') || '<span>Standard kit</span>'}</div>
      ${c.src || kitOf(c).some(k => k.by) ? `<div class="src">${esc(c.src || 'Crew')}${sz ? ` · size: ${esc(sz.src)}` : ''}${kitOf(c).some(k => k.by) ? ` · kit edited by ${esc([...new Set(kitOf(c).filter(k => k.by).map(k => k.by))].join(', '))}` : ''}</div>` : ''}
      ${people.filter(p => note(p, c) && !(mine && p.id === me.id)).map(p => `<p class="remark">${avatar(p, 'xs')}<span><b>${esc(p.name)}</b> ${esc(note(p, c))}</span></p>`).join('')}
      ${mine ? `<details class="c-more" data-keep="club-${esc(c.id)}"><summary>Edit club: equipment, remark, crowd${c.size ? '' : ', size'}</summary>
        <div class="kit-edit"><span>Equipment <small>tap to mark here / not here</small></span>
          ${kitOf(c).map(k => `<button class="btn-ghost sm ${k.on ? 'on' : 'off'}" data-act="kit" data-k="kit:${esc(c.id)}:${esc(k.sl)}" data-v="${k.on ? 2 : 1}" data-n="${esc(k.name)}" data-l="${esc(c.name)}" aria-pressed="${k.on}">${k.on ? '✓' : '✕'} ${esc(k.name)}</button>`).join('')}
          <input type="text" class="kit-add" data-kitadd="${esc(c.id)}" data-l="${esc(c.name)}" list="kit-ideas" maxlength="30" enterkeyhint="done" placeholder="+ Add equipment (e.g. Sauna)" aria-label="Add equipment at ${esc(c.name)}"></div>
        <input type="text" class="remark-in" data-cnote="${esc(noteKey(c))}" data-l="${esc(c.name)}" value="${esc(note(me, c))}" maxlength="140" enterkeyhint="done" placeholder="Remark (e.g. ice bath closed Mondays)" aria-label="Your remark on ${esc(c.name)}">
        <label class="crowd-in"><span>People here now, 6–8 pm</span><input type="text" inputmode="numeric" maxlength="3" enterkeyhint="done" data-crowd="${esc(crowdK)}" data-l="${esc(c.name)}" value="${myCrowd || ''}" placeholder="count" aria-label="Headcount at ${esc(c.name)} between 6 and 8 pm today"></label>
        ${c.size ? '' : `<div class="size-vote"><span>Size</span>${Object.entries(SIZES).map(([k, t]) => `<button class="btn-ghost sm ${myVote === k ? 'on' : ''}" data-act="csize" data-k="${esc(sizeKey(c))}" data-v="${k}" data-l="${esc(c.name)}">${t}</button>`).join('')}</div>`}
      </details>` : ''}
    </li>`; }).join('')}<li class="note c-none" ${list.some(c => clubHit(c, kit(c))) ? 'hidden' : ''}>No clubs match.</li></ul>
    <datalist id="kit-ideas">${[...new Set([...kitNames, ...KIT_IDEAS])].sort().map(k => `<option value="${esc(k)}">`).join('')}</datalist>
  </section>`;
}

function crewTab(me, people, who) {
  const owner = me.role === 'owner', st = S.status;
  return `<section class="card reveal crew">
    <h2>Crew <small>${guests().length}/${MAX_GUESTS} guests</small></h2>
    ${people.map(p => `<div class="member ${p.id === who.id ? 'sel' : ''}" style="--c:${col(p.color)}">
      <button class="m-open" data-act="view" data-id="${esc(p.id)}">
        <span class="dot ${online(p) ? 'on' : ''}" style="--c:${col(p.color)}">${avatar(p)}</span>
        <span class="m-name">${esc(p.name)}${p.id === me.id ? ' <small>(you)</small>' : ''}<small class="sub">${p.role === 'owner' ? 'Owner · ' : p.role === 'member' ? 'Crew · ' : ''}${online(p) ? 'online now' : 'seen ' + ago(p.seen)}</small></span>
        <span class="m-pct"><b>${weekPct(p, monday(todayIso()))}%</b><small>this week</small></span>
      </button>
      ${owner && p.role === 'guest' ? `<button class="r-skip" data-act="kick" data-id="${esc(p.id)}" aria-label="Free ${esc(p.name)}'s spot">✕</button>` : ''}
    </div>`).join('')}
  </section>
  <details class="card reveal rules" data-keep="rules"><summary><h3>Injury rules & goals</h3></summary>
    <ul>${plan.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    <div class="goals">${plan.goals.map(g => `<span>${esc(g)}</span>`).join('')}</div>
  </details>
  <details class="card reveal" data-keep="profile"><summary><h3>Your profile</h3></summary>
    <form data-form="profile" class="profile">
      ${me.role !== 'guest' ? '' : `<div class="heads small">${Object.entries(HEADS).map(([h, n]) => {
        const taken = guests().some(g => g.head === h && g.id !== me.id);
        return `<label class="${taken ? 'taken' : ''}"><input type="radio" name="head" value="${h}" ${h === me.head ? 'checked' : ''} ${taken ? 'disabled' : ''}><img src="heads/${h}.jpg" alt=""><span>${n}</span></label>`; }).join('')}</div>`}
      ${swatches(me.color, me.id)}
      <button class="btn">Save</button>
    </form>
  </details>
  <section class="card reveal settings">
    <p class="sync ${st.state}">${!S.hasToken() ? 'Preview · not synced' : st.state === 'error' ? '⚠ ' + esc(st.error) : st.state === 'saving' ? 'Saving…' : st.last ? 'Synced ' + ago(st.last) : 'Connecting…'}</p>
    ${installEvt ? '<button class="btn wide" data-act="install">Install app</button>' : /iphone|ipad/i.test(navigator.userAgent) && !navigator.standalone ? '<p class="hint">Install: Safari → Share → Add to Home Screen</p>' : ''}
    <button class="btn-ghost wide" data-act="switch">Switch person</button>
    ${me.role !== 'guest' ? '' : '<button class="btn-ghost wide" data-act="leave">Leave crew (frees your spot)</button>'}
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

$app.addEventListener('input', e => {
  if (e.target.dataset.act !== 'csearch') return;
  clubQ = e.target.value;
  const ws = clubQ.trim().toLowerCase().split(/\s+/);
  let any = false;
  for (const li of $app.querySelectorAll('.club')) { const hit = ws.every(w => li.dataset.q.includes(w)); li.hidden = !hit; any ||= hit; }
  $app.querySelector('.c-none')?.toggleAttribute('hidden', any);
});

$app.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.kg && !viewing) {
    const raw = t.value.trim().replace(',', '.'), kg = raw ? Math.round(+raw * 100) / 100 : 0;
    if (!(kg >= 0 && kg < 1000) || (kg === 0 && +raw !== 0)) {
      t.value = S.me()?.checks?.[t.dataset.kg]?.v || '';   // put back what's saved, not a blank that looks saved
      toast('Weight must be 0.01 to 999.99 kg'); return;
    }
    S.set({ [t.dataset.kg]: { v: kg } }, `${t.dataset.l} ${kg ? kg + ' kg' : 'weight cleared'} (${sel})`);
  } else if (t.dataset.k && !viewing) write({ [t.dataset.k]: { v: t.checked ? 1 : 0 } }, `${t.checked ? '✓' : '○'} ${t.dataset.l} (${sel})`, t.dataset.k);
  else if (t.dataset.act === 'goal' && !viewing && S.me()?.role !== 'owner') { if (!t.value || isIso(t.value)) { S.setProfile({ goal: t.value }); toast(t.value ? `Goal set: ${fmt(t.value, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Goal cleared'); } }
  else if (t.dataset.crowd && !viewing) {
    const raw = t.value.trim(), n = raw ? Number(raw) : 0;
    if (!Number.isInteger(n) || n < 0 || n > 499) { t.value = val(S.me(), t.dataset.crowd) || ''; toast('Headcount must be a whole number, 1 to 499'); return; }
    const h = new Date().getHours();
    S.set({ [t.dataset.crowd]: { v: n } }, `👥 ${n || 'cleared'} at ${t.dataset.l}`);
    toast(!n ? 'Headcount cleared' : h === 18 || h === 19 ? `Headcount ${n} saved` : `Saved ${n}. Counts are meant for 6–8 pm`);
  }
  else if (t.dataset.kitadd && !viewing) {
    const n = kitName(t.value);
    if (n) { S.set({ [`kit:${t.dataset.kitadd}:${slug(n)}`]: { v: 1, name: n } }, `+ ${n} at ${t.dataset.l}`); toast(`${n} added to ${t.dataset.l}`); }
    t.value = '';
  }
  else if (t.dataset.cnote && !viewing) { const v = t.value.trim().slice(0, 140); S.set({ [t.dataset.cnote]: { v } }, `${v ? '✎ remark on' : 'cleared remark on'} ${t.dataset.l}`); toast(v ? 'Remark saved' : 'Remark cleared'); }
  else if (t.dataset.act === 'ckit') { clubFilter = t.value; document.activeElement?.blur(); render(); }   // a focused search box would otherwise hold the render
  else if (t.dataset.act === 'session') write({ [`${sel}|session`]: { v: t.value } }, `${sel} → ${plan.sessions[t.value]?.title || 'Rest'}`);
});

$app.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (b?.dataset.act === 'goal') { try { b.showPicker(); } catch {} return; }
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
  else if (act === 'alt') { e.preventDefault(); const s = b.dataset.s; altOpen.has(s) ? altOpen.delete(s) : altOpen.add(s); render(); }
  else if (act === 'useAlt' && !viewing) { S.set({ [k]: { v: b.dataset.v } }, `⇄ ${b.dataset.l} (${sel})`); toast(b.dataset.v ? `Swapped to ${b.dataset.l}` : 'Back to the plan exercise'); }
  else if (act === 'club' && !viewing) { const v = val(S.me(), k) ? 0 : 1; S.set({ [k]: { v } }, `${v ? '📍 visited' : 'unvisited'} ${b.dataset.l}`); }
  else if (act === 'kit' && !viewing) { const v = +b.dataset.v; S.set({ [k]: { v, name: b.dataset.n } }, `${v === 1 ? '✓' : '✕'} ${b.dataset.n} at ${b.dataset.l}`); toast(`${b.dataset.n}: ${v === 1 ? 'here' : 'not here'}`); }
  else if (act === 'fav' && !viewing) { const v = val(S.me(), k) ? 0 : 1; S.set({ [k]: { v } }, `${v ? '★' : '☆'} ${b.dataset.l}`); }
  else if (act === 'csize' && !viewing) { const v = S.me()?.checks?.[k]?.v === b.dataset.v ? '' : b.dataset.v; S.set({ [k]: { v } }, `size ${v || 'vote cleared'}: ${b.dataset.l}`); }
  else if (act === 'cfilter') { clubFilter = b.dataset.f; render(); }
  else if (act === 'trend') { const s = b.dataset.s; trendOpen.has(s) ? trendOpen.delete(s) : trendOpen.add(s); render(); }
  else if (act === 'mfilter') { mm.filter = b.dataset.f; render(); }
  else if (act === 'mview') { mm.view = b.dataset.v; render(); }
  else if (act === 'asmember' && MEMBERS[b.dataset.id]) { err = ''; joinMode = b.dataset.id; render(); $app.querySelector('input[name=pin]')?.focus(); }
  else if (act === 'asguest') { joinMode = 'guest'; err = ''; render(); }
  else if (act === 'joinback') { joinMode = ''; err = ''; render(); }
  else if (act === 'claim') { const p = S.people[b.dataset.id]; err = ''; intro = true; S.join({ id: p.id, name: p.name, color: p.color, head: p.head, role: 'guest' }); }
  else if (act === 'kick') { const p = S.people[b.dataset.id]; if (p) { if (viewing === p.id) viewing = null; S.remove(p.id); toast(`${p.name}'s spot is free`); } }
  else if (act === 'switch') { viewing = null; joinMode = ''; tab = 'today'; await S.switchPerson(); }
  else if (act === 'leave') { const id = S.meId; viewing = null; joinMode = ''; tab = 'today'; await S.switchPerson(); await S.remove(id); }
  else if (act === 'sync') { if (!S.hasToken()) { preview = false; S.ls.set('preview', false); err = ''; render(); } else { S.poll(); toast(S.status.state === 'error' ? 'Retrying sync…' : 'Syncing…'); } }
  else if (act === 'sound') {
    clip?.pause();
    const a = clip = new Audio(`sounds/${b.dataset.f}.m4a`);
    a.onerror = () => toast('Clip failed to load');
    a.play().catch(() => {});
    setTimeout(() => a.pause(), 3000);
  }
  else if (act === 'install') { installEvt.prompt(); installEvt = null; render(); }
  else if (act === 'signout') { viewing = null; preview = false; S.ls.set('preview', false); S.signOut(); }
  else if (act === 'preview' || act === 'addkey') { preview = act === 'preview'; S.ls.set('preview', preview); err = ''; render(); }
});

// SVG muscles are role=button; give them the keyboard behaviour real buttons have.
$app.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.target.dataset.kg || e.target.dataset.cnote || e.target.dataset.crowd || e.target.dataset.kitadd || e.target.dataset.act === 'csearch')) e.target.blur(); if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('path[data-act]')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });

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
  } else if (form === 'member') {
    const id = joinMode;
    if (!MEMBERS[id] || await sha256(f.get('pin')) !== MEMBERS[id].pin) { err = 'Wrong PIN'; render(); return; }
    err = ''; joinMode = ''; intro = true;
    S.join(memberProfile(id));
  } else if (form === 'guest') {
    const head = f.get('head');
    if (!HEADS[head] || guests().length >= MAX_GUESTS || guests().some(g => g.head === head)) { err = 'That legend was just taken. Pick another.'; render(); return; }
    err = ''; intro = true;
    S.join({ name: HEADS[head], color: f.get('color') || COLORS[1], head, role: 'guest' });
  } else if (form === 'profile') {
    const head = f.get('head');
    const color = f.get('color') || S.me().color;   // a retired colour has no swatch to tick; keep it rather than saving none
    S.setProfile(head && HEADS[head] ? { head, name: HEADS[head], color } : { color });
    toast('Profile saved');
  } else if (form === 'bonus') {
    document.activeElement?.blur();
    const name = f.get('name').trim(), k = `${sel}|bonus:${S.uid()}`;
    if (name) write({ [k]: { v: 1, name, sets: f.get('sets').trim() } }, `+ bonus ${name} (${sel})`, k);
  }
});
$app.addEventListener('focusout', () => setTimeout(() => { if (deferred && !typing()) { deferred = false; render(); } }));

// Two guests joining at the same moment can each see 4/5 and both get in. Once the files sync, the later joiner steps back out.
let bumping = false;
async function overflow() {
  const me = S.me();
  if (bumping || !S.hasToken() || me?.role !== 'guest' || me.removed) return;
  const order = guests().sort((a, b) => (a.joined || 0) - (b.joined || 0) || (a.id < b.id ? -1 : 1));
  if (order.findIndex(g => g.id === me.id) < MAX_GUESTS) return;
  bumping = true; viewing = null; joinMode = 'guest'; tab = 'today';
  const id = me.id;
  await S.switchPerson(); await S.remove(id);
  err = 'Crew filled up just before you. Ask Mika to free a spot.'; bumping = false; render();
}
S.onChange(overflow);
S.onChange(() => { if (screen !== 'pass' && (screen !== 'gate' || S.hasToken())) render(); });  // never wipe a half-typed password or key
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (screen === 'main') render(); });

// Stay live while the page is open: pull everyone's ticks every 15 s, say "I'm here" every few minutes.
const tick = () => { if (!document.hidden && S.hasToken()) { S.poll(); S.heartbeat(); } };
setInterval(tick, 15e3);
let lastDay = todayIso();
const newDay = () => { if (todayIso() !== lastDay) { lastDay = sel = todayIso(); calMonth = sel.slice(0, 7); } };   // past midnight: jump to today
setInterval(() => { if (!document.hidden) { newDay(); render(); } }, 60e3);   // "seen 3 min ago" and online dots age even without new data
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return void S.save();
  newDay();
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
