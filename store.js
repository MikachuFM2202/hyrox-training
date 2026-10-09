// store.js — crew progress, synced through the GitHub contents API.
//
// Check keys are `<yyyy-mm-dd>|<item>`, so the checklist is per calendar day.
// Every person owns exactly one file on the `data` branch: people/<id>.json. Nobody ever writes
// someone else's file, so two people ticking boxes at the same moment can never conflict. The only
// clash is one person on two devices; that is resolved by merge() (newer timestamp wins per box).
// The data branch is not the Pages branch, so check-ins never trigger a site rebuild.

export const REPO = 'MikachuFM2202/hyrox-training';
const BRANCH = 'data';
const te = new TextEncoder(), td = new TextDecoder();

export const ls = {
  get(k, d) { try { const v = localStorage.getItem('hyrox.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hyrox.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('hyrox.' + k); } catch {} },
};
const b64 = s => { const b = te.encode(s); let o = ''; for (let i = 0; i < b.length; i += 0x8000) o += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(o); };
const unb64 = s => td.decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
export const uid = () => crypto.getRandomValues(new Uint32Array(2)).reduce((s, n) => s + n.toString(36), '');

let token = ls.get('token', '');
export let meId = ls.get('me', '');
export let people = ls.get('people', {});   // id -> doc, last known copy (paints instantly, works offline)
const shas = {};                            // id -> blob sha currently on the data branch
const listeners = new Set();
export const status = { state: 'idle', error: '', last: 0 };

export const onChange = fn => listeners.add(fn);
const emit = () => listeners.forEach(f => f());
const setStatus = (state, error = '') => { status.state = state; status.error = error; emit(); };
export const hasToken = () => !!token;
export const me = () => people[meId];

/** Merge two copies of the same person's file. Profile: newer `u` wins. Boxes: newer `t` wins per box. */
export function merge(a, b) {
  if (!a) return b; if (!b) return a;
  const [older, newer] = (a.u || 0) >= (b.u || 0) ? [b, a] : [a, b];
  const checks = { ...a.checks };
  for (const [k, v] of Object.entries(b.checks || {})) if (!checks[k] || v.t > checks[k].t) checks[k] = v;
  return { ...older, ...newer, seen: Math.max(a.seen || 0, b.seen || 0), checks };
}

/** Most recent weight logged for an exercise before `date`: checks keys look like `<date>|kg:<slug>`. */
export function lastKg(checks = {}, date, slug) {
  let best = null;
  for (const [k, c] of Object.entries(checks)) {
    const d = k.slice(0, 10);
    if (typeof c.v === 'number' && isFinite(c.v) && c.v > 0 && k.slice(10) === `|kg:${slug}` && d < date && (!best || d > best.date)) best = { date: d, kg: c.v };
  }
  return best;
}

async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path ? '/' + path : ''}`, {
    cache: 'no-store', ...opts,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...opts.headers },
  });
  if (!r.ok) { const e = new Error(`GitHub ${r.status}`); e.status = r.status; throw e; }
  return r.status === 204 ? null : r.json();
}
const errText = e => e.status === 401 ? 'Access key rejected or expired'
  : e.status === 403 ? 'Access key has no write access (or GitHub rate limit hit)'
  : e.status === 404 ? 'Repo not found for this key' : navigator.onLine ? e.message : 'Offline';

/** Check a pasted key works and can write, then make sure the data branch exists. */
export async function connect(key) {
  const prev = token; token = key.trim();
  try {
    const repo = await gh('');
    if (!repo.permissions?.push) { const e = new Error('This key can only read. It needs Contents: Read and write.'); e.status = 0; throw e; }
    try { await gh(`git/ref/heads/${BRANCH}`); }
    catch (e) {
      if (e.status !== 404) throw e;
      const main = await gh(`git/ref/heads/${repo.default_branch}`);
      await gh('git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: main.object.sha }) })
        .catch(e => { if (e.status !== 422) throw e; }); // 422 = someone else created it a moment ago
    }
  } catch (e) { token = prev; throw new Error(e.status === 0 ? e.message : errText(e)); }
  ls.set('token', token);
  await poll();
}

export function signOut() { token = ''; meId = ''; ['token', 'me'].forEach(ls.del); emit(); }

/** Fetch everyone's file. The directory listing gives blob shas; blobs are immutable, so only changed files are downloaded. */
let polling = null;
export function poll() {
  if (!token) return Promise.resolve();
  return polling ??= (async () => {
    try {
      let list = [];
      try { list = await gh(`contents/people?ref=${BRANCH}&_=${Date.now()}`); }
      catch (e) { if (e.status !== 404) throw e; }   // no one has joined yet
      let changed = false;
      for (const f of list.filter(f => f.name.endsWith('.json'))) {
        const id = f.name.slice(0, -5);
        if (shas[id] === f.sha) continue;
        const doc = JSON.parse(unb64((await gh(`git/blobs/${f.sha}`)).content));
        shas[id] = f.sha;
        const next = id === meId ? merge(people[id], doc) : doc;  // keep my unsynced ticks
        if (JSON.stringify(next) !== JSON.stringify(people[id])) { people[id] = next; changed = true; }
      }
      if (changed) ls.set('people', people);
      if (people[meId]?.removed) { meId = ''; ls.del('me'); dirty = false; ls.set('dirty', false); }   // Mika freed my guest spot
      status.last = Date.now();
      if (dirty) save(); else setStatus('ok');  // also retries a save that failed while offline
    } catch (e) {
      if (e.status === 401) { token = ''; ls.del('token'); }  // key rotated or expired: back to the key screen, profile kept
      setStatus('error', errText(e));
    }
    polling = null;
  })();
}

// ---- writing my own file ----------------------------------------------------
let dirty = ls.get('dirty', false), ver = 0, msgs = [], timer, saving = null;

function update(fn, msg) {
  const cur = people[meId];
  people[meId] = fn(structuredClone(cur));
  ls.set('people', people);
  dirty = true; ver++; ls.set('dirty', true);
  if (msg) msgs.push(msg);
  emit();
  clearTimeout(timer); timer = setTimeout(save, 800);
}

/** Become a person: { id?, name, color, head, role }. Mika always uses id "mika", so all of Mika's devices share one file. */
export function join(profile) {
  meId = profile.id || uid(); ls.set('me', meId);
  const now = Date.now();
  people[meId] = merge(people[meId], { ...profile, id: meId, removed: false, u: now, seen: now, checks: {} });
  update(d => d, `${profile.name} joined the crew`);
}
export const setProfile = fields => update(d => ({ ...d, ...fields, u: Date.now() }), `${people[meId].name} updated profile`);

/** Stop being this person on this device (saves first so no ticks are lost). */
export async function switchPerson() {
  clearTimeout(timer); await save();
  meId = ''; ls.del('me'); dirty = false; ls.set('dirty', false); emit();
}

/** Free a guest spot: marks the person's file removed (never deletes it, so a device mid-save can't resurrect it). */
export async function remove(id) {
  const t = Date.now();
  people[id] = { ...people[id], removed: true, u: t };
  ls.set('people', people); emit();
  if (!token) return;
  const path = `contents/people/${id}.json`;
  for (let attempt = 0; ; attempt++) {
    try {
      const cur = await gh(`${path}?ref=${BRANCH}&_=${Date.now()}`);
      const doc = merge(JSON.parse(unb64(cur.content)), people[id]);
      const r = await gh(path, { method: 'PUT', body: JSON.stringify({ message: `${doc.name} left the crew`, branch: BRANCH, sha: cur.sha, content: b64(JSON.stringify(doc, null, 1)) }) });
      shas[id] = r.content.sha; people[id] = doc; ls.set('people', people);
      return;
    } catch (e) {
      if (e.status === 404) return;                        // never synced: nothing to mark
      if (attempt < 3 && e.status === 409) continue;
      setStatus('error', errText(e)); return;
    }
  }
}
/** Set one or more checklist entries: {key: {v, ...extra}}. v: 0 open, 1 done, 2 skipped (or a session id for day swaps). */
export const set = (entries, label) => update(d => {
  const t = Date.now(), checks = { ...d.checks };
  for (const [k, val] of Object.entries(entries)) checks[k] = { ...val, t };
  return { ...d, seen: t, checks };
}, label && `${people[meId].name}: ${label}`);
/** Mark me as "here now". Called on open and every few minutes while the page is visible. */
export const heartbeat = () => { if (me() && Date.now() - (me().seen || 0) > 3 * 60e3) update(d => ({ ...d, seen: Date.now() })); };

export function save() {
  if (!token || !dirty || !meId) return Promise.resolve();
  return saving ??= (async () => {
    setStatus('saving');
    const v = ver;
    try {
      const path = `contents/people/${meId}.json`;
      for (let attempt = 0; ; attempt++) {
        const message = msgs.length ? msgs.at(-1) + (msgs.length > 1 ? ` (+${msgs.length - 1})` : '') : `${me().name} checked in`;
        const sent = msgs.length;
        try {
          const r = await gh(path, { method: 'PUT', body: JSON.stringify({ message, branch: BRANCH, sha: shas[meId], content: b64(JSON.stringify(people[meId], null, 1)) }) });
          shas[meId] = r.content.sha;
          msgs.splice(0, sent);
          break;
        } catch (e) {
          // 409/422: my other device wrote first (or I don't know the sha yet). Re-read, merge, retry.
          if (attempt >= 3 || ![409, 422].includes(e.status)) throw e;
          try {
            const cur = await gh(`${path}?ref=${BRANCH}&_=${Date.now()}`);
            shas[meId] = cur.sha;
            people[meId] = merge(people[meId], JSON.parse(unb64(cur.content)));
          } catch (e2) { if (e2.status !== 404) throw e2; delete shas[meId]; }
        }
      }
      dirty = ver !== v; ls.set('dirty', dirty); ls.set('people', people);
      status.last = Date.now();
      setStatus('ok');
    } catch (e) { setStatus('error', errText(e)); }
    saving = null;
    if (dirty && status.state === 'ok') save();  // ticks made while the request was in flight
  })();
}
