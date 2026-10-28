-- Fonctions d'analyse appelées par le tableau de bord (RPC). Aucun nom de candidat n'y est écrit :
-- les « favoris » sont toujours les mieux placés, dans les sondages récents ou dans le résultat.

-- Moyenne de chaque candidat sur les p_jours derniers jours de terrain, 1er tour.
CREATE FUNCTION moyenne_recente(p_election text, p_jours int DEFAULT 30)
RETURNS TABLE (candidat text, parti text, couleur text, moyenne numeric, mini numeric, maxi numeric,
               sondages bigint, scenarios bigint, debut date, fin date)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH lim AS (SELECT max(fieldwork_end) AS fin FROM polls WHERE election_id = p_election AND round = 1)
  SELECT c.name, c.party, pa.color, round(avg(r.value)::numeric, 1), round(min(r.value)::numeric, 1),
         round(max(r.value)::numeric, 1), count(DISTINCT p.institute || '|' || p.fieldwork_label), count(*),
         min(lim.fin) - p_jours, min(lim.fin)
  FROM polls p
  JOIN poll_results r ON r.poll_id = p.id
  JOIN candidates c ON c.name = r.candidate
  LEFT JOIN parties pa ON pa.code = c.party
  CROSS JOIN lim
  WHERE p.election_id = p_election AND p.round = 1 AND p.fieldwork_end >= lim.fin - p_jours AND c.kind = 'personne'
  GROUP BY c.name, c.party, pa.color
  HAVING count(*) >= 5
  ORDER BY 4 DESC
$$;

