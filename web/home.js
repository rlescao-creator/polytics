// Accueil « le match » : sondages contre Polymarket sur toutes les présidentielles passées.
// Score : pour chaque élection, le camp au plus petit score de Brier sur la campagne (même calcul que
// bilan_previsions, à partir de bilan_quotidien). Veille : chance donnée au vainqueur le jour avant le vote.
// Classement : agrégat de bilan_premier_a_voir (même calcul que classement_premier_a_voir).
// En direct : moyenne des sondages et cotes de l'élection en cours, comme sur election.html.
const { supabaseUrl, supabaseKey, election: LIVE } = window.POLL_CONFIG;
const db = window.supabase.createClient(supabaseUrl, supabaseKey);

// Anciennes adresses (?e=…) : la page élection a déménagé.
if (new URLSearchParams(location.search).has('e')) location.replace('election.html' + location.search);

const DAY = 86400000;
const WINDOW = 30;      // jours de terrain pris dans la moyenne en direct
const MIN_POLLS = 3;
const MIN_ELECTIONS = 2; // un institut entre au classement à partir de 2 élections

const $ = (id) => document.getElementById(id);
const pct = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const dec2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortDay = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const month = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const region = new Intl.DisplayNames(['fr'], { type: 'region' });
const utc = (iso) => new Date(iso + 'T00:00:00Z');
const isoDay = (d) => d.toISOString().slice(0, 10);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
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
const CAMP = { polls: 'Sondages', market: 'Marché' };

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
  const [elections, results, cands, daily, first, markets, polls] = await Promise.all([
    all(() => db.from('elections').select('id, country, election_date, second_round_date').order('id')),
    all(() => db.from('results').select('election_id, round, candidate, value').order('election_id')),
    all(() => db.from('candidates').select('name, full_name, parties(color)').eq('kind', 'personne').order('name')),
    all(() => db.from('bilan_quotidien').select('election_id, jour, candidat, polymarket, proba_sondages')
      .eq('gagnant', true).order('election_id').order('jour')),
    all(() => db.from('bilan_premier_a_voir').select('election_id, source, genre, juste, jours_avance').order('election_id').order('source')),
    all(() => db.from('markets').select('candidate_name, last_price, closed').eq('election_id', LIVE).order('candidate_name')),
    all(() => db.from('polls').select('id, fieldwork_end, fieldwork_label, institute, poll_results(candidate, value)')
      .eq('election_id', LIVE).eq('round', 1).gte('fieldwork_end', since).order('id')),
  ]);
  const people = new Map(cands.map((c) => [c.name, { full: c.full_name || c.name, color: c.parties && c.parties.color }]));

  // Une ligne par élection passée : vainqueur, chances la veille, Brier de chaque camp.
  const today = new Date();
  const matches = elections.map((e) => {
    const res = results.filter((r) => r.election_id === e.id);
    if (!res.length) return null;
    const round = Math.max(...res.map((r) => r.round));
    const vote = utc(round === 2 ? e.second_round_date : e.election_date);
    if (vote >= today) return null;
    const days = daily.filter((d) => d.election_id === e.id && d.polymarket != null && d.proba_sondages != null);
    if (!days.length) return null;
    const eve = days.find((d) => d.jour === isoDay(new Date(+vote - DAY)));
    const brier = (key) => mean(days.map((d) => (1 - d[key] / 100) ** 2));
    const m = {
      id: e.id, country: region.of(e.country), year: e.id.split('-')[1], vote,
      winner: days[0].candidat, share: res.filter((r) => r.round === round).sort((a, b) => b.value - a.value)[0].value,
      evePolls: eve ? +eve.proba_sondages : null, eveMarket: eve ? +eve.polymarket : null,
      brierPolls: brier('proba_sondages'), brierMarket: brier('polymarket'),
      series: days.map((d) => ({ date: utc(d.jour), polls: +d.proba_sondages, market: +d.polymarket })),
    };
    m.camp = m.brierPolls < m.brierMarket ? 'polls' : 'market';
    return m;
  }).filter(Boolean).sort((a, b) => b.vote - a.vote);

  // Classement des sources sur les élections retenues.
  const ids = new Set(matches.map((m) => m.id));
  const bySource = new Map();
  first.filter((f) => ids.has(f.election_id)).forEach((f) => {
    const s = bySource.get(f.source) || { source: f.source, genre: f.genre, rows: [] };
    s.rows.push(f);
    bySource.set(f.source, s);
  });
  const ranking = [...bySource.values()]
    .filter((s) => s.genre !== 'institut' || s.rows.length >= MIN_ELECTIONS)
    .map((s) => {
      const leads = s.rows.map((r) => r.jours_avance ?? 0);
      return { ...s, elections: s.rows.length, right: s.rows.filter((r) => r.juste).length, avg: mean(leads), med: median(leads) };
    })
    .sort((a, b) => Math.round(b.avg) - Math.round(a.avg) || b.right - a.right);

  return { people, matches, ranking, live: liveSummary(people, markets, polls) };
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
    if (!best.has(m.candidate_name) || best.get(m.candidate_name) < m.last_price) best.set(m.candidate_name, m.last_price);
  });
  const marketTop = [...best].map(([candidate, p]) => ({ candidate, value: p * 100 })).sort((a, b) => b.value - a.value).slice(0, 4);
  return { pollTop, marketTop, last };
}

