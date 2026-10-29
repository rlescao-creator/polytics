// Page élection : sondages (polls, poll_results, v_poll_sponsors) et cotes Polymarket (markets, market_prices),
// lus en public grâce à la RLS. Élection choisie par ?e=<id> (fr-2027 par défaut), tour par ?tour=1|2.
// Élections passées : résultat (results), « qui l'a vu en premier » (premier_a_voir) et chance de victoire
// jour par jour (comparaison_quotidienne). Rien n'est écrit en dur : candidats et couleurs viennent de la base.
const { supabaseUrl, supabaseKey, election: DEFAULT_ELECTION } = window.POLL_CONFIG;
const db = window.supabase.createClient(supabaseUrl, supabaseKey);

const WINDOW = 30;      // jours de terrain pris dans la moyenne
const MIN_POLLS = 3;    // sondages minimum sur la fenêtre pour afficher une moyenne
const LAST_N = 5;       // sondages pris dans la courbe
const LOOKBACK = 90;    // ancienneté maximale d'un sondage dans la courbe, en jours
const HISTORY = 365;    // jours affichés sur les graphiques
const SHOWN = 7;        // candidats tracés
const DAY = 86400000;

const $ = (id) => document.getElementById(id);
const pct = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const signed = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const longDay = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const month = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
const monthYear = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const relative = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const usd = (v) => compact.format(v) + '\u00a0$';
const hour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const dayHour = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const region = new Intl.DisplayNames(['fr'], { type: 'region' });
const ordinal = (n) => (n === 1 ? '1er' : n + 'e');
const roundName = (r) => (r === 1 ? '1er tour' : '2nd tour');
const yearOf = (e) => e.id.split('-')[1];
const titleOf = (e) => region.of(e.country) + ' ' + yearOf(e);
const utc = (iso) => new Date(iso + 'T00:00:00Z');
const isoDay = (d) => d.toISOString().slice(0, 10);

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const ago = (date) => {
  const min = Math.round((date - Date.now()) / 60000);
  if (min > -60) return relative.format(min, 'minute');
  if (min > -60 * 48) return relative.format(Math.round(min / 60), 'hour');
  return relative.format(Math.round(min / 1440), 'day');
};

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

// --- État : élection, tour, candidat suivi ; élection et tour sont reflétés dans l'adresse.
const params = new URLSearchParams(location.search);
const state = { id: params.get('e') || DEFAULT_ELECTION, round: Number(params.get('tour')) || null, focus: null };
let elections = [];
let people = new Map();
const cache = new Map();
let view = null;       // données calculées de l'élection affichée
let token = 0;         // ignore les chargements dépassés quand on change vite d'élection

const colorOf = (c) => people.get(c)?.color || 'var(--muted)';
const fullName = (c) => people.get(c)?.full || c;

async function init() {
  const [els, results, cands] = await Promise.all([
    all(() => db.from('elections').select('id, name, country, election_date, second_round_date').order('id')),
    all(() => db.from('results').select('election_id, round, candidate, value').order('election_id')),
    all(() => db.from('candidates').select('name, full_name, party, parties(name, color)').eq('kind', 'personne').order('name')),
  ]);
  people = new Map(cands.map((c) => [c.name, {
    full: c.full_name || c.name, party: c.parties ? c.parties.name : c.party, color: c.parties && c.parties.color,
  }]));
  elections = els.map((e) => {
    const res = new Map();
    results.filter((r) => r.election_id === e.id).forEach((r) => res.set(r.round, [...(res.get(r.round) || []), r]));
    res.forEach((rows) => rows.sort((a, b) => b.value - a.value));
    const decisive = res.size ? Math.max(...res.keys()) : null;
    const vote = (r) => {
      const d = r === 2 ? e.second_round_date : e.election_date;
      return d ? utc(d) : null;
    };
    return { ...e, results: res, past: res.size > 0, decisive, vote, end: decisive ? vote(decisive) : null };
  }).sort((a, b) => (a.past - b.past) || ((b.end || 0) - (a.end || 0)));
  if (!elections.some((e) => e.id === state.id)) state.id = elections[0].id;
  renderPicker();
  show();
}

window.addEventListener('popstate', () => {
  if (!elections.length) return;   // init() lit l'adresse lui-même
  const p = new URLSearchParams(location.search);
  state.id = p.get('e') || DEFAULT_ELECTION;
  state.round = Number(p.get('tour')) || null;
  state.focus = null;
  renderPicker();
  show();
});

function go(id, round) {
  state.id = id;
  state.round = round || null;
  state.focus = null;
  const p = new URLSearchParams();
  if (id !== DEFAULT_ELECTION) p.set('e', id);
  if (round) p.set('tour', round);
  history.pushState(null, '', location.pathname + (p.size ? '?' + p : ''));
  renderPicker();
  show();
}

function renderPicker() {
  const nav = $('picker');
  nav.replaceChildren();
  elections.forEach((e) => {
    const a = el('a', 'chip');
    a.href = '?e=' + e.id;
    if (e.id === state.id) a.setAttribute('aria-current', 'page');
    a.append(el('span', '', region.of(e.country)), el('span', 'year', yearOf(e)));
    if (!e.past) a.append(el('span', 'live', 'en direct'));
    a.addEventListener('click', (ev) => {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
      ev.preventDefault();
      if (e.id !== state.id) go(e.id);
    });
    nav.append(a);
  });
  const current = nav.querySelector('[aria-current]');
  if (current) nav.scrollLeft = current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
}

