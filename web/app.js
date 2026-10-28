// Mon suivi 2027 : connexion Supabase Auth, liste des candidats (RPC moyenne_recente),
// favoris par utilisateur (table favorites, protégée par RLS) et vue sondages contre Polymarket (RPC mes_favoris).
const { supabaseUrl, supabaseKey, election } = window.POLL_CONFIG;
const db = window.supabase.createClient(supabaseUrl, supabaseKey);

const $ = (id) => document.getElementById(id);
const pct = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const day = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });

let user = null;
let favorites = new Set();

const say = (text, kind) => {
  $('auth-msg').textContent = text || '';
  $('auth-msg').className = 'msg' + (kind ? ' ' + kind : '');
};

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

// --- Authentification
$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  say('Connexion…');
  const { error } = await db.auth.signInWithPassword({ email: $('email').value, password: $('password').value });
  say(error ? 'Connexion impossible : ' + error.message : '', error ? 'error' : null);
});

$('signup').addEventListener('click', async () => {
  if (!$('auth-form').reportValidity()) return;
  say('Création du compte…');
  const { data, error } = await db.auth.signUp({ email: $('email').value, password: $('password').value });
  if (error) return say('Création impossible : ' + error.message, 'error');
  say(data.session ? 'Compte créé, vous êtes connecté.' : 'Compte créé : confirmez votre adresse via l’e-mail reçu, puis connectez-vous.', 'ok');
});

$('signout').addEventListener('click', async () => {
  await db.auth.signOut();
  say('Vous êtes déconnecté.', 'ok');
});

db.auth.onAuthStateChange((_event, session) => {
  user = session ? session.user : null;
  $('signed-out').hidden = !!user;
  $('signed-in').hidden = !user;
  $('user-email').textContent = user ? user.email : '';
  refresh();
});

// --- Données
async function loadFavorites() {
  favorites = new Set();
  if (!user) return [];
  const { data, error } = await db.rpc('mes_favoris', { p_election: election });
  if (error) { say('Favoris indisponibles : ' + error.message, 'error'); return []; }
  data.forEach((f) => favorites.add(f.candidat));
  return data;
}

async function toggle(name) {
  if (!user) return;
  const { error } = favorites.has(name)
    ? await db.from('favorites').delete().eq('candidate', name)
    : await db.from('favorites').insert({ candidate: name });
  if (error) say('Modification impossible : ' + error.message, 'error');
  refresh();
}

function renderCandidates(rows) {
  const list = $('candidates');
  list.replaceChildren();
  if (!rows.length) { list.append(el('li', 'empty', 'Aucun sondage récent.')); return; }
  rows.forEach((r) => {
    const li = el('li', 'cand');
    const dot = el('span', 'dot');
    if (r.couleur) dot.style.background = r.couleur;
    const name = el('span', 'name', r.candidat);
    if (r.parti) name.append(el('span', 'party', r.parti));
    const val = el('span', 'val', pct.format(r.moyenne) + ' %');
    val.append(el('small', '', pct.format(r.mini) + ' – ' + pct.format(r.maxi)));
    const star = el('button', 'star', favorites.has(r.candidat) ? '★' : '☆');
    star.type = 'button';
    star.setAttribute('aria-pressed', String(favorites.has(r.candidat)));
    star.setAttribute('aria-label', (favorites.has(r.candidat) ? 'Ne plus suivre ' : 'Suivre ') + r.candidat);
    star.disabled = !user;
    star.title = user ? '' : 'Connectez-vous pour suivre ce candidat';
    star.addEventListener('click', () => toggle(r.candidat));
    li.append(dot, name, val, star);
    list.append(li);
  });
}

function renderFavorites(rows) {
  const list = $('favorites');
  list.replaceChildren();
  if (!user) { list.append(el('li', 'empty', 'Connectez-vous pour voir vos favoris.')); return; }
  if (!rows.length) { list.append(el('li', 'empty', 'Aucun favori : cliquez sur une étoile dans la liste.')); return; }
  rows.forEach((r) => {
    const li = el('li', 'fav');
    const dot = el('span', 'dot');
    if (r.couleur) dot.style.background = r.couleur;
    const body = el('div');
    body.append(el('div', 'name', r.candidat));
    const metrics = el('div', 'metrics');
    const m1 = el('div');
    m1.append(el('div', 'big', r.moyenne === null ? '—' : pct.format(r.moyenne) + ' %'), el('span', '', 'intentions de vote'));
    const m2 = el('div');
    m2.append(el('div', 'big', r.proba === null ? '—' : pct.format(r.proba) + ' %'), el('span', '', 'chance de victoire (Polymarket)'));
    metrics.append(m1, m2);
    body.append(metrics);
    li.append(dot, body);
    list.append(li);
  });
}

async function refresh() {
  const favRows = await loadFavorites();
  const { data, error } = await db.rpc('moyenne_recente', { p_election: election, p_jours: 30 });
  if (error) {
    $('candidates').replaceChildren(el('li', 'empty', 'Sondages indisponibles : ' + error.message));
  } else {
    renderCandidates(data);
    if (data.length) $('period').textContent = 'Sondages du ' + day.format(new Date(data[0].debut)) + ' au ' + day.format(new Date(data[0].fin));
  }
  renderFavorites(favRows);
}
// Premier affichage : onAuthStateChange se déclenche au chargement (session restaurée ou non).
