-- « Qui l'a vu en premier » : pour chaque source, depuis quand elle place sans interruption le futur
-- vainqueur devant son adversaire final (les deux premiers du scrutin décisif), jusqu'au vote.
--   Polymarket           : cote du vainqueur > cote de l'adversaire, jour par jour ;
--   Moyenne des sondages : part du vainqueur > 50 % dans le duel (moyenne de comparaison_quotidienne) ;
--   chaque institut      : chiffre du vainqueur > chiffre de l'adversaire, sondage par sondage (fin de terrain).
-- juste = la dernière donnée avant le vote donnait le bon vainqueur (une égalité compte comme raté) ;
-- jours_avance = jours entre voit_depuis et le vote, nul si la source avait tort à la fin.
-- Fenêtre commune : à partir du premier jour coté sur Polymarket (comme comparaison_quotidienne), sinon les
-- instituts qui sondent des duels hypothétiques des années avant le vote auraient une avance imbattable.
-- L'avance reste bornée par la première donnée de chaque source : un institut qui commence tard ne peut
-- pas « voir » plus tôt.
CREATE FUNCTION premier_a_voir(p_election text, p_min int DEFAULT 3)
RETURNS TABLE (source text, genre text, nb bigint, premier date, dernier date, juste boolean,
               voit_depuis date, jours_avance int)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH e AS (SELECT coalesce(second_round_date, election_date) AS fin FROM elections WHERE id = p_election),
  tour AS (SELECT max(round) AS n FROM results WHERE election_id = p_election),
  duel AS (
    SELECT r.candidate, row_number() OVER (ORDER BY r.value DESC) AS rang
    FROM results r CROSS JOIN tour WHERE r.election_id = p_election AND r.round = tour.n
  ),
  c AS (SELECT * FROM comparaison_quotidienne(p_election)),
  debut AS (SELECT min(jour) AS d FROM c),
  points AS (
    SELECT 'Polymarket' AS source, 'marché' AS genre, w.jour, w.polymarket > l.polymarket AS voit
    FROM c w JOIN c l ON l.jour = w.jour AND NOT l.gagnant
    WHERE w.gagnant AND w.polymarket IS NOT NULL AND l.polymarket IS NOT NULL
    UNION ALL
    SELECT 'Moyenne des sondages', 'moyenne', jour, part_sondages > 50 FROM c
    WHERE gagnant AND part_sondages IS NOT NULL
    UNION ALL
    SELECT p.institute, 'institut', p.fieldwork_end, w.value > l.value
    FROM polls p CROSS JOIN tour CROSS JOIN e CROSS JOIN debut
    JOIN poll_results w ON w.poll_id = p.id JOIN duel dw ON dw.candidate = w.candidate AND dw.rang = 1
    JOIN poll_results l ON l.poll_id = p.id JOIN duel dl ON dl.candidate = l.candidate AND dl.rang = 2
    WHERE p.election_id = p_election AND p.round = tour.n AND p.fieldwork_end >= debut.d AND p.fieldwork_end < e.fin
      AND w.value > 0 AND l.value > 0
  ),
  par AS (
    SELECT source, genre, count(*) AS nb, min(jour) AS premier, max(jour) AS dernier,
           (array_agg(voit ORDER BY jour DESC, voit))[1] AS juste,
           max(jour) FILTER (WHERE NOT voit) AS dernier_rate
    FROM points GROUP BY source, genre
  ),
  vu AS (
    SELECT par.*, CASE WHEN juste THEN
             (SELECT min(jour) FROM points pt WHERE pt.source = par.source AND pt.genre = par.genre
                AND (par.dernier_rate IS NULL OR pt.jour > par.dernier_rate)) END AS voit_depuis
    FROM par WHERE genre <> 'institut' OR nb >= p_min
  )
  SELECT source, genre, nb, premier, dernier, juste, voit_depuis, (e.fin - voit_depuis)::int
  FROM vu CROSS JOIN e
  ORDER BY 8 DESC NULLS LAST, 1
$$;

-- Classement sur toutes les élections passées. Un raté compte zéro jour d'avance. Les instituts ne sont
-- gardés qu'à partir de p_min_elections élections (la plupart ne sondent qu'un pays).
CREATE FUNCTION classement_premier_a_voir(p_min_elections int DEFAULT 2, p_min int DEFAULT 3)
RETURNS TABLE (source text, genre text, elections bigint, justes bigint, avance_moyenne numeric,
               avance_mediane numeric, pays text)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT v.source, v.genre, count(*), count(*) FILTER (WHERE v.juste),
         round(avg(coalesce(v.jours_avance, 0)), 0),
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY coalesce(v.jours_avance, 0))::numeric, 0),
         string_agg(e.country, ', ' ORDER BY e.election_date)
  FROM elections e CROSS JOIN LATERAL premier_a_voir(e.id, p_min) v
  WHERE coalesce(e.second_round_date, e.election_date) < current_date
    AND EXISTS (SELECT 1 FROM results r WHERE r.election_id = e.id)
  GROUP BY v.source, v.genre
  HAVING v.genre <> 'institut' OR count(*) >= p_min_elections
  ORDER BY 5 DESC, 4 DESC
$$;

-- Instituts présents dans plusieurs pays : un seul nom quel que soit le média associé ou la filiale
-- ('AtlasIntel/Semana', 'Atlas Intel', 'Reuters / Ipsos', 'Ipsos Perú'), pour les comparer d'un pays à l'autre.
CREATE OR REPLACE FUNCTION normalize_institute(raw text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN x ~* '(^|/)\s*atlas\s?intel' THEN 'AtlasIntel'
    WHEN x ~* '(^|/)\s*ipsos' THEN 'Ipsos'
    WHEN x ~* '(^|/)\s*yougov' THEN 'YouGov'
    ELSE CASE lower(x)
      WHEN 'harris interactive' THEN 'Harris' WHEN 'harris interractive' THEN 'Harris'
      WHEN 'toluna harris interactive' THEN 'Harris' WHEN 'cluster 17' THEN 'Cluster17'
      WHEN 'opinionway' THEN 'OpinionWay'
      ELSE x END
  END
  FROM (SELECT btrim(regexp_replace(raw, '\s*\(.*?\)', '', 'g')) AS x) s
$$;

UPDATE polls SET institute = institute WHERE institute ~* 'atlas\s?intel|ipsos|yougov';
