"""Cotes des anciens marchés Polymarket (avant fin 2022), reconstruites depuis la blockchain Polygon.

Ces marchés étaient des automates (FPMM, « Fixed Product Market Maker ») : l'API d'historique de
Polymarket ne les couvre pas. Leur cote se déduit de leurs réserves de parts Oui et Non :
P(Oui) = réserve Non / (réserve Oui + réserve Non).

Deux façons de retrouver ces réserves dans le passé :
- « state » (par défaut) : lire les soldes de l'automate à une date donnée (eth_call sur un bloc
  passé), toutes les 2 heures. Marche avec un accès archive gratuit (Alchemy) ;
- « logs » : rejouer chaque achat, vente et apport de liquidité (eth_getLogs). Plus fin, mais il faut
  un accès qui accepte de grandes plages de blocs (offres payantes) : $LEGACY_METHOD=logs.

Accès Polygon avec historique requis : $POLYGON_RPC_URL, par exemple
https://polygon-mainnet.g.alchemy.com/v2/<clé> (compte Alchemy gratuit).
"""
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime

from .config import ELECTIONS
from .http import get_json

GAMMA = "https://gamma-api.polymarket.com"
CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045"  # contrat Conditional Tokens (parts Oui/Non) sur Polygon
BALANCE_OF_BATCH = "0x4e1273f4"                     # balanceOfBatch(address[],uint256[])
STEP = 2 * 3600                                     # un relevé toutes les 2 heures (méthode « state »)

# keccak256 des signatures d'événements du contrat FixedProductMarketMaker (Gnosis), méthode « logs ».
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
            except urllib.error.HTTPError as e:
                if e.code != 429 or attempt == retries - 1:
                    # Le fournisseur explique son refus dans le corps de la réponse (limite de plage, quota…).
                    raise RuntimeError(f"{method} : HTTP {e.code} {e.read()[:300]!r}") from None
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

    def marks(self, start, end, step=20000):
        """Blocs repères (bloc, heure) tous les `step` blocs : les blocs Polygon arrivent environ
        toutes les 2 secondes, une interpolation entre repères suffit à quelques secondes près."""
        return [(b, self.timestamp(b)) for b in list(range(start, end, step)) + [end]]

    def logs(self, addresses, start, end):
        out, a = [], start
        while a <= end:
            b = min(a + self.log_range - 1, end)
            out += self.call("eth_getLogs", [{"address": addresses, "fromBlock": hex(a), "toBlock": hex(b),
                                              "topics": [[BUY, SELL, ADDED, REMOVED]]}])
            a = b + 1
        return out

    def balances(self, holder, token_ids, block):
        """Soldes ERC-1155 de `holder` au bloc donné (lecture d'état passé, accès archive)."""
        word = lambda n: format(n, "064x")
        n = len(token_ids)
        data = (BALANCE_OF_BATCH + word(0x40) + word(0x40 + 0x20 * (n + 1)) + word(n)
                + "".join(word(int(holder, 16)) for _ in token_ids) + word(n) + "".join(word(t) for t in token_ids))
        raw = self.call("eth_call", [{"to": CTF, "data": data}, hex(block)])[2:]
        words = [int(raw[i:i + 64], 16) for i in range(0, len(raw), 64)]
        return words[2:2 + n]  # offset, longueur, puis les soldes


def _interpolate(marks, x, by_time):
    """Bloc → heure (by_time=False) ou heure → bloc (by_time=True), par interpolation entre repères."""
    i, j = (1, 0) if by_time else (0, 1)
    for a, b in zip(marks, marks[1:]):
        if x <= b[i]:
            return a[j] + (b[j] - a[j]) * (x - a[i]) / max(1, b[i] - a[i])
    return marks[-1][j]


def _words(data):
    raw = data[2:]
    return [int(raw[i:i + 64], 16) for i in range(0, len(raw), 64)]


def replay(logs):
    """Méthode « logs » : rejoue les événements d'un automate à 2 issues ; renvoie [(bloc, P(Oui))]."""
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


def sample(rpc, marks, fpmm, yes_id, no_id, t_start, t_end):
    """Méthode « state » : réserves Oui/Non de l'automate toutes les STEP secondes ; [(heure, P(Oui))]."""
    out = []
    for ts in range(t_start // STEP * STEP + STEP, t_end, STEP):
        block = int(_interpolate(marks, ts, by_time=True))
        yes, no = rpc.balances(fpmm, [yes_id, no_id], block)
        if yes > 0 and no > 0:
            out.append((ts, no / (yes + no)))
    return out


def collect(con, election_ids=None):
    url = os.environ.get("POLYGON_RPC_URL")
    if not url:
        raise RuntimeError("POLYGON_RPC_URL manquant : accès Polygon avec historique (ex. Alchemy, compte gratuit).")
    method = os.environ.get("LEGACY_METHOD", "state")
    rpc = Rpc(url, int(os.environ.get("POLYGON_LOG_RANGE", "10000")))
    iso = lambda s: int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
    for eid in election_ids or ELECTIONS:
        for slug in ELECTIONS[eid]["polymarket_events"]:
            markets = [m for m in get_json(f"{GAMMA}/events", {"slug": slug})[0]["markets"] if m.get("marketMakerAddress")]
            if not markets:
                continue
            t_start, t_end = min(iso(m["createdAt"]) for m in markets), max(iso(m["endDate"]) for m in markets)
            start, end = rpc.block_at(t_start), rpc.block_at(t_end)
            marks = rpc.marks(start, end)
            if method == "logs":
                logs = rpc.logs([m["marketMakerAddress"].lower() for m in markets], start, end)
            for m in markets:
                fpmm = m["marketMakerAddress"].lower()
                if method == "logs":
                    mine = [l for l in logs if l["address"].lower() == fpmm]
                    series = [(int(_interpolate(marks, block, by_time=False)), p) for block, p in replay(mine)]
                else:
                    yes_id, no_id = (int(t) for t in json.loads(m["clobTokenIds"]))
                    series = sample(rpc, marks, fpmm, yes_id, no_id, t_start, t_end)
                # Un point par heure au plus : la dernière cote de l'heure, horodatée au début de l'heure.
                hourly = {}
                for ts, p in series:
                    hourly[ts // 3600 * 3600] = p
                con.executemany(
                    "INSERT INTO market_prices (condition_id, ts, price) VALUES (?, ?, ?) "
                    "ON CONFLICT (condition_id, ts) DO UPDATE SET price = excluded.price",
                    [(m["conditionId"], ts, round(p, 4)) for ts, p in sorted(hourly.items())],
                )
                con.commit()
                print(f"[polymarket-legacy] {eid} {m.get('groupItemTitle') or m['question']} ({method}) : "
                      f"{len(hourly)} points ; premières cotes {[round(p, 3) for _, p in series[:6]]}")
