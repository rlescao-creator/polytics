"""Marchés Polymarket : liste des candidats + historique des cotes."""
import json
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone

from .config import ELECTIONS, RESULTS
from .db import now
from .http import get_json

GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"


def _history(token_id, **params):
    return get_json(f"{CLOB}/prices-history", {"market": token_id, **params}).get("history", [])


def search(queries):
    """Affiche les événements Polymarket (ouverts et clos) qui répondent à chaque requête : sert à trouver les slugs."""
    for q in queries:
        q = q.replace("+", " ")  # « south+korea » : pas d'espaces à protéger dans les arguments du workflow
        for status in ("active", "closed"):
            if q.startswith("slug:"):  # vérifie qu'un slug existe
                events = get_json(f"{GAMMA}/events", {"slug": q[5:]}) if status == "closed" else []
                if status == "closed" and not events:
                    print(f"[{q}] introuvable")
            else:
                events = get_json(f"{GAMMA}/public-search", {"q": q, "events_status": status, "limit_per_type": 20}).get("events") or []
            for e in events:
                print(f"[{q}] {status:6} {e.get('slug')} | {e.get('title')} | fin {str(e.get('endDate'))[:10]} "
                      f"| volume {float(e.get('volume') or 0):,.0f}")


def collect(con, election_ids=None, min_volume=1000):
    """Renvoie le nombre d'événements Polymarket injoignables (0 si tout s'est bien passé)."""
    unreachable = 0
    for eid in election_ids or ELECTIONS:
        for slug in ELECTIONS[eid]["polymarket_events"]:
            try:
                events = get_json(f"{GAMMA}/events", {"slug": slug})
            except OSError as e:
                # En France, les FAI redirigent polymarket.com vers la page de blocage de l'ANJ.
                print(f"[polymarket] {eid}: API injoignable ({e}) — réseau filtré ?")
                unreachable += 1
                continue
            if not events:
                print(f"[polymarket] {eid}: événement '{slug}' introuvable")
                continue
            markets = events[0]["markets"]
            n_markets = n_points = 0
            for m in markets:
                volume = float(m.get("volume") or 0)
                if volume < min_volume:
                    continue  # candidats fantaisistes sans liquidité
                yes_token = json.loads(m["clobTokenIds"])[0]
                prices = json.loads(m.get("outcomePrices") or "[]")
                con.execute(
                    "INSERT INTO markets (condition_id, election_id, event_slug, question, candidate, "
                    "yes_token_id, volume, closed, last_price, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) "
                    "ON CONFLICT (condition_id) DO UPDATE SET volume=excluded.volume, closed=excluded.closed, "
                    "last_price=excluded.last_price, updated_at=excluded.updated_at",
                    (m["conditionId"], eid, slug, m["question"], m.get("groupItemTitle") or m["question"],
                     yes_token, volume, int(bool(m.get("closed"))),
                     float(prices[0]) if prices else None, now()),
                )
                if m.get("closed") and con.execute(
                        "SELECT 1 FROM market_prices WHERE condition_id = ? LIMIT 1", (m["conditionId"],)).fetchone():
                    continue  # marché clôturé déjà collecté : son historique ne bougera plus
                # Historique complet au pas journalier, puis dernière semaine au pas horaire.
                try:
                    points = _history(yes_token, interval="max", fidelity=1440)
                    if not m.get("closed"):
                        points += _history(yes_token, interval="1w", fidelity=60)
                except OSError as e:
                    print(f"[polymarket] {m['question']}: historique non récupéré ({e})")
                    points = []
                # Seuls les points depuis le dernier déjà en base partent : un aller-retour réseau par
                # point rendrait chaque passage horaire très long. Le dernier est réécrit, il peut avoir bougé.
                last = con.execute(
                    "SELECT max(ts) AS ts FROM market_prices WHERE condition_id = ?", (m["conditionId"],)).fetchone()["ts"]
                points = [p for p in points if last is None or p["t"] >= last]
                con.executemany(
                    "INSERT INTO market_prices (condition_id, ts, price) VALUES (?, ?, ?) "
                    "ON CONFLICT (condition_id, ts) DO UPDATE SET price = excluded.price",
                    [(m["conditionId"], p["t"], p["p"]) for p in points],
                )
                con.commit()
                n_markets += 1
                n_points += len(points)
            print(f"[polymarket] {eid}: {n_markets} marchés, {n_points} points de cotes écrits")
    return unreachable


def _bare(text):
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower())


def collect_night(con, election_ids=None, fidelity=10):
    """Nuit électorale : cotes des deux finalistes au pas de fidelity minutes, du jour du vote (0 h UTC) au
    surlendemain, pour le marché national et les événements de ELECTIONS[...]["polymarket_nuit"] (une ville…).

    Une élection déjà relevée n'est pas relue : passé le vote, ces cotes ne bougent plus.
    """
    for eid in election_ids or ELECTIONS:
        e, res = ELECTIONS[eid], RESULTS.get(eid)
        vote = e["second_round_date"] or e["election_date"]
        if not res or not vote or date.fromisoformat(vote) >= date.today():
            continue
        finalists = sorted(res[max(r for r in res if isinstance(r, int))].items(), key=lambda kv: -kv[1])[:2]
        names = [n for n, _ in finalists]
        start = int(datetime.fromisoformat(vote).replace(tzinfo=timezone.utc).timestamp())
        window = {"startTs": start, "endTs": start + int(timedelta(days=2).total_seconds()), "fidelity": fidelity}

        def pick(markets):
            """Le marché le plus échangé de chaque finaliste, nom comparé sans accents ni casse."""
            out = []
            for n in names:
                m = next((m for m in markets if m[1] and (_bare(n) in _bare(m[0]) or _bare(m[0]) in _bare(n))), None)
                if m:
                    out.append((n, m[1], m[2]))
            return out

        series = {"national": pick([(m["candidate"], m["yes_token_id"], m["volume"]) for m in con.execute(
            "SELECT candidate, yes_token_id, volume FROM markets WHERE election_id = ? ORDER BY volume DESC", (eid,)).fetchall()])}
        for label, slug in e.get("polymarket_nuit", {}).items():
            try:
                events = get_json(f"{GAMMA}/events", {"slug": slug})
            except OSError as err:
                print(f"[nuit] {eid} {label}: API injoignable ({err})")
                continue
            # « Other », « Candidate A » ne correspondent à aucun finaliste et sont ignorés.
            series[label] = pick(sorted(((m.get("groupItemTitle") or m["question"], json.loads(m["clobTokenIds"])[0],
                                          float(m.get("volume") or 0)) for m in (events[0]["markets"] if events else [])),
                                        key=lambda m: -m[2]))

        for label, markets in series.items():
            if con.execute("SELECT 1 FROM nuit_electorale WHERE election_id = ? AND serie = ? LIMIT 1",
                           (eid, label)).fetchone():
                continue
            rows = []
            for name, token, volume in markets:
                try:
                    rows += [(eid, label, name, volume, p["t"], p["p"]) for p in _history(token, **window)]
                except OSError as err:
                    print(f"[nuit] {eid} {label} {name}: historique non récupéré ({err})")
            con.executemany(
                "INSERT INTO nuit_electorale (election_id, serie, candidat, volume, ts, price) VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT (election_id, serie, candidat, ts) DO NOTHING", rows)
            con.commit()
            print(f"[nuit] {eid} {label}: {len(rows)} points")
