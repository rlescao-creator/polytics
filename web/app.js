// Page Présidentielle 2027 : sondages du premier tour (tables polls, poll_results, v_poll_sponsors)
// et cotes Polymarket (markets, market_prices), lus en public grâce à la RLS. Rien n'est écrit en dur :
// candidats et couleurs viennent des tables candidates et parties.
const { supabaseUrl, supabaseKey, election } = window.POLL_CONFIG;
const db = window.supabase.createClient(supabaseUrl, supabaseKey);

const WINDOW = 30;      // jours de terrain pris dans la moyenne
const MIN_POLLS = 3;    // sondages minimum sur la fenêtre pour afficher une moyenne
const LAST_N = 5;       // sondages pris dans la courbe
const LOOKBACK = 90;    // ancienneté maximale d'un sondage dans la courbe, en jours
const HISTORY = 365;    // jours affichés sur les graphiques
const DAY = 86400000;

const $ = (id) => document.getElementById(id);
const pct = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const longDay = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const shortDay = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const month = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
const monthYear = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const time = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const ordinal = (n) => (n === 1 ? '1er' : n + 'e');

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const utcDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const isoDay = (d) => d.toISOString().slice(0, 10);

// PostgREST renvoie au plus 1 000 lignes : on lit par tranches.
async function all(query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

// --- Lecture
async function load() {
  const since = isoDay(new Date(Date.now() - (HISTORY + WINDOW) * DAY));
  const [cands, rows, sponsors, markets] = await Promise.all([
    all(() => db.from('candidates').select('name, full_name, party, parties(name, color)').eq('kind', 'personne').order('name')),
    all(() => db.from('polls')
      .select('id, fieldwork_end, fieldwork_label, institute, scenario, sample_size, notice_url, source, poll_results(candidate, value)')
      .eq('election_id', election).eq('round', 1).gte('fieldwork_end', since).order('id')),
    all(() => db.from('v_poll_sponsors').select('id, sponsor')
      .eq('election_id', election).eq('round', 1).gte('fieldwork_end', since).order('id')),
    all(() => db.from('markets').select('condition_id, candidate_name, volume, last_price, closed')
      .eq('election_id', election).order('condition_id')),
  ]);

  const people = new Map(cands.map((c) => [c.name, {
    name: c.name, full: c.full_name || c.name, party: c.parties ? c.parties.name : c.party,
    color: (c.parties && c.parties.color) || 'var(--muted)',
  }]));

  // Un sondage = un institut et un terrain ; ses hypothèses (scenario) sont moyennées par candidat.
  const bySponsor = new Map();
  sponsors.forEach((s) => s.sponsor && bySponsor.set(s.id, (bySponsor.get(s.id) || new Set()).add(s.sponsor)));
  const polls = new Map();
  rows.forEach((r) => {
    const key = r.institute + '|' + r.fieldwork_label + '|' + r.fieldwork_end;
    let p = polls.get(key);
    if (!p) {
      p = { key, date: new Date(r.fieldwork_end + 'T00:00:00Z'), label: r.fieldwork_label, institute: r.institute,
            sample: r.sample_size, notice: r.notice_url, source: r.source, sponsors: new Set(), scenarios: 0, sums: new Map() };
      polls.set(key, p);
    }
    p.scenarios += 1;
    if (!p.notice && r.notice_url) p.notice = r.notice_url;
    (bySponsor.get(r.id) || []).forEach((s) => p.sponsors.add(s));
    r.poll_results.forEach((v) => {
      if (!people.has(v.candidate) || v.value == null) return;
      const acc = p.sums.get(v.candidate) || { sum: 0, n: 0 };
      acc.sum += v.value; acc.n += 1;
      p.sums.set(v.candidate, acc);
    });
  });
  const pollList = [...polls.values()]
    .map((p) => ({ ...p, values: new Map([...p.sums].map(([c, a]) => [c, a.sum / a.n])) }))
    .filter((p) => p.values.size)
    .sort((a, b) => a.date - b.date);

  // Cotes : les marchés ouverts les mieux cotés, un point par jour (dernier prix du jour).
  const open = markets.filter((m) => !m.closed && m.candidate_name && m.last_price != null)
    .sort((a, b) => b.last_price - a.last_price);
  const tracked = open.slice(0, 10);
  const prices = tracked.length ? await all(() => db.from('market_prices').select('condition_id, ts, price')
    .in('condition_id', tracked.map((m) => m.condition_id)).order('condition_id').order('ts')) : [];
  const nameOf = new Map(tracked.map((m) => [m.condition_id, m.candidate_name]));
  const daily = new Map();
  let lastTs = 0;
  prices.forEach((p) => {
    const d = isoDay(new Date(p.ts * 1000));
    daily.set(p.condition_id + '|' + d, { candidate: nameOf.get(p.condition_id), date: new Date(d + 'T00:00:00Z'), value: p.price * 100 });
    lastTs = Math.max(lastTs, p.ts);
  });

  return {
    people, polls: pollList, lastTs,
    market: open.map((m) => ({ candidate: m.candidate_name, proba: m.last_price * 100, volume: m.volume })),
    marketSeries: [...daily.values()],
  };
}

// --- Calculs
// Courbe : moyenne des LAST_N derniers sondages où le candidat figure, sur LOOKBACK jours au plus
// (avant septembre 2026, il y a parfois un seul sondage par mois : une fenêtre fixe de 30 jours serait trouée).
function rolling(polls, candidate, start, end) {
  const pts = polls.filter((p) => p.values.has(candidate)).map((p) => ({ t: +p.date, v: p.values.get(candidate) }));
  const out = [];
  for (let t = +start; t <= +end; t += DAY) {
    const win = pts.filter((p) => p.t <= t && p.t > t - LOOKBACK * DAY).slice(-LAST_N);
    // Valeur vide quand trop peu de sondages : la ligne s'interrompt au lieu de relier deux périodes.
    out.push({ candidate, date: new Date(t), value: win.length >= MIN_POLLS ? win.reduce((s, p) => s + p.v, 0) / win.length : NaN, n: win.length });
  }
  return out.some((p) => Number.isFinite(p.value)) ? out : [];
}

function standings(data) {
  const last = data.polls.length ? data.polls[data.polls.length - 1].date : null;
  const recent = last ? data.polls.filter((p) => p.date > new Date(+last - WINDOW * DAY)) : [];
  const stats = new Map();
  recent.forEach((p) => p.values.forEach((v, c) => {
    const s = stats.get(c) || { values: [] };
    s.values.push(v);
    stats.set(c, s);
  }));
  const polled = [...stats].filter(([, s]) => s.values.length >= MIN_POLLS).map(([c, s]) => ({
    candidate: c, avg: s.values.reduce((a, b) => a + b, 0) / s.values.length,
    min: Math.min(...s.values), max: Math.max(...s.values), n: s.values.length,
  })).sort((a, b) => b.avg - a.avg);
  polled.forEach((r, i) => { r.pollRank = i + 1; });

  const marketRank = new Map(data.market.map((m, i) => [m.candidate, { proba: m.proba, rank: i + 1 }]));
  const byName = new Map(polled.map((r) => [r.candidate, r]));
  data.market.filter((m) => m.proba >= 1).forEach((m) => {
    if (!byName.has(m.candidate)) byName.set(m.candidate, { candidate: m.candidate, avg: null, n: stats.has(m.candidate) ? stats.get(m.candidate).values.length : 0 });
  });
  const rowsOut = [...byName.values()].map((r) => ({ ...r, ...(marketRank.has(r.candidate)
    ? { proba: marketRank.get(r.candidate).proba, marketRank: marketRank.get(r.candidate).rank } : { proba: null }) }));
  rowsOut.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || (b.proba ?? 0) - (a.proba ?? 0));
  return { rows: rowsOut.slice(0, 12), recent, last, polled };
}