// --- Lecture d'une élection
// Bilans d'une élection passée : tables précalculées par le collecteur, sinon calcul à la volée
// (souvent trop long pour le rôle anon). null quand aucun des deux ne répond.
async function bilan(table, rpc, e) {
  try {
    const rows = await all(() => db.from(table).select('*').eq('election_id', e.id).order(table === 'bilan_quotidien' ? 'jour' : 'source'));
    if (rows.length) return rows;
  } catch { /* table absente : on tente le calcul */ }
  const { data, error } = await db.rpc(rpc, { p_election: e.id });
  return error ? null : data;
}

async function load(e) {
  const end = e.past ? e.end : new Date();
  const since = isoDay(new Date(+end - (HISTORY + WINDOW) * DAY));
  const [rows, sponsors, markets, first, duel, night] = await Promise.all([
    all(() => db.from('polls')
      .select('id, round, fieldwork_end, fieldwork_label, institute, media, scenario, sample_size, notice_url, source, poll_results(candidate, value)')
      .eq('election_id', e.id).gte('fieldwork_end', since).order('id')),
    e.country === 'FR' ? all(() => db.from('v_poll_sponsors').select('id, sponsor')
      .eq('election_id', e.id).gte('fieldwork_end', since).order('id')) : [],
    all(() => db.from('markets').select('condition_id, candidate_name, volume, last_price, closed')
      .eq('election_id', e.id).order('condition_id')),
    e.past ? bilan('bilan_premier_a_voir', 'premier_a_voir', e) : [],
    e.past ? bilan('bilan_quotidien', 'comparaison_quotidienne', e) : [],
    e.past ? all(() => db.from('nuit_electorale').select('serie, candidat, volume, ts, price').eq('election_id', e.id).order('ts'))
      .catch(() => []) : [],
  ]);

  // Marchés suivis : en direct, les mieux cotés ; après le vote, les plus échangés et ceux des candidats du résultat.
  const named = new Map();
  markets.filter((m) => m.candidate_name && (e.past || (!m.closed && m.last_price != null)))
    .sort((a, b) => (e.past ? b.volume - a.volume : b.last_price - a.last_price))
    .forEach((m) => { if (!named.has(m.candidate_name)) named.set(m.candidate_name, m); });
  const finalists = e.past ? e.results.get(e.decisive).map((r) => r.candidate) : [];
  const tracked = [...named.values()].filter((m, i) => i < 10 || finalists.includes(m.candidate_name));
  const prices = tracked.length ? await all(() => db.from('market_prices').select('condition_id, ts, price')
    .in('condition_id', tracked.map((m) => m.condition_id)).order('condition_id').order('ts')) : [];
  const nameOf = new Map(tracked.map((m) => [m.condition_id, m.candidate_name]));
  const daily = new Map();
  let lastTs = 0;
  prices.forEach((p) => {
    const d = isoDay(new Date(p.ts * 1000));
    if (e.past && utc(d) >= e.end) return;   // le jour du vote et après, le prix ne prévoit plus rien
    daily.set(p.condition_id + '|' + d, { candidate: nameOf.get(p.condition_id), date: utc(d), value: p.price * 100 });
    lastTs = Math.max(lastTs, p.ts);
  });
  const marketSeries = [...daily.values()].sort((a, b) => a.date - b.date);

  // Cote de référence : la dernière en direct, celle de la veille du vote après coup.
  const market = e.past
    ? tracked.map((m) => {
      const last = marketSeries.filter((p) => p.candidate === m.candidate_name).at(-1);
      return last && { candidate: m.candidate_name, proba: last.value };
    }).filter(Boolean)
    : tracked.map((m) => ({ candidate: m.candidate_name, proba: m.last_price * 100 }));
  market.sort((a, b) => b.proba - a.proba);

  const bySponsor = new Map();
  sponsors.forEach((s) => s.sponsor && bySponsor.set(s.id, (bySponsor.get(s.id) || new Set()).add(s.sponsor)));
  // L'argent : dollars échangés sur tous les marchés de l'élection, et sur le marché de chaque candidat.
  const volumeOf = new Map();
  markets.filter((m) => m.candidate_name).forEach((m) => volumeOf.set(m.candidate_name, (volumeOf.get(m.candidate_name) || 0) + (m.volume || 0)));
  const dollars = markets.reduce((t, m) => t + (m.volume || 0), 0);
  return { rows, bySponsor, market, marketSeries, lastTs, first, duel, night, volumeOf, dollars };
}

