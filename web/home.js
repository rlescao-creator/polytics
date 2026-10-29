// Accueil « l'argent contre la rue » : ce que les gens disent aux sondeurs contre ce que les parieurs
// misent sur Polymarket, sur toutes les présidentielles passées.
// Score : pour chaque élection, le camp au plus petit score de Brier sur la campagne (même calcul que
// bilan_previsions, à partir de bilan_quotidien). Veille : chance donnée au vainqueur le jour avant le vote.
// Mises : dollars échangés (markets.volume) contre sondages publiés et personnes interrogées dans l'année.
// Nuit du vote : nuit_electorale. Classement : agrégat de bilan_premier_a_voir (comme classement_premier_a_voir).
// En direct : moyenne des sondages et cotes de l'élection en cours, comme sur election.html.
const { supabaseUrl, supabaseKey, election: LIVE } = window.POLL_CONFIG;
const db = window.supabase.createClient(supabaseUrl, supabaseKey);

// Anciennes adresses (?e=…) : la page élection a déménagé.
if (new URLSearchParams(location.search).has('e')) location.replace('election.html' + location.search);

const DAY = 86400000;
const WINDOW = 30;       // jours de terrain pris dans la moyenne en direct
const MIN_POLLS = 3;
const MIN_ELECTIONS = 2; // un institut entre au classement à partir de 2 élections
const YEAR = 365;        // la rue : sondages publiés dans l'année avant le vote

