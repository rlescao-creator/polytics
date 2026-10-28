"""Marchés Polymarket : liste des candidats + historique des cotes."""
import json

from .config import ELECTIONS
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