// Un sondage = un institut et un terrain ; ses hypothèses (scenario) sont moyennées par candidat.
// Pour un tour dont on connaît le résultat, chaque hypothèse est ramenée à la part des voix entre
// les candidats du résultat, et ignorée si l'un d'eux y manque.
function pollsFor(e, data, round) {
  const res = e.results.get(round);
  const set = res && res.map((r) => r.candidate);
  const cutoff = e.past ? e.vote(round) : null;
  const polls = new Map();
  data.rows.filter((r) => r.round === round && (!cutoff || utc(r.fieldwork_end) <= cutoff)).forEach((r) => {
    let vals = r.poll_results.filter((v) => people.has(v.candidate) && v.value > 0);
    if (set) {
      if (!set.every((c) => vals.some((v) => v.candidate === c))) return;
      vals = vals.filter((v) => set.includes(v.candidate));
      const total = vals.reduce((s, v) => s + v.value, 0);
      vals = vals.map((v) => ({ candidate: v.candidate, value: 100 * v.value / total }));
    }
    if (!vals.length) return;
    const key = r.institute + '|' + r.fieldwork_label + '|' + r.fieldwork_end;
    let p = polls.get(key);
    if (!p) {
      p = { key, date: utc(r.fieldwork_end), label: r.fieldwork_label, institute: r.institute, sample: r.sample_size,
            notice: r.notice_url, source: r.source, sponsors: new Set(), scenarios: 0, sums: new Map() };
      polls.set(key, p);
    }
    p.scenarios += 1;
    if (!p.notice && r.notice_url) p.notice = r.notice_url;
    (data.bySponsor.get(r.id) || (r.media ? [r.media] : [])).forEach((s) => p.sponsors.add(s));
    vals.forEach((v) => {
      const acc = p.sums.get(v.candidate) || { sum: 0, n: 0 };
      acc.sum += v.value; acc.n += 1;
      p.sums.set(v.candidate, acc);
    });
  });
  return [...polls.values()]
    .map((p) => ({ ...p, values: new Map([...p.sums].map(([c, a]) => [c, a.sum / a.n])) }))
    .sort((a, b) => a.date - b.date);
}

// Tours proposés : en direct, seulement le 1er (les duels du 2nd tour sont des hypothèses multiples).
function roundsFor(e, data) {
  const rounds = [...new Set(data.rows.map((r) => r.round))].sort();
  return rounds.filter((r) => (e.past || r === 1) && pollsFor(e, data, r).length >= MIN_POLLS);
}

// --- Calculs
// Courbe : moyenne des LAST_N derniers sondages où le candidat figure, sur LOOKBACK jours au plus
// (quand il y a parfois un seul sondage par mois, une fenêtre fixe de 30 jours serait trouée).
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

function standings(e, data, polls, round) {
  const last = polls.length ? polls.at(-1).date : null;
  const recent = last ? polls.filter((p) => p.date > new Date(+last - WINDOW * DAY)) : [];
  const stats = new Map();
  recent.forEach((p) => p.values.forEach((v, c) => stats.set(c, [...(stats.get(c) || []), v])));
  const polled = [...stats].filter(([, v]) => v.length >= MIN_POLLS).map(([c, v]) => ({
    candidate: c, avg: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v), n: v.length,
  })).sort((a, b) => b.avg - a.avg);
  polled.forEach((r, i) => { r.pollRank = i + 1; });
  const byName = new Map(polled.map((r) => [r.candidate, r]));
  const marketOf = new Map(data.market.map((m, i) => [m.candidate, { proba: m.proba, marketRank: i + 1 }]));
  const withMarket = (r) => ({ ...r, ...(marketOf.get(r.candidate) || { proba: null }) });

  const res = e.results.get(round);
  if (res) {
    const total = res.reduce((s, r) => s + r.value, 0);
    const rows = res.map((r) => withMarket({
      candidate: r.candidate, ...(byName.get(r.candidate) || { avg: null, n: (stats.get(r.candidate) || []).length }),
      official: r.value, result: 100 * r.value / total,
    }));
    return { rows, polled, last, hasResult: true };
  }
  data.market.filter((m) => m.proba >= 1).forEach((m) => {
    if (!byName.has(m.candidate)) byName.set(m.candidate, { candidate: m.candidate, avg: null, n: (stats.get(m.candidate) || []).length });
  });
  const rows = [...byName.values()].map(withMarket)
    .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || (b.proba ?? 0) - (a.proba ?? 0));
  return { rows: rows.slice(0, 12), polled, last, hasResult: false };
}

// --- Rendu
const BUSY = ['board', 'chart-polls', 'chart-market', 'chart-duel', 'latest', 'first'];

function skeleton() {
  $('board').replaceChildren(...Array.from({ length: 5 }, () => el('div', 'skel skel-row')));
  ['chart-polls', 'chart-market', 'chart-duel'].forEach((id) => $(id).replaceChildren(el('div', 'skel skel-chart')));
  $('latest').replaceChildren(...Array.from({ length: 3 }, () => el('li', 'skel skel-card')));
  $('first').replaceChildren(...Array.from({ length: 4 }, () => el('li', 'skel skel-line')));
  $('lede').replaceChildren(el('span', 'skel skel-text'));
  $('rounds').hidden = true;
  BUSY.forEach((id) => $(id).setAttribute('aria-busy', 'true'));
}

async function show() {
  const e = elections.find((x) => x.id === state.id);
  const mine = ++token;
  document.title = 'Présidentielle · ' + titleOf(e) + ' · Polytics';
  $('nav-live').toggleAttribute('aria-current', e.id === DEFAULT_ELECTION);
  $('updated').textContent = 'Présidentielle · ' + titleOf(e);
  $('headline').textContent = ' ';
  $('sec-first').hidden = $('sec-duel').hidden = !e.past;
  $('src-cs').hidden = e.country !== 'FR';
  skeleton();
  let data;
  try {
    if (!cache.has(e.id)) cache.set(e.id, load(e));
    data = await cache.get(e.id);
  } catch (err) {
    cache.delete(e.id);
    if (mine !== token) return;
    $('lede').replaceChildren('Données indisponibles : ' + (err.message || err) + '. ');
    const retry = el('button', 'link', 'Réessayer');
    retry.type = 'button';
    retry.addEventListener('click', show);
    $('lede').append(retry);
    return;
  }
  if (mine !== token) return;

  const rounds = roundsFor(e, data);
  const round = rounds.includes(state.round) ? state.round
    : (e.past && rounds.includes(e.decisive) ? e.decisive : rounds[0] || 1);
  const polls = pollsFor(e, data, round);
  const st = standings(e, data, polls, round);
  view = { e, data, round, rounds, polls, st };
  const src = data.rows.find((r) => r.source)?.source;
  if (src) $('src-wiki').href = src;

  renderHero();
  renderRounds();
  renderBoard();
  renderFirst();
  renderNight();
  renderCharts();
  renderLatest();
  BUSY.forEach((id) => $(id).removeAttribute('aria-busy'));
}

