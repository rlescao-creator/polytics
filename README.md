# poll-collector

Collecte, dans Postgres (projet Supabase `poll-collector`, via `DATABASE_URL`) ou à défaut dans une base
SQLite locale (`data/polls.db`) :

| Source | Contenu | Module |
|---|---|---|
| API Polymarket (Gamma + CLOB) | marchés par candidat + historique des cotes (journalier, + horaire sur 7 jours pour les marchés ouverts) | `collector/polymarket.py` |
| Wikipedia (liste des sondages) | chiffres par candidat, institut, dates de terrain, échantillon, scénario, lien vers la notice | `collector/wikipedia_polls.py` |
| Commission des sondages (notices PDF) | commanditaire(s) normalisés (BFMTV, LCI, RTL…), date de première publication | `collector/notices.py` |

Les élections suivies sont dans `collector/config.py` (`fr-2027`, `fr-2022`, `us-2024`), avec les
résultats officiels des élections passées (`RESULTS`, chargés dans la table `results`) pour mesurer
l'erreur des sondages.

## Installation et lancement

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env                     # puis y mettre la chaîne de connexion Supabase (sinon : SQLite local)
.venv/bin/python -m collector            # tout collecter puis afficher les stats
.venv/bin/python -m collector polls      # une seule source : polymarket | polls | notices | stats
```

Schéma : `supabase/migrations/` pour Postgres, `collector/schema.sql` pour SQLite (garder les deux alignés).
Relancer est sans danger : les cotes sont dédoublonnées par horodatage, les sondages Wikipedia sont
rechargés en entier, et seules les nouvelles notices sont téléchargées (PDF mis en cache dans `data/notices/`).

## Requêtes utiles

```sql
-- Sondages commandés par une chaîne TV, avec leurs chiffres
SELECT p.fieldwork_end, p.institute, p.sponsor, r.candidate, r.value
FROM v_poll_sponsors p JOIN poll_results r ON r.poll_id = p.id
WHERE p.media_type = 'tv';

-- Cote Polymarket d'un candidat, jour par jour
SELECT date(ts, 'unixepoch') d, price FROM market_prices
JOIN markets USING (condition_id) WHERE candidate = 'Marine Le Pen' ORDER BY ts;
```

## Limites connues

- **Polymarket est bloqué par l'ANJ en France** : les FAI français redirigent le domaine vers une page de
  blocage, l'API est alors injoignable et le module l'indique sans planter. À faire tourner depuis un serveur
  hors de France : c'est le rôle de GitHub Actions (voir « Mise en ligne » ci-dessous) ; sur un serveur Linux, [deploy/DEPLOY.md](deploy/DEPLOY.md). `python -m collector check` teste l'accès aux sources.
- France 2022 : marchés de l'ancien système Polymarket (AMM), pas d'historique via l'API.
- Commanditaire : lu dans la notice quand le format le permet, sinon déduit du nom de fichier
  (`notices.sponsor_source` indique lequel). Un commanditaire non listé dans `config.MEDIA` est ignoré.
- Les chiffres viennent de Wikipedia (licence CC BY-SA : citer la source en cas de republication).
- US 2024 : seulement Polymarket pour l'instant (pas d'équivalent de la Commission des sondages).

## Base de données (Supabase)

Migrations dans `supabase/migrations/`, à appliquer dans l'ordre.

| Élément | Rôle |
|---|---|
| 11 tables, 12 clés étrangères | `elections`, `polls` → `poll_results`, `notices` → `notice_sponsors`, `markets` → `market_prices`, `results`, `parties` → `candidates`, `favorites` → `auth.users` |
| RLS sur toutes les tables | lecture publique des données ; `favorites` : chaque utilisateur ne voit et ne modifie que ses lignes |
| Triggers | `ensure_candidate` (nom inconnu → fiche candidat), `polls_normalize_institute` (un nom par institut), `markets_link_candidate` (marché Polymarket → fiche candidat) |
| Fonctions RPC | `moyenne_recente`, `evolution_mensuelle`, `ecart_commanditaires`, `erreur_sondages`, `sondages_vs_resultat`, `marches_actuels`, `mes_favoris` |
| Vue | `v_poll_sponsors` (sondages avec leurs commanditaires) |

Aucun nom de candidat ni couleur n'est écrit dans le tableau de bord : les noms viennent des sondages,
les couleurs de la table `parties`, et les « candidats en tête » sont calculés par les fonctions.

## Application web « Mon suivi 2027 »

`web/` : connexion par e-mail (Supabase Auth), liste des candidats, favoris par utilisateur.
`web/config.js` contient l'adresse du projet et sa clé publique (prévue pour le navigateur).

```bash
python3 -m http.server 8090 --directory web
```

Puis ouvrir http://localhost:8090. Dans Supabase > Authentication > URL Configuration, mettre cette
adresse (ou celle du site en ligne) comme **Site URL**, pour que le lien de confirmation par e-mail y ramène.

## Mise en ligne

### Collecteur : GitHub Actions

`.github/workflows/collect.yml` lance `python -m collector scheduled` toutes les heures à hh:05 (UTC) :
cotes Polymarket à chaque passage, sondages et notices une fois par jour à 6 h UTC. Les serveurs GitHub
sont hors de France, donc Polymarket y est joignable.

1. Dans le dépôt GitHub : **Settings > Secrets and variables > Actions > New repository secret**,
   nom `DATABASE_URL`, valeur = Supabase > **Connect** > **Session pooler** (avec le mot de passe de la base).
2. Onglet **Actions > Collecte > Run workflow** pour un premier passage (cocher « sondages » pour tout charger).

GitHub peut décaler un passage planifié de quelques minutes. Un dépôt privé dispose de 2 000 minutes
d'Actions gratuites par mois ; un passage dure environ une minute.

### Appli web : Vercel

En ligne : https://polytics-web.vercel.app (projet Vercel avec **Root Directory** = `web`, preset **Other**).

`vercel.json` publie le dossier `web/` tel quel, sans compilation.

1. Sur vercel.com : **Add New > Project**, importer le dépôt, garder les réglages proposés, **Deploy**.
2. Dans Supabase > **Authentication > URL Configuration** : mettre l'adresse Vercel comme **Site URL**
   (et garder `http://localhost:8090` dans **Redirect URLs** pour les tests en local).
