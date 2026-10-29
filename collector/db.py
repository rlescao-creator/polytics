"""Accès base : SQLite en local, Postgres (Supabase) quand la cible est une URL postgresql://.

Le code applicatif écrit du SQL portable avec des paramètres '?' ; l'adaptateur Postgres les traduit.
"""
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .config import ELECTIONS, RESULTS

SCHEMA = Path(__file__).with_name("schema.sql")


class Postgres:
    """Expose la petite partie de l'API sqlite3 utilisée par le collecteur."""

    dialect = "postgres"

    def __init__(self, url):
        import psycopg
        from psycopg.rows import dict_row

        # prepare_threshold=None : le pooler Supabase en mode transaction refuse les requêtes préparées.
        self.con = psycopg.connect(url, row_factory=dict_row, prepare_threshold=None)

    def execute(self, sql, params=()):
        return self.con.execute(sql.replace("?", "%s"), params)

    def executemany(self, sql, rows):
        with self.con.cursor() as cur:
            cur.executemany(sql.replace("?", "%s"), rows)

    def commit(self):
        self.con.commit()


class Sqlite:
    dialect = "sqlite"

    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        # timeout : jobs cron horaires et quotidiens peuvent se chevaucher
        self.con = sqlite3.connect(path, timeout=60)
        self.con.row_factory = sqlite3.Row
        self.con.execute("PRAGMA foreign_keys = ON")
        self.con.executescript(SCHEMA.read_text())
        for table, column in (("elections", "second_round_date"), ("polls", "media")):
            try:  # bases créées avant l'ajout de la colonne
                self.con.execute(f"ALTER TABLE {table} ADD COLUMN {column} TEXT")
            except sqlite3.OperationalError:
                pass

    def execute(self, sql, params=()):
        return self.con.execute(sql, params)

    def executemany(self, sql, rows):
        self.con.executemany(sql, rows)

    def commit(self):
        self.con.commit()


def connect(target):
    """target : chemin d'un fichier SQLite, ou URL postgresql:// (schéma créé par supabase/migrations)."""
    con = Postgres(target) if target.startswith(("postgres://", "postgresql://")) else Sqlite(target)
    for eid, e in ELECTIONS.items():
        con.execute(
            "INSERT INTO elections (id, name, country, election_date, second_round_date) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT (id) DO UPDATE SET name = excluded.name, country = excluded.country, "
            "election_date = excluded.election_date, second_round_date = excluded.second_round_date",
            (eid, e["name"], e["country"], e["election_date"], e["second_round_date"]),
        )
    for eid, res in RESULTS.items():
        for rnd in (1, 2):
            con.executemany(
                "INSERT INTO results (election_id, round, candidate, value, source) VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT (election_id, round, candidate) DO UPDATE SET value = excluded.value, source = excluded.source",
                [(eid, rnd, cand, v, res["source"]) for cand, v in res.get(rnd, {}).items()],
            )
    con.commit()
    return con


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
