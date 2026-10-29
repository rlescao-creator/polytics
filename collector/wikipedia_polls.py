"""Chiffres des sondages depuis les tableaux Wikipedia.

France (fr.wikipedia) : chaque ligne de tableau pointe vers la notice officielle de la Commission
des sondages, ce qui permet ensuite de la relier à son commanditaire.
États-Unis (en.wikipedia) : tableaux « National poll results », une colonne par candidat.
Autres pays (en.wikipedia) : pages « Opinion polling for… » de formes variées ; une colonne est retenue
quand son en-tête renvoie vers la page Wikipedia d'un candidat listé dans la configuration de l'élection.
"""
import re
import unicodedata
from collections import Counter
import urllib.parse
from datetime import date

from bs4 import BeautifulSoup

from .config import ELECTIONS
from .http import get_json

MONTHS = {
    "janv": 1, "jan": 1, "fév": 2, "févr": 2, "fev": 2, "mars": 3, "avr": 4, "mai": 5,
    "juin": 6, "juil": 7, "août": 8, "aout": 8, "sept": 9, "sep": 9, "oct": 10,
    "nov": 11, "déc": 12, "dec": 12,
}
NUMBER = re.compile(r"\d+(?:[.,]\d+)?")
MONTHS_EN = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
NOTICE_PATH = re.compile(r"/notices/(\d{4})/([a-zéû]+)/", re.I)


def _month(word):
    w = word.lower().strip(".")
    for key in sorted(MONTHS, key=len, reverse=True):
        if w.startswith(key):
            return MONTHS[key]
    return None


INSTITUTE_ALIASES = {
    "harris interactive": "Harris", "harris interractive": "Harris", "toluna harris interactive": "Harris",
    "cluster 17": "Cluster17", "opinionway": "OpinionWay", "ipsos-bva": "Ipsos", "ipsos bva": "Ipsos",
}


def _institute(name):
    """'Ifop (rolling)' -> 'Ifop', 'Harris Interractive' -> 'Harris' : un nom par institut."""
    base = re.sub(r"\s*\(.*?\)", "", name).strip()
    return INSTITUTE_ALIASES.get(base.lower(), base)


def _spelling_key(name):
    """'Redfield & Wilton Strategies' = 'Redfield and Wilton Strategies', 'Forbes / HarrisX' = 'HarrisX / Forbes',
    'Analogías' = 'Analogias' : lettres seules, sans accents ni casse, parties séparées par '/' triées."""
    parts = re.split(r"\s*/\s*", re.sub(r"\s(?:&|and)\s", " ", name, flags=re.I))
    bare = lambda t: re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower())
    return "|".join(sorted(bare(t) for t in parts))


def _merge_spellings(polls):
    """Une seule écriture par institut dans une élection : la plus fréquente parmi ses variantes."""
    for p in polls:
        p["institute"] = re.sub(r"\s*/\s*", " / ", re.sub(r"[\"“”«»]", "", p["institute"])).strip()
        if p.get("media"):
            p["media"] = re.sub(r"[\"“”«»]", "", p["media"]).strip()
    counts = Counter(p["institute"] for p in polls)
    best = {}
    for name, n in counts.most_common():
        best.setdefault(_spelling_key(name), name)
    for p in polls:
        p["institute"] = best[_spelling_key(p["institute"])]


def _clean(s):
    s = re.sub(r"\s+", " ", s).strip()
    return re.sub(r"\(\s+", "(", re.sub(r"\s+\)", ")", s))


def _split_party(name):
    """'Le Pen (RN)' -> ('Le Pen', 'RN')."""
    m = re.match(r"^(.*?)\s*\(([^)]*)\)\s*$", name)
    return (m.group(1), m.group(2)) if m else (name, None)


def _text(el):
    for sup in el.find_all("sup"):
        sup.decompose()
    return _clean(el.get_text(" "))