// --- Rendu
function renderHero(data, st) {
  const updated = data.lastTs ? time.format(new Date(data.lastTs * 1000)) : null;
  $('updated').textContent = 'Présidentielle 2027' + (updated ? ' · cotes du ' + updated : '')
    + (st.last ? ' · sondages jusqu’au ' + longDay.format(st.last) : '');
  const pollLead = st.polled[0];
  const marketLead = data.market[0];
  if (!pollLead || !marketLead) return;
  const name = (c) => data.people.get(c)?.full || c;
  $('headline').textContent = pollLead.candidate === marketLead.candidate
    ? name(pollLead.candidate) + ' en tête des sondages comme du marché'
    : name(pollLead.candidate) + ' en tête des sondages, ' + name(marketLead.candidate) + ' favori du marché';

  // Le désaccord le plus net entre les deux classements, parmi les candidats que le marché prend au sérieux.
  const gaps = st.rows.filter((r) => r.proba >= 3).map((r) => ({
    ...r, gap: (r.pollRank ?? st.polled.length + 1) - r.marketRank,
  })).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  const lede = $('lede');
  lede.replaceChildren();
  const b = (t) => el('b', '', t);
  lede.append(
    'Moyenne des sondages\u00a0: ', b(pct.format(pollLead.avg) + ' %'), ' des intentions de vote pour ' + name(pollLead.candidate) + '. ',
    'Polymarket lui donne ', b(pct.format(data.market.find((m) => m.candidate === pollLead.candidate)?.proba ?? 0) + ' %'), ' de chances de gagner. ',
  );
  const g = gaps[0];
  if (g && Math.abs(g.gap) >= 2) {
    lede.append('Le plus grand écart\u00a0: ', b(name(g.candidate)), ', ' + ordinal(g.marketRank) + ' du marché, '
      + (g.pollRank ? ordinal(g.pollRank) + ' des sondages.' : 'trop peu testé par les sondeurs pour avoir une moyenne.'));
  }
}

