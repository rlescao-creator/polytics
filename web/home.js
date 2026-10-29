// Accueil « l'argent contre la rue » : ce que disent les sondages publiés par les médias contre ce que
// misent les parieurs de Polymarket, sur toutes les présidentielles passées.
// Compte à rebours : à J-d, le favori de chaque camp (bilan_favoris) a-t-il gagné ? Comparé à 2027.
// Veille : chance donnée au vainqueur le jour avant le vote (bilan_quotidien). Gauche ou droite : écart des
// sondages sur le candidat le plus à droite. Nuit du vote : nuit_electorale.
const { supabaseUrl, supabaseKey, election: LIVE, exclus = [], plusADroite = {} } = window.POLL_CONFIG;
const EXCLUDED = new Set(exclus);
const db = window.supabase.createClient(supabaseUrl, supabaseKey);

// Anciennes adresses (?e=…) : la page élection a déménagé.
if (new URLSearchParams(location.search).has('e')) location.replace('election.html' + location.search);

const DAY = 86400000;
const WINDOW = 30;       // jours de terrain pris dans la moyenne en direct
const MIN_POLLS = 3;
const HORIZON = 100;     // compte à rebours : jours avant le vote comparés

const $ = (id) => document.getElementById(id);
const pct = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const shortDay = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const month = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const hour = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const dayHour = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const region = new Intl.DisplayNames(['fr'], { type: 'region' });
const usd = (v) => compact.format(v) + ' $';
const utc = (iso) => new Date(iso + 'T00:00:00Z');
const isoDay = (d) => d.toISOString().slice(0, 10);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const signed1 = (v) => {
  const r = Math.round(v * 10) / 10;
  return (r > 0 ? '+' : r < 0 ? '−' : '') + pct.format(Math.abs(r));
};
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length / 2;
  return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2;
};
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
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

