# Déployer le collecteur sur Railway

Railway fait tourner le collecteur comme une tâche planifiée : chaque heure à hh:05 (UTC), il lance
`python -m collector scheduled`, qui se termine à chaque passage.

- Polymarket : à chaque passage (cotes du moment, historique journalier et horaire sur 7 jours).
- Sondages Wikipedia et notices officielles : une fois par jour, au passage de 6 h UTC.
- Une étape en échec n'empêche pas les autres, mais le passage est marqué en échec dans Railway.

Tout est déjà configuré dans le projet : `railway.json` (commande et planification) et
`.python-version` (Python 3.12). Railway installe `requirements.txt` tout seul.

> **Cadre légal** : Railway n'a pas de serveur en France, donc Polymarket y est joignable. Le
> collecteur ne fait que lire des données publiques ; reste à valider leur réaffichage en France.

## 1. Mettre le code sur GitHub

Railway déploie depuis un dépôt GitHub. Le fichier `.gitignore` exclut déjà `.env`, `.venv/` et `data/`.

```bash
git init && git add . && git commit -m "Collecteur sondages vs Polymarket"
```

Puis crée un dépôt privé sur GitHub et pousse-y le code.

## 2. Créer le service

1. Sur Railway : **New Project**, puis **Deploy from GitHub repo**, et choisis le dépôt.
2. Dans **Settings** du service, **Region** : prends `EU West (Amsterdam)`, la plus proche de Supabase (Paris).
3. La planification `5 * * * *` est lue dans `railway.json` ; vérifie qu'elle apparaît dans **Settings > Cron Schedule**.

## 3. Donner l'accès à Supabase

Dans **Variables**, ajoute :

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | Supabase > projet poll-collector > **Connect** > **Session pooler**, avec ton mot de passe |

Options :

| Variable | Rôle | Défaut |
|---|---|---|
| `POLLS_HOUR_UTC` | heure UTC de la mise à jour quotidienne des sondages | `6` |

## 4. Premier passage

Railway lance la tâche à la prochaine heure pile + 5 min. Pour ne pas attendre, déclenche un
déploiement manuel, puis regarde les **Logs**. Un passage réussi se termine par une ligne :

```
[scheduled] étapes : polymarket ; échecs : aucun
```

Pour charger tout de suite les sondages sans attendre 6 h UTC, mets temporairement
`POLLS_HOUR_UTC` à l'heure UTC actuelle, lance un passage, puis remets `6`.

## Vérifier depuis Supabase

Dans le *SQL Editor* de Supabase :

```sql
SELECT election_id, count(*) AS marches, max(updated_at) AS dernier_releve FROM markets GROUP BY 1;
```

## Ce que ça coûte

Un passage dure environ une minute par heure. Sur Railway, l'offre Hobby (5 $/mois, crédit d'usage
inclus) suffit largement.
