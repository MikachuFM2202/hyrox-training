// muscles.js — interactive front/back muscle map built from the exercise "muscles" text in plan.json.
// Colours: orange = primary target, blue = secondary, green = core / rehab, dark = not trained.

export const MUSCLES = {
  chest:      { name: 'Chest',      sub: 'Pectoralis major & minor',        view: 'front' },
  shoulders:  { name: 'Shoulders',  sub: 'Front & side deltoids',           view: 'front' },
  reardelts:  { name: 'Rear Delts', sub: 'Posterior deltoid',               view: 'back' },
  traps:      { name: 'Traps',      sub: 'Trapezius & rhomboids',           view: 'back' },
  lats:       { name: 'Lats',       sub: 'Latissimus dorsi & teres major',  view: 'back' },
  biceps:     { name: 'Biceps',     sub: 'Biceps & brachialis',             view: 'front' },
  triceps:    { name: 'Triceps',    sub: 'Triceps brachii, all 3 heads',    view: 'back' },
  forearms:   { name: 'Forearms',   sub: 'Flexors & extensors',             view: 'front' },
  abs:        { name: 'Abs',        sub: 'Rectus abdominis & deep core',    view: 'front' },
  obliques:   { name: 'Obliques',   sub: 'Internal & external obliques',    view: 'front' },
  quads:      { name: 'Quads',      sub: 'Quadriceps, VMO & hip flexors',   view: 'front' },
  hamstrings: { name: 'Hamstrings', sub: 'Biceps femoris & co.',            view: 'back' },
  glutes:     { name: 'Glutes',     sub: 'Gluteus max, med & min',          view: 'back' },
  adductors:  { name: 'Adductors',  sub: 'Inner thigh',                     view: 'front' },
  calves:     { name: 'Calves',     sub: 'Gastrocnemius, soleus & Achilles', view: 'back' },
};
const CORE = new Set(['abs', 'obliques']);

// Muscle words used in plan.json -> map group. First match wins, so specific words come first.
const WORDS = [
  [/rear delt|posterior/i, 'reardelts'], [/delt|shoulder|supraspinatus|medial/i, 'shoulders'],
  [/pec|chest/i, 'chest'], [/trap|rhomboid/i, 'traps'], [/lat|teres|back/i, 'lats'],
  [/tricep/i, 'triceps'], [/forearm/i, 'forearms'], [/bicep|brachialis|arms/i, 'biceps'],
  [/oblique/i, 'obliques'], [/abs|abdomin|core/i, 'abs'],
  [/quad|vmo|hip flexor|knee stabil/i, 'quads'], [/hamstring/i, 'hamstrings'],
  [/glute|outer thigh/i, 'glutes'], [/adductor|inner thigh/i, 'adductors'], [/calf|calves|achilles/i, 'calves'],
];
export function groupsOf(muscles = '') {
  const out = [];
  for (const part of muscles.split(/,|\+/)) {
    const hit = WORDS.find(([re]) => re.test(part));
    if (hit && !out.includes(hit[1])) out.push(hit[1]);
  }
  return out;  // out[0] is the primary target
}

/** Which muscles the chosen session(s) hit, and by which exercises. */
export function analyse(plan, filter) {
  const ids = filter === 'all' ? Object.keys(plan.sessions) : [filter];
  const hits = {};
  for (const id of ids) for (const sec of plan.sessions[id].sections) for (const it of sec.items) {
    groupsOf(it.muscles).forEach((g, i) => {
      const h = hits[g] ??= { pri: [], sec: [], rehab: false };
      const list = i === 0 ? h.pri : h.sec;
      if (!list.some(e => e.name === it.name)) list.push({ name: it.name, sets: it.sets || '', session: id });
      if (plan.sessions[id].optional) h.rehab = true;
    });
  }
  const tone = g => { const h = hits[g]; return 't-' + (!h ? 'off' : CORE.has(g) || (h.rehab && filter !== 'all') ? 'core' : h.pri.length ? 'pri' : 'sec'); };
  return { hits, tone };
}

