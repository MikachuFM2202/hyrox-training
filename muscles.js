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
  hipflexors: { name: 'Hip Flexors', sub: 'Iliopsoas, sartorius & TFL',    view: 'front' },
  quads:      { name: 'Quads',      sub: 'Quadriceps & VMO',                view: 'front' },
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
  [/hip flexor/i, 'hipflexors'], [/quad|vmo|knee stabil/i, 'quads'], [/hamstring/i, 'hamstrings'],
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

// Shapes traced from innerbody.com's front/back muscular system maps (innerbody.com/image/musfov.html),
// in that image's 1400x1916 pixel space. Left half of the figure (viewer's left); the right half is mirrored.
const BODY = 'M700,250 L656,256 L652,332 C612,342 566,348 536,362 C506,376 492,410 493,460 L490,600 L486,700 L470,820 L452,935 L420,960 L405,1030 L430,1110 L470,1100 L500,1020 L505,940 L522,830 L540,720 L548,600 L550,505 L578,482 L580,600 L566,750 L548,830 L530,900 L525,1000 L540,1150 L562,1290 L560,1400 L568,1520 L585,1680 L588,1760 L565,1830 L600,1852 L680,1848 L652,1760 L648,1650 L668,1500 L662,1320 L670,1150 L688,950 L700,932 Z';
const PATHS = {
  front: {
    traps: 'M655,295 L650,338 L572,352 C604,336 632,318 655,295 Z',
    shoulders: 'M574,356 C540,352 506,370 497,410 C492,446 500,480 515,500 C530,470 546,440 560,412 L578,388 Z',
    chest: 'M695,365 L640,358 C606,360 582,374 574,394 L566,430 C578,470 600,520 640,545 C670,550 690,536 695,526 Z',
    biceps: 'M520,482 C505,530 505,610 515,690 L545,690 C552,620 552,540 548,482 Z',
    forearms: 'M498,702 C480,760 470,840 470,925 L500,925 C515,860 535,780 545,710 Z',
    abs: 'M698,540 L656,545 C646,610 646,720 656,820 C670,850 688,862 698,862 Z',
    obliques: 'M648,552 C622,544 600,534 582,526 C576,600 571,700 576,770 C600,800 628,818 650,828 C641,720 640,620 648,552 Z',
    hipflexors: 'M596,846 C615,880 648,908 686,922 L672,962 C640,956 610,934 588,902 Z',
    quads: 'M562,880 C542,950 536,1060 548,1170 C560,1240 585,1275 610,1280 L650,1275 C664,1200 666,1090 652,968 C626,950 600,920 584,900 Z',
    adductors: 'M688,928 L676,966 C658,1000 652,1060 662,1165 C674,1090 684,1000 688,928 Z',
    calves: 'M640,1350 C668,1400 676,1480 668,1560 C661,1620 652,1648 646,1660 C630,1580 628,1450 640,1350 Z',
  },
  back: {
    traps: 'M698,250 L660,266 C640,310 600,336 560,350 L592,376 C620,392 640,420 652,452 C666,520 684,580 698,616 Z',
    reardelts: 'M586,366 C546,356 506,370 497,410 C492,450 500,480 512,496 C530,466 556,432 592,402 Z',
    lats: 'M592,442 C576,470 576,520 582,580 C586,640 590,700 600,750 C630,762 660,742 690,722 L672,642 C656,560 642,482 616,452 Z',
    triceps: 'M505,472 C495,540 495,620 505,700 L545,700 C552,620 550,530 546,472 Z',
    forearms: 'M500,712 C482,770 472,850 472,925 L502,925 C515,860 532,780 545,716 Z',
    glutes: 'M690,830 C670,800 630,780 590,790 C560,806 545,850 545,900 C548,950 565,990 600,1000 C640,1000 670,985 688,960 Z',
    hamstrings: 'M566,1004 C556,1080 560,1180 585,1270 L615,1290 L650,1280 C665,1200 675,1100 678,1004 C640,1014 600,1014 566,1004 Z',
    calves: 'M590,1320 C566,1370 560,1450 570,1530 C580,1580 600,1600 620,1600 C640,1600 660,1580 668,1530 C675,1450 668,1370 640,1320 Z M612,1604 L628,1604 L624,1760 L614,1760 Z',
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
  const chip = (e, cls) => `<span class="chip ${cls}">${esc(e.name)}<small>${esc(e.sets)}${filter === 'all' && DAYS[plan.schedule.indexOf(e.session)] ? ` · ${DAYS[plan.schedule.indexOf(e.session)]}` : ''}</small></span>`;

  return `<section class="card mmap reveal" id="muscles">
    <header class="mm-head"><h3>Muscle map</h3>
      <div class="seg" role="tablist" aria-label="Filter by day">${tabs.map(([id, t]) =>
        `<button role="tab" aria-selected="${id === filter}" class="${id === filter ? 'on' : ''}" data-act="mfilter" data-f="${id}">${t}</button>`).join('')}</div>
    </header>
    <div class="mm-body">
      <div class="mm-figure">
        <div class="seg small">${['front', 'back'].map(v => `<button class="${v === view ? 'on' : ''}" data-act="mview" data-v="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>
        <svg viewBox="390 70 620 1790" class="body" aria-label="${view} body view">
          <defs>
            <radialGradient id="mg-pri" cx="40%" cy="35%"><stop offset="0" stop-color="#ffb347"/><stop offset=".55" stop-color="#ff6b2b"/><stop offset="1" stop-color="#c2271c"/></radialGradient>
            <radialGradient id="mg-sec" cx="40%" cy="35%"><stop offset="0" stop-color="#9fd0ff"/><stop offset="1" stop-color="#2f6fd6"/></radialGradient>
            <radialGradient id="mg-core" cx="40%" cy="35%"><stop offset="0" stop-color="#8ff0b6"/><stop offset="1" stop-color="#1e9e57"/></radialGradient>
            <radialGradient id="mg-skin" cx="50%" cy="30%"><stop offset="0" stop-color="#2a2a2a"/><stop offset="1" stop-color="#151515"/></radialGradient>
          </defs>
          <g class="sil"><ellipse cx="700" cy="176" rx="74" ry="92"/><path d="${BODY}"/><path d="${BODY}" transform="matrix(-1 0 0 1 1400 0)"/></g>
          <g>${half}</g><g transform="matrix(-1 0 0 1 1400 0)">${half}</g>
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
