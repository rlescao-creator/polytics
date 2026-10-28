-- Schéma Postgres (Supabase) du collecteur. Miroir de collector/schema.sql (SQLite, usage local).

CREATE TABLE elections (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  country       text NOT NULL,
  election_date date
);

CREATE TABLE markets (
  condition_id  text PRIMARY KEY,
  election_id   text NOT NULL REFERENCES elections(id),
  event_slug    text NOT NULL,
  question      text NOT NULL,
  candidate     text NOT NULL,
  yes_token_id  text NOT NULL,
  volume        double precision,
  closed        integer NOT NULL DEFAULT 0,
  last_price    double precision,
  updated_at    text NOT NULL
);
CREATE INDEX idx_markets_election ON markets(election_id);

CREATE TABLE market_prices (
  condition_id  text NOT NULL REFERENCES markets(condition_id),
  ts            bigint NOT NULL,             -- epoch secondes UTC
  price         double precision NOT NULL,   -- proba "Yes" (0..1)
  PRIMARY KEY (condition_id, ts)
);

CREATE TABLE polls (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  election_id     text NOT NULL REFERENCES elections(id),
  round           integer,
  section         text NOT NULL,
  institute       text NOT NULL,
  notice_url      text,
  fieldwork_label text NOT NULL,
  fieldwork_end   date,
  sample_size     integer,
  scenario        integer NOT NULL DEFAULT 1,
  source          text NOT NULL
);
CREATE INDEX idx_polls_election ON polls(election_id, fieldwork_end);
CREATE INDEX idx_polls_notice ON polls(notice_url);

CREATE TABLE poll_results (
  poll_id   bigint NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  candidate text NOT NULL,
  party     text,
  value     double precision,
  note      text,
  PRIMARY KEY (poll_id, candidate)
);

CREATE TABLE notices (
  url               text PRIMARY KEY,
  institute         text,
  sponsors_raw      text,
  sponsor_source    text,
  first_publication text,
  pages             integer,
  fetched_at        text NOT NULL,
  error             text
);

CREATE TABLE notice_sponsors (
  notice_url text NOT NULL REFERENCES notices(url) ON DELETE CASCADE,
  sponsor    text NOT NULL,
  media_type text NOT NULL,
  PRIMARY KEY (notice_url, sponsor)
);

CREATE VIEW v_poll_sponsors WITH (security_invoker = true) AS
SELECT p.*, s.sponsor, s.media_type
FROM polls p
LEFT JOIN notice_sponsors s ON s.notice_url = p.notice_url;

-- Données publiques : lecture ouverte via l'API, écriture réservée au collecteur
-- (connexion Postgres directe, rôle postgres, non soumis à RLS).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['elections','markets','market_prices','polls','poll_results','notices','notice_sponsors'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "lecture publique" ON %I FOR SELECT TO anon, authenticated USING (true)', t);
  END LOOP;
END $$;
