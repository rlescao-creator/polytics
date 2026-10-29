"""Ce que montrent les chaînes : les articles de leurs sites qui citent un sondage présidentiel.

1. Lister les articles depuis les plans du site (sitemaps). On ne garde que les adresses qui parlent de
   sondage et de présidentielle.
2. Lire chaque article (une seule fois) : date de publication, titre, institut cité, commanditaires
   (« sondage Harris Interactive pour M6/RTL »), et s'il donne des intentions de vote.
3. Le rapprochement avec les sondages se fait en SQL (vue v_media_polls), parce que les sondages Wikipedia
   sont rechargés en entier et changent d'identifiant.

Le collecteur se présente sous son propre nom (http.USER_AGENT) et respecte le robots.txt de chaque site :
une adresse interdite à « poll-collector » ou à tous les robots n'est pas lue. Plusieurs chaînes (CNews,
Europe 1) refusent tous les robots : elles ne sont pas collectées. Les sites de presse interdisent aussi
la fouille de texte par les agents d'IA (opt-out de la directive européenne sur le droit d'auteur) :
vérifier les conditions d'utilisation avant un usage commercial.
"""
import html
import json
import re
import urllib.error
import urllib.parse
from datetime import date, datetime
from urllib import robotparser

from bs4 import BeautifulSoup

from .config import MEDIA, MEDIA_SITES, MEDIA_WINDOWS
from .http import USER_AGENT, get

ROBOT_NAME = USER_AGENT.split("/")[0]  # 'poll-collector', le nom cherché dans les robots.txt
_robots = {}


class Disallowed(Exception):
    pass


def fetch(url, delay=0.5):
    """GET d'une page si le robots.txt du site l'autorise ; un robots.txt illisible vaut refus."""
    parts = urllib.parse.urlsplit(url)
    root = f"{parts.scheme}://{parts.netloc}"
    if root not in _robots:
        rules = robotparser.RobotFileParser()
        try:
            rules.parse(get(root + "/robots.txt").decode("utf-8", "replace").splitlines())
        except Exception:
            rules.disallow_all = True
        _robots[root] = rules
    if not _robots[root].can_fetch(ROBOT_NAME, url):
        raise Disallowed(url)
    return get(url, delay=delay)

# Noms tels qu'ils figurent dans polls.institute ; le premier cité dans l'article l'emporte.
INSTITUTES = [
    (r"\bIfop\b", "Ifop"), (r"\bElabe\b", "Elabe"), (r"\bOdoxa\b", "Odoxa"), (r"\bIpsos\b", "Ipsos"),
    (r"\bBVA\b", "BVA"), (r"\bOpinion ?Way\b", "OpinionWay"), (r"Harris Interactive|\bToluna\b|\bHarris\b", "Harris"),
    (r"\bCluster ?17\b", "Cluster17"), (r"\bCSA\b", "CSA"), (r"\bVerian\b", "Verian"), (r"\bKantar\b", "Kantar"),
    (r"\bYouGov\b", "YouGov"), (r"\bViavoice\b", "Viavoice"), (r"\bAtlas ?Politico\b", "Atlas Politico"),
]
VOTE = re.compile(r"intentions? de vote|premier tour|second tour|1er tour|2nd tour|l'emporterait|recueill|"
                  r"au second|qualifi", re.I)
LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>(?:\s*<lastmod>\s*([^<\s]+)\s*</lastmod>)?")


def _months(since, until):
    y, m = since.year, since.month
    while (y, m) <= (until.year, until.month):
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def _sitemap(url):
    try:
        return [(loc, mod) for loc, mod in LOC.findall(fetch(url).decode("utf-8", "replace"))]
    except urllib.error.HTTPError as e:
        if e.code in (403, 404, 410):  # BFMTV répond 403 pour un fichier qui n'existe pas
            return []
        raise


