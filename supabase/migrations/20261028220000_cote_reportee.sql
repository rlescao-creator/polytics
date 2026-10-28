-- Les vieux marchés (2023, début 2024) n'ont pas une cote chaque jour dans l'historique de Polymarket :
-- un jour sans échange reprend la dernière cote connue, au lieu de laisser un trou (la veille du vote
-- manquait en Argentine et à Taïwan). La série court du premier jour coté à la veille du scrutin décisif.
-- Côté sondages, plusieurs pays interdisent de publier les derniers jours (8 en Argentine, 10 à Taïwan) :
-- on moyenne la dernière semaine de terrain connue, si elle date de moins de 3 semaines.
CREATE OR REPLACE FUNCTION comparaison_quotidienne(p_election text, p_sigma numeric DEFAULT 3.5)
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
  prix AS (
    SELECT m.candidate_name AS candidate, p.ts, p.price
    FROM markets m JOIN market_prices p USING (condition_id) JOIN duel ON duel.candidate = m.candidate_name
    WHERE m.election_id = p_election
  ),
  jours AS (
    SELECT d::date AS d
    FROM e, generate_series((SELECT min(to_timestamp(ts) AT TIME ZONE 'UTC')::date FROM prix), e.fin - 1, interval '1 day') d
  ),
  pm AS (
    SELECT j.d, duel.candidate,
           (SELECT price FROM prix WHERE prix.candidate = duel.candidate
              AND prix.ts < extract(epoch FROM (j.d + 1)::timestamp AT TIME ZONE 'UTC')
            ORDER BY ts DESC LIMIT 1) AS price
    FROM jours j CROSS JOIN duel
  ),
  parts AS (
    SELECT p.id, p.fieldwork_end, r.candidate,
           100 * r.value / sum(r.value) OVER (PARTITION BY p.id) AS part, count(*) OVER (PARTITION BY p.id) AS n
    FROM polls p CROSS JOIN tour JOIN poll_results r ON r.poll_id = p.id JOIN duel ON duel.candidate = r.candidate
    WHERE p.election_id = p_election AND p.round = tour.n AND r.value > 0
  ),
  moy AS (
    SELECT j.d, parts.candidate, avg(parts.part) AS part, count(*) AS n
    FROM jours j
    CROSS JOIN LATERAL (SELECT max(fieldwork_end) AS last FROM parts
                        WHERE parts.n = 2 AND parts.fieldwork_end BETWEEN j.d - 21 AND j.d - 1) l
    JOIN parts ON parts.n = 2 AND parts.fieldwork_end BETWEEN l.last - 6 AND l.last
    GROUP BY j.d, parts.candidate
  )
  SELECT j.d, duel.candidate, duel.color, duel.gagnant, round((pm.price * 100)::numeric, 1), round(moy.part::numeric, 1),
         round((100 / (1 + exp(-1.702 * (moy.part - 50) / p_sigma)))::numeric, 1), coalesce(moy.n, 0)
  FROM jours j CROSS JOIN duel
  LEFT JOIN pm ON pm.candidate = duel.candidate AND pm.d = j.d
  LEFT JOIN moy ON moy.candidate = duel.candidate AND moy.d = j.d
  ORDER BY j.d, duel.gagnant DESC
$$;
