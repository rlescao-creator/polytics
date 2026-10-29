-- Ce que chaque chaîne a choisi de montrer, comparé à tous les sondages publiés.
-- Un « sondage relayé » = un institut et une date de fin de terrain cités dans au moins un article de la chaîne
-- (v_media_polls) ; « propre » = commandé par la chaîne elle-même (notice de la Commission des sondages).

-- Couverture : combien d'articles, combien de sondages relayés sur tous ceux publiés pendant la période,
-- quelle part sont les siens, et quels instituts.
CREATE FUNCTION couverture_medias(p_election text)
RETURNS TABLE (media text, articles bigint, articles_intentions bigint, sondages_relayes bigint,
               sondages_publies bigint, part_relayee numeric, propres bigint, instituts text)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH a AS (SELECT * FROM media_articles WHERE election_id = p_election),
  rel AS (SELECT DISTINCT media, institute, fieldwork_end, propre FROM v_media_polls WHERE election_id = p_election),
  periode AS (SELECT media, min(published_at)::date - 14 AS debut, max(published_at)::date AS fin FROM a GROUP BY media),
  publies AS (
    SELECT pe.media, count(DISTINCT (p.institute, p.fieldwork_end)) AS n
    FROM periode pe JOIN polls p ON p.election_id = p_election AND p.fieldwork_end BETWEEN pe.debut AND pe.fin
    GROUP BY pe.media
  ),
  inst AS (
    SELECT media, string_agg(institute || ' ' || n, ', ' ORDER BY n DESC, institute) AS instituts
    FROM (SELECT media, institute, count(*) AS n FROM rel GROUP BY 1, 2) x GROUP BY media
  )
  SELECT o.name, count(DISTINCT a.id), count(DISTINCT a.id) FILTER (WHERE a.vote_intention),
         (SELECT count(*) FROM rel WHERE rel.media = o.name), coalesce(pu.n, 0),
         round(100.0 * (SELECT count(*) FROM rel WHERE rel.media = o.name) / nullif(pu.n, 0), 0),
         (SELECT count(*) FROM rel WHERE rel.media = o.name AND rel.propre), inst.instituts
  FROM media_outlets o
  LEFT JOIN a ON a.media = o.name
  LEFT JOIN publies pu ON pu.media = o.name
  LEFT JOIN inst ON inst.media = o.name
  GROUP BY o.name, pu.n, inst.instituts
  ORDER BY 4 DESC
$$;

-- Biais de sélection, 1er tour : pour chaque sondage relayé, le score de chaque candidat (moyenne de ses
-- hypothèses) moins la moyenne de tous les sondages terminés dans les p_jours précédents. Un écart moyen
-- positif = la chaîne a relayé des sondages plus favorables au candidat que l'ensemble des sondages.
-- Seuls les candidats à p_min % ou plus en moyenne sont gardés.
CREATE FUNCTION selection_medias(p_election text, p_jours int DEFAULT 30, p_min numeric DEFAULT 5)
RETURNS TABLE (media text, candidat text, couleur text, sondages bigint, part_relayee numeric,
               part_tous numeric, ecart numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH rel AS (
    SELECT DISTINCT media, institute, fieldwork_end FROM v_media_polls
    WHERE election_id = p_election AND round = 1
  ),
  val AS (
    SELECT rel.media, rel.institute, rel.fieldwork_end, r.candidate, avg(r.value) AS v
    FROM rel JOIN polls p ON p.election_id = p_election AND p.round = 1
      AND p.institute = rel.institute AND p.fieldwork_end = rel.fieldwork_end
    JOIN poll_results r ON r.poll_id = p.id
    GROUP BY 1, 2, 3, 4
  ),
  ref AS (
    SELECT val.*, (SELECT avg(r.value) FROM polls p JOIN poll_results r ON r.poll_id = p.id
                   WHERE p.election_id = p_election AND p.round = 1 AND r.candidate = val.candidate
                     AND p.fieldwork_end BETWEEN val.fieldwork_end - p_jours + 1 AND val.fieldwork_end) AS tous
    FROM val
  )
  SELECT ref.media, ref.candidate, pa.color, count(*), round(avg(ref.v)::numeric, 1), round(avg(ref.tous)::numeric, 1),
         round(avg(ref.v - ref.tous)::numeric, 1)
  FROM ref JOIN candidates c ON c.name = ref.candidate LEFT JOIN parties pa ON pa.code = c.party
  GROUP BY ref.media, ref.candidate, pa.color
  HAVING avg(ref.tous) >= p_min
  ORDER BY ref.media, avg(ref.tous) DESC
$$;