def _grid(rows):
    """Déplie rowspan/colspan : renvoie une liste de lignes de cellules (même objet si fusionnées)."""
    grid, pending = [], {}  # pending[col] = (cell, lignes restantes)
    for tr in rows:
        out, col = [], 0
        cells = tr.find_all(["th", "td"], recursive=False)
        it = iter(cells)
        while True:
            if col in pending:
                cell, left = pending[col]
                out.append(cell)
                pending[col] = (cell, left - 1) if left > 1 else None
                if pending[col] is None:
                    del pending[col]
                col += 1
                continue
            cell = next(it, None)
            if cell is None:
                break
            span = int(re.sub(r"\D", "", cell.get("colspan", "1")) or 1)
            rspan = int(re.sub(r"\D", "", cell.get("rowspan", "1")) or 1)
            for _ in range(span):
                out.append(cell)
                if rspan > 1:
                    pending[col] = (cell, rspan - 1)
                col += 1
        # Cellules fusionnées venant de lignes précédentes, au-delà de la dernière cellule.
        while col in pending:
            cell, left = pending.pop(col)
            out.append(cell)
            if left > 1:
                pending[col] = (cell, left - 1)
            col += 1
        grid.append(out)
    return grid


def _fieldwork_end(label, notice_url, heading_year):
    """'21-22 octobre' -> date ISO du dernier jour de terrain."""
    matches = re.findall(r"(\d{1,2})(?:er)?\s+([A-Za-zéûÉ]+\.?)", label)
    if not matches:
        return None
    day, month_word = matches[-1]
    month = _month(month_word)
    if not month:
        return None
    explicit = re.search(r"\b(20\d\d)\b", label)
    year = int(explicit.group(1)) if explicit else None
    if year is None and notice_url:
        m = NOTICE_PATH.search(urllib.parse.unquote(notice_url))
        if m:
            year = int(m.group(1))
            notice_month = _month(m.group(2))
            # Terrain en décembre, notice déposée en janvier.
            if notice_month and month > notice_month:
                year -= 1
    year = year or heading_year
    if not year:
        return None
    try:
        return date(year, month, int(day)).isoformat()
    except ValueError:
        return None


def _parse_cell(cell, column):
    """Une case -> [(candidat, valeur, note)].

    Une case peut nommer un autre candidat que celui de la colonne (ex. 'Hollande (PS)' testé
    dans la colonne Glucksmann, ou 'Candidat RN' = Bardella), et 'Autres' peut en lister
    plusieurs séparés par <hr>.
    """
    for sup in cell.find_all("sup"):
        sup.decompose()
    parts = re.split(r"<hr\s*/?>", str(cell))
    # Sans <hr>, deux candidats dans la même case : '12 % Bertrand 8 % Pécresse'.
    texts = [chunk for part in parts
             for chunk in re.split(r"(?<=[A-Za-zÀ-ÿ)])\s+(?=<?\s*\d)", _clean(BeautifulSoup(part, "html.parser").get_text(" ")))]
    out = []
    for txt in texts:
        m = NUMBER.search(txt)
        if not m:
            continue
        value = float(m.group(0).replace(",", "."))
        rest = (txt[:m.start()] + txt[m.end():]).strip(" |")
        notes = ["inférieur à"] if "<" in rest else []
        name = _clean(rest.replace("<", "")).lstrip("% ")  # '26 % Bertrand' : le signe reste collé au nom
        if re.search(r"[A-Za-zÀ-ÿ]", name):
            notes.append(f"colonne {column}")
            out.append((name, value, "; ".join(notes)))
        else:
            out.append((column, value, "; ".join(notes) or None))
    return out


