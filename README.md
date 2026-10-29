# poll-collector

Collecte, dans Postgres (projet Supabase `poll-collector`, via `DATABASE_URL`) ou à défaut dans une base
SQLite locale (`data/polls.db`) :

| Source | Contenu | Module |
|---|---|---|
| API Polymarket (Gamma + CLOB) | marchés par candidat + historique des cotes (journalier, + horaire sur 7 jours pour les marchés ouverts) | `collector/polymarket.py` |
| Wikipedia (liste des sondages) | chiffres par candidat, institut, dates de terrain, échantillon, scénario, lien vers la notice | `collector/wikipedia_polls.py` |
| Commission des sondages (notices PDF) | commanditaire(s) normalisés (BFMTV, LCI, RTL…), date de première publication | `collector/notices.py` |
| Sites des chaînes (plans du site) | articles qui citent un sondage : date, institut, commanditaires — **non lancé, voir ci-dessous** | `collector/media_polls.py` |

Les élections suivies sont dans `collector/config.py` : `fr-2027` en direct, et en rétrospective `fr-2022`,
`us-2024` et onze autres présidentielles depuis 2023 (Argentine, Mexique, Taïwan, Roumanie, Pologne,
Corée du Sud, Chili, Portugal, Pérou, Colombie, Brésil). Elles viennent avec les
résultats officiels des élections passées (`RESULTS`, chargés dans la table `results`) pour mesurer
l'erreur des sondages.