// --- Rendu
function renderScore({ matches }) {
  const n = { polls: matches.filter((m) => m.camp === 'polls').length, market: matches.filter((m) => m.camp === 'market').length };
  const eve = {
    polls: matches.filter((m) => m.evePolls > 50).length, market: matches.filter((m) => m.eveMarket > 50).length,
    counted: matches.filter((m) => m.evePolls != null && m.eveMarket != null).length,
  };
  $('n-polls').textContent = n.polls;
  $('n-market').textContent = n.market;
  const lead = n.polls === n.market ? null : n.polls > n.market ? 'polls' : 'market';
  $('board-score').className = 'board-score' + (lead ? ' lead-' + lead : '');
  $('board-score').setAttribute('aria-label', 'Sondages ' + n.polls + ', marché ' + n.market);
  const since = Math.min(...matches.map((m) => +m.year));
  $('score-kicker').textContent = 'Le match · ' + matches.length + ' présidentielles depuis ' + since;
  $('caution').textContent = matches.length + ' élections, c’est peu';

  const deck = $('deck');
  deck.replaceChildren();
  const b = (t, cls) => el('b', cls, t);
  deck.append('Sur toute la campagne, ', lead ? b(lead === 'polls' ? 'les sondages' : 'le marché', lead + '-ink') : 'aucun camp',
    lead ? ' se sont moins trompés que ' + (lead === 'polls' ? 'Polymarket' : 'les sondages') : ' ne se trompe moins que l’autre',
    ' dans ' + Math.max(n.polls, n.market) + ' élections sur ' + matches.length + '. ');
  const eveLead = eve.polls === eve.market ? null : eve.polls > eve.market ? 'polls' : 'market';
  const twist = eveLead && eveLead !== lead ? 'Mais la veille du vote, ' : 'La veille du vote, ';
  deck.append(twist);
  if (!eveLead) deck.append('égalité : les deux camps avaient le bon favori ' + eve.polls + ' fois sur ' + eve.counted + '.');
  else {
    deck.append(eveLead === 'market' ? 'c’est le marché qui avait le plus souvent le bon favori : ' : 'ce sont les sondages qui avaient le plus souvent le bon favori : ',
      b(eve[eveLead] + ' fois sur ' + eve.counted, eveLead + '-ink'), ', contre ' + eve[eveLead === 'market' ? 'polls' : 'market'] + ' pour '
      + (eveLead === 'market' ? 'les sondages.' : 'le marché.'));
  }
}

function verdict(m) {
  const right = { polls: m.evePolls > 50, market: m.eveMarket > 50 };
  const better = m.camp === 'polls' ? 'les sondages' : 'le marché';
  if (right.polls && right.market) return m.country + ' : les deux avaient le bon favori, ' + better + ' plus tôt';
  if (!right.polls && !right.market) return m.country + ' : les deux se sont trompés, ' + better + ' moins';
  return m.country + ' : ' + (right.polls ? 'les sondages avaient vu juste, pas le marché' : 'le marché avait vu juste, pas les sondages');
}