const $ = (id) => document.getElementById(id);
const pct = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const dec2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const int = new Intl.NumberFormat('fr-FR');
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
const CAMP = { polls: 'La rue', market: 'L’argent' };

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
  const [elections, results, cands, daily, first, markets, livePolls, pollMeta, favoris] = await Promise.all([
    all(() => db.from('elections').select('id, country, election_date, second_round_date').order('id')),
    all(() => db.from('results').select('election_id, round, candidate, value').order('election_id')),
    all(() => db.from('candidates').select('name, full_name, parties(color)').eq('kind', 'personne').order('name')),
    all(() => db.from('bilan_quotidien').select('election_id, jour, candidat, polymarket, proba_sondages')
      .eq('gagnant', true).order('election_id').order('jour')),
    all(() => db.from('bilan_premier_a_voir').select('election_id, source, genre, juste, jours_avance').order('election_id').order('source')),
    all(() => db.from('markets').select('election_id, candidate_name, volume, last_price, closed').order('condition_id')),
    all(() => db.from('polls').select('id, fieldwork_end, fieldwork_label, institute, poll_results(candidate, value)')
      .eq('election_id', LIVE).eq('round', 1).gte('fieldwork_end', since).order('id')),
    all(() => db.from('polls').select('election_id, fieldwork_end, fieldwork_label, institute, sample_size').order('id')),
    // Table absente tant que la migration bilan_favoris n'est pas appliquée : pas de compte à rebours.
    all(() => db.from('bilan_favoris').select('election_id, jours, gagnant, favori_marche, proba_marche, favori_sondages, moyenne_sondages')
      .order('election_id').order('jours')).catch(() => null),
  ]);
  const people = new Map(cands.map((c) => [c.name, { full: c.full_name || c.name, color: c.parties && c.parties.color }]));

  // Les mises de chaque élection : dollars échangés sur tous ses marchés ; sondages publiés dans l'année
  // avant le vote (un sondage = un institut et un terrain) et somme de leurs échantillons connus.
  const today = new Date();
  const stakes = (e, end) => {
    const polls = new Map();
    pollMeta.filter((p) => p.election_id === e.id && utc(p.fieldwork_end) <= end && utc(p.fieldwork_end) > new Date(+end - YEAR * DAY))
      .forEach((p) => {
        const key = p.institute + '|' + p.fieldwork_label + '|' + p.fieldwork_end;
        polls.set(key, Math.max(polls.get(key) || 0, p.sample_size || 0));
      });
    const sizes = [...polls.values()];
    const named = new Map();
    markets.filter((m) => m.election_id === e.id && m.candidate_name)
      .forEach((m) => named.set(m.candidate_name, (named.get(m.candidate_name) || 0) + (m.volume || 0)));
    return {
      dollars: sum(markets.filter((m) => m.election_id === e.id).map((m) => m.volume || 0)), byCandidate: named,
      polls: sizes.length, people: sum(sizes), partial: sizes.some((n) => !n),
    };
  };

  // Une ligne par élection passée : vainqueur, chances la veille, Brier de chaque camp, mises.
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
    const final = res.filter((r) => r.round === round).sort((a, b) => b.value - a.value);
    const m = {
      id: e.id, country: region.of(e.country), year: e.id.split('-')[1], vote,
      winner: days[0].candidat, loser: final.find((r) => r.candidate !== days[0].candidat)?.candidate, share: final[0].value,
      evePolls: eve ? +eve.proba_sondages : null, eveMarket: eve ? +eve.polymarket : null,
      brierPolls: brier('proba_sondages'), brierMarket: brier('polymarket'), stakes: stakes(e, vote),
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

  // Nuit du vote de la dernière élection (table absente ou vide : pas de graphique).
  const night = matches[0]
    ? await all(() => db.from('nuit_electorale').select('serie, candidat, volume, ts, price').eq('election_id', matches[0].id).order('ts'))
      .catch(() => [])
    : [];

  const live = elections.find((e) => e.id === LIVE);
  const liveVote = live && (live.second_round_date || live.election_date);
  return {
    people, matches, ranking, night, favoris, liveVote: liveVote ? utc(liveVote) : null, liveFirst: live?.election_date ? utc(live.election_date) : null,
    live: { ...liveSummary(people, markets.filter((m) => m.election_id === LIVE), livePolls), stakes: live ? stakes(live, today) : null },
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
const peopleLine = (s) => (s.partial ? 'au moins ' : '') + compact.format(s.people) + ' personnes interrogées';

function renderScore({ matches }) {
  const n = { polls: matches.filter((m) => m.camp === 'polls').length, market: matches.filter((m) => m.camp === 'market').length };
  const eve = {
    polls: matches.filter((m) => m.evePolls > 50).length, market: matches.filter((m) => m.eveMarket > 50).length,
    counted: matches.filter((m) => m.evePolls != null && m.eveMarket != null).length,
  };
  const total = {
    dollars: sum(matches.map((m) => m.stakes.dollars)), polls: sum(matches.map((m) => m.stakes.polls)),
    people: sum(matches.map((m) => m.stakes.people)), partial: matches.some((m) => m.stakes.partial),
  };
  $('n-polls').textContent = n.polls;
  $('n-market').textContent = n.market;
  $('stake-polls').textContent = int.format(total.polls) + ' sondages · ' + peopleLine(total);
  $('stake-market').textContent = usd(total.dollars) + ' échangés';
  const lead = n.polls === n.market ? null : n.polls > n.market ? 'polls' : 'market';
  $('board-score').className = 'board-score' + (lead ? ' lead-' + lead : '');
  $('board-score').setAttribute('aria-label', 'La rue ' + n.polls + ', l’argent ' + n.market);
  const since = Math.min(...matches.map((m) => +m.year));
  $('score-kicker').textContent = 'L’argent contre la rue · ' + matches.length + ' présidentielles depuis ' + since;
  $('caution').textContent = matches.length + ' élections, c’est peu';

  const deck = $('deck');
  deck.replaceChildren();
  const b = (t, cls) => el('b', cls, t);
  deck.append('D’un côté, ce que les gens disent aux sondeurs. De l’autre, ce que des parieurs misent en dollars sur Polymarket. ',
    'Sur toute la campagne, ', lead ? b(lead === 'polls' ? 'la rue' : 'l’argent', lead + '-ink') : 'aucun camp',
    lead ? ' s’est moins trompé' + (lead === 'polls' ? 'e' : '') + ' que ' + (lead === 'polls' ? 'l’argent' : 'la rue') : ' ne s’est moins trompé que l’autre',
    ' dans ' + Math.max(n.polls, n.market) + ' élections sur ' + matches.length + '. ');
  const eveLead = eve.polls === eve.market ? null : eve.polls > eve.market ? 'polls' : 'market';
  deck.append(eveLead && eveLead !== lead ? 'Mais la veille du vote, ' : 'La veille du vote, ');
  if (!eveLead) deck.append('égalité : les deux avaient le bon favori ' + eve.polls + ' fois sur ' + eve.counted + '.');
  else {
    deck.append(eveLead === 'market' ? 'c’est l’argent qui avait le plus souvent le bon favori : ' : 'c’est la rue qui avait le plus souvent le bon favori : ',
      b(eve[eveLead] + ' fois sur ' + eve.counted, eveLead + '-ink'), ', contre ' + eve[eveLead === 'market' ? 'polls' : 'market'] + '.');
  }
}

function verdict(m) {
  const right = { polls: m.evePolls > 50, market: m.eveMarket > 50 };
  const better = m.camp === 'polls' ? 'la rue' : 'l’argent';
  if (right.polls && right.market) return m.country + ' : la rue et l’argent avaient le bon favori, ' + better + ' plus tôt';
  if (!right.polls && !right.market) return m.country + ' : la rue et l’argent se sont trompés, ' + better + ' moins';
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
  const onWinner = m.stakes.byCandidate.get(m.winner);
  const onLoser = m.stakes.byCandidate.get(m.loser);
  note.replaceChildren('Chance de victoire donnée à ' + name(m.winner) + ' chaque jour, jusqu’au ' + shortDay.format(m.vote) + '. La veille : ',
    el('b', 'polls-ink', 'la rue ' + pct.format(m.evePolls) + ' %'), ', ', el('b', 'market-ink', 'l’argent ' + pct.format(m.eveMarket) + ' %'),
    '. Résultat : ' + name(m.winner) + ' l’emporte avec ' + pct.format(m.share) + ' %. ');
  if (onWinner && onLoser) {
    note.append('Sur Polymarket, ', el('b', '', usd(onWinner)), ' échangés sur le marché « ' + m.winner + ' gagne », ',
      el('b', '', usd(onLoser)), ' sur « ' + m.loser + ' gagne ». ');
  }
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

function renderSheet({ people, matches }) {
  const list = $('sheet');
  list.replaceChildren();
  const head = el('li', 'sheet-head');
  head.setAttribute('aria-hidden', 'true');
  const scale = el('div', 'scale');
  ['0 %', '50 %', '100 %'].forEach((t) => scale.append(el('span', '', t)));
  head.append(el('span', '', 'Élection · mises'), scale, el('span', 'r', 'Moins d’erreurs (campagne)'));
  list.append(head);
  const tip = $('tip');
  matches.forEach((m) => {
    const li = el('li');
    const a = el('a', 'match ' + m.camp);
    a.href = 'election.html?e=' + m.id;
    const name = people.get(m.winner)?.full || m.winner;
    const s = m.stakes;
    a.setAttribute('aria-label', m.country + ' ' + m.year + ', vainqueur : ' + name + '. La veille : la rue ' + pct.format(m.evePolls)
      + ' %, l’argent ' + pct.format(m.eveMarket) + ' %. ' + usd(s.dollars) + ' échangés, ' + s.polls + ' sondages. Moins d’erreurs : ' + CAMP[m.camp] + '.');

    const who = el('span', 'who-match');
    const stakes = el('span', 'stakes');
    stakes.append(el('span', 'market-ink', usd(s.dollars)), ' · ', el('span', 'polls-ink', s.polls + ' sondages'));
    who.append(el('span', 'country', m.country), el('span', 'meta', m.year + ' · ' + name), stakes);
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
        el('span', 'polls-ink', 'La rue, la veille : ' + pct.format(m.evePolls) + ' % · ' + s.polls + ' sondages, ' + peopleLine(s)),
        el('span', 'market-ink', 'L’argent, la veille : ' + pct.format(m.eveMarket) + ' % · ' + usd(s.dollars) + ' échangés'),
        el('span', '', 'Erreur sur la campagne : la rue ' + dec2.format(m.brierPolls) + ', l’argent ' + dec2.format(m.brierMarket)));
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
  const s = live.stakes;
  $('n-live').textContent = 'Pas encore de vainqueur à prévoir : voici où en sont les deux camps. Attention, ce ne sont pas les mêmes chiffres.'
    + (s ? ' Déjà ' + usd(s.dollars) + ' échangés sur Polymarket, et ' + s.polls + ' sondages publiés en un an (' + peopleLine(s) + ').' : '');
  [['polls', 'La rue', 'intentions de vote au 1er tour, moyenne 30 jours', live.pollTop],
   ['market', 'L’argent', 'chance de gagner selon Polymarket · dollars échangés', live.marketTop]].forEach(([camp, title, sub, rows]) => {
    const col = el('div', 'live-col ' + camp);
    col.append(el('h3', '', title), el('p', 'live-sub', sub));
    const ol = el('ol');
    const max = Math.max(...rows.map((r) => r.value), 1);
    rows.forEach((r) => {
      const li = el('li');
      const bar = el('span', 'live-bar');
      bar.style.width = (100 * r.value / max) + '%';
      const v = el('span', 'live-v', pct.format(r.value) + ' %');
      if (r.volume) v.append(el('small', '', usd(r.volume)));
      li.append(el('span', 'live-name', people.get(r.candidate)?.full || r.candidate), v, bar);
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
    const title = r.genre === 'marché' ? 'L’argent · Polymarket' : r.genre === 'moyenne' ? 'La rue · moyenne des sondages' : r.source;
    const name = el('span', 'src-name', title);
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

// --- Compte à rebours : à J-d du vote décisif, le favori de chaque camp a-t-il fini par gagner ?
function favoriteAt(favoris, matches, d) {
  return matches.map((m) => {
    const row = favoris.find((f) => f.election_id === m.id && f.jours === d);
    const pick = (name, value) => (name ? { name, value: +value, right: name === row.gagnant } : null);
    return { m, polls: row && pick(row.favori_sondages, row.moyenne_sondages), market: row && pick(row.favori_marche, row.proba_marche) };
  });
}

function tally(rows, camp) {
  const seen = rows.filter((r) => r[camp]);
  return { right: seen.filter((r) => r[camp].right).length, n: seen.length };
}

const longDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function renderCountdown(data) {
  const { favoris, matches, liveVote, liveFirst, live, people } = data;
  if (!favoris || !favoris.length || !liveVote) return;
  const today = utc(isoDay(new Date()));
  const J = Math.round((liveVote - today) / DAY);
  if (J < 1) return;
  $('sec-countdown').hidden = false;
  $('cd-j').textContent = 'J-' + J;
  $('cd-sub').textContent = 'avant le 2nd tour, le ' + longDate.format(liveVote)
    + (liveFirst && liveFirst < liveVote ? ' · 1er tour dans ' + Math.round((liveFirst - today) / DAY) + ' jours' : '');
  const name = (c) => people.get(c)?.full || c;
  const max = Math.min(365, Math.max(...favoris.map((f) => f.jours)));

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
    const finite = curve.filter((p) => Number.isFinite(p.value));
    const ends = ['La rue', 'L’argent'].map((s) => finite.filter((p) => p.serie === s).sort((a, b) => a.d - b.d)[0]).filter(Boolean);
    target.replaceChildren(Plot.plot({
      width, height: narrow ? 260 : 320, marginLeft: 40, marginRight: narrow ? 70 : 90, marginTop: 28,
      style: { color: 'var(--muted)', background: 'transparent', fontSize: '12px' },
      x: { domain: [max, 0], label: 'jours avant le vote →', tickFormat: (d) => 'J-' + d, ticks: narrow ? 4 : 8 },
      y: { domain: [0, 100], label: '↑ le favori a fini par gagner', ticks: [0, 25, 50, 75, 100], tickFormat: (v) => v + ' %', grid: true },
      marks: [
        Plot.ruleY([50], { stroke: 'var(--fg)', strokeOpacity: 0.4, strokeDasharray: '2,4' }),
        Plot.ruleX([J], { stroke: 'var(--fg)', strokeWidth: 2 }),
        Plot.text([{ d: J }], { x: 'd', frameAnchor: 'top', dy: -16, text: () => '2027 aujourd’hui', fill: 'var(--fg)', fontWeight: 700 }),
        ...(selected !== J ? [Plot.ruleX([selected], { stroke: 'var(--fg)', strokeDasharray: '3,3' })] : []),
        Plot.line(curve, { x: 'd', y: 'value', z: 'serie', stroke: (p) => color(p.serie), strokeWidth: 2.5, curve: 'step-after' }),
        Plot.text(ends, { x: 'd', y: 'value', text: 'serie', dx: 8, textAnchor: 'start', fill: (p) => color(p.serie), fontWeight: 700 }),
        Plot.tip(finite, Plot.pointer({ x: 'd', y: 'value', title: (p) => p.serie + ' à J-' + p.d + '\u00a0: le favori a gagné '
          + p.right + ' fois sur ' + p.n, fill: 'var(--panel)', stroke: 'var(--line)' })),
      ],
    }));
  };

  const range = $('cd-range');
  range.max = max;
  range.value = selected;
  const show = (d) => {
    selected = d;
    $('cd-out').textContent = 'J-' + d + (d === J ? ' (aujourd’hui pour 2027)' : '');
    const rows = favoriteAt(favoris, matches, d);
    const t = { polls: tally(rows, 'polls'), market: tally(rows, 'market') };
    const deck = $('cd-deck');
    const b = (txt, cls) => el('b', cls, txt);
    deck.replaceChildren('À J-' + d + ' des élections précédentes, ');
    const part = (camp, label) => (t[camp].n
      ? [label + ' a fini par gagner ', b(t[camp].right + ' fois sur ' + t[camp].n, camp + '-ink')]
      : [label + '\u00a0: pas encore de données']);
    deck.append(...part('polls', 'le candidat en tête des sondages'), ' ; ', ...part('market', 'le favori de Polymarket'), '. ');
    if (d === J) {
      const p = live.pollTop[0];
      const mk = live.marketTop[0];
      if (p && mk) {
        deck.append('Pour 2027, aujourd’hui\u00a0: la rue met ', b(name(p.candidate) + ' (' + pct0.format(p.value) + ' %)', 'polls-ink'),
          ' en tête, l’argent ', b(name(mk.candidate) + ' (' + pct0.format(mk.value) + ' %)', 'market-ink'), '.');
      }
    }
    const grid = $('cd-grid');
    grid.replaceChildren();
    rows.forEach((r) => {
      const li = el('li', 'cd-card');
      const head = el('div', 'cd-head');
      head.append(el('span', 'country', r.m.country), el('span', 'meta', r.m.year + ' · vainqueur ' + name(r.m.winner)));
      li.append(head);
      [['polls', 'La rue'], ['market', 'L’argent']].forEach(([camp, label]) => {
        const f = r[camp];
        const line = el('div', 'cd-line ' + camp + (f ? (f.right ? ' right' : ' wrong') : ' none'));
        line.append(el('span', 'cd-camp', label),
          el('span', 'cd-name', f ? name(f.name) + ' ' + pct0.format(f.value) + ' %' : (camp === 'polls' ? 'pas assez de sondages' : 'pas encore de marché')),
          el('span', 'cd-mark', f ? (f.right ? '✓' : '✗') : ''));
        line.setAttribute('aria-label', label + ' : ' + (f ? name(f.name) + (f.right ? ', a gagné' : ', a perdu') : 'pas de données'));
        li.append(line);
      });
      grid.append(li);
    });
    draw();
  };
  range.addEventListener('input', () => show(+range.value));
  show(selected);
  let w = target.clientWidth;
  new ResizeObserver(() => { if (target.clientWidth !== w) { w = target.clientWidth; draw(); } }).observe(target);
}

function skeleton() {
  $('sheet').replaceChildren(...Array.from({ length: 6 }, () => el('li', 'skel skel-line')));
  $('ranking').replaceChildren(...Array.from({ length: 5 }, () => el('li', 'skel skel-line')));
}

skeleton();
load().then((data) => {
  renderScore(data);
  renderCountdown(data);
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
