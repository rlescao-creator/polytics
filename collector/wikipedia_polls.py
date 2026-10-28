"""Chiffres des sondages depuis les tableaux Wikipedia.

Chaque ligne de tableau pointe vers la notice officielle de la Commission des sondages,
ce qui permet ensuite de la relier à son commanditaire.
"""
import re
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
    out = []
    for part in parts:
        txt = _clean(BeautifulSoup(part, "html.parser").get_text(" "))
        m = NUMBER.search(txt)
        if not m:
            continue
        value = float(m.group(0).replace(",", "."))
        rest = (txt[:m.start()] + txt[m.end():]).strip(" |")
        notes = ["inférieur à"] if "<" in rest else []
        name = _clean(rest.replace("<", ""))
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
                              "format": "json", "formatversion": 2})
        soup = BeautifulSoup(data["parse"]["text"], "html.parser")

        polls, headings = [], []
        for el in soup.find_all(["h2", "h3", "h4", "h5", "table"]):
            if el.name != "table":
                level = int(el.name[1])
                headings = [h for h in headings if h[0] < level] + [(level, _text(el))]
            elif "wikitable" in (el.get("class") or []) and not el.find_parent("table"):
                # Seules les sections d'intentions de vote par tour ; pas les tableaux par âge, CSP, etc.
                if not any(" tour" in h.lower() for _, h in headings):
                    continue
                polls += _parse_table(el, headings, page_url, election_year)

        # Rafraîchissement complet : Wikipedia n'a pas d'identifiant stable par ligne.
        con.execute("DELETE FROM polls WHERE election_id = ? AND source = ?", (eid, page_url))
        for p in polls:
            cur = con.execute(
                "INSERT INTO polls (election_id, round, section, institute, notice_url, fieldwork_label, "
                "fieldwork_end, sample_size, scenario, source) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id",
                (eid, p["round"], p["section"], p["institute"], p["notice_url"], p["fieldwork_label"],
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