async function load() {
  const since = isoDay(new Date(Date.now() - 120 * DAY));
  const [elections, results, cands, daily, markets, livePolls, favoris] = await Promise.all([
    all(() => db.from('elections').select('id, country, election_date, second_round_date').order('id')),
    all(() => db.from('results').select('election_id, round, candidate, value').order('election_id')),
    all(() => db.from('candidates').select('name, full_name, parties(color)').eq('kind', 'personne').order('name')),
    all(() => db.from('bilan_quotidien').select('election_id, jour, candidat, polymarket, proba_sondages, part_sondages')
      .eq('gagnant', true).order('election_id').order('jour')),
    all(() => db.from('markets').select('election_id, candidate_name, volume, last_price, closed').order('condition_id')),
    all(() => db.from('polls').select('id, fieldwork_end, fieldwork_label, institute, poll_results(candidate, value)')
      .eq('election_id', LIVE).eq('round', 1).gte('fieldwork_end', since).order('id')),
    // Table absente tant que la migration bilan_favoris n'est pas appliquée : pas de compte à rebours.
    all(() => db.from('bilan_favoris').select('election_id, jours, gagnant, favori_marche, proba_marche, favori_sondages, moyenne_sondages')
      .order('election_id').order('jours')).catch(() => null),
  ]);
  const people = new Map(cands.map((c) => [c.name, { full: c.full_name || c.name, color: c.parties && c.parties.color }]));

  // Dollars échangés sur le marché de chaque candidat (pour le dernier match).
  const today = new Date();
  const volumeOf = (eid) => {
    const named = new Map();
    markets.filter((m) => m.election_id === eid && m.candidate_name)
      .forEach((m) => named.set(m.candidate_name, (named.get(m.candidate_name) || 0) + (m.volume || 0)));
    return named;
  };

  // Une ligne par élection passée : vainqueur, chances la veille, écart des sondages.
  const matches = elections.map((e) => {
    const res = results.filter((r) => r.election_id === e.id);
    if (!res.length) return null;
    const round = Math.max(...res.map((r) => r.round));
    const vote = utc(round === 2 ? e.second_round_date : e.election_date);
    if (vote >= today) return null;
    const days = daily.filter((d) => d.election_id === e.id && d.polymarket != null && d.proba_sondages != null);
    if (!days.length) return null;
    const eve = days.find((d) => d.jour === isoDay(new Date(+vote - DAY)));
    const final = res.filter((r) => r.round === round).sort((a, b) => b.value - a.value);
    const m = {
      id: e.id, country: region.of(e.country), year: e.id.split('-')[1], vote,
      winner: days[0].candidat, loser: final.find((r) => r.candidate !== days[0].candidat)?.candidate, share: final[0].value,
      evePolls: eve ? +eve.proba_sondages : null, eveMarket: eve ? +eve.polymarket : null,
      // Part du vainqueur entre les deux premiers : dernière semaine de sondages la veille, et résultat.
      evePart: eve && eve.part_sondages != null ? +eve.part_sondages : null,
      result2: final.length >= 2 ? 100 * final[0].value / (final[0].value + final[1].value) : null,
      excluded: EXCLUDED.has(e.id),
      volumes: volumeOf(e.id),
      series: days.map((d) => ({ date: utc(d.jour), polls: +d.proba_sondages, market: +d.polymarket })),
    };
    return m;
  }).filter(Boolean).sort((a, b) => b.vote - a.vote);

  const counted = matches.filter((m) => !m.excluded);

  // Nuit du vote de la dernière élection (table absente ou vide : pas de graphique).
  const night = matches[0]
    ? await all(() => db.from('nuit_electorale').select('serie, candidat, volume, ts, price').eq('election_id', matches[0].id).order('ts'))
      .catch(() => [])
    : [];

  const live = elections.find((e) => e.id === LIVE);
  const liveVote = live && (live.second_round_date || live.election_date);
  return {
    people, matches, counted, night, favoris, liveVote: liveVote ? utc(liveVote) : null, liveFirst: live?.election_date ? utc(live.election_date) : null,
    live: liveSummary(people, markets.filter((m) => m.election_id === LIVE), livePolls),
  };
}

// Élection en cours : même règle que la page élection (un sondage = un institut et un terrain,
// hypothèses moyennées ; 30 jours avant le dernier sondage ; 3 sondages minimum).
function liveSummary(people, markets, rows) {
  const polls = new Map();
  rows.forEach((r) => {
    const key = r.institute + '|' + r.fieldwork_label + '|' + r.fieldwork_end;
    const p = polls.get(key) || { date: utc(r.fieldwork_end), sums: new Map() };
    r.poll_results.filter((v) => people.has(v.candidate) && v.value > 0).forEach((v) => {
      const acc = p.sums.get(v.candidate) || { sum: 0, n: 0 };
      acc.sum += v.value; acc.n += 1;
      p.sums.set(v.candidate, acc);
    });
    polls.set(key, p);
  });
  const list = [...polls.values()].filter((p) => p.sums.size);
  const last = list.length ? new Date(Math.max(...list.map((p) => +p.date))) : null;
  const stats = new Map();
  list.filter((p) => last && p.date > new Date(+last - WINDOW * DAY))
    .forEach((p) => p.sums.forEach((a, c) => stats.set(c, [...(stats.get(c) || []), a.sum / a.n])));
  const pollTop = [...stats].filter(([, v]) => v.length >= MIN_POLLS)
    .map(([candidate, v]) => ({ candidate, value: mean(v), n: v.length })).sort((a, b) => b.value - a.value).slice(0, 4);
  const best = new Map();
  markets.filter((m) => !m.closed && m.candidate_name && m.last_price != null).forEach((m) => {
    const prev = best.get(m.candidate_name);
    if (!prev || prev.price < m.last_price) best.set(m.candidate_name, { price: m.last_price, volume: m.volume });
  });
  const marketTop = [...best].map(([candidate, b]) => ({ candidate, value: b.price * 100, volume: b.volume }))
    .sort((a, b) => b.value - a.value).slice(0, 4);
  return { pollTop, marketTop, last };
}