function meter(value, scale, color, sub, range) {
  const m = el('div', 'meter');
  const num = el('span', 'num' + (value == null ? ' none' : ''), value == null ? '—' : pct.format(value) + ' %');
  if (sub) num.append(el('small', '', sub));
  const track = el('div', 'track');
  if (value != null) {
    const bar = el('span', 'bar');
    bar.style.width = (100 * value / scale) + '%';
    bar.style.background = color;
    track.append(bar);
    if (range) {
      const r = el('span', 'range');
      r.style.left = (100 * range[0] / scale) + '%';
      r.style.width = (100 * (range[1] - range[0]) / scale) + '%';
      r.title = 'De ' + pct.format(range[0]) + ' à ' + pct.format(range[1]) + ' % selon les sondages';
      track.append(r);
    }
  }
  m.append(num, track);
  return m;
}

function renderBoard(data, st) {
  const board = $('board');
  board.replaceChildren();
  if (!st.rows.length) { board.append(el('p', 'empty', 'Aucune donnée récente.')); return; }
  const pollScale = Math.ceil(Math.max(...st.rows.map((r) => r.max ?? r.avg ?? 0)) / 10) * 10 || 10;
  const marketScale = Math.max(50, Math.ceil(Math.max(...st.rows.map((r) => r.proba ?? 0)) / 10) * 10);
  const head = el('div', 'head');
  head.setAttribute('role', 'row');
  [['name', 'Candidat'],
   ['', 'Intentions de vote, 1er tour · moyenne 30 j, fourchette des sondages (0–' + pollScale + ' %)'],
   ['', 'Chance de gagner · Polymarket (0–' + marketScale + ' %)']].forEach(([cls, t]) => {
    const c = el('div', 'cell ' + cls, t);
    c.setAttribute('role', 'columnheader');
    head.append(c);
  });
  board.append(head);
  st.rows.forEach((r) => {
    const p = data.people.get(r.candidate) || { full: r.candidate, color: 'var(--muted)' };
    const row = el('div');
    row.setAttribute('role', 'row');
    const who = el('div', 'cell name');
    const w = el('div', 'who');
    const dot = el('span', 'dot');
    dot.style.background = p.color;
    const label = el('span', '', p.full);
    if (p.party) label.append(el('small', '', p.party));
    w.append(dot, label);
    who.append(w);
    const polls = el('div', 'cell');
    polls.append(meter(r.avg, pollScale, p.color,
      r.avg == null ? (r.n ? r.n + ' sondage' + (r.n > 1 ? 's' : '') + ' sur 30 j' : 'absent des sondages') : ordinal(r.pollRank) + ' · ' + r.n + ' sondages',
      r.avg == null ? null : [r.min, r.max]));
    const market = el('div', 'cell');
    market.append(meter(r.proba, marketScale, p.color, r.proba == null ? 'pas de marché' : ordinal(r.marketRank)));
    [who, polls, market].forEach((c) => c.setAttribute('role', 'cell'));
    row.append(who, polls, market);
    board.append(row);
  });
}

const tickFormat = (d) => (d.getUTCMonth() === 0 ? monthYear.format(d) : month.format(d));

// Étiquettes en bout de ligne, écartées pour ne pas se chevaucher.
function endLabels(series, yDomain, height) {
  const minGap = (yDomain[1] - yDomain[0]) * 16 / (height - 50);
  const ends = series.map((s) => s.findLast((p) => Number.isFinite(p.value))).map((p) => ({ ...p, y: p.value }))
    .sort((a, b) => b.y - a.y);
  for (let i = 1; i < ends.length; i++) if (ends[i - 1].y - ends[i].y < minGap) ends[i].y = ends[i - 1].y - minGap;
  return ends;
}

