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
CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045"  # contrat Conditional Tokens de Polymarket sur Polygon

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

    def transfers(self, start, end, **direction):
        """Transferts ERC-1155 (parts Oui/Non) vers ou depuis une adresse, via alchemy_getAssetTransfers.

        Fonction propre à Alchemy, disponible en offre gratuite : 1 000 transferts par page, sans
        limite de plage de blocs (contrairement à eth_getLogs), avec l'heure de chaque bloc.
        """
        out, page = [], None
        while True:
            params = {"fromBlock": hex(start), "toBlock": hex(end), "category": ["erc1155"],
                      "withMetadata": True, "excludeZeroValue": False,
                      "maxCount": hex(1000), "order": "asc", **direction}
            if not os.environ.get("LEGACY_DEBUG"):
                params["contractAddresses"] = [CTF]
            if page:
                params["pageKey"] = page
            res = self.call("alchemy_getAssetTransfers", [params])
            out += res["transfers"]
            page = res.get("pageKey")
            if not page:
                return out

    def logs(self, addresses, start, end):
        out, a = [], start
        while a <= end:
            b = min(a + self.log_range - 1, end)
            out += self.call("eth_getLogs", [{"address": addresses, "fromBlock": hex(a), "toBlock": hex(b),
                                              "topics": [[BUY, SELL, ADDED, REMOVED]]}])
            a = b + 1
        return out


def replay_transfers(rpc, fpmm, yes_id, no_id, start, end):
    """Cote après chaque transaction, à partir des parts Oui/Non entrées et sorties de l'automate.

    Les réserves de l'automate sont ses soldes de parts Oui et Non ; P(Oui) = Non / (Oui + Non).
    Renvoie [(horodatage, P(Oui))].
    """
    moves = {}
    for sign, direction in ((1, {"toAddress": fpmm}), (-1, {"fromAddress": fpmm})):
        found = rpc.transfers(start, end, **direction)
        if os.environ.get("LEGACY_DEBUG"):
            tokens = {}
            for t in found:
                for meta in t.get("erc1155Metadata") or []:
                    tokens[meta["tokenId"]] = tokens.get(meta["tokenId"], 0) + 1
            print(f"  [diagnostic] {fpmm} {list(direction)[0]} : {len(found)} transferts, contrats "
                  f"{sorted({t.get('rawContract', {}).get('address') for t in found})}, parts {tokens} ; "
                  f"attendues Oui={hex(yes_id)} Non={hex(no_id)}")
        for t in found:
            log_index = int(t["uniqueId"].rsplit(":", 1)[-1], 0)
            key = (int(t["blockNum"], 16), t["hash"])
            when = int(datetime.fromisoformat(t["metadata"]["blockTimestamp"].replace("Z", "+00:00")).timestamp())
            entry = moves.setdefault(key, {"order": log_index, "ts": when, "yes": 0, "no": 0})
            entry["order"] = min(entry["order"], log_index)
            for meta in t.get("erc1155Metadata") or []:
                token, value = int(meta["tokenId"], 16), int(meta["value"], 16)
                if token == yes_id:
                    entry["yes"] += sign * value
                elif token == no_id:
                    entry["no"] += sign * value
    yes = no = 0
    prices = []
    for (block, _), e in sorted(moves.items(), key=lambda kv: (kv[0][0], kv[1]["order"])):
        yes, no = yes + e["yes"], no + e["no"]
        if yes > 0 and no > 0:
            prices.append((e["ts"], no / (yes + no)))
    return prices


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
            by_transfers = "alchemy.com" in url  # Alchemy gratuit : eth_getLogs limité, transferts illimités
            if not by_transfers:
                logs = rpc.logs([m["marketMakerAddress"].lower() for m in markets], start, end)
                when = rpc.clock(start, end)
            for m in markets:
                if by_transfers:
                    yes_id, no_id = (int(t) for t in json.loads(m["clobTokenIds"]))
                    series = replay_transfers(rpc, m["marketMakerAddress"].lower(), yes_id, no_id, start, end)
                else:
                    mine = [l for l in logs if l["address"].lower() == m["marketMakerAddress"].lower()]
                    series = [(int(when(block)), p) for block, p in replay(mine)]
                # Un point par heure : la dernière cote de l'heure, horodatée au début de l'heure.
                hourly = {}
                for ts, p in series:
                    hourly[ts // 3600 * 3600] = p
                con.executemany(
                    "INSERT INTO market_prices (condition_id, ts, price) VALUES (?, ?, ?) "
                    "ON CONFLICT (condition_id, ts) DO UPDATE SET price = excluded.price",
                    [(m["conditionId"], ts, round(p, 4)) for ts, p in sorted(hourly.items())],
                )
                con.commit()
                print(f"[polymarket-legacy] {eid} {m.get('groupItemTitle') or m['question']}: "
                      f"{len(series)} échanges, {len(hourly)} points horaires ; premières cotes "
                      f"{[round(p, 3) for _, p in series[:6]]}")