def _parse_table(table, headings, page_url, election_year=None):
    rows = table.find_all("tr")
    grid = _grid(rows)
    header_rows = 0
    while header_rows < len(rows) and not rows[header_rows].find("td", recursive=False):
        header_rows += 1
    if header_rows == 0:
        return []
    ncols = max(len(r) for r in grid[:header_rows])
    names = []
    for c in range(ncols):
        name = ""
        for r in grid[:header_rows]:
            if c < len(r):
                t = _text(r[c])
                if t:
                    name = t
        names.append(name)
    lower = [n.lower() for n in names]
    try:
        c_inst = next(i for i, n in enumerate(lower) if n.startswith("sondeur") or n.startswith("institut"))
        c_date = next(i for i, n in enumerate(lower) if n.startswith("date"))
    except StopIteration:
        return []
    c_sample = next((i for i, n in enumerate(lower) if n.startswith("échantillon")), None)
    cand_cols = [i for i in range(ncols) if i not in (c_inst, c_date, c_sample) and names[i]]

    section = " > ".join(h for _, h in headings)
    round_ = 2 if any("second tour" in h.lower() for _, h in headings) else 1
    # Année des titres de section ; à défaut (fin de campagne sans année), celle de l'élection.
    heading_year = next((int(y) for _, h in reversed(headings) for y in re.findall(r"\b(20\d\d)\b", h)), election_year)

    polls, seen = [], {}
    for r in grid[header_rows:]:
        if len(r) <= max(cand_cols + [c_inst, c_date]):
            continue
        inst_cell = r[c_inst]
        institute = _institute(_text(inst_cell))
        if not institute or inst_cell.name == "th" or institute.lower().startswith("résultat"):
            continue  # en-têtes répétés, ou ligne des résultats réels d'une élection passée
        results = []
        for i, c in enumerate(cand_cols):
            if r[c] is inst_cell:  # ligne de note fusionnée sur toute la largeur
                break
            if i and r[c] is r[cand_cols[i - 1]]:
                continue  # case fusionnée (colspan), déjà comptée une fois
            # Une case sur plusieurs colonnes = candidature commune, ex. 'Mélenchon (LFI) / Roussel (PCF)'.
            span = list(dict.fromkeys(names[k] for k in cand_cols[i:] if r[k] is r[c]))
            results += _parse_cell(r[c], " / ".join(span))
        if len(results) < 2:
            continue
        link = inst_cell.find("a", href=re.compile(r"commission-des-sondages", re.I))
        notice_url = re.sub(r"^http://", "https://", link["href"]) if link else None
        label = _text(r[c_date])
        sample = None
        if c_sample is not None:
            digits = re.sub(r"\D", "", _text(r[c_sample]).split("(")[0])
            sample = int(digits) if digits else None
        key = id(inst_cell)
        seen[key] = seen.get(key, 0) + 1
        polls.append({
            "round": round_, "section": section, "institute": institute, "notice_url": notice_url,
            "fieldwork_label": label, "fieldwork_end": _fieldwork_end(label, notice_url, heading_year),
            "sample_size": sample, "scenario": seen[key], "source": page_url, "results": results,
        })
    return polls


def _fieldwork_end_en(label, default_year=None):
    """'October 30 – November 2, 2024' -> '2024-11-02' ; le jour seul reprend le dernier mois cité.

    Sans année dans la case ('10–13 Aug'), on prend default_year (celle du titre de section) ;
    sans jour ('February 2026'), le 15 du mois.
    """
    years = re.findall(r"\b(20\d\d)\b", label)  # '31 December 2023–1 January 2024' : la dernière compte
    tokens = re.findall(r"([A-Za-z]{3,})\.?\s*(\d{1,2})?|\b(\d{1,2})\b(?!\d)", re.sub(r"\b20\d\d\b", "", label))
    month = day = None
    for word, d, lone in tokens:
        if word and word[:3].lower() in MONTHS_EN:
            month, day = MONTHS_EN[word[:3].lower()], int(d) if d else day
        elif lone:
            day = int(lone)
    y = int(years[-1]) if years else default_year
    if month and not day:  # 'Apr 2025' : mois seul, on prend le milieu du mois
        day = 15
    if not (y and month and day):
        return None
    try:
        return date(y, month, day).isoformat()
    except ValueError:
        return None


def _surname(full):
    """'Robert F. Kennedy Jr.' -> 'Kennedy' : le nom tel qu'il sert de clé candidat."""
    words = [w for w in full.split() if w.strip(".,").lower() not in ("jr", "sr", "ii", "iii")]
    return words[-1] if words else full


def _parse_table_en(table, headings, page_url):
    rows = table.find_all("tr")
    grid = _grid(rows)
    header = rows[0].find_all("th", recursive=False) if rows else []
    lower = [_text(th).lower() for th in header]
    try:
        c_inst = next(i for i, n in enumerate(lower) if n.startswith("poll source"))
        c_date = next(i for i, n in enumerate(lower) if n.startswith("date"))
    except StopIteration:
        return []
    c_sample = next((i for i, n in enumerate(lower) if n.startswith("sample")), None)
    # Colonnes candidat : l'en-tête commence par un lien vers la page de la personne.
    cands = {}
    for i, th in enumerate(header):
        a = th.find("a")
        if a and a.get("title") and i not in (c_inst, c_date, c_sample) and not lower[i].startswith(("others", "lead", "margin")):
            cands[i] = _surname(a["title"])
    if len(cands) < 2:
        return []
    section = " > ".join(h for _, h in headings)
    polls, seen = [], {}
    for r in grid[1:]:
        if len(r) < len(header) or r[c_inst].name == "th":
            continue
        results = []
        for i, name in cands.items():
            m = NUMBER.search(_text(r[i]))
            if m and r[i] is not r[c_inst]:
                results.append((name, float(m.group(0).replace(",", ".")), None))
        if len(results) < 2:
            continue  # ligne d'événement (« X suspends his campaign ») fusionnée sur toute la largeur
        label = _text(r[c_date])
        sample = None
        if c_sample is not None:
            digits = re.sub(r"\D", "", _text(r[c_sample]).split("(")[0])
            sample = int(digits) if digits else None
        key = id(r[c_inst])
        seen[key] = seen.get(key, 0) + 1
        polls.append({
            "round": 1, "section": section, "institute": _text(r[c_inst]), "notice_url": None,
            "fieldwork_label": label, "fieldwork_end": _fieldwork_end_en(label),
            "sample_size": sample, "scenario": seen[key], "source": page_url, "results": results,
        })
    return polls