function renderHero() {
  const { e, data, round, st } = view;
  const b = (t) => el('b', '', t);
  const lede = $('lede');
  lede.replaceChildren();
  const eyebrow = ['Présidentielle · ' + titleOf(e)];
  if (e.past) eyebrow.push((e.decisive === 2 ? '2nd tour le ' : 'vote le ') + longDay.format(e.end));
  if (data.dollars) eyebrow.push(usd(data.dollars) + ' échangés sur Polymarket');
  else {
    if (data.lastTs) eyebrow.push('cotes mises à jour ' + ago(new Date(data.lastTs * 1000)));
    if (st.last) eyebrow.push('dernier sondage le ' + longDay.format(st.last));
  }
  $('updated').textContent = eyebrow.join(' · ');

  if (!e.past) {
    const pollLead = st.polled[0];
    const marketLead = data.market[0];
    if (!pollLead || !marketLead) { $('headline').textContent = titleOf(e) + ' : pas encore assez de données'; return; }
    $('headline').textContent = pollLead.candidate === marketLead.candidate
      ? fullName(pollLead.candidate) + ' en tête des sondages comme du marché'
      : fullName(pollLead.candidate) + ' en tête des sondages, ' + fullName(marketLead.candidate) + ' favori du marché';
    // Le désaccord le plus net entre les deux classements, parmi les candidats que le marché prend au sérieux.
    const g = st.rows.filter((r) => r.proba >= 3)
      .map((r) => ({ ...r, gap: (r.pollRank ?? st.polled.length + 1) - r.marketRank }))
      .sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap))[0];
    if (g && Math.abs(g.gap) >= 2) {
      lede.append('Le plus grand écart : ', b(fullName(g.candidate)), ', ' + ordinal(g.marketRank) + ' du marché, '
        + (g.pollRank ? ordinal(g.pollRank) + ' des sondages.' : 'trop peu testé par les sondeurs pour avoir une moyenne.'));
    }
    return;
  }

  // Élection passée : le bilan se fait toujours sur le tour décisif, quel que soit le tour affiché.
  const decisive = round === e.decisive ? st : standings(e, data, pollsFor(e, data, e.decisive), e.decisive);
  const winner = e.results.get(e.decisive)[0];
  const pollsRight = decisive.polled[0]?.candidate === winner.candidate;
  const marketRight = data.market[0]?.candidate === winner.candidate;
  const name = fullName(winner.candidate);
  $('headline').textContent = !decisive.polled.length || !data.market.length ? name + ' l’emporte'
    : pollsRight && marketRight ? name + ' l’emporte, comme l’annonçaient sondages et marché'
    : pollsRight ? name + ' l’emporte : les sondages avaient vu juste, pas le marché'
    : marketRight ? name + ' l’emporte : le marché avait vu juste, pas les sondages'
    : name + ' l’emporte, contre les sondages et le marché';
  const firstRight = (data.first || []).filter((f) => f.juste && f.jours_avance != null).sort((x, y) => y.jours_avance - x.jours_avance)[0];
  if (firstRight) {
    lede.append('Premier à l’avoir vu durablement : ', b(firstRight.genre === 'moyenne' ? 'la moyenne des sondages' : firstRight.source),
      ', ' + firstRight.jours_avance + ' jours avant le vote.');
  } else if (data.first?.length) lede.append('Aucune source ne l’avait placé devant durablement avant le vote.');
}

function renderRounds() {
  const { rounds, round } = view;
  const box = $('rounds');
  box.hidden = rounds.length < 2;
  box.replaceChildren();
  rounds.forEach((r) => {
    const btn = el('button', 'seg', roundName(r));
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(r === round));
    btn.addEventListener('click', () => { if (r !== round) go(view.e.id, r); });
    box.append(btn);
  });
}

function meter({ value, scale, color, sub, range, marker, markerTitle }) {
  const m = el('div', 'meter');
  const num = el('span', 'num' + (value == null ? ' none' : ''), value == null ? '—' : pct.format(value) + ' %');
  if (sub) num.append(el('small', '', sub));
  const track = el('div', 'track');
  if (value != null) {
    const bar = el('span', 'bar');
    bar.style.width = Math.min(100, 100 * value / scale) + '%';
    bar.style.background = color;
    track.append(bar);
  }
  if (range) {
    const r = el('span', 'range');
    r.style.left = (100 * range[0] / scale) + '%';
    r.style.width = (100 * (range[1] - range[0]) / scale) + '%';
    r.title = 'De ' + pct.format(range[0]) + ' à ' + pct.format(range[1]) + ' % selon les sondages';
    track.append(r);
  }
  if (marker != null) {
    const t = el('span', 'tick');
    t.style.left = (100 * marker / scale) + '%';
    t.title = markerTitle;
    track.append(t);
  }
  m.append(num, track);
  return m;
}

