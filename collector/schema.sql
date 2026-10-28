-- Schéma du collecteur. Compatible SQLite ; portable tel quel vers Postgres/Supabase.

CREATE TABLE IF NOT EXISTS elections (
  id            TEXT PRIMARY KEY,           -- ex. 'fr-2027', 'us-2024'
  name          TEXT NOT NULL,
  country       TEXT NOT NULL,
  election_date TEXT                        -- ISO, NULL si pas encore fixée
);

-- Un marché Polymarket = "Will <candidat> win ?" (outcome Yes/No).
CREATE TABLE IF NOT EXISTS markets (
  condition_id  TEXT PRIMARY KEY,
  election_id   TEXT NOT NULL REFERENCES elections(id),
  event_slug    TEXT NOT NULL,
  question      TEXT NOT NULL,
  candidate     TEXT NOT NULL,
  yes_token_id  TEXT NOT NULL,
  volume        REAL,
  closed        INTEGER NOT NULL DEFAULT 0,
  last_price    REAL,                       -- proba "Yes" au dernier relevé
  updated_at    TEXT NOT NULL
);

-- Historique de la proba "Yes" (0..1). ts = epoch secondes UTC.
CREATE TABLE IF NOT EXISTS market_prices (
  condition_id  TEXT NOT NULL REFERENCES markets(condition_id),
  ts            INTEGER NOT NULL,
  price         REAL NOT NULL,
  PRIMARY KEY (condition_id, ts)
);

-- Un sondage = une ligne (un scénario) d'un tableau Wikipedia.
-- Un même sondage testant plusieurs hypothèses donne plusieurs lignes (scenario 1..n).
CREATE TABLE IF NOT EXISTS polls (
  id              INTEGER PRIMARY KEY,
  election_id     TEXT NOT NULL REFERENCES elections(id),
  round           INTEGER,                  -- 1 ou 2
  section         TEXT NOT NULL,            -- chemin des titres Wikipedia
  institute       TEXT NOT NULL,
  notice_url      TEXT,                     -- notice officielle Commission des sondages
  fieldwork_label TEXT NOT NULL,            -- tel qu'affiché, ex. '21-22 octobre'
  fieldwork_end   TEXT,                     -- ISO déduit, NULL si ambigu
  sample_size     INTEGER,
  scenario        INTEGER NOT NULL DEFAULT 1,
  source          TEXT NOT NULL             -- URL de la page source
);

CREATE TABLE IF NOT EXISTS poll_results (
  poll_id   INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  candidate TEXT NOT NULL,                 -- nom seul, ex. 'Le Pen'
  party     TEXT,                          -- sigle si affiché, ex. 'RN'
  value     REAL,                           -- % d'intentions de vote
  note      TEXT,                           -- ex. nom du candidat testé dans 'Autres'
  PRIMARY KEY (poll_id, candidate)
);

-- Résultat officiel d'une élection passée, pour mesurer l'erreur des sondages.
CREATE TABLE IF NOT EXISTS results (
  election_id TEXT NOT NULL REFERENCES elections(id),
  round       INTEGER NOT NULL,
  candidate   TEXT NOT NULL,
  value       REAL NOT NULL,
  source      TEXT NOT NULL,
  PRIMARY KEY (election_id, round, candidate)
);

-- Notice officielle : qui a payé le sondage.
CREATE TABLE IF NOT EXISTS notices (
  url               TEXT PRIMARY KEY,
  institute         TEXT,
  sponsors_raw      TEXT,                   -- texte brut trouvé dans la notice
  sponsor_source    TEXT,                   -- 'notice' | 'filename' | 'none'
  first_publication TEXT,
  pages             INTEGER,
  fetched_at        TEXT NOT NULL,
  error             TEXT
);

CREATE TABLE IF NOT EXISTS notice_sponsors (
  notice_url TEXT NOT NULL REFERENCES notices(url) ON DELETE CASCADE,
  sponsor    TEXT NOT NULL,                 -- nom normalisé, ex. 'BFMTV'
  media_type TEXT NOT NULL,                 -- 'tv' | 'radio' | 'press' | 'web'
  PRIMARY KEY (notice_url, sponsor)
);

CREATE INDEX IF NOT EXISTS idx_polls_election ON polls(election_id, fieldwork_end);
CREATE INDEX IF NOT EXISTS idx_polls_notice ON polls(notice_url);

-- Sondages avec leurs commanditaires (une ligne par commanditaire).
CREATE VIEW IF NOT EXISTS v_poll_sponsors AS
SELECT p.*, s.sponsor, s.media_type
FROM polls p
LEFT JOIN notice_sponsors s ON s.notice_url = p.notice_url;