// Left half of the figure (viewer's left). The right half is the same shape mirrored.
const BODY = 'M100,54 L92,56 L76,64 C60,66 52,78 53,94 L51,146 L47,196 L52,214 L62,202 L68,150 L72,112 L74,176 L76,186 C71,222 72,258 78,288 C74,320 76,350 81,376 L79,398 L97,399 L97,372 C99,340 99,310 97,288 C100,260 100,230 100,200 Z';
const PATHS = {
  front: {
    traps: 'M92,57 L77,66 L91,67 Z',
    shoulders: 'M77,67 C63,68 55,77 56,91 C56,99 59,104 63,106 L73,89 L80,74 Z',
    chest: 'M98,72 L81,72 C74,77 71,89 73,100 C81,108 92,108 98,104 Z',
    biceps: 'M59,106 C55,118 55,132 58,142 L68,142 C72,130 72,117 69,106 Z',
    forearms: 'M57,146 C53,160 51,178 53,193 L60,193 C65,178 67,160 68,146 Z',
    abs: 'M88,109 L99,109 L99,176 L90,176 C86,160 86,125 88,109 Z',
    obliques: 'M86,110 L75,105 C71,125 73,150 79,172 L88,176 C84,156 84,128 86,110 Z',
    quads: 'M80,190 C74,214 74,250 80,278 L94,278 C98,250 98,216 95,193 Z',
    adductors: 'M96,194 L99,198 L99,248 C97,250 95,246 95,238 C96,222 97,208 96,194 Z',
    calves: 'M81,292 C77,318 79,348 84,370 L92,370 C96,348 96,318 94,292 Z',
  },
  back: {
    traps: 'M99,56 L88,62 L75,71 L86,78 L99,106 Z',
    reardelts: 'M75,70 C63,72 56,82 58,94 L70,91 L79,78 Z',
    lats: 'M98,108 L85,82 C77,92 73,110 75,128 C83,142 92,150 98,156 Z',
    triceps: 'M59,100 C55,114 55,130 58,140 L68,140 C70,126 70,112 68,100 Z',
    forearms: 'M57,144 C53,158 51,176 53,192 L60,192 C65,176 67,158 68,144 Z',
    glutes: 'M99,180 L84,176 C76,186 76,204 82,214 C90,220 97,218 99,214 Z',
    hamstrings: 'M81,220 C77,240 78,262 82,280 L96,280 C98,262 98,240 98,222 Z',
    calves: 'M81,292 C75,310 77,334 82,350 C86,356 92,356 94,350 C98,334 98,310 94,292 Z',
  },
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const reps = s => +(/^(\d+)\s*×/.exec(s)?.[1] || 0);

export function muscleMap(plan, { view, filter, muscle }) {
  const { hits, tone } = analyse(plan, filter);
  const half = Object.entries(PATHS[view]).map(([g, d]) =>
    `<path d="${d}" class="m ${tone(g)} ${g === muscle ? 'act' : ''}" data-act="muscle" data-m="${g}" tabindex="0" role="button" aria-label="${MUSCLES[g].name}"><title>${MUSCLES[g].name}</title></path>`).join('');
  const tabs = [['all', 'All'], ...plan.schedule.map((id, i) => [id, DAYS[i]]).filter(([id]) => plan.sessions[id])];
  const h = hits[muscle] || { pri: [], sec: [] }, m = MUSCLES[muscle];
  const all = [...h.pri, ...h.sec];
  const chip = (e, cls) => `<span class="chip ${cls}">${esc(e.name)}<small>${esc(e.sets)}${filter === 'all' ? ` · ${DAYS[plan.schedule.indexOf(e.session)] || ''}` : ''}</small></span>`;

  return `<section class="card mmap reveal" id="muscles">
    <header class="mm-head"><h3>Muscle map</h3>
      <div class="seg" role="tablist" aria-label="Filter by day">${tabs.map(([id, t]) =>
        `<button role="tab" aria-selected="${id === filter}" class="${id === filter ? 'on' : ''}" data-act="mfilter" data-f="${id}">${t}</button>`).join('')}</div>
    </header>
    <div class="mm-body">
      <div class="mm-figure">
        <div class="seg small">${['front', 'back'].map(v => `<button class="${v === view ? 'on' : ''}" data-act="mview" data-v="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>
        <svg viewBox="40 0 120 410" class="body" aria-label="${view} body view">
          <defs>
            <radialGradient id="mg-pri" cx="40%" cy="35%"><stop offset="0" stop-color="#ffb347"/><stop offset=".55" stop-color="#ff6b2b"/><stop offset="1" stop-color="#c2271c"/></radialGradient>
            <radialGradient id="mg-sec" cx="40%" cy="35%"><stop offset="0" stop-color="#9fd0ff"/><stop offset="1" stop-color="#2f6fd6"/></radialGradient>
            <radialGradient id="mg-core" cx="40%" cy="35%"><stop offset="0" stop-color="#8ff0b6"/><stop offset="1" stop-color="#1e9e57"/></radialGradient>
            <radialGradient id="mg-skin" cx="50%" cy="30%"><stop offset="0" stop-color="#2a2a2a"/><stop offset="1" stop-color="#151515"/></radialGradient>
          </defs>
          <g class="sil"><ellipse cx="100" cy="31" rx="17" ry="21"/><path d="${BODY}"/><path d="${BODY}" transform="matrix(-1 0 0 1 200 0)"/></g>
          <g>${half}</g><g transform="matrix(-1 0 0 1 200 0)">${half}</g>
        </svg>
        <div class="legend mm-legend"><span class="t-pri">Primary</span><span class="t-sec">Secondary</span><span class="t-core">Core / rehab</span><span class="t-off">Rest</span></div>
      </div>
      <div class="mm-info">
        <div class="kicker">${m.view === 'front' ? 'Front' : 'Back'} · ${esc(m.sub)}</div>
        <h2 class="mm-name ${tone(muscle)}">${esc(m.name)}</h2>
        <div class="mm-stats">
          <div><b>${all.length}</b><span>exercises</span></div>
          <div><b>${all.reduce((n, e) => n + reps(e.sets), 0)}</b><span>sets listed</span></div>
          <div><b>${h.pri.length}</b><span>as primary</span></div>
        </div>
        ${all.length ? `<div class="chips">${h.pri.map(e => chip(e, 't-pri')).join('')}${h.sec.map(e => chip(e, 't-sec')).join('')}</div>`
          : '<p class="note">Not trained in this filter. Rest muscle.</p>'}
        <div class="mm-list">${Object.entries(MUSCLES).map(([g, mm]) =>
          `<button class="${tone(g)} ${g === muscle ? 'act' : ''}" data-act="muscle" data-m="${g}">${mm.name}</button>`).join('')}</div>
      </div>
    </div>
  </section>`;
}