function renderBoard() {
  const { e, st, round } = view;
  const board = $('board');
  board.replaceChildren();
  const note = $('n-now');
  note.replaceChildren();
  board.className = 'board' + (st.hasResult ? ' split' : '');
  if (st.hasResult) {
    renderSplit(board, note);
    return;
  } else {
    $('t-now').textContent = 'Deux mesures, deux échelles';
    note.append('Les sondages mesurent des ', el('b', '', 'intentions de vote au ' + roundName(round)), '. Polymarket donne une ',
      el('b', '', 'chance de gagner l’élection'), '. Ce ne sont pas les mêmes chiffres : chaque colonne a sa propre échelle.');
  }
  if (!st.rows.length) { board.append(el('p', 'empty', 'Pas assez de sondages pour ce tour.')); return; }

  const top = Math.max(...st.rows.map((r) => Math.max(r.max ?? 0, r.avg ?? 0, r.result ?? 0)));
  const voteScale = Math.ceil(top / 10) * 10 || 10;
  const marketScale = Math.max(50, Math.ceil(Math.max(...st.rows.map((r) => r.proba ?? 0)) / 10) * 10);
  const head = el('div', 'head');
  head.setAttribute('role', 'row');
  [['name', 'Candidat'],
   ['', (st.hasResult ? 'Résultat et sondages · part des voix entre ces candidats' : 'Intentions de vote · moyenne 30 j et fourchette des sondages') + ' (0–' + voteScale + ' %)'],
   ['', 'Chance de gagner · Polymarket' + (e.past ? ', la veille' : '') + ' (0–' + marketScale + ' %)']].forEach(([cls, t]) => {
    const c = el('div', 'cell ' + cls, t);
    c.setAttribute('role', 'columnheader');
    head.append(c);
  });
  board.append(head);

  st.rows.forEach((r, i) => {
    const p = people.get(r.candidate) || { full: r.candidate };
    const color = colorOf(r.candidate);
    const row = el('div', 'row' + (state.focus === r.candidate ? ' focused' : '') + (state.focus && state.focus !== r.candidate ? ' dimmed' : ''));
    row.setAttribute('role', 'row');
    const who = el('div', 'cell name');
    const btn = el('button', 'who');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(state.focus === r.candidate));
    btn.title = state.focus === r.candidate ? 'Ne plus suivre dans les graphiques' : 'Suivre dans les graphiques';
    const dot = el('span', 'dot');
    dot.style.background = color;
    const lab = el('span', '', p.full);
    lab.append(el('small', '', [st.hasResult ? ordinal(i + 1) : null, p.party].filter(Boolean).join(' · ')));
    btn.append(dot, lab);
    btn.addEventListener('click', () => focus(r.candidate));
    who.append(btn);

    const vote = el('div', 'cell');
    if (st.hasResult) {
      const off = Math.abs(r.official - r.result) >= 0.1 ? 'officiel ' + pct.format(r.official) + ' %' : null;
      const polled = r.avg == null ? 'sondages : —' : 'sondages ' + pct.format(r.avg) + ' (' + signed.format(r.avg - r.result) + ')';
      vote.append(meter({ value: r.result, scale: voteScale, color, sub: [polled, off].filter(Boolean).join(' · '),
        range: r.avg == null ? null : [r.min, r.max], marker: r.avg,
        markerTitle: r.avg == null ? '' : 'Moyenne des sondages : ' + pct.format(r.avg) + ' %' }));
    } else {
      vote.append(meter({ value: r.avg, scale: voteScale, color,
        sub: r.avg == null ? (r.n ? r.n + ' sondage' + (r.n > 1 ? 's' : '') + ' sur 30 j' : 'absent des sondages') : ordinal(r.pollRank) + ' · ' + r.n + ' sondages',
        range: r.avg == null ? null : [r.min, r.max] }));
    }
    const market = el('div', 'cell');
    const traded = view.data.volumeOf.get(r.candidate);
    market.append(meter({ value: r.proba, scale: marketScale, color,
      sub: r.proba == null ? 'pas de marché' : ordinal(r.marketRank) + (traded ? ' · ' + usd(traded) + ' échangés' : '') }));
    [who, vote, market].forEach((c) => c.setAttribute('role', 'cell'));
    row.append(who, vote, market);
    board.append(row);
  });
}

