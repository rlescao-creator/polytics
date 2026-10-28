"""Vérifie que chaque source est joignable depuis cette machine (à lancer juste après l'install serveur)."""
import urllib.error

from .http import get

SOURCES = {
    "Polymarket Gamma": "https://gamma-api.polymarket.com/events?slug=next-french-presidential-election",
    "Polymarket CLOB": "https://clob.polymarket.com/time",
    "Wikipedia": "https://fr.wikipedia.org/w/api.php?action=query&meta=siteinfo&format=json",
    "Commission des sondages": "https://www.commission-des-sondages.fr/notices/",
}


def run():
    ok = True
    for name, url in SOURCES.items():
        try:
            get(url, retries=2, delay=0)
            print(f"  OK      {name}")
        except (urllib.error.URLError, OSError) as e:
            ok = False
            reason = str(getattr(e, "reason", e))
            # Blocage ANJ : le DNS renvoie vers offre-illegale.anj.fr, d'où un certificat *.anj.fr.
            hint = " -> réseau filtré (blocage ANJ ?)" if "certificate" in reason.lower() else ""
            print(f"  ÉCHEC   {name}: {reason}{hint}")
    return ok