// --- Rendu
function verdict(m) {
  const right = { polls: m.evePolls > 50, market: m.eveMarket > 50 };
  const closer = m.evePolls > m.eveMarket ? 'la rue' : 'l’argent';
  if (right.polls && right.market) return m.country + ' : la rue et l’argent avaient le bon favori';
  if (!right.polls && !right.market) return m.country + ' : la rue et l’argent se sont trompés, ' + closer + ' moins';
  return m.country + ' : ' + (right.polls ? 'la rue avait vu juste, pas l’argent' : 'l’argent avait vu juste, pas la rue');
}

function stepChart(target, { pts, color, domain, yLabel, tickFormat, ticks, rule, ruleLabel, tip, label }) {
  const draw = () => {
    const width = target.clientWidth;
    const narrow = width < 520;
    const ends = [...new Set(pts.map((p) => p.serie))].map((s) => pts.filter((p) => p.serie === s).at(-1))
      .sort((x, y) => y.value - x.value).map((d) => ({ ...d, y: d.value }));
    for (let i = 1; i < ends.length; i++) if (ends[i - 1].y - ends[i].y < 9) ends[i].y = ends[i - 1].y - 9;
    target.replaceChildren(Plot.plot({
      width, height: narrow ? 280 : 340, marginLeft: 40, marginRight: narrow ? 112 : 150, marginTop: 28,
      style: { color: 'var(--muted)', background: 'transparent', fontSize: '12px' },
      x: { type: 'utc', label: null, ticks: narrow ? 4 : ticks, tickFormat, domain },
      y: { domain: [0, 100], label: yLabel, ticks: [0, 25, 50, 75, 100], tickFormat: (v) => v + ' %', grid: true },
      marks: [
        Plot.rectY([{ x1: domain[0], x2: domain[1] }], { x1: 'x1', x2: 'x2', y1: 50, y2: 100, fill: 'var(--track)', fillOpacity: 0.6 }),
        Plot.ruleY([50], { stroke: 'var(--fg)', strokeOpacity: 0.6 }),
        ...(rule ? [Plot.ruleX([rule], { stroke: 'var(--fg)', strokeDasharray: '3,3' }),
          Plot.text([{ date: rule }], { x: 'date', frameAnchor: 'top', dy: -16, text: () => ruleLabel, fill: 'var(--fg)', fontWeight: 700 })] : []),
        Plot.line(pts.filter((d) => !d.dashed), { x: 'date', y: 'value', z: 'serie', stroke: (d) => color(d.serie), strokeWidth: 2.5, curve: 'step-after' }),
        Plot.line(pts.filter((d) => d.dashed), { x: 'date', y: 'value', z: 'serie', stroke: (d) => color(d.serie), strokeWidth: 1.75,
          strokeDasharray: '4,3', curve: 'step-after' }),
        Plot.text(ends, { x: 'date', y: 'y', text: label, dx: 8, textAnchor: 'start', fill: (d) => color(d.serie), fontWeight: 700, fontSize: 13, lineWidth: 12 }),
        Plot.tip(pts, Plot.pointerX({ x: 'date', y: 'value', title: tip, fill: 'var(--panel)', stroke: 'var(--line)' })),
      ],
    }));
  };
  draw();
  let w = target.clientWidth;
  new ResizeObserver(() => { if (target.clientWidth !== w) { w = target.clientWidth; draw(); } }).observe(target);
}