// Élection passée : trois barres partagées, l'une sous l'autre (résultat, médias, Polymarket), chaque
// candidat à la même place et de la même couleur ; à droite, le favori de chaque camp était-il le bon ?
function renderSplit(board, note) {
  const { st, round } = view;
  const rows = st.rows;
  const winner = rows[0].candidate;
  $('t-now').textContent = 'Qui mettaient-ils devant ?';
  note.append('Le ', el('b', '', 'résultat'), (view.e.second_round_date ? ' du ' + roundName(round) : '') + ', puis ce que donnaient les ', el('b', '', 'médias'),
    ' (derniers sondages) et ', el('b', '', 'Polymarket'), ' (chance de gagner) la veille du vote.');

  // Candidats : pastilles qui servent aussi à suivre un candidat dans les graphiques.
  const chips = el('div', 'split-chips');
  rows.forEach((r) => {
    const b = el('button', 'split-chip' + (state.focus === r.candidate ? ' on' : ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(state.focus === r.candidate));
    b.title = 'Suivre dans les graphiques';
    const dot = el('span', 'dot');
    dot.style.background = colorOf(r.candidate);
    b.append(dot, fullName(r.candidate));
    b.addEventListener('click', () => focus(r.candidate));
    chips.append(b);
  });
  board.append(chips);

  const sources = [
    ['result', 'Résultat', view.e.second_round_date ? roundName(round) : 'le vote', (r) => r.result],
    ['polls', 'Médias', 'derniers sondages', (r) => r.avg],
    ['market', 'Polymarket', 'chance de gagner, la veille', (r) => r.proba],
  ];
  sources.forEach(([key, label, sub, value]) => {
    const vals = rows.map((r) => ({ c: r.candidate, v: value(r) })).filter((x) => x.v != null);
    const line = el('div', 'split-row ' + key);
    const lab = el('div', 'split-label');
    lab.append(el('b', '', label), el('small', '', sub));
    const bar = el('div', 'split-bar' + (rows.length === 2 ? ' duel' : ''));
    vals.forEach((x) => {
      const seg = el('span', 'split-seg' + (state.focus && state.focus !== x.c ? ' dim' : ''));
      seg.style.width = x.v + '%';
      seg.style.background = colorOf(x.c);
      seg.title = fullName(x.c) + ' : ' + pct.format(x.v) + ' %';
      if (x.v >= 14) seg.append(el('span', '', x.c + ' ' + pct0.format(x.v) + ' %'));
      else if (x.v >= 6) seg.append(el('span', '', pct0.format(x.v)));
      bar.append(seg);
    });
    const verdict = el('div', 'split-verdict');
    if (!vals.length) verdict.append(el('span', 'none', 'pas de données'));
    else if (key === 'result') verdict.append(el('span', 'won', '→ ' + fullName(winner)));
    else {
      const fav = vals.reduce((a, b) => (b.v > a.v ? b : a)).c;
      verdict.append(fav === winner ? el('span', 'ok', '✓ bon favori') : el('span', 'ko', '✗ favori : ' + fav));
    }
    line.append(lab, bar, verdict);
    board.append(line);
  });
  if (rows.some((r) => Math.abs(r.official - r.result) >= 0.1)) {
    board.append(el('p', 'split-foot', 'Résultat et sondages en part des voix entre ces candidats. Officiel : '
      + rows.map((r) => fullName(r.candidate) + ' ' + pct.format(r.official) + ' %').join(', ') + '.'));
  }
}

function focus(candidate) {
  state.focus = state.focus === candidate ? null : candidate;
  renderBoard();
  renderCharts();
}

function renderFirst() {
  const { e, data } = view;
  const list = $('first');
  list.replaceChildren();
  if (!e.past) return;
  const res = e.results.get(e.decisive);
  $('n-first').textContent = 'Depuis combien de jours avant le vote chaque source plaçait ' + fullName(res[0].candidate)
    + ' devant ' + fullName(res[1].candidate) + ', sans plus changer d’avis. Instituts avec au moins 3 sondages.';
  if (!data.first) { list.append(el('li', 'empty', 'Calcul indisponible pour le moment.')); return; }
  const rows = [...data.first].sort((a, b) => (b.jours_avance ?? -1) - (a.jours_avance ?? -1) || b.nb - a.nb);
  if (!rows.length) { list.append(el('li', 'empty', 'Pas assez de données.')); return; }
  const max = Math.max(...rows.map((r) => r.jours_avance ?? 0), 1);
  rows.forEach((r) => {
    const li = el('li', 'src' + (r.genre === 'marché' ? ' market' : r.genre === 'moyenne' ? ' polls' : '') + (r.jours_avance == null ? ' never' : ''));
    const name = el('span', 'src-name', r.source);
    name.append(el('small', '', r.genre === 'institut' ? r.nb + ' sondages' : r.genre === 'marché' ? 'marché' : 'tous instituts'));
    const track = el('div', 'track');
    if (r.jours_avance != null) {
      const bar = el('span', 'bar');
      bar.style.width = Math.max(1, 100 * r.jours_avance / max) + '%';
      track.append(bar);
    }
    li.append(name, track, el('span', 'days', r.jours_avance == null ? 'jamais' : r.jours_avance + ' j'));
    li.title = r.jours_avance == null ? 'N’a pas placé le vainqueur devant de façon durable avant le vote'
      : 'Vainqueur devant sans interruption depuis le ' + longDay.format(utc(r.voit_depuis));
    list.append(li);
  });
}

const tickFormat = (d) => (d.getUTCMonth() === 0 ? monthYear.format(d) : month.format(d));

// Étiquettes en bout de ligne, écartées pour ne pas se chevaucher.
function endLabels(series, yDomain, height) {
  const minGap = (yDomain[1] - yDomain[0]) * 16 / (height - 50);
  const ends = series.map((s) => s.findLast((p) => Number.isFinite(p.value))).filter(Boolean)
    .map((p) => ({ ...p, y: p.value })).sort((a, b) => b.y - a.y);
  for (let i = 1; i < ends.length; i++) if (ends[i - 1].y - ends[i].y < minGap) ends[i].y = ends[i - 1].y - minGap;
  return ends;
}

const observers = new Map();
function lineChart(target, opts) {
  const { dots = [], series, yLabel, color, tip, rules = [], extra = [], yDomain: fixed, xDomain, focusable = true,
    dashed = () => false, ticks: tickCount = 8, xFormat = tickFormat, curve = 'monotone-x' } = opts;
  const fade = (d) => (focusable && state.focus && d.candidate !== state.focus ? 0.12 : 1);
  const draw = () => {
    const width = target.clientWidth;
    const narrow = width < 520;
    const height = narrow ? 300 : 380;
    const flat = series.flat();
    const finite = flat.filter((d) => Number.isFinite(d.value));
    const yDomain = fixed || [0, Math.ceil(Math.max(5, ...dots.map((d) => d.value), ...finite.map((d) => d.value),
      ...extra.map((d) => d.value)) / 5) * 5];
    const labels = endLabels(series, yDomain, height);
    const chart = Plot.plot({
      width, height, marginLeft: 36, marginRight: narrow ? 96 : 124, marginTop: 28,
      style: { color: 'var(--muted)', background: 'transparent', fontSize: '12px' },
      x: { type: 'utc', tickFormat: xFormat, ticks: narrow ? 4 : tickCount, label: null, domain: xDomain },
      y: { domain: yDomain, grid: true, label: yLabel, tickFormat: (v) => v + ' %' },
      marks: [
        Plot.ruleY([0], { stroke: 'var(--line)' }),
        ...(opts.ruleY != null ? [Plot.ruleY([opts.ruleY], { stroke: 'var(--muted)', strokeDasharray: '2,4' })] : []),
        ...rules.map((r) => Plot.ruleX([r.date], { stroke: 'var(--fg)', strokeDasharray: '3,3', strokeOpacity: 0.5 })),
        ...rules.map((r) => Plot.text([r], { x: 'date', frameAnchor: 'top', text: 'label', dy: -16, fill: 'var(--fg)', fontWeight: 500 })),
        Plot.dot(dots, { x: 'date', y: 'value', r: 2.5, fill: (d) => color(d.candidate), fillOpacity: (d) => 0.35 * fade(d) }),
        Plot.line(flat.filter((d) => dashed(d)), { x: 'date', y: 'value', z: 'candidate', stroke: (d) => color(d.candidate),
          strokeWidth: 1.5, strokeDasharray: '4,3', strokeOpacity: fade, curve }),
        Plot.line(flat.filter((d) => !dashed(d)), { x: 'date', y: 'value', z: 'candidate', stroke: (d) => color(d.candidate),
          strokeWidth: (d) => (focusable && state.focus === d.candidate ? 3.5 : 2.25), strokeOpacity: fade, curve }),
        Plot.dot(extra, { x: 'date', y: 'value', symbol: 'diamond', r: 6, fill: (d) => color(d.candidate), stroke: 'var(--bg)', strokeWidth: 1.5, fillOpacity: fade }),
        Plot.text(labels, { x: 'date', y: 'y', text: (d) => d.candidate + ' ' + pct.format(d.value), dx: 8, textAnchor: 'start',
          fill: (d) => color(d.candidate), fontWeight: 600, fillOpacity: fade }),
        Plot.tip([...(dots.length ? dots : finite), ...extra], Plot.pointer({ x: 'date', y: 'value', title: tip,
          fill: 'var(--panel)', stroke: 'var(--line)' })),
      ],
    });
    target.replaceChildren(chart);
  };
  draw();
  observers.get(target)?.disconnect();
  let w = target.clientWidth;
  const ro = new ResizeObserver(() => { if (target.clientWidth !== w) { w = target.clientWidth; draw(); } });
  ro.observe(target);
  observers.set(target, ro);
}

function renderCharts() {
  const { e, data, round, polls, st } = view;
  const vote = e.past ? e.vote(round) : null;
  const res = e.results.get(round);

  // Sondages
  $('t-polls').textContent = 'Intentions de vote, ' + roundName(round);
  $('n-polls').textContent = 'Chaque point est un sondage. La ligne est la moyenne des 5 derniers sondages, sur 90 jours au plus : elle s’interrompt quand il y en a moins de 3.'
    + (res ? ' Losange : le résultat. Part des voix entre les candidats du résultat.' : '');
  const order = res ? res.map((r) => r.candidate) : st.polled.map((r) => r.candidate);
  const shown = order.slice(0, SHOWN);
  if (state.focus && !shown.includes(state.focus) && polls.some((p) => p.values.has(state.focus))) shown.push(state.focus);
  if (!polls.length || !shown.length) {
    $('chart-polls').replaceChildren(el('p', 'empty', 'Pas assez de sondages.'));
  } else {
    const end = vote || st.last;
    const start = new Date(Math.max(+end - HISTORY * DAY, +polls[0].date - 7 * DAY));  // pas de vide avant le premier sondage
    const dots = polls.filter((p) => p.date >= start).flatMap((p) => shown.filter((c) => p.values.has(c))
      .map((c) => ({ candidate: c, date: p.date, value: p.values.get(c), poll: p })));
    const total = res ? res.reduce((s, r) => s + r.value, 0) : 0;
    lineChart($('chart-polls'), {
      dots, color: colorOf,
      series: shown.map((c) => rolling(polls, c, start, st.last)).filter((s) => s.length),
      extra: res ? res.filter((r) => shown.includes(r.candidate)).map((r) => ({ candidate: r.candidate, date: vote, value: 100 * r.value / total, result: true })) : [],
      rules: vote ? [{ date: vote, label: 'Vote' }] : [],
      xDomain: vote ? [start, new Date(+vote + 7 * DAY)] : undefined,
      yLabel: res ? '↑ part des voix' : '↑ intentions de vote',
      tip: (d) => (d.result ? d.candidate + ' : ' + pct.format(d.value) + ' %\nRésultat'
        : d.candidate + ' : ' + pct.format(d.value) + ' %\n' + d.poll.institute
          + (d.poll.sponsors.size ? ' pour ' + [...d.poll.sponsors].join(', ') : '') + '\nTerrain : ' + d.poll.label),
    });
  }

  // Marché
  const mk = data.market.slice(0, SHOWN).map((m) => m.candidate);
  if (state.focus && !mk.includes(state.focus) && data.market.some((m) => m.candidate === state.focus)) mk.push(state.focus);
  const series = mk.map((c) => data.marketSeries.filter((p) => p.candidate === c)).filter((s) => s.length);
  if (!series.length) {
    $('chart-market').replaceChildren(el('p', 'empty', 'Pas de cotes disponibles.'));
  } else {
    lineChart($('chart-market'), {
      series, color: colorOf, yLabel: '↑ chance de victoire',
      rules: e.past ? [{ date: e.end, label: 'Vote' }] : [],
      xDomain: e.past ? [d3.min(series.flat(), (d) => d.date), new Date(+e.end + 7 * DAY)] : undefined,
      tip: (d) => d.candidate + ' : ' + pct.format(d.value) + ' %\n' + longDay.format(d.date),
    });
  }

  // Duel : chance de victoire du vainqueur, sondages contre marché
  if (!e.past) return;
  const winner = e.results.get(e.decisive)[0].candidate;
  $('t-duel').textContent = 'Chance de victoire de ' + fullName(winner) + ', jour par jour';
  const rows = (data.duel || []).filter((r) => r.candidat === winner);
  const pm = rows.filter((r) => r.polymarket != null).map((r) => ({ candidate: 'L’argent', date: utc(r.jour), value: +r.polymarket }));
  const sd = rows.filter((r) => r.proba_sondages != null).map((r) => ({ candidate: 'La rue', date: utc(r.jour), value: +r.proba_sondages }));
  if (!pm.length && !sd.length) {
    $('chart-duel').replaceChildren(el('p', 'empty', 'Pas assez de données pour suivre le duel jour par jour.'));
    return;
  }
  lineChart($('chart-duel'), {
    series: [pm, sd].filter((s) => s.length), color: (c) => (c === 'L’argent' ? 'var(--market)' : 'var(--polls)'),
    yDomain: [0, 100], ruleY: 50, focusable: false, yLabel: '↑ chance de victoire', rules: [{ date: e.end, label: 'Vote' }],
    xDomain: [d3.min([...pm, ...sd], (d) => d.date), new Date(+e.end + 7 * DAY)],
    tip: (d) => d.candidate + ' : ' + pct.format(d.value) + ' %\n' + longDay.format(d.date),
  });
}

// Nuit du vote : cotes des deux finalistes au pas de 10 minutes ; marchés locaux en pointillé.
function renderNight() {
  const { e, data } = view;
  const box = $('sec-night');
  box.hidden = !e.past || !data.night.length;
  if (box.hidden) return;
  const label = (r) => (r.serie === 'national' ? r.candidat : r.candidat + ' · ' + r.serie);
  const series = [...new Set(data.night.map(label))].map((l) => data.night.filter((r) => label(r) === l)
    .map((r) => ({ candidate: l, local: r.serie !== 'national', date: new Date(r.ts * 1000), value: r.price * 100 })));
  const winner = e.results.get(e.decisive)[0].candidate;
  const nat = series.find((s) => s[0].candidate === winner);
  $('t-night').textContent = nat ? 'La nuit du vote\u00a0: ' + fullName(winner) + ' de ' + Math.round(nat[0].value) + ' % à '
    + Math.round(nat.at(-1).value) + ' % sur Polymarket' : 'La nuit du vote';
  const volumes = [...new Set(data.night.map((r) => r.serie))].map((serie) => {
    const byCand = new Map(data.night.filter((r) => r.serie === serie).map((r) => [r.candidat, r.volume || 0]));
    return [serie, [...byCand.values()].reduce((a, b) => a + b, 0)];
  });
  $('n-night').textContent = 'Cote de chaque finaliste toutes les 10 minutes, heure de Paris, du jour du vote au lendemain. '
    + volumes.map(([serie, v]) => (serie === 'national' ? 'Marché national' : 'Marché « ' + serie + ' » (pointillé)') + '\u00a0: ' + usd(v) + ' échangés').join(' · ')
    + '.';
  lineChart($('chart-night'), {
    series, color: (c) => colorOf(c.split(' · ')[0]), dashed: (d) => d.local, focusable: false, yDomain: [0, 100], ruleY: 50,
    yLabel: '↑ chance de victoire', curve: 'step-after', xFormat: (d) => hour.format(d), ticks: 8,
    tip: (d) => d.candidate + '\u00a0: ' + pct.format(d.value) + ' %\n' + dayHour.format(d.date),
  });
}

function renderLatest() {
  const { e, polls } = view;
  $('t-latest').textContent = e.past ? 'Derniers sondages avant le vote' : 'Derniers sondages';
  const list = $('latest');
  list.replaceChildren();
  if (!polls.length) { list.append(el('li', 'empty', 'Aucun sondage.')); return; }
  polls.slice(-8).reverse().forEach((p) => {
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
      dot.style.background = colorOf(c);
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

init().catch((err) => {
  $('headline').textContent = 'Données indisponibles';
  $('lede').textContent = err.message || String(err);
});