# Sections hors intentions de vote présidentielles : moyennes, législatives, primaires, résultats…
SKIP_SECTION = re.compile(r"aggregat|average|graphical|issue polling|parliament|senate|chamber|^(presidential )?primaries|by political party"
                          r"|by alliance|coalition|approval|leadership|preferred|endorse|debate|^results|by department", re.I)
SECOND_ROUND = re.compile(r"second round|run-?off|ballotage|\bvs?\.? ", re.I)
NOT_A_POLL = re.compile(r"election|result|^(first|second) round$", re.I)


def _article(title):
    """'Kim Moon-soo (politician)' -> 'Kim Moon-soo'."""
    return re.sub(r"\s*\(.*?\)$", "", title or "").strip()


def _parse_table_intl(table, headings, page_url, election):
    """Tableau de sondages d'un autre pays (election : sa configuration, avec "candidates")."""
    candidates, two_rounds = election["candidates"], bool(election["second_round_date"])
    election_year = int(election["election_date"][:4])
    rows = table.find_all("tr")
    grid = _grid(rows)
    # En-tête : lignes du haut sans chiffres (noms, partis, photos, bandeaux de couleur).
    header_rows = 0
    while header_rows < len(rows) and not any(c.name == "td" and NUMBER.search(_text(c)) for c in rows[header_rows].find_all(["th", "td"], recursive=False)):
        header_rows += 1
    if not header_rows or header_rows == len(rows):
        return []
    ncols = max(len(r) for r in grid[:header_rows])
    col_cells = [list(dict.fromkeys(r[c] for r in grid[:header_rows] if c < len(r))) for c in range(ncols)]
    labels = [" ".join(_text(cell) for cell in cells).lower() for cells in col_cells]
    inst = [i for i, n in enumerate(labels) if re.search(r"poll|firm|company", n) and not re.search(r"period|date|aggregat|average", n)]
    dates = [i for i, n in enumerate(labels) if re.search(r"date|period|administer", n)]
    if not inst or not dates:
        return []
    c_inst, c_date = inst[0], dates[0]
    c_sample = next((i for i, n in enumerate(labels) if n.startswith("sample size") or n == "sample"), None)
    by_article = {_article(t).lower(): name for name, t in candidates.items()}
    cands = {}
    for i, cells in enumerate(col_cells):
        if i in (c_inst, c_date, c_sample):
            continue
        titles = [_article(a.get("title")).lower() for cell in cells for a in cell.find_all("a") if a.get("title")]
        name = next((by_article[t] for t in titles if t in by_article), None)
        if name is None and not any(t in by_article for t in titles):
            # Pas de lien vers un candidat suivi : on tente le nom court dans le texte de l'en-tête.
            name = next((n for n in candidates if re.search(rf"(^|\s){re.escape(n.lower())}(\s|$)", labels[i])), None)
        if name and name not in cands.values():
            cands[i] = name
    if len(cands) < 2:
        return []
    section = " > ".join(h for _, h in headings)
    duel = any(SECOND_ROUND.search(h + " ") for _, h in headings)
    if duel and not two_rounds:
        return []  # duels hypothétiques d'un scrutin à un tour : pas comparables aux sondages à plusieurs candidats
    round_ = 2 if duel else 1
    vote_day = election["second_round_date"] if duel else election["election_date"]
    heading_year = next((int(y) for _, h in reversed(headings) for y in re.findall(r"\b(20\d\d)\b", h)), election_year)
    polls, seen = [], {}
    for r in grid[header_rows:]:
        if len(r) <= max(list(cands) + [c_inst, c_date]):
            continue
        institute, label = _text(r[c_inst]), _text(r[c_date])
        if not institute or r[c_inst].name == "th" or NOT_A_POLL.search(institute) or NOT_A_POLL.search(label):
            continue
        # 'IBRiS / Onet' : l'institut d'abord, puis le média qui l'a commandé ou publié.
        institute, _, media = (part.strip() for part in institute.partition("/"))
        results = []
        for i, name in cands.items():
            if r[i] is r[c_inst] or r[i] is r[c_date]:
                break  # ligne de note fusionnée sur toute la largeur
            m = NUMBER.search(_text(r[i]))
            if m:
                results.append((name, float(m.group(0).replace(",", ".")), None))
        if len(results) < 2:
            continue
        sample = None
        if c_sample is not None:
            digits = re.sub(r"\D", "", _text(r[c_sample]).split("(")[0])
            sample = int(digits) if digits else None
        end = _fieldwork_end_en(label, heading_year)
        if end and end >= vote_day:
            continue  # sondages sortie des urnes et enquêtes faites après le vote
        key = id(r[c_inst])
        seen[key] = seen.get(key, 0) + 1
        polls.append({
            "round": round_, "section": section, "institute": institute, "media": media or None, "notice_url": None,
            "fieldwork_label": label, "fieldwork_end": end,
            "sample_size": sample, "scenario": seen[key], "source": page_url, "results": results,
        })
    return polls


