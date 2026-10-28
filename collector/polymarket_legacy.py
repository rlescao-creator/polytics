"""Cotes des anciens marchés Polymarket (avant fin 2022), reconstruites depuis la blockchain Polygon.

Ces marchés étaient des automates (FPMM, « Fixed Product Market Maker ») : l'API d'historique de
Polymarket ne les couvre pas. Chaque achat, vente ou apport de liquidité est en revanche resté
inscrit sur Polygon. On rejoue ces événements pour retrouver les réserves de l'automate, d'où
découle la cote : pour un marché Oui/Non, P(Oui) = réserve Non / (réserve Oui + réserve Non).

Il faut un accès Polygon qui sert l'historique (archive) : $POLYGON_RPC_URL, par exemple
https://polygon-mainnet.g.alchemy.com/v2/<clé> (compte Alchemy gratuit).
"""
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

from .config import ELECTIONS
from .http import get_json

GAMMA = "https://gamma-api.polymarket.com"

# keccak256 des signatures d'événements du contrat FixedProductMarketMaker (Gnosis).
BUY = "0x4f62630f51608fc8a7603a9391a5101e58bd7c276139366fc107dc3b67c3dcf8"      # FPMMBuy(address,uint256,uint256,uint256,uint256)
SELL = "0xadcf2a240ed9300d681d9a3f5382b6c1beed1b7e46643e0c7b42cbe6e2d766b4"     # FPMMSell(address,uint256,uint256,uint256,uint256)
ADDED = "0xec2dc3e5a3bb9aa0a1deb905d2bd23640d07f107e6ceb484024501aad964a951"    # FPMMFundingAdded(address,uint256[],uint256)
REMOVED = "0x8b4b2c8ebd04c47fc8bce136a85df9b93fcb1f47c8aa296457d4391519d190e7"  # FPMMFundingRemoved(address,uint256[],uint256,uint256)


class Rpc:
    def __init__(self, url, log_range):
        self.url, self.log_range, self._ts = url, log_range, {}

    def call(self, method, params, retries=5):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        req = urllib.request.Request(self.url, data=body, headers={"content-type": "application/json",
                                                                   "user-agent": "poll-collector/0.1"})
        for attempt in range(retries):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = json.loads(r.read())
                if "error" in data:
                    raise RuntimeError(f"{method} : {data['error']}")
                return data["result"]
            except (urllib.error.URLError, TimeoutError):
                if attempt == retries - 1:
                    raise
                time.sleep(2 ** attempt)

    def timestamp(self, block):
        if block not in self._ts:
            self._ts[block] = int(self.call("eth_getBlockByNumber", [hex(block), False])["timestamp"], 16)
        return self._ts[block]

    def block_at(self, ts):
        """Premier bloc dont l'horodatage est >= ts (recherche dichotomique)."""
        lo, hi = 1, int(self.call("eth_blockNumber", []), 16)
        while lo < hi:
            mid = (lo + hi) // 2
            if self.timestamp(mid) < ts:
                lo = mid + 1
            else:
                hi = mid
        return lo

    def clock(self, start, end, step=20000):
        """Heure estimée d'un bloc, interpolée entre des blocs relevés tous les `step` blocs.

        Les blocs Polygon arrivent environ toutes les 2 secondes : l'erreur reste de quelques
        secondes, et on évite une requête par bloc échangé.
        """
        marks = list(range(start, end, step)) + [end]
        known = [(b, self.timestamp(b)) for b in marks]

        def at(block):
            for (b0, t0), (b1, t1) in zip(known, known[1:]):
                if block <= b1:
                    return t0 + (t1 - t0) * (block - b0) / max(1, b1 - b0)
            return known[-1][1]
        return at

    def logs(self, addresses, start, end):
        out, a = [], start
        while a <= end:
            b = min(a + self.log_range - 1, end)
            out += self.call("eth_getLogs", [{"address": addresses, "fromBlock": hex(a), "toBlock": hex(b),
                                              "topics": [[BUY, SELL, ADDED, REMOVED]]}])
            a = b + 1
        return out


def _words(data):
    raw = data[2:]
    return [int(raw[i:i + 64], 16) for i in range(0, len(raw), 64)]


def replay(logs):
    """Rejoue les événements d'un automate à 2 issues ; renvoie [(bloc, P(Oui))] après chaque échange."""
    bal, prices = [0, 0], []
    for log in sorted(logs, key=lambda l: (int(l["blockNumber"], 16), int(l["logIndex"], 16))):
        topic, w = log["topics"][0], _words(log["data"])
        if topic == BUY:                      # data : investmentAmount, feeAmount, outcomeTokensBought
            i, net = int(log["topics"][2], 16), w[0] - w[1]
            bal = [b + net for b in bal]
            bal[i] -= w[2]
        elif topic == SELL:                   # data : returnAmount, feeAmount, outcomeTokensSold
            i, total = int(log["topics"][2], 16), w[0] + w[1]
            bal[i] += w[2]
            bal = [b - total for b in bal]
        elif topic == ADDED:                  # data : offset, sharesMinted, len, montants…
            bal = [b + x for b, x in zip(bal, w[3:5])]
        elif topic == REMOVED:                # data : offset, collateralRemoved, sharesBurnt, len, montants…
            bal = [b - x for b, x in zip(bal, w[4:6])]
        if topic in (BUY, SELL) and sum(bal) > 0:
            prices.append((int(log["blockNumber"], 16), bal[1] / sum(bal)))
    return prices


def collect(con, election_ids=None):
    url = os.environ.get("POLYGON_RPC_URL")
    if not url:
        raise RuntimeError("POLYGON_RPC_URL manquant : accès Polygon avec historique (ex. Alchemy, compte gratuit).")
    rpc = Rpc(url, int(os.environ.get("POLYGON_LOG_RANGE", "10000")))
    for eid in election_ids or ELECTIONS:
        for slug in ELECTIONS[eid]["polymarket_events"]:
            markets = [m for m in get_json(f"{GAMMA}/events", {"slug": slug})[0]["markets"] if m.get("marketMakerAddress")]
            if not markets:
                continue
            iso = lambda s: int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
            start = rpc.block_at(min(iso(m["createdAt"]) for m in markets))
            end = rpc.block_at(max(iso(m["endDate"]) for m in markets))
            addrs = [m["marketMakerAddress"].lower() for m in markets]
            logs = rpc.logs(addrs, start, end)
            when = rpc.clock(start, end)
            for m in markets:
                mine = [l for l in logs if l["address"].lower() == m["marketMakerAddress"].lower()]
                # Un point par heure : la dernière cote de l'heure, horodatée au début de l'heure.
                hourly = {}
                for block, p in replay(mine):
                    hourly[int(when(block)) // 3600 * 3600] = p
                con.executemany(
                    "INSERT INTO market_prices (condition_id, ts, price) VALUES (?, ?, ?) "
                    "ON CONFLICT (condition_id, ts) DO UPDATE SET price = excluded.price",
                    [(m["conditionId"], ts, round(p, 4)) for ts, p in sorted(hourly.items())],
                )
                con.commit()
                print(f"[polymarket-legacy] {eid} {m.get('groupItemTitle') or m['question']}: "
                      f"{len(mine)} événements, {len(hourly)} points horaires")
