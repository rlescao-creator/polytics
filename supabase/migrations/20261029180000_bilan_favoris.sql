-- Favoris jour par jour : à J-d du vote décisif, qui était en tête pour l'argent (le candidat le plus coté
-- sur Polymarket la veille au soir) et pour la rue (le candidat en tête de la moyenne des sondages des
-- 30 jours précédents, au 1er tour avant celui-ci, au 2nd tour ensuite ; 3 sondages minimum), et le
-- vainqueur final. Sert à comparer, au même nombre de jours avant le vote, l'élection en cours aux passées.

CREATE FUNCTION favoris_jour_par_jour(p_election text, p_jours int DEFAULT 400)
RETURNS TABLE (jours int, jour date, gagnant text, favori_marche text, proba_marche numeric,
               favori_sondages text, moyenne_sondages numeric, nb_sondages bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH e AS (
    SELECT el.election_date AS t1, coalesce(el.second_round_date, el.election_date) AS fin,
           (SELECT r.candidate FROM results r WHERE r.election_id = p_election ORDER BY r.round DESC, r.value DESC LIMIT 1) AS gagnant
    FROM elections el WHERE el.id = p_election
  ),
  j AS (SELECT d, e.fin - d AS jour FROM e, generate_series(0, p_jours) d),
  cote AS (
    SELECT j.d, mk.candidate_name, p.price
    FROM j JOIN markets mk ON mk.election_id = p_election AND mk.candidate_name IS NOT NULL
    CROSS JOIN LATERAL (SELECT price FROM market_prices mp WHERE mp.condition_id = mk.condition_id
                        AND mp.ts < extract(epoch FROM j.jour::timestamp AT TIME ZONE 'UTC') ORDER BY ts DESC LIMIT 1) p
  ),
  fav_m AS (SELECT DISTINCT ON (d) d, candidate_name AS favori, price FROM cote ORDER BY d, price DESC),
  sond AS (
    SELECT p.institute, p.fieldwork_label, p.fieldwork_end, p.round, r.candidate, avg(r.value) AS v
    FROM polls p JOIN poll_results r ON r.poll_id = p.id JOIN candidates c ON c.name = r.candidate AND c.kind = 'personne'
    WHERE p.election_id = p_election AND r.value > 0
    GROUP BY 1, 2, 3, 4, 5
  ),
  moy AS (
    SELECT j.d, s.candidate, avg(s.v) AS v, count(*) AS n
    FROM j CROSS JOIN e JOIN sond s ON s.fieldwork_end < j.jour AND s.fieldwork_end >= j.jour - 30
     AND s.round = CASE WHEN e.t1 < e.fin AND j.jour > e.t1 THEN 2 ELSE 1 END
    GROUP BY j.d, s.candidate HAVING count(*) >= 3
  ),
  fav_s AS (SELECT DISTINCT ON (d) d, candidate AS favori, v, n FROM moy ORDER BY d, v DESC)
  SELECT j.d, j.jour, e.gagnant, m.favori, round((m.price * 100)::numeric, 1), s.favori, round(s.v::numeric, 1), s.n
  FROM j CROSS JOIN e LEFT JOIN fav_m m USING (d) LEFT JOIN fav_s s USING (d)
  ORDER BY j.d
$$;

CREATE TABLE bilan_favoris (
  election_id text NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  jours int NOT NULL, jour date, gagnant text, favori_marche text, proba_marche numeric,
  favori_sondages text, moyenne_sondages numeric, nb_sondages bigint,
  PRIMARY KEY (election_id, jours)
);
ALTER TABLE bilan_favoris ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lecture publique" ON bilan_favoris FOR SELECT TO anon, authenticated USING (true);

-- rafraichir_bilans recalcule aussi les favoris jour par jour.
CREATE OR REPLACE FUNCTION rafraichir_bilans(p_election text) RETURNS void
LANGUAGE sql SET search_path = public AS $$
  DELETE FROM bilan_premier_a_voir WHERE election_id = p_election;
  INSERT INTO bilan_premier_a_voir SELECT p_election, * FROM premier_a_voir(p_election);
  DELETE FROM bilan_quotidien WHERE election_id = p_election;
  INSERT INTO bilan_quotidien SELECT p_election, * FROM comparaison_quotidienne(p_election);
  DELETE FROM bilan_favoris WHERE election_id = p_election;
  INSERT INTO bilan_favoris SELECT p_election, * FROM favoris_jour_par_jour(p_election)
  WHERE EXISTS (SELECT 1 FROM results WHERE election_id = p_election);
$$;
REVOKE EXECUTE ON FUNCTION rafraichir_bilans(text) FROM public, anon, authenticated;

-- Remplissage initial.
SELECT rafraichir_bilans(election_id) FROM (SELECT DISTINCT election_id FROM results) r;
