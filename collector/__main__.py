"""Usage : python -m collector [all|polymarket|polls|notices|stats|check] [--election fr-2027] [--db data/polls.db]

Base : $DATABASE_URL (postgresql://…, ex. Supabase) si défini, sinon data/polls.db (SQLite).
Les variables peuvent aussi venir d'un fichier .env (ou du fichier pointé par $COLLECTOR_ENV).
Le dossier de données (base SQLite + cache des notices) vaut ./data, ou $COLLECTOR_DATA s'il est défini.
"""
import argparse
import os
from datetime import date, datetime, timedelta, timezone
import sys
from pathlib import Path

from . import check, notices, polymarket, polymarket_legacy, wikipedia_polls
from .config import ELECTIONS
from .db import connect

ROOT = Path(__file__).resolve().parent.parent


def load_env(path):
    """Charge un fichier KEY=VALUE (sans écraser l'environnement existant). Garde les secrets hors du code."""
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            value = value.strip().strip('"').strip("'")
            if "MOT_DE_PASSE" in value:  # modèle .env.example pas encore rempli
                continue
            os.environ.setdefault(key.strip(), value)


def _day(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d %H:%M") if ts else "—"


def stats(con):
    q = lambda sql, *a: con.execute(sql, a).fetchall()
    concat = "GROUP_CONCAT(DISTINCT institute)" if con.dialect == "sqlite" else "STRING_AGG(DISTINCT institute, ',')"
    print("\n== Polymarket")
    for r in q("SELECT election_id, COUNT(DISTINCT m.condition_id) n, COUNT(p.ts) pts, "
               "MIN(p.ts) d0, MAX(p.ts) d1 "
               "FROM markets m LEFT JOIN market_prices p USING(condition_id) GROUP BY election_id"):
        print(f"  {r['election_id']}: {r['n']} marchés, {r['pts']} points ({_day(r['d0'])} → {_day(r['d1'])})")
    for r in q("SELECT election_id, candidate, last_price FROM markets WHERE closed = 0 "
               "ORDER BY last_price DESC LIMIT 5"):
        print(f"    {r['candidate']}: {r['last_price']:.1%}")
    print("\n== Sondages")
    for r in q("SELECT election_id, round, COUNT(*) n, COUNT(DISTINCT notice_url) notices, "
               "SUM(CASE WHEN fieldwork_end IS NULL THEN 1 ELSE 0 END) sans_date FROM polls GROUP BY 1, 2 ORDER BY 1, 2"):
        print(f"  {r['election_id']} tour {r['round']}: {r['n']} lignes, {r['notices']} notices, "
              f"{r['sans_date']} sans date déduite")
    print("\n== Notices")
    for r in q("SELECT sponsor_source, COUNT(*) n, SUM(CASE WHEN error IS NULL THEN 0 ELSE 1 END) err "
               "FROM notices GROUP BY 1 ORDER BY 1"):
        print(f"  commanditaire via {r['sponsor_source']}: {r['n']} (erreurs : {r['err']})")
    print("\n== Commanditaires (sondages distincts)")
    for r in q(f"SELECT sponsor, media_type, COUNT(DISTINCT notice_url) n, {concat} inst "
               "FROM v_poll_sponsors WHERE sponsor IS NOT NULL GROUP BY sponsor, media_type ORDER BY n DESC"):
        print(f"  {r['n']:3}  {r['sponsor']:<20} {r['media_type']:<6} {r['inst']}")


def live_elections(margin_days=7):
    """Élections à venir ou votées depuis moins de margin_days jours : les seules qui bougent encore."""
    limit = date.today() - timedelta(days=margin_days)
    return [eid for eid, e in ELECTIONS.items()
            if not (e["second_round_date"] or e["election_date"])
            or date.fromisoformat(e["second_round_date"] or e["election_date"]) >= limit]


def scheduled(con, args, data_dir):
    """Un passage de tâche planifiée (GitHub Actions, cron) : lancée chaque heure, elle se termine à chaque fois.

    Polymarket à chaque passage ; sondages et notices aux heures UTC de $POLLS_HOURS_UTC (6, 12 et 18
    par défaut : GitHub saute parfois des passages planifiés, trois essais par jour en garantissent un),
    ou à chaque passage si $COLLECT_POLLS vaut 1 (lancement manuel).
    Seules les élections en cours sont relues, sauf --election ou lancement manuel ($COLLECT_POLLS) : les
    élections passées ne changent plus, et les recharger toutes prend un quart d'heure.
    Une étape en échec n'empêche pas les suivantes, mais le code de sortie le signale pour que la
    plateforme affiche l'échec.
    """
    hours = {int(h) for h in os.environ.get("POLLS_HOURS_UTC", "6,12,18").split(",")}
    manual = os.environ.get("COLLECT_POLLS") == "1"
    elections = args.election or (None if manual else live_elections())

    def markets():
        if polymarket.collect(con, elections):
            raise RuntimeError("Polymarket injoignable")

    steps = [("polymarket", markets)]
    if datetime.now(timezone.utc).hour in hours or manual:
        steps += [
            ("polls", lambda: wikipedia_polls.collect(con, elections)),
            ("notices", lambda: notices.collect(con, data_dir / "notices")),
        ]
    failed = []
    for name, run in steps:
        try:
            run()
        except Exception as e:  # on continue : une source en panne ne doit pas bloquer les autres
            failed.append(name)
            print(f"[{name}] échec : {type(e).__name__}: {e}")
    print(f"[scheduled] étapes : {', '.join(n for n, _ in steps)} ; échecs : {', '.join(failed) or 'aucun'}")
    return 1 if failed else 0


def main():
    load_env(Path(os.environ.get("COLLECTOR_ENV", ROOT / ".env")))
    data_dir = Path(os.environ.get("COLLECTOR_DATA", ROOT / "data"))
    ap = argparse.ArgumentParser(prog="collector")
    ap.add_argument("command", nargs="?", default="all",
                    choices=["all", "polymarket", "polls", "notices", "stats", "check", "scheduled", "polymarket-legacy", "polymarket-search"])
    ap.add_argument("--election", action="append", help="id d'élection (répétable), défaut : toutes")
    ap.add_argument("--db", default=os.environ.get("DATABASE_URL") or str(data_dir / "polls.db"),
                    help="fichier SQLite ou URL postgresql:// (défaut : $DATABASE_URL, sinon data/polls.db)")
    ap.add_argument("--refresh-notices", action="store_true", help="re-parser toutes les notices")
    ap.add_argument("--query", action="append", help="texte recherché (polymarket-search, répétable)")
    ap.add_argument("--quiet", action="store_true", help="ne pas afficher les stats (cron)")
    args = ap.parse_args()

    if args.command == "check":
        sys.exit(0 if check.run() else 1)

    if args.command == "polymarket-search":
        polymarket.search(args.query or [])
        return

    con = connect(args.db)
    if args.command == "scheduled":
        sys.exit(scheduled(con, args, data_dir))
    if args.command == "polymarket-legacy":  # anciens marchés (avant fin 2022), relus sur Polygon
        polymarket_legacy.collect(con, args.election)
    if args.command in ("all", "polymarket"):
        polymarket.collect(con, args.election)
    if args.command in ("all", "polls"):
        wikipedia_polls.collect(con, args.election)
    if args.command in ("all", "notices"):
        notices.collect(con, data_dir / "notices", refresh=args.refresh_notices)
    if not args.quiet:
        stats(con)


if __name__ == "__main__":
    main()