function renderLast({ people, matches, night }) {
  const m = matches[0];
  if (!m) return;
  const name = (c) => people.get(c)?.full || c;
  $('t-last').textContent = verdict(m);
  const note = $('n-last');
  const onWinner = m.volumes.get(m.winner);
  const onLoser = m.volumes.get(m.loser);
  note.replaceChildren(el('b', '', name(m.winner) + ' ' + pct.format(m.share) + ' %'), ' · la veille\u00a0: ',
    el('b', 'polls-ink', 'la rue ' + pct0.format(m.evePolls) + ' %'), ', ', el('b', 'market-ink', 'l’argent ' + pct0.format(m.eveMarket) + ' %'), ' de chances',
    onWinner && onLoser ? ' · ' + usd(onWinner) + ' échangés sur ' + m.winner + ', ' + usd(onLoser) + ' sur ' + m.loser + '. ' : '. ');
  const a = el('a', '', 'Toute l’élection →');
  a.href = 'election.html?e=' + m.id;
  note.append(a);

  const start = new Date(+m.vote - 150 * DAY);
  const pts = m.series.filter((d) => d.date >= start).flatMap((d) => [
    { serie: 'La rue', date: d.date, value: d.polls }, { serie: 'L’argent', date: d.date, value: d.market }]);
  stepChart($('chart-last'), {
    pts, color: (s) => (s === 'La rue' ? 'var(--polls)' : 'var(--market)'), domain: [start, new Date(+m.vote + 3 * DAY)],
    yLabel: '↑ chance de victoire de ' + m.winner, ticks: 6, tickFormat: (d) => month.format(d), rule: m.vote, ruleLabel: 'Vote',
    label: (d) => d.serie + ' ' + pct0.format(d.value) + ' %',
    tip: (d) => d.serie + ' : ' + pct.format(d.value) + ' %\n' + shortDay.format(d.date),
  });
  renderNight(m, night, name);
}

// Nuit du vote : la cote du vainqueur au pas de 10 minutes, marché national et marchés locaux.
function renderNight(m, night, name) {
  const rows = night.filter((r) => r.candidat === m.winner);
  if (!rows.length) return;
  $('night-last').hidden = false;
  const series = [...new Set(rows.map((r) => r.serie))];
  const volume = new Map(series.map((s) => [s, sum([...new Set(night.filter((r) => r.serie === s).map((r) => r.candidat))]
    .map((c) => night.find((r) => r.serie === s && r.candidat === c).volume || 0))]));
  const label = (s) => (s === 'national' ? 'National' : s);
  const pts = rows.map((r) => ({ serie: r.serie, date: new Date(r.ts * 1000), value: r.price * 100, dashed: r.serie !== 'national' }));
  const nat = pts.filter((p) => p.serie === 'national');
  if (nat.length) {
    // Saut le plus net de la nuit : la plus forte hausse sur 3 heures, pour dater le moment où l'argent a basculé.
    let jump = null;
    nat.forEach((p, i) => {
      const before = nat.find((q) => +q.date >= +p.date - 3 * 3600000);
      if (before && (!jump || p.value - before.value > jump.gain)) jump = { from: before, to: p, gain: p.value - before.value };
    });
    $('t-night').textContent = 'La nuit du vote : ' + name(m.winner) + ' de ' + pct0.format(nat[0].value) + ' % à ' + pct0.format(nat.at(-1).value) + ' % sur Polymarket';
    const n = $('n-night');
    n.replaceChildren('Cote de ' + name(m.winner) + ' toutes les 10 minutes, heure de Paris. ');
    if (jump && jump.gain >= 20) {
      n.append('L’argent bascule entre ' + dayHour.format(jump.from.date) + ' et ' + hour.format(jump.to.date) + ' : ',
        el('b', 'market-ink', pct0.format(jump.from.value) + ' % → ' + pct0.format(jump.to.value) + ' %'), ', au rythme du dépouillement. ');
    }
    const local = series.filter((s) => s !== 'national');
    if (local.length) {
      n.append('En pointillé, ' + local.map((s) => 'le marché « ' + s + ' », ' + usd(volume.get(s)) + ' échangés').join(', ')
        + '\u00a0; le marché national en a brassé ',
        el('b', '', usd(volume.get('national'))), '.');
    }
  }
  const range = [d3.min(pts, (d) => d.date), d3.max(pts, (d) => d.date)];
  stepChart($('chart-night'), {
    pts, color: () => 'var(--market)', domain: range, yLabel: '↑ chance de victoire de ' + m.winner, ticks: 8,
    tickFormat: (d) => hour.format(d), label: (d) => label(d.serie) + ' ' + pct0.format(d.value) + ' %',
    tip: (d) => label(d.serie) + ' : ' + pct.format(d.value) + ' %\n' + dayHour.format(d.date),
  });
}