function lineChart(target, { dots = [], series, yLabel, colorOf, tipDot, tipLine }) {
  const draw = () => {
    const width = target.clientWidth;
    const height = width < 520 ? 300 : 380;
    const flat = series.flat();
    const finite = flat.filter((d) => Number.isFinite(d.value));
    const yMax = Math.ceil(Math.max(...dots.map((d) => d.value), ...finite.map((d) => d.value)) / 5) * 5;
    const yDomain = [0, yMax];
    const labels = endLabels(series, yDomain, height);
    const chart = Plot.plot({
      width, height, marginLeft: 36, marginRight: width < 520 ? 92 : 120, marginTop: 24,
      style: { color: 'var(--muted)', background: 'transparent', fontSize: '12px' },
      x: { type: 'utc', tickFormat, ticks: width < 520 ? 4 : 8, label: null },
      y: { domain: yDomain, grid: true, label: yLabel, tickFormat: (v) => v + ' %' },
      marks: [
        Plot.ruleY([0], { stroke: 'var(--line)' }),
        Plot.dot(dots, { x: 'date', y: 'value', r: 2.5, fill: (d) => colorOf(d.candidate), fillOpacity: 0.35 }),
        Plot.line(flat, { x: 'date', y: 'value', z: 'candidate', stroke: (d) => colorOf(d.candidate), strokeWidth: 2.25, curve: 'monotone-x' }),
        Plot.text(labels, { x: 'date', y: 'y', text: (d) => d.candidate + ' ' + pct.format(d.value), dx: 8, textAnchor: 'start',
          fill: (d) => colorOf(d.candidate), fontWeight: 600 }),
        Plot.tip(dots.length ? dots : finite, Plot.pointer({ x: 'date', y: 'value', title: dots.length ? tipDot : tipLine,
          fill: 'var(--panel)', stroke: 'var(--line)' })),
      ],
    });
    target.replaceChildren(chart);
  };
  draw();
  let w = target.clientWidth;
  new ResizeObserver(() => { if (target.clientWidth !== w) { w = target.clientWidth; draw(); } }).observe(target);
}

function renderPollChart(data, st) {
  const shown = st.polled.slice(0, 7).map((r) => r.candidate);
  if (!shown.length || !st.last) { $('chart-polls').replaceChildren(el('p', 'empty', 'Pas assez de sondages.')); return; }
  const start = utcDay(new Date(+st.last - HISTORY * DAY));
  const polls = data.polls.filter((p) => p.date >= start);
  const dots = polls.flatMap((p) => shown.filter((c) => p.values.has(c)).map((c) => ({
    candidate: c, date: p.date, value: p.values.get(c), poll: p,
  })));
  const series = shown.map((c) => rolling(data.polls, c, start, st.last)).filter((s) => s.length);
  const colorOf = (c) => data.people.get(c)?.color || 'var(--muted)';
  lineChart($('chart-polls'), {
    dots, series, yLabel: '↑ intentions de vote', colorOf,
    tipDot: (d) => d.candidate + '\u00a0: ' + pct.format(d.value) + ' %\n' + d.poll.institute
      + (d.poll.sponsors.size ? ' pour ' + [...d.poll.sponsors].join(', ') : '') + '\nTerrain : ' + d.poll.label,
  });
}

function renderMarketChart(data) {
  const shown = data.market.slice(0, 7).map((m) => m.candidate);
  const series = shown.map((c) => data.marketSeries.filter((p) => p.candidate === c).sort((a, b) => a.date - b.date)).filter((s) => s.length);
  if (!series.length) { $('chart-market').replaceChildren(el('p', 'empty', 'Pas de cotes disponibles.')); return; }
  const colorOf = (c) => data.people.get(c)?.color || 'var(--muted)';
  lineChart($('chart-market'), {
    series, yLabel: '↑ chance de victoire', colorOf,
    tipLine: (d) => d.candidate + '\u00a0: ' + pct.format(d.value) + ' %\n' + longDay.format(d.date),
  });
}

function renderLatest(data) {
  const list = $('latest');
  list.replaceChildren();
  data.polls.slice(-8).reverse().forEach((p) => {
    const li = el('li', 'poll');
    const head = el('header');
    head.append(el('span', 'inst', p.institute), el('span', 'date', p.label));
    const meta = [p.sponsors.size ? 'pour ' + [...p.sponsors].join(', ') : null,
      p.sample ? p.sample.toLocaleString('fr-FR') + ' personnes' : null,
      p.scenarios > 1 ? p.scenarios + ' hypothèses' : null].filter(Boolean).join(' · ');
    const ul = el('ul');
    [...p.values].sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([c, v]) => {
      const row = el('li');
      const dot = el('span', 'dot');
      dot.style.background = data.people.get(c)?.color || 'var(--muted)';
      row.append(dot, el('span', '', c), el('span', 'v', pct.format(v) + ' %'));
      ul.append(row);
    });
    const links = el('div', 'links');
    if (p.notice) { const a = el('a', '', 'Notice'); a.href = p.notice; links.append(a); }
    if (p.source) { const a = el('a', '', 'Wikipedia'); a.href = p.source; links.append(a); }
    li.append(head);
    if (meta) li.append(el('div', 'meta', meta));
    li.append(ul, links);
    list.append(li);
  });
}

load().then((data) => {
  const st = standings(data);
  renderHero(data, st);
  renderBoard(data, st);
  renderPollChart(data, st);
  renderMarketChart(data);
  renderLatest(data);
}).catch((e) => {
  $('lede').textContent = 'Données indisponibles : ' + (e.message || e);
});
