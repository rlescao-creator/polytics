-- Comparaison jour par jour : cote Polymarket contre sondages traduits en chance de victoire, face au résultat.

ALTER TABLE elections ADD COLUMN second_round_date date;  -- NULL pour un scrutin à un tour

-- Les marchés Polymarket écrivent les noms sans accents (« Valerie Pecresse ») : on compare sans accents.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION markets_link_candidate() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
  NEW.candidate_name := (SELECT name FROM candidates WHERE unaccent(full_name) = unaccent(NEW.candidate) LIMIT 1);
  RETURN NEW;
END $$;

UPDATE markets SET candidate = candidate WHERE candidate_name IS NULL;  -- relie les marchés déjà présents

-- Pour les deux premiers du tour décisif (le second tour s'il existe), chaque jour où Polymarket a une cote :
--   polymarket     : dernière cote du jour (UTC), en % ;
--   part_sondages  : part du candidat dans le duel, moyenne des sondages de duel terminés les 7 jours d'avant ;
--   proba_sondages : cette part traduite en chance de victoire, en supposant une erreur des sondages
--                    de p_sigma points (loi normale, approchée par une logistique de pente 1,702).
-- La série s'arrête la veille du scrutin décisif.
CREATE FUNCTION comparaison_quotidienne(p_election text, p_sigma numeric DEFAULT 3.5)
RETURNS TABLE (jour date, candidat text, couleur text, gagnant boolean, polymarket numeric,
               part_sondages numeric, proba_sondages numeric, nb_sondages bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH e AS (SELECT coalesce(second_round_date, election_date) AS fin FROM elections WHERE id = p_election),
  tour AS (SELECT max(round) AS n FROM results WHERE election_id = p_election),
  duel AS (
    SELECT r.candidate, pa.color, r.value = max(r.value) OVER () AS gagnant
    FROM results r CROSS JOIN tour JOIN candidates c ON c.name = r.candidate LEFT JOIN parties pa ON pa.code = c.party
    WHERE r.election_id = p_election AND r.round = tour.n
    ORDER BY r.value DESC LIMIT 2
  ),
  pm AS (
    SELECT DISTINCT ON (candidate, d) candidate, d, price
    FROM (SELECT m.candidate_name AS candidate, (to_timestamp(p.ts) AT TIME ZONE 'UTC')::date AS d, p.ts, p.price
          FROM markets m JOIN market_prices p USING (condition_id) JOIN duel ON duel.candidate = m.candidate_name
          WHERE m.election_id = p_election) x
    ORDER BY candidate, d, ts DESC
  ),
  jours AS (SELECT DISTINCT d FROM pm CROSS JOIN e WHERE d < e.fin),
  parts AS (
    SELECT p.id, p.fieldwork_end, r.candidate,
           100 * r.value / sum(r.value) OVER (PARTITION BY p.id) AS part, count(*) OVER (PARTITION BY p.id) AS n
    FROM polls p CROSS JOIN tour JOIN poll_results r ON r.poll_id = p.id JOIN duel ON duel.candidate = r.candidate
    WHERE p.election_id = p_election AND p.round = tour.n AND r.value > 0
  ),
  moy AS (
    SELECT j.d, parts.candidate, avg(parts.part) AS part, count(*) AS n
    FROM jours j JOIN parts ON parts.n = 2 AND parts.fieldwork_end BETWEEN j.d - 7 AND j.d - 1
    GROUP BY j.d, parts.candidate
  )
  SELECT j.d, duel.candidate, duel.color, duel.gagnant, round((pm.price * 100)::numeric, 1), round(moy.part::numeric, 1),
         round((100 / (1 + exp(-1.702 * (moy.part - 50) / p_sigma)))::numeric, 1), coalesce(moy.n, 0)
  FROM jours j CROSS JOIN duel
  LEFT JOIN pm ON pm.candidate = duel.candidate AND pm.d = j.d
  LEFT JOIN moy ON moy.candidate = duel.candidate AND moy.d = j.d
  ORDER BY j.d, duel.gagnant DESC
$$;

-- Bilan par source (Polymarket, sondages) de la chance donnée au futur vainqueur, sur les jours où les deux
-- sources existent :
--   brier         : moyenne de (1 − chance)² ; 0 = certitude juste, 0,25 = pile ou face ;
--   veille_t1/t2  : chance donnée la veille du 1er tour et la veille du scrutin décisif ;
--   favori_depuis : premier jour à partir duquel la source donne toujours le vainqueur favori (> 50 %).
CREATE FUNCTION bilan_previsions(p_election text, p_sigma numeric DEFAULT 3.5)
RETURNS TABLE (source text, vainqueur text, jours bigint, brier numeric, veille_t1 numeric, veille_t2 numeric,
               favori_depuis date)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH e AS (SELECT election_date, coalesce(second_round_date, election_date) AS fin FROM elections WHERE id = p_election),
  c AS (SELECT * FROM comparaison_quotidienne(p_election, p_sigma)
        WHERE gagnant AND polymarket IS NOT NULL AND proba_sondages IS NOT NULL),
  s AS (
    SELECT 'Polymarket' AS source, candidat, jour, polymarket AS proba FROM c
    UNION ALL
    SELECT 'Sondages', candidat, jour, proba_sondages FROM c
  )
  SELECT s.source, min(s.candidat), count(*), round(avg((1 - s.proba / 100) ^ 2), 3),
         max(s.proba) FILTER (WHERE s.jour = e.election_date - 1),
         max(s.proba) FILTER (WHERE s.jour = e.fin - 1),
         coalesce(max(s.jour) FILTER (WHERE s.proba <= 50) + 1, min(s.jour))
  FROM s CROSS JOIN e
  GROUP BY s.source, e.election_date, e.fin
  ORDER BY 4
$$;