// --- Compte à rebours : à J-d du vote décisif, le favori de chaque camp a-t-il fini par gagner ?
// bilan_favoris donne, à la ligne d, la cote d'avant le jour J-d (la veille au soir de J-d) : la cote à la fin
// de J-d est donc à la ligne d-1, comme la cote « la veille » de bilan_quotidien. Les sondages restent ceux
// terminés avant J-d.
function favoriteAt(favoris, matches, d) {
  return matches.map((m) => {
    const row = (k) => favoris.find((f) => f.election_id === m.id && f.jours === k);
    const polls = row(d);
    const market = row(d - 1);
    const pick = (name, value, r) => (name ? { name, value: +value, right: name === r.gagnant } : null);
    return { m, polls: polls && pick(polls.favori_sondages, polls.moyenne_sondages, polls),
             market: market && pick(market.favori_marche, market.proba_marche, market) };
  });
}

function tally(rows, camp) {
  const seen = rows.filter((r) => r[camp]);
  return { right: seen.filter((r) => r[camp].right).length, n: seen.length };
}

const longDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function renderCountdown(data) {
  const { favoris, matches, excluded = [], liveVote, live, people } = data;
  if (!favoris || !favoris.length || !liveVote) return;
  const today = utc(isoDay(new Date()));
  const J = Math.round((liveVote - today) / DAY);
  if (J < 1) return;
  $('sec-countdown').hidden = false;
  $('cd-sub').textContent = 'avant le vote · 2027\u00a0: J-' + J + ' aujourd’hui, 2nd tour le ' + longDate.format(liveVote);
  // Au-delà de J-100, trop d'élections n'ont encore ni marché ni assez de sondages pour comparer.
  const max = Math.min(HORIZON, Math.max(...favoris.map((f) => f.jours)));

  // 2027 aujourd'hui, en une ligne.
  const p = live.pollTop[0];
  const mk = live.marketTop[0];
  if (p && mk) {
    const now = $('cd-now');
    const name = (c) => people.get(c)?.full || c;
    now.replaceChildren(el('span', 'cd-now-label', '2027 aujourd’hui'));
    if (p.candidate === mk.candidate) now.append(el('b', '', name(p.candidate)), ' en tête des deux côtés ');
    else now.append('la rue : ', el('b', '', name(p.candidate)), ' · l’argent : ', el('b', '', name(mk.candidate)), ' ');
    const more = el('a', 'cd-more', 'Suivre 2027 →');
    more.href = 'election.html';
    now.append(el('span', 'polls-ink', pct0.format(p.value) + ' %'), ' · ', el('span', 'market-ink', pct0.format(mk.value) + ' %'), more);
  }

  // Courbe : part des élections où le favori de chaque camp a gagné, selon le nombre de jours avant le vote.
  const curve = [];
  for (let d = 1; d <= max; d++) {
    const rows = favoriteAt(favoris, matches, d);
    [['La rue', 'polls'], ['L’argent', 'market']].forEach(([serie, camp]) => {
      const t = tally(rows, camp);
      curve.push({ serie, d, value: t.n >= 3 ? 100 * t.right / t.n : NaN, right: t.right, n: t.n });
    });
  }
  const color = (s) => (s === 'La rue' ? 'var(--polls)' : 'var(--market)');
  const target = $('chart-countdown');
  let selected = Math.min(J, max);
  const draw = () => {
    const width = target.clientWidth;
    const narrow = width < 520;
    const finite = curve.filter((q) => Number.isFinite(q.value));
    const ends = ['La rue', 'L’argent'].map((s) => finite.filter((q) => q.serie === s).sort((a, b) => a.d - b.d)[0]).filter(Boolean);
    target.replaceChildren(Plot.plot({
      width, height: narrow ? 200 : 240, marginLeft: 40, marginRight: narrow ? 64 : 80, marginTop: 24, marginBottom: 28,
      style: { color: 'var(--muted)', background: 'transparent', fontSize: '12px' },
      x: { domain: [max, 0], label: null, tickFormat: (d) => 'J-' + d, ticks: narrow ? 4 : 8 },
      y: { domain: [0, 100], label: null, ticks: [0, 50, 100], tickFormat: (v) => v + ' %', grid: true },
      marks: [
        ...(J <= max ? [Plot.ruleX([J], { stroke: 'var(--fg)', strokeWidth: 2 }),
          Plot.text([{ d: J }], { x: 'd', frameAnchor: 'top', dy: -14, text: () => '2027', fill: 'var(--fg)', fontWeight: 800 })] : []),
        ...(selected !== J ? [Plot.ruleX([selected], { stroke: 'var(--fg)', strokeDasharray: '3,3' })] : []),
        Plot.line(curve, { x: 'd', y: 'value', z: 'serie', stroke: (q) => color(q.serie), strokeWidth: 2.5, curve: 'step-after' }),
        Plot.text(ends, { x: 'd', y: 'value', text: 'serie', dx: 8, textAnchor: 'start', fill: (q) => color(q.serie), fontWeight: 800 }),
        Plot.tip(finite, Plot.pointer({ x: 'd', y: 'value', title: (q) => q.serie + ' à J-' + q.d + ' : ' + q.right + ' sur ' + q.n,
          fill: 'var(--panel)', stroke: 'var(--line)' })),
      ],
    }));
  };

  const range = $('cd-range');
  range.max = max;
  range.value = selected;
  const rate = (t) => (t.n ? t.right + '/' + t.n : '–');
  const show = (d) => {
    selected = d;
    $('cd-j').textContent = 'J-' + d;
    $('cd-out').textContent = d === J ? 'aujourd’hui' : 'J-' + d;
    const rows = favoriteAt(favoris, matches, d);
    $('cd-rate-polls').textContent = rate(tally(rows, 'polls'));
    $('cd-rate-market').textContent = rate(tally(rows, 'market'));

    // Une fiche par élection : nom court, barre au %, ✓ ou ✗ ; rien à lire de plus.
    const grid = $('cd-grid');
    grid.replaceChildren();
    // Élections sans aucune donnée à ce stade : en fin de grille, atténuées.
    [...rows.filter((r) => r.polls || r.market), ...rows.filter((r) => !r.polls && !r.market)].forEach((r) => {
      const li = el('li', 'cd-card' + (r.polls || r.market ? '' : ' empty'));
      const head = el('div', 'cd-card-head');
      head.append(el('span', 'country', r.m.country + ' ' + r.m.year.slice(2)), el('span', 'cd-winner', '→ ' + r.m.winner));
      li.append(head);
      [['polls', 'La rue'], ['market', 'L’argent']].forEach(([camp, label]) => {
        const f = r[camp];
        const row = el('div', 'cd-row ' + camp + (f ? (f.right ? ' right' : ' wrong') : ' none'));
        const bar = el('span', 'cd-bar');
        const fill = el('i');
        fill.style.width = (f ? f.value : 0) + '%';
        bar.append(fill);
        row.append(el('span', 'cd-name', f ? f.name : '—'), bar, el('small', 'cd-src', camp === 'polls' ? 'médias' : 'Polymarket'), el('span', 'cd-v', f ? pct0.format(f.value) + ' %' : ''),
          el('span', 'cd-mark', f ? (f.right ? '✓' : '✗') : ''));
        row.setAttribute('aria-label', label + ' : ' + (f ? f.name + ' ' + pct0.format(f.value) + ' %, ' + (f.right ? 'a gagné' : 'a perdu') : 'pas de données'));
        row.title = row.getAttribute('aria-label');
        li.append(row);
      });
      grid.append(li);
    });
    excluded.forEach((m) => {
      const li = el('li', 'cd-card empty excluded');
      const head = el('div', 'cd-card-head');
      head.append(el('span', 'country', m.country + ' ' + m.year.slice(2)));
      li.append(head);
      grid.append(li);
    });
    draw();
  };
  range.addEventListener('input', () => show(+range.value));
  show(selected);
  let w = target.clientWidth;
  new ResizeObserver(() => { if (target.clientWidth !== w) { w = target.clientWidth; draw(); } }).observe(target);
}