function renderLast({ people, matches }) {
  const m = matches[0];
  if (!m) return;
  const name = people.get(m.winner)?.full || m.winner;
  $('t-last').textContent = verdict(m);
  const note = $('n-last');
  note.replaceChildren(
    'Chance de victoire donnée à ' + name + ' chaque jour, jusqu’au ' + shortDay.format(m.vote) + '. La veille : ',
    el('b', 'polls-ink', 'sondages ' + pct.format(m.evePolls) + ' %'), ', ', el('b', 'market-ink', 'Polymarket ' + pct.format(m.eveMarket) + ' %'),
    '. Résultat : ' + name + ' l’emporte avec ' + pct.format(m.share) + ' %. ');
  const a = el('a', '', 'Toute l’élection →');
  a.href = 'election.html?e=' + m.id;
  note.append(a);

  const start = new Date(+m.vote - 150 * DAY);
  const pts = m.series.filter((d) => d.date >= start).flatMap((d) => [
    { camp: 'Sondages', date: d.date, value: d.polls }, { camp: 'Polymarket', date: d.date, value: d.market }]);
  const color = (c) => (c === 'Sondages' ? 'var(--polls)' : 'var(--market)');
  const target = $('chart-last');
  const draw = () => {
    const width = target.clientWidth;
    const narrow = width < 520;
    const ends = ['Sondages', 'Polymarket'].map((c) => pts.filter((p) => p.camp === c).at(-1)).filter(Boolean)
      .sort((x, y) => y.value - x.value);
    if (ends.length === 2 && ends[0].value - ends[1].value < 9) ends[1] = { ...ends[1], y: ends[0].value - 9 };
    target.replaceChildren(Plot.plot({
      width, height: narrow ? 280 : 360, marginLeft: 40, marginRight: narrow ? 100 : 130, marginTop: 28,
      style: { color: 'var(--muted)', background: 'transparent', fontSize: '12px' },
      x: { type: 'utc', label: null, ticks: narrow ? 4 : 6, tickFormat: (d) => month.format(d), domain: [start, new Date(+m.vote + 3 * DAY)] },
      y: { domain: [0, 100], label: '↑ chance de victoire de ' + m.winner, ticks: [0, 25, 50, 75, 100], tickFormat: (v) => v + ' %', grid: true },
      marks: [
        Plot.rectY([{ x1: start, x2: m.vote }], { x1: 'x1', x2: 'x2', y1: 50, y2: 100, fill: 'var(--track)', fillOpacity: 0.6 }),
        Plot.ruleY([50], { stroke: 'var(--fg)', strokeOpacity: 0.6 }),
        Plot.ruleX([m.vote], { stroke: 'var(--fg)', strokeDasharray: '3,3' }),
        Plot.text([{ date: m.vote }], { x: 'date', frameAnchor: 'top', dy: -16, text: () => 'Vote', fill: 'var(--fg)', fontWeight: 700 }),
        Plot.line(pts, { x: 'date', y: 'value', z: 'camp', stroke: (d) => color(d.camp), strokeWidth: 2.5, curve: 'step-after' }),
        Plot.text(ends, { x: 'date', y: (d) => d.y ?? d.value, text: (d) => d.camp + ' ' + pct0.format(d.value) + ' %', dx: 8, textAnchor: 'start',
          fill: (d) => color(d.camp), fontWeight: 700, fontSize: 13 }),
        Plot.tip(pts, Plot.pointerX({ x: 'date', y: 'value', title: (d) => d.camp + ' : ' + pct.format(d.value) + ' %\n' + shortDay.format(d.date),
          fill: 'var(--panel)', stroke: 'var(--line)' })),
      ],
    }));
  };
  draw();
  let w = target.clientWidth;
  new ResizeObserver(() => { if (target.clientWidth !== w) { w = target.clientWidth; draw(); } }).observe(target);
}