## Installation et lancement

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env                     # puis y mettre la chaîne de connexion Supabase (sinon : SQLite local)
.venv/bin/python -m collector            # tout collecter puis afficher les stats
.venv/bin/python -m collector polls      # une seule source : polymarket | polls | notices | stats
```

Tests des analyseurs (cas réels des tableaux Wikipedia) : `.venv/bin/python -m unittest`.

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
- Hors France : pas d'équivalent de la Commission des sondages, donc pas de commanditaire. Les sondages
  viennent des pages « Opinion polling for… » de la Wikipedia anglaise ; une colonne est lue quand son
  en-tête renvoie vers la page d'un candidat listé dans `candidates` (config). Seul le tour décisif est
  chargé dans `results`.
- « Qui l'a vu en premier » (`premier_a_voir`) : une source voit le vainqueur à partir du jour où elle le
  place devant son adversaire final sans plus changer d'avis jusqu'au vote ; toutes les sources partent du
  premier jour coté sur Polymarket. AtlasIntel, Ipsos et YouGov gardent un seul nom d'un pays à l'autre
  (média associé et filiale ôtés par `normalize_institute`). Hors France et États-Unis, la case
  « Institut / Média » de Wikipedia est coupée : l'institut d'un côté, le média dans `polls.media`.
- Trouver le slug Polymarket d'une élection : lancer le workflow avec `recherche_polymarket`
  (ex. `--query chile+presidential` ou `--query slug:brazil-presidential-election`).

## Ce que montrent les chaînes (prêt, pas encore lancé)

`python -m collector media [--media BFMTV] [--since 2025-01-01]` lit les plans des sites de BFMTV,
TF1info/LCI et franceinfo, garde les articles « sondage + présidentielle », et note pour chacun la date,
l'institut cité, les commanditaires (« sondage Harris Interactive pour M6/RTL ») et s'il donne des
intentions de vote (table `media_articles`). La vue `v_media_polls` relie chaque article au dernier
sondage du même institut terminé dans les 14 jours ; `couverture_medias` (sondages relayés sur tous ceux
publiés, part de ses propres sondages, instituts) et `selection_medias` (écart, candidat par candidat,
entre les sondages relayés et la moyenne de tous les sondages des 30 jours précédents) en tirent la mesure.

Pour le lancer : GitHub > **Actions > Collecte > Run workflow**, champ « Relever les articles de sondage
des chaînes » = `--media BFMTV --since 2021-09-01` (puis `TF1-LCI`, puis `franceinfo`, une chaîne par
lancement). En local : `.venv/bin/python -m collector media --media BFMTV --since 2021-09-01`.

Avant de le lancer :
- **Droits** : les robots.txt de ces trois sites interdisent les agents d'IA (ClaudeBot, Claude-User, GPTBot…),
  ce qui vaut opposition à la fouille de textes au sens de la directive européenne sur le droit d'auteur.
  Le collecteur, lui, se présente sous son nom (`poll-collector`) et respecte le robots.txt, mais un usage
  commercial des articles est à faire valider. Il n'est pas dans la collecte planifiée.
- **CNews et Europe 1** refusent tous les robots : non collectés (saisie manuelle ou accord à prévoir).
- Sans articles, on dispose déjà des sondages **commandés** par chaque média (`ecart_commanditaires`).

## Base de données (Supabase)

Migrations dans `supabase/migrations/`, à appliquer dans l'ordre.

| Élément | Rôle |
|---|---|
| 13 tables, 14 clés étrangères | `elections`, `polls` → `poll_results`, `notices` → `notice_sponsors`, `markets` → `market_prices`, `results`, `parties` → `candidates`, `favorites` → `auth.users`, `media_outlets` → `media_articles` (→ `elections`) |
| RLS sur toutes les tables | lecture publique des données ; `favorites` : chaque utilisateur ne voit et ne modifie que ses lignes |
| Triggers | `ensure_candidate` (nom inconnu → fiche candidat), `polls_normalize_institute` (un nom par institut), `markets_link_candidate` (marché Polymarket → fiche candidat) |
| Fonctions RPC | `moyenne_recente`, `evolution_mensuelle`, `ecart_commanditaires`, `erreur_sondages`, `sondages_vs_resultat`, `marches_actuels`, `comparaison_quotidienne`, `bilan_previsions` (toutes les élections passées), `premier_a_voir` et `classement_premier_a_voir` (qui a vu le vainqueur en premier), `couverture_medias` et `selection_medias` (ce que montrent les chaînes), `mes_favoris` |
| Vues | `v_poll_sponsors` (sondages avec leurs commanditaires), `v_media_polls` (articles des chaînes → sondages) |

Aucun nom de candidat ni couleur n'est écrit dans le tableau de bord : les noms viennent des sondages,
les couleurs de la table `parties`, et les « candidats en tête » sont calculés par les fonctions.

## Application web

`web/` (sans compilation, bibliothèques chargées depuis jsDelivr) :

- `index.html` + `home.js` + `home.css` : accueil « le match », sondages contre Polymarket sur toutes les
  présidentielles passées. Score : le camp au plus petit score de Brier sur la campagne (même calcul que
  `bilan_previsions`, lu dans `bilan_quotidien`) ; feuille de match (chance donnée au vainqueur la veille) ;
  dernier match ; 2027 en direct ; classement « qui voit le vainqueur en premier » (agrégat de `bilan_premier_a_voir`).
- `election.html` + `app.js` : une page par élection (`?e=br-2026`, `&tour=1|2`), 2027 par défaut,
  sélecteur de pays en haut. Moyenne des sondages (un sondage compte une fois, ses hypothèses moyennées ;
  30 jours, 3 sondages minimum) à côté de la cote Polymarket, chacune sur sa propre échelle ; courbes avec
  Observable Plot (moyenne des 5 derniers sondages sur 90 jours au plus) ; derniers sondages avec
  commanditaire et notice. Titre et accroche calculés. Cliquer un candidat le met en avant dans les graphiques.
  Élections passées : résultat comparé à la dernière moyenne (part des voix entre les candidats du résultat),
  cote la veille du vote, « qui l'a vu en premier » et chance de victoire jour par jour, lus dans les tables
  `bilan_premier_a_voir` et `bilan_quotidien` (sinon calculés à la volée, souvent au-delà des 3 s permises).
- `suivi.html` + `suivi.js` : « Mon suivi », connexion par e-mail (Supabase Auth) et favoris par utilisateur.

`style.css` porte la direction artistique commune (papier, encre ; vermillon = sondages, outremer = marché).
`web/config.js` porte aussi deux choix éditoriaux de l'accueil : `exclus` (élections écartées des totaux des
deux camps, leur ligne reste affichée) et `plusADroite` (candidat le plus à droite de chaque duel final).
`web/config.js` contient l'adresse du projet et sa clé publique (prévue pour le navigateur).

```bash
python3 -m http.server 8090 --directory web
```

Puis ouvrir http://localhost:8090. Dans Supabase > Authentication > URL Configuration, mettre cette
adresse (ou celle du site en ligne) comme **Site URL**, pour que le lien de confirmation par e-mail y ramène.

## Mise en ligne

### Collecteur : GitHub Actions

`.github/workflows/collect.yml` lance `python -m collector scheduled` toutes les heures à hh:23 (UTC) :
cotes Polymarket à chaque passage, sondages et notices à 6, 12 et 18 h UTC (GitHub saute parfois des
passages planifiés). Seules les élections en cours sont relues ; cocher « sondages » au lancement manuel
recharge toutes les élections. Les serveurs GitHub
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
