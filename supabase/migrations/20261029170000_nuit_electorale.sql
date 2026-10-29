-- Nuit électorale : cotes Polymarket au pas de 10 minutes, du jour du vote au lendemain, pour voir l'argent
-- suivre (ou non) le dépouillement. Série « national » : marchés des finalistes ; d'autres séries (une ville,
-- un État) viennent des événements listés dans config.ELECTIONS[...]["polymarket_nuit"]. Le volume est celui
-- du marché du candidat, en dollars échangés depuis son ouverture.
CREATE TABLE nuit_electorale (
  election_id text NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  serie text NOT NULL,
  candidat text NOT NULL,
  volume double precision,
  ts bigint NOT NULL,
  price double precision NOT NULL,
  PRIMARY KEY (election_id, serie, candidat, ts)
);

ALTER TABLE nuit_electorale ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lecture publique" ON nuit_electorale FOR SELECT TO anon, authenticated USING (true);