-- Moyenne mensuelle des p_nb candidats les mieux placés sur les 90 derniers jours de terrain.
-- rang_parti = 2 pour un second candidat du même parti (ex. Bardella testé à la place de Le Pen).
CREATE FUNCTION evolution_mensuelle(p_election text, p_depuis date, p_nb int DEFAULT 7)
RETURNS TABLE (mois date, candidat text, couleur text, rang int, rang_parti int, moyenne numeric, scenarios bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH lim AS (SELECT max(fieldwork_end) AS fin FROM polls WHERE election_id = p_election AND round = 1),
  top AS (
    SELECT c.name, c.party, pa.color, row_number() OVER (ORDER BY avg(r.value) DESC) AS rang
    FROM polls p JOIN poll_results r ON r.poll_id = p.id JOIN candidates c ON c.name = r.candidate
    LEFT JOIN parties pa ON pa.code = c.party CROSS JOIN lim
    WHERE p.election_id = p_election AND p.round = 1 AND p.fieldwork_end >= lim.fin - 90 AND c.kind = 'personne'
    GROUP BY c.name, c.party, pa.color
    HAVING count(*) >= 10
    ORDER BY avg(r.value) DESC
    LIMIT p_nb
  ),
  ranked AS (SELECT *, row_number() OVER (PARTITION BY coalesce(party, name) ORDER BY rang) AS rang_parti FROM top)
  SELECT date_trunc('month', p.fieldwork_end)::date, t.name, t.color, t.rang::int, t.rang_parti::int,
         round(avg(r.value)::numeric, 1), count(*)
  FROM polls p JOIN poll_results r ON r.poll_id = p.id JOIN ranked t ON t.name = r.candidate
  WHERE p.election_id = p_election AND p.round = 1 AND p.fieldwork_end >= p_depuis
  GROUP BY 1, t.name, t.color, t.rang, t.rang_parti
  ORDER BY 1, t.rang
$$;

-- Pour chaque média commanditaire : écart moyen de ses sondages à la moyenne de tous les sondages du
-- même mois, pour les p_nb candidats les mieux placés sur les 30 derniers jours (1er tour).
CREATE FUNCTION ecart_commanditaires(p_election text, p_depuis date, p_nb int DEFAULT 4)
RETURNS TABLE (commanditaire text, type text, instituts text, sondages bigint, candidat text, couleur text, rang int, ecart numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH top AS (
    SELECT candidat, couleur, row_number() OVER (ORDER BY moyenne DESC)::int AS rang
    FROM moyenne_recente(p_election, 30) LIMIT p_nb
  ),
  s AS (
    SELECT p.notice_url, p.institute, date_trunc('month', p.fieldwork_end) AS mois, r.candidate, r.value
    FROM polls p JOIN poll_results r ON r.poll_id = p.id JOIN top ON top.candidat = r.candidate
    WHERE p.election_id = p_election AND p.round = 1 AND p.fieldwork_end >= p_depuis
  ),
  m AS (SELECT mois, candidate, avg(value) AS moy FROM s GROUP BY 1, 2),
  d AS (
    SELECT ns.sponsor, ns.media_type, s.notice_url, s.institute, s.candidate, s.value - m.moy AS ecart
    FROM s JOIN m USING (mois, candidate) JOIN notice_sponsors ns ON ns.notice_url = s.notice_url
  ),
  media AS (
    SELECT sponsor, media_type, string_agg(DISTINCT institute, ', ') AS instituts, count(DISTINCT notice_url) AS sondages
    FROM d GROUP BY sponsor, media_type
  )
  SELECT d.sponsor,
         CASE d.media_type WHEN 'tv' THEN 'Télé' WHEN 'radio' THEN 'Radio' WHEN 'press' THEN 'Presse' ELSE 'Web' END,
         media.instituts, media.sondages, d.candidate, top.couleur, top.rang, round(avg(d.ecart)::numeric, 1)
  FROM d JOIN media USING (sponsor, media_type) JOIN top ON top.candidat = d.candidate
  GROUP BY d.sponsor, d.media_type, media.instituts, media.sondages, d.candidate, top.couleur, top.rang
  ORDER BY media.sondages DESC, d.sponsor, top.rang
$$;

-- Erreur des sondages face au résultat officiel, 1er tour.
--   p_par = 'institut' : le dernier sondage de chaque institut avant le vote ;
--   p_par = 'media'    : les sondages commandés par chaque média la dernière semaine (9 jours avant le vote).
-- erreur = sondage − résultat ; erreur_moyenne porte sur tous les candidats du résultat,
-- erreur sur les p_nb premiers du résultat.
CREATE FUNCTION erreur_sondages(p_election text, p_par text, p_nb int DEFAULT 4)
RETURNS TABLE (source text, type text, instituts text, sondages bigint, dernier_sondage date,
               erreur_moyenne numeric, candidat text, couleur text, rang int, erreur numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH e AS (SELECT election_date FROM elections WHERE id = p_election),
  res AS (
    SELECT r.candidate, r.value, pa.color, row_number() OVER (ORDER BY r.value DESC)::int AS rang
    FROM results r JOIN candidates c ON c.name = r.candidate LEFT JOIN parties pa ON pa.code = c.party
    WHERE r.election_id = p_election AND r.round = 1
  ),
  pol AS (
    SELECT p.*, row_number() OVER (PARTITION BY p.institute ORDER BY p.fieldwork_end DESC, p.id) AS dernier
    FROM polls p CROSS JOIN e
    WHERE p.election_id = p_election AND p.round = 1 AND p.fieldwork_end < e.election_date
  ),
  src AS (
    SELECT pol.institute AS source, 'Institut' AS type, pol.institute AS institute, pol.id, pol.fieldwork_end
    FROM pol WHERE p_par = 'institut' AND pol.dernier = 1
    UNION ALL
    SELECT ns.sponsor,
           CASE ns.media_type WHEN 'tv' THEN 'Télé' WHEN 'radio' THEN 'Radio' WHEN 'press' THEN 'Presse' ELSE 'Web' END,
           pol.institute, pol.id, pol.fieldwork_end
    FROM pol JOIN notice_sponsors ns ON ns.notice_url = pol.notice_url CROSS JOIN e
    WHERE p_par = 'media' AND pol.fieldwork_end >= e.election_date - 9
  ),
  err AS (
    SELECT src.source, src.type, src.institute, src.id, src.fieldwork_end, r.candidate, r.value - res.value AS erreur
    FROM src JOIN poll_results r ON r.poll_id = src.id JOIN res ON res.candidate = r.candidate
  ),
  agg AS (
    SELECT source, type, string_agg(DISTINCT institute, ', ') AS instituts, count(DISTINCT id) AS sondages,
           max(fieldwork_end) AS dernier_sondage, round(avg(abs(erreur))::numeric, 2) AS erreur_moyenne
    FROM err GROUP BY source, type
  )
  SELECT agg.source, agg.type, agg.instituts, agg.sondages, agg.dernier_sondage, agg.erreur_moyenne,
         res.candidate, res.color, res.rang, round(avg(err.erreur)::numeric, 1)
  FROM agg JOIN err USING (source, type) JOIN res ON res.candidate = err.candidate
  WHERE res.rang <= p_nb
  GROUP BY agg.source, agg.type, agg.instituts, agg.sondages, agg.dernier_sondage, agg.erreur_moyenne,
           res.candidate, res.color, res.rang
  ORDER BY agg.erreur_moyenne, agg.source, res.rang
$$;

-- Moyenne des sondages de la dernière semaine contre le résultat officiel.
--   1er tour : les 9 jours avant le vote ; 2nd tour : à partir du 8e jour après le 1er tour.
CREATE FUNCTION sondages_vs_resultat(p_election text, p_tour int)
RETURNS TABLE (candidat text, couleur text, sondages numeric, resultat double precision, erreur numeric, nb_sondages bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH e AS (SELECT election_date FROM elections WHERE id = p_election)
  SELECT r.candidate, pa.color, round(avg(pr.value)::numeric, 1), r.value,
         round((avg(pr.value) - r.value)::numeric, 1), count(DISTINCT p.id)
  FROM results r
  JOIN candidates c ON c.name = r.candidate
  LEFT JOIN parties pa ON pa.code = c.party
  JOIN poll_results pr ON pr.candidate = r.candidate
  JOIN polls p ON p.id = pr.poll_id AND p.election_id = r.election_id AND p.round = r.round
  CROSS JOIN e
  WHERE r.election_id = p_election AND r.round = p_tour
    AND ((p_tour = 1 AND p.fieldwork_end >= e.election_date - 9 AND p.fieldwork_end < e.election_date)
      OR (p_tour = 2 AND p.fieldwork_end > e.election_date + 7))
  GROUP BY r.candidate, pa.color, r.value
  ORDER BY r.value DESC
$$;

-- Cotes Polymarket du dernier relevé, avec la couleur du parti quand le candidat est connu.
CREATE FUNCTION marches_actuels(p_election text, p_nb int DEFAULT 8)
RETURNS TABLE (candidat text, couleur text, proba numeric, volume numeric, releve text)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT m.candidate, pa.color, round((m.last_price * 100)::numeric, 1), round(m.volume::numeric), m.updated_at
  FROM markets m
  LEFT JOIN candidates c ON c.name = m.candidate_name
  LEFT JOIN parties pa ON pa.code = c.party
  WHERE m.election_id = p_election AND m.closed = 0
  ORDER BY m.last_price DESC
  LIMIT p_nb
$$;
