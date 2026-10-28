"""Notices officielles de la Commission des sondages : institut, commanditaire(s), publication."""
import io
import logging
import re
import urllib.parse
from pathlib import Path

from pypdf import PdfReader

from .config import MEDIA
from .db import now
from .http import get

logging.getLogger("pypdf").setLevel(logging.ERROR)

# Chaque format d'institut formule le commanditaire différemment.
SPONSOR_PATTERNS = [
    r"commanditaires?(?:\(s\))?(?: du sondage)?\s*:?\s*(.{2,120}?)(?=\s+(?:Nom et qualit|Nombre|▪|Existence|Date|Acheteur|Organisme)|$)",
    # (?-i:...) : 'le'/'du' en minuscules terminent la liste, mais pas 'Le Figaro'.
    r"(?:r[ée]alis[ée]e?|notice technique\s*:?[^.]{0,40}?)\s+pour\s+(.{2,80}?)(?=\s+(?:aupr[èe]s|(?-i:sur|du|le)|Baromètre|Intentions|M[ée]thodologie|\d)|[.;]|$)",
    r"pour le compte d[eu]\s+(.{2,80}?)(?=[.;]|\s+(?:aupr[èe]s|(?-i:du|le))\s|$)",
]
INSTITUTE = re.compile(r"Organisme ayant r[ée]alis[ée] le sondage\s*:?\s*(.{2,40}?)(?=\s+(?:Nom|▪|Commanditaire)|$)", re.I)
PUBLICATION = re.compile(
    r"(?:Date et support de premi[èe]re publication|Date de diffusion pr[ée]vue|Date de publication)\s*:?\s*"
    r"(.{4,90}?)(?=\s+(?:▪|Questionnaire|Nom|Article)|$)", re.I)


def find_media(text):
    found = {}
    for pattern, name, kind in MEDIA:
        if re.search(pattern, text, re.I):
            found[name] = kind
    return found


def parse(pdf_bytes, url):
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = " ".join((p.extract_text() or "") for p in reader.pages[:3])
    text = re.sub(r"\s+", " ", text)

    sponsors_raw, media, source = None, {}, "none"
    for pattern in SPONSOR_PATTERNS:
        m = re.search(pattern, text, re.I)
        if m and find_media(m.group(1)):
            sponsors_raw, media, source = m.group(1).strip(), find_media(m.group(1)), "notice"
            break
    # Le nom de fichier contient souvent le commanditaire (ex. '...-elabe-bfmtv-...') :
    # repli quand la notice est illisible, complément quand la liste y est tronquée.
    filename = Path(urllib.parse.urlparse(url).path).stem.replace("-", " ")
    from_filename = find_media(filename)
    if not media and from_filename:
        source = "filename"
    media = {**from_filename, **media}
    inst = INSTITUTE.search(text)
    pub = PUBLICATION.search(text)
    return {
        "institute": inst.group(1).strip() if inst else None,
        "sponsors_raw": sponsors_raw,
        "sponsor_source": source,
        "first_publication": pub.group(1).strip() if pub else None,
        "pages": len(reader.pages),
        "media": media,
    }


def collect(con, cache_dir, refresh=False):
    cache = Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    query = "SELECT DISTINCT notice_url FROM polls WHERE notice_url IS NOT NULL"
    if not refresh:
        query += " AND notice_url NOT IN (SELECT url FROM notices WHERE error IS NULL)"
    # Notices que plus aucun sondage ne cite (lien changé sur Wikipedia, http -> https...).
    con.execute("DELETE FROM notices WHERE url NOT IN (SELECT notice_url FROM polls WHERE notice_url IS NOT NULL)")
    urls = [r["notice_url"] for r in con.execute(query)]
    ok = 0
    for url in urls:
        path = cache / Path(urllib.parse.urlparse(url).path).name
        try:
            if not path.exists():
                path.write_bytes(get(url, delay=1.0))
            info = parse(path.read_bytes(), url)
            error = None
        except Exception as e:  # PDF corrompu, 404… on garde une trace et on continue
            info, error = {"media": {}}, f"{type(e).__name__}: {e}"[:300]
        con.execute("DELETE FROM notices WHERE url = ?", (url,))
        con.execute(
            "INSERT INTO notices (url, institute, sponsors_raw, sponsor_source, first_publication, pages, "
            "fetched_at, error) VALUES (?,?,?,?,?,?,?,?)",
            (url, info.get("institute"), info.get("sponsors_raw"), info.get("sponsor_source"),
             info.get("first_publication"), info.get("pages"), now(), error),
        )
        con.executemany(
            "INSERT INTO notice_sponsors (notice_url, sponsor, media_type) VALUES (?,?,?)",
            [(url, name, kind) for name, kind in info["media"].items()],
        )
        con.commit()
        ok += error is None
    print(f"[notices] {ok}/{len(urls)} notices traitées")
