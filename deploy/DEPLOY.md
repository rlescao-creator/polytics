# Déployer le collecteur (serveur hors de France + base Supabase)

- **Base** : projet Supabase `poll-collector` (région Paris, offre gratuite). Le schéma est dans
  `supabase/migrations/` et il est déjà appliqué. Les tables sont lisibles publiquement via l'API ;
  seul le collecteur, connecté en Postgres direct, peut y écrire.
- **Serveur** : il faut un serveur hors de France, parce que les fournisseurs d'accès français
  redirigent `polymarket.com` vers la page de blocage de l'ANJ.

> **Cadre légal à valider avant de lancer** : lecture de données publiques depuis l'étranger, puis
> réaffichage des cotes en France. Pas de lien d'affiliation ni d'incitation à parier.

## 1. Récupérer la chaîne de connexion Supabase

Dans le tableau de bord Supabase, ouvre le projet **poll-collector**, clique sur **Connect**, puis choisis
**Session pooler**, qui fonctionne en IPv4. Copie l'URI. Le mot de passe de la base se définit ou se
réinitialise dans *Project Settings > Database*.

Pour un test depuis ton Mac, copie `.env.example` en `.env` et colle l'URI à la place de la ligne
d'exemple. `.env` n'est jamais versionné.

```bash
.venv/bin/python -m collector polls
```

Polymarket reste bloqué depuis la France ; les sondages et les notices passent.

## 2. Créer le serveur

N'importe quel petit VPS suffit (1 vCPU, 2 Go de RAM, Debian 12 ou Ubuntu 24.04), par exemple chez Hetzner,
DigitalOcean ou OVHcloud, **dans une région hors de France** (Allemagne, Finlande, États-Unis…).
Ajoute ta clé SSH à la création.

## 3. Copier le projet et installer

Depuis ton Mac, dans le dossier `poll-collector` :

```bash
rsync -av --exclude .venv --exclude data --exclude __pycache__ --exclude .env ./ root@IP_DU_SERVEUR:/root/poll-collector/
```

```bash
ssh root@IP_DU_SERVEUR "bash /root/poll-collector/deploy/install.sh"
```

Au premier passage, le script crée `/etc/poll-collector.env` et s'arrête. Colle l'URI Supabase dans ce
fichier :

```bash
ssh root@IP_DU_SERVEUR "nano /etc/poll-collector.env"
```

Puis relance `install.sh`. Cette fois, il vérifie que les 4 sources sont joignables. Si Polymarket ne
l'est pas, change de région. Il lance ensuite une première collecte complète, puis la planification :

| Quand (UTC) | Quoi |
|---|---|
| toutes les heures à hh:05 | cotes Polymarket |
| chaque jour à 06:30 | sondages Wikipedia, puis nouvelles notices |

## 4. Vérifier

```bash
ssh root@IP_DU_SERVEUR "tail -n 20 /var/lib/poll-collector/logs/polymarket.log"
```

Les données sont visibles dans Supabase, dans le *Table Editor*.

## Mettre à jour le code

Refaire la copie de l'étape 3, puis relancer `install.sh`. Le code est remplacé ; la config et la base
restent intactes.

## Sauvegardes

Il n'y a pas de sauvegarde planifiée. Presque tout peut être recollecté : sondages, notices et historique
journalier Polymarket. La seule perte possible est l'historique au pas horaire de plus de 7 jours.
Pour mieux protéger les données, il faut passer à l'offre payante de Supabase, qui inclut des
sauvegardes quotidiennes.

## Emplacements sur le serveur

- Code : `/opt/poll-collector`
- Chaîne de connexion : `/etc/poll-collector.env` (lisible par root et collector uniquement)
- Cache des notices et logs : `/var/lib/poll-collector`
- Planification : `/etc/cron.d/poll-collector`