def collect(con, election_ids=None):
    for eid in election_ids or ELECTIONS:
        wiki = ELECTIONS[eid]["wikipedia"]
        if not wiki:
            continue
        lang, title = wiki
        date = ELECTIONS[eid]["election_date"]
        election_year = int(date[:4]) if date else None
        api = f"https://{lang}.wikipedia.org/w/api.php"
        page_url = f"https://{lang}.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}"
        data = get_json(api, {"action": "parse", "page": title, "prop": "text",
                              "format": "json", "formatversion": 2, "redirects": 1})
        soup = BeautifulSoup(data["parse"]["text"], "html.parser")

        polls, headings = [], []
        for el in soup.find_all(["h2", "h3", "h4", "h5", "table"]):
            if el.name != "table":
                level = int(el.name[1])
                headings = [h for h in headings if h[0] < level] + [(level, _text(el))]
            elif "wikitable" in (el.get("class") or []) and not el.find_parent("table"):
                if "candidates" in ELECTIONS[eid]:
                    if not any(SKIP_SECTION.search(h) for _, h in headings):
                        polls += _parse_table_intl(el, headings, page_url, ELECTIONS[eid])
                    continue
                if lang == "en":
                    # Sondages nationaux réels ; pas les moyennes d'agrégateurs ni les duels hypothétiques.
                    if headings and headings[0][1].lower().startswith("national poll results"):
                        polls += _parse_table_en(el, headings, page_url)
                    continue
                # Seules les sections d'intentions de vote par tour ; pas les tableaux par âge, CSP, etc.
                if not any(" tour" in h.lower() for _, h in headings):
                    continue
                polls += _parse_table(el, headings, page_url, election_year)

        _merge_spellings(polls)
        # Rafraîchissement complet : Wikipedia n'a pas d'identifiant stable par ligne.
        con.execute("DELETE FROM polls WHERE election_id = ? AND source = ?", (eid, page_url))
        for p in polls:
            cur = con.execute(
                "INSERT INTO polls (election_id, round, section, institute, media, notice_url, fieldwork_label, "
                "fieldwork_end, sample_size, scenario, source) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id",
                (eid, p["round"], p["section"], p["institute"], p.get("media"), p["notice_url"], p["fieldwork_label"],
                 p["fieldwork_end"], p["sample_size"], p["scenario"], p["source"]),
            )
            poll_id = cur.fetchone()["id"]
            con.executemany(
                "INSERT INTO poll_results (poll_id, candidate, party, value, note) VALUES (?,?,?,?,?) "
                "ON CONFLICT (poll_id, candidate) DO UPDATE SET party = excluded.party, "
                "value = excluded.value, note = excluded.note",
                [(poll_id, *_split_party(c), v, n) for c, v, n in p["results"]],
            )
        con.commit()
        n_notices = len({p["notice_url"] for p in polls if p["notice_url"]})
        print(f"[wikipedia] {eid}: {len(polls)} lignes de sondage, {n_notices} notices liées")