function renderSheet({ people, matches }) {
  const list = $('sheet');
  list.replaceChildren();
  const head = el('li', 'sheet-head');
  head.setAttribute('aria-hidden', 'true');
  const scale = el('div', 'scale');
  ['0 %', '50 %', '100 %'].forEach((t) => scale.append(el('span', '', t)));
  head.append(el('span', '', 'Élection'), scale, el('span', 'r', 'Moins d’erreurs sur la campagne'));
  list.append(head);
  const tip = $('tip');
  matches.forEach((m) => {
    const li = el('li');
    const a = el('a', 'match ' + m.camp);
    a.href = 'election.html?e=' + m.id;
    const name = people.get(m.winner)?.full || m.winner;
    const desc = m.country + ' ' + m.year + ', vainqueur : ' + name + '. La veille : sondages ' + pct.format(m.evePolls) + ' %, Polymarket '
      + pct.format(m.eveMarket) + ' %. Erreur sur la campagne (Brier) : sondages ' + dec2.format(m.brierPolls) + ', marché ' + dec2.format(m.brierMarket) + '.';
    a.setAttribute('aria-label', desc);

    const who = el('span', 'who-match');
    who.append(el('span', 'country', m.country), el('span', 'meta', m.year + ' · ' + name));
    const strip = el('span', 'strip');
    strip.append(el('span', 'zone'), el('span', 'mid'));
    const lo = Math.min(m.evePolls, m.eveMarket);
    const hi = Math.max(m.evePolls, m.eveMarket);
    const link = el('span', 'link');
    link.style.left = lo + '%';
    link.style.width = (hi - lo) + '%';
    strip.append(link);
    [['polls', m.evePolls], ['market', m.eveMarket]].forEach(([camp, v]) => {
      const d = el('span', 'mark ' + camp);
      d.style.left = v + '%';
      strip.append(d);
    });
    const res = el('span', 'camp ' + m.camp);
    res.append(el('span', 'camp-name', CAMP[m.camp]), el('span', 'camp-eve',
      'erreur ' + dec2.format(Math.min(m.brierPolls, m.brierMarket)) + ' contre ' + dec2.format(Math.max(m.brierPolls, m.brierMarket))));
    a.append(who, strip, res);

    const show = (x, y) => {
      tip.replaceChildren(el('b', '', m.country + ' ' + m.year + ' · ' + name),
        el('span', 'polls-ink', 'Sondages, la veille : ' + pct.format(m.evePolls) + ' %'),
        el('span', 'market-ink', 'Polymarket, la veille : ' + pct.format(m.eveMarket) + ' %'),
        el('span', '', 'Erreur sur la campagne : sondages ' + dec2.format(m.brierPolls) + ', marché ' + dec2.format(m.brierMarket)));
      tip.hidden = false;
      const r = tip.getBoundingClientRect();
      tip.style.left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 14)) + 'px';
      tip.style.top = Math.max(8, y - r.height - 12) + 'px';
    };
    a.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse') show(ev.clientX, ev.clientY); });
    a.addEventListener('pointerleave', () => { tip.hidden = true; });
    a.addEventListener('focus', () => { const r = a.getBoundingClientRect(); show(r.left + r.width / 2, r.top); });
    a.addEventListener('blur', () => { tip.hidden = true; });
    li.append(a);
    list.append(li);
  });
}

function renderLive({ people, live }) {
  const cols = $('live-cols');
  cols.replaceChildren();
  $('n-live').textContent = 'Pas encore de vainqueur à prévoir : voici où en sont les deux camps. Attention, ce ne sont pas les mêmes chiffres.';
  [['polls', 'Sondages', 'intentions de vote au 1er tour, moyenne 30 jours', live.pollTop],
   ['market', 'Polymarket', 'chance de gagner l’élection', live.marketTop]].forEach(([camp, title, sub, rows]) => {
    const col = el('div', 'live-col ' + camp);
    col.append(el('h3', '', title), el('p', 'live-sub', sub));
    const ol = el('ol');
    const max = Math.max(...rows.map((r) => r.value), 1);
    rows.forEach((r) => {
      const li = el('li');
      const bar = el('span', 'live-bar');
      bar.style.width = (100 * r.value / max) + '%';
      li.append(el('span', 'live-name', people.get(r.candidate)?.full || r.candidate), el('span', 'live-v', pct.format(r.value) + ' %'), bar);
      ol.append(li);
    });
    col.append(ol);
    cols.append(col);
  });
}

function renderRanking({ ranking }) {
  const list = $('ranking');
  list.replaceChildren();
  const max = Math.max(...ranking.map((r) => r.avg), 1);
  ranking.forEach((r) => {
    const li = el('li', 'src' + (r.genre === 'marché' ? ' market' : r.genre === 'moyenne' ? ' polls' : ''));
    const name = el('span', 'src-name', r.source);
    name.append(el('small', '', r.right + ' élection' + (r.right > 1 ? 's' : '') + ' sur ' + r.elections + ' vue' + (r.right > 1 ? 's' : '')
      + ' juste' + (r.right > 1 ? 's' : '') + ' · médiane ' + pct0.format(r.med) + ' j'));
    const track = el('div', 'track');
    const bar = el('span', 'bar');
    bar.style.width = Math.max(0.5, 100 * r.avg / max) + '%';
    track.append(bar);
    li.append(name, track, el('span', 'days', pct0.format(r.avg) + ' j'));
    list.append(li);
  });
}

function skeleton() {
  $('sheet').replaceChildren(...Array.from({ length: 6 }, () => el('li', 'skel skel-line')));
  $('ranking').replaceChildren(...Array.from({ length: 5 }, () => el('li', 'skel skel-line')));
}

skeleton();
load().then((data) => {
  renderScore(data);
  renderLast(data);
  renderSheet(data);
  renderLive(data);
  renderRanking(data);
}).catch((err) => {
  $('deck').replaceChildren('Données indisponibles : ' + (err.message || err) + '. ');
  const retry = el('button', 'link', 'Réessayer');
  retry.type = 'button';
  retry.addEventListener('click', () => location.reload());
  $('deck').append(retry);
});
