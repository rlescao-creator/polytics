-- Résultats officiels d'une élection passée, pour mesurer l'erreur des sondages.
CREATE TABLE results (
  election_id text NOT NULL REFERENCES elections(id),
  round       integer NOT NULL,
  candidate   text NOT NULL,
  value       double precision NOT NULL,   -- % des exprimés
  source      text NOT NULL,
  PRIMARY KEY (election_id, round, candidate)
);

ALTER TABLE results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lecture publique" ON results FOR SELECT TO anon, authenticated USING (true);