def _list_bfmtv(since, until):
    for y, m in _months(since, until):
        for i in range(10):  # 5 000 adresses par fichier, plusieurs fichiers les mois chargés
            rows = _sitemap(f"https://www.bfmtv.com/sitemaps/rubriquesContenus/{y}-{m:02d}-{i}.xml.gz")
            if not rows:
                break
            yield from ((loc, None) for loc, _ in rows)


def _list_franceinfo(since, until):
    for y, m in _months(since, until):
        yield from ((loc, None) for loc, _ in _sitemap(f"https://www.franceinfo.fr/sitemap/{y}-{m:02d}-article.xml"))


def _list_tf1info(since, until):
    index = fetch("https://www.tf1info.fr/sitemap.xml").decode()
    for n in sorted({int(n) for n in re.findall(r"sitemap-contents-(\d+)\.xml", index)}):
        for loc, mod in _sitemap(f"https://www.tf1info.fr/sitemap-contents-{n}.xml"):
            # lastmod = dernière modification, jamais avant la publication : écarte les vieux articles
            if mod and since.isoformat() <= mod[:10]:
                yield loc, None


LISTERS = {"bfmtv": _list_bfmtv, "franceinfo": _list_franceinfo, "tf1info": _list_tf1info}


def _election_for(day):
    for eid, (start, end) in MEDIA_WINDOWS.items():
        if date.fromisoformat(start) <= day <= (date.fromisoformat(end) if end else date.today()):
            return eid
    return None


# Sondages d'élections étrangères (« présidentielle au Brésil ») : hors sujet.
ABROAD = re.compile(r"/(international|monde|world)/|bresil|etats-unis|americaine|israel|argentin|chili|colombi|"
                    r"portugal|roumani|pologne|coree|perou|mexique|taiwan")


def _wanted(url, eid):
    slug = url.lower()
    return "sondage" in slug and not ABROAD.search(slug) and re.search(MEDIA_SITES_KEYWORDS[eid], slug)


MEDIA_SITES_KEYWORDS = {
    "fr-2027": r"presidenti|2027|intention|tour|le-pen|bardella|melenchon|philippe|glucksmann|retailleau|attal|zemmour",
    "fr-2022": r"presidenti|2022|intention|tour|macron|le-pen|melenchon|zemmour|pecresse|jadot|hidalgo",
}


def _published(soup, ld):
    for d in ld:
        if d.get("datePublished"):
            return d["datePublished"]
    for prop in ("article:published_time", "og:article:published_time", "date"):
        m = soup.find("meta", attrs={"property": prop}) or soup.find("meta", attrs={"name": prop})
        if m and m.get("content"):
            return m["content"]
    return None


def _ld(soup):
    out = []
    for s in soup.find_all("script", type="application/ld+json"):
        try:
            d = json.loads(s.string or "")
        except json.JSONDecodeError:
            continue
        for x in (d if isinstance(d, list) else d.get("@graph", [d]) if isinstance(d, dict) else []):
            if isinstance(x, dict) and re.search(r"Article|Posting", str(x.get("@type"))):
                out.append(x)
    return out


def parse_article(page):
    """Page d'article -> date de publication, titre, institut, commanditaires, intentions de vote."""
    soup = BeautifulSoup(page, "html.parser")
    ld = _ld(soup)
    title = next((d.get("headline") for d in ld if d.get("headline")), None)
    if not title:
        og = soup.find("meta", attrs={"property": "og:title"})
        title = og["content"] if og and og.get("content") else (soup.title.string if soup.title else "")
    lead = " ".join(filter(None, [title] + [d.get("description") or d.get("alternativeHeadline") for d in ld]))
    body = next((d.get("articleBody") for d in ld if d.get("articleBody")), None)
    if not body:
        node = soup.find("article") or soup.body or soup
        body = " ".join(p.get_text(" ") for p in node.find_all("p")) or node.get_text(" ")
    text = re.sub(r"\s+", " ", BeautifulSoup(f"{lead} {body}", "html.parser").get_text(" "))[:8000]

    hits = sorted((m.start(), name, m) for pattern, name in INSTITUTES for m in [re.search(pattern, text)] if m)
    institute = hits[0][1] if hits else None
    sponsors = []
    if hits:
        after = text[hits[0][2].end():hits[0][2].end() + 160]
        m = re.search(r"\b(?:pour|commandé par|réalisé pour)\b(.{0,100})", after)
        if m:
            span = re.split(r"[.;:]\s", m.group(1))[0]
            sponsors = [name for pattern, name, _ in MEDIA if re.search(pattern, span, re.I)]
    return {
        "published_at": _published(soup, ld), "title": re.sub(r"\s+", " ", html.unescape(title or "")).strip()[:500],
        "institute": institute, "commissioned_by": ", ".join(dict.fromkeys(sponsors)) or None,
        "vote_intention": bool(VOTE.search(text)),
    }


