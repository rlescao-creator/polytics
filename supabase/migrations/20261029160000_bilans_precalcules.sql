-- Bilans des élections passées précalculés : premier_a_voir et comparaison_quotidienne prennent environ
-- 8 s chacune, au-delà du délai de 3 s accordé au rôle anon. Une élection passée ne bouge plus : on garde
-- leurs résultats dans deux tables, que le collecteur recalcule pour les élections qu'il vient de relire.

CREATE TABLE bilan_premier_a_voir (
  election_id text NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  source text NOT NULL, genre text, nb bigint, premier date, dernier date, juste boolean,
  voit_depuis date, jours_avance int,
  PRIMARY KEY (election_id, source)
);

CREATE TABLE bilan_quotidien (
  election_id text NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  jour date NOT NULL, candidat text NOT NULL, couleur text, gagnant boolean, polymarket numeric,
  part_sondages numeric, proba_sondages numeric, nb_sondages bigint,
  PRIMARY KEY (election_id, jour, candidat)
);

ALTER TABLE bilan_premier_a_voir ENABLE ROW LEVEL SECURITY;
ALTER TABLE bilan_quotidien ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lecture publique" ON bilan_premier_a_voir FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "lecture publique" ON bilan_quotidien FOR SELECT TO anon, authenticated USING (true);

-- Recalcule les bilans d'une élection (vides tant qu'elle n'a pas de résultat).
CREATE FUNCTION rafraichir_bilans(p_election text) RETURNS void
LANGUAGE sql SET search_path = public AS $$
  DELETE FROM bilan_premier_a_voir WHERE election_id = p_election;
  INSERT INTO bilan_premier_a_voir SELECT p_election, * FROM premier_a_voir(p_election);
  DELETE FROM bilan_quotidien WHERE election_id = p_election;
  INSERT INTO bilan_quotidien SELECT p_election, * FROM comparaison_quotidienne(p_election);
$$;
REVOKE EXECUTE ON FUNCTION rafraichir_bilans(text) FROM public, anon, authenticated;

-- Remplissage initial (environ 17 s par élection passée).
SELECT rafraichir_bilans(election_id) FROM (SELECT DISTINCT election_id FROM results) r;