// --- Gauche ou droite : écart des sondages, la veille, sur le candidat le plus à droite du duel final.
function renderLean({ counted, matches }) {
  $('caution').textContent = counted.length + ' élections';
  const out = matches.filter((m) => m.excluded);
  $('excluded-note').textContent = out.length
    ? out.map((m) => m.country + ' ' + m.year).join(', ') + ' écarté' + (out.length > 1 ? 's' : '') + ' des totaux'
    : 'aucune élection écartée';
  const lean = counted.filter((m) => plusADroite[m.id] && m.evePart != null && m.result2 != null).map((m) => {
    const gap = m.evePart - m.result2;   // écart sur le vainqueur
    return { m, gap: plusADroite[m.id] === m.winner ? gap : -gap };
  }).sort((a, b) => a.gap - b.gap);
  if (!lean.length) return;
  $('sec-lean').hidden = false;
  const med = median(lean.map((l) => l.gap));
  const over = lean.filter((l) => l.gap > 0.5).length;
  const under = lean.filter((l) => l.gap < -0.5).length;
  $('t-lean').textContent = Math.abs(med) < 1 ? 'Les sondages ne penchent ni à gauche ni à droite'
    : med > 0 ? 'Les sondages surestiment la droite' : 'Les sondages sous-estiment la droite';
  $('n-lean').textContent = 'Candidat le plus à droite : sous-estimé ' + under + ' fois, surestimé ' + over + ' fois · écart médian ' + signed1(med) + ' point.';
  const box = $('lean');
  box.replaceChildren();
  const scale = Math.max(5, Math.ceil(Math.max(...lean.map((l) => Math.abs(l.gap)))));
  const list = el('ol', 'lean-list');
  lean.forEach((l) => {
    const li = el('li');
    const track = el('span', 'lean-track');
    const bar = el('i', l.gap >= 0 ? 'pos' : 'neg');
    bar.style.width = (50 * Math.abs(l.gap) / scale) + '%';
    track.append(bar);
    li.append(el('span', 'lean-name', l.m.country + ' · ' + plusADroite[l.m.id]), track, el('span', 'lean-v', signed1(l.gap)));
    list.append(li);
  });
  const axis = el('div', 'lean-axis');
  axis.append(el('span', '', '← sous-estimée'), el('span', '', 'surestimée →'));
  box.append(list, axis);
}

load().then((data) => {
  renderCountdown({ ...data, matches: data.counted, excluded: data.matches.filter((m) => m.excluded) });
  renderLast(data);
  renderLean(data);
}).catch((err) => {
  const status = $('status');
  status.hidden = false;
  status.replaceChildren('Données indisponibles\u00a0: ' + (err.message || err) + '. ');
  const retry = el('button', 'link', 'Réessayer');
  retry.type = 'button';
  retry.addEventListener('click', () => location.reload());
  status.append(retry);
});