def collect(con, media_names=None, since=None, until=None):
    """Ajoute les articles pas encore lus des chaînes de MEDIA_SITES (toutes par défaut)."""
    pg = con.dialect == "postgres"
    for name, site in MEDIA_SITES.items():
        sponsors = site["sponsors"] if pg else ",".join(site["sponsors"])
        con.execute("INSERT INTO media_outlets (name, site, sponsors) VALUES (?,?,?) ON CONFLICT (name) "
                    "DO UPDATE SET site = excluded.site, sponsors = excluded.sponsors", (name, site["site"], sponsors))
    con.commit()
    known = {r["url"] for r in con.execute("SELECT url FROM media_articles").fetchall()}
    starts = [date.fromisoformat(s) for s, _ in MEDIA_WINDOWS.values()]
    lo = since or min(starts)
    hi = until or date.today()

    for name in media_names or MEDIA_SITES:
        site = MEDIA_SITES[name]
        try:
            listing = list(LISTERS[site["sitemap"]](lo, hi))
        except Disallowed as e:
            print(f"[médias] {name} : plan du site interdit aux robots par robots.txt ({e}), chaîne ignorée")
            continue
        added = seen = failed = 0
        for url, ts in listing:
            if url in known:
                continue
            day = datetime.strptime(ts[:8], "%Y%m%d").date() if ts else _date_in_url(url)
            eids = [_election_for(day)] if day else list(MEDIA_WINDOWS)
            if not any(e and _wanted(url, e) for e in eids):
                continue
            known.add(url)
            seen += 1
            try:
                art = parse_article(fetch(url).decode("utf-8", "replace"))
            except Disallowed:
                continue
            except Exception as e:  # une page en erreur ne doit pas arrêter la collecte
                failed += 1
                print(f"[médias] {name} : {url} illisible ({type(e).__name__})")
                continue
            pub = art["published_at"]
            pub_day = date.fromisoformat(pub[:10]) if pub else day
            eid = _election_for(pub_day) if pub_day else None
            if eid is None or not _wanted(url, eid) and not art["vote_intention"]:
                continue
            con.execute(
                "INSERT INTO media_articles (media, url, published_at, title, election_id, institute, "
                "commissioned_by, vote_intention, via) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (url) DO NOTHING",
                (name, url, pub or (pub_day.isoformat() if pub_day else None), art["title"], eid, art["institute"],
                 art["commissioned_by"], art["vote_intention"] if pg else int(art["vote_intention"]), "sitemap"))
            added += 1
            if added % 25 == 0:
                con.commit()
        con.commit()
        print(f"[médias] {name} : {seen} articles lus, {added} gardés, {failed} illisibles")


def _date_in_url(url):
    """'…/2026-01-08/…' ou '_AN-202610230176' (BFMTV) -> date ; sinon None."""
    m = re.search(r"/(20\d\d)-(\d\d)-(\d\d)/", url) or re.search(r"_[A-Z]{2}-(20\d\d)(\d\d)(\d\d)\d{4}\.html", url)
    if m:
        try:
            return date(*map(int, m.groups()))
        except ValueError:
            return None
    return None
