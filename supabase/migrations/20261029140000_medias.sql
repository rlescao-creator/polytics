-- Ce que montrent les chaînes : les articles de leurs sites qui citent un sondage, reliés aux sondages.
-- media_outlets : une chaîne et les noms sous lesquels elle commande des sondages (notice_sponsors.sponsor).
CREATE TABLE media_outlets (
  name     text PRIMARY KEY,                 -- ex. 'BFMTV', 'TF1-LCI'
  site     text NOT NULL,                    -- ex. 'bfmtv.com'
  sponsors text[] NOT NULL DEFAULT '{}'      -- ex. {TF1,LCI} : ses propres sondages
);

CREATE TABLE media_articles (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  media          text NOT NULL REFERENCES media_outlets(name),
  url            text NOT NULL UNIQUE,
  published_at   timestamptz,
  title          text,
  election_id    text REFERENCES elections(id),
  institute      text,                       -- institut cité, au nom de polls.institute
  commissioned_by text,                      -- commanditaires cités (« sondage X pour BFMTV »), noms de config.MEDIA
  vote_intention boolean NOT NULL DEFAULT false,  -- parle d'intentions de vote à la présidentielle
  via            text NOT NULL,              -- 'sitemap' ou 'wayback'
  fetched_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_media_articles_media ON media_articles(media);
CREATE INDEX idx_media_articles_election ON media_articles(election_id, published_at);

ALTER TABLE media_outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lecture publique" ON media_outlets FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "lecture publique" ON media_articles FOR SELECT TO anon, authenticated USING (true);

-- Un article d'intentions de vote est relié au dernier sondage du même institut terminé dans les 14 jours
-- avant sa publication (toutes ses lignes : tours et hypothèses). Calculé à la lecture, car les sondages
-- Wikipedia sont rechargés en entier et changent d'identifiant.
CREATE VIEW v_media_polls WITH (security_invoker = true) AS
SELECT a.id AS article_id, a.media, a.published_at, a.election_id, a.institute, last.fieldwork_end,
       p.id AS poll_id, p.round,
       EXISTS (SELECT 1 FROM notice_sponsors ns JOIN media_outlets o ON o.name = a.media
               WHERE ns.notice_url = p.notice_url AND ns.sponsor = ANY (o.sponsors)) AS propre
FROM media_articles a
CROSS JOIN LATERAL (
  SELECT max(p.fieldwork_end) AS fieldwork_end FROM polls p
  WHERE p.election_id = a.election_id AND p.institute = a.institute
    AND p.fieldwork_end BETWEEN (a.published_at AT TIME ZONE 'Europe/Paris')::date - 14
                            AND (a.published_at AT TIME ZONE 'Europe/Paris')::date
) last
JOIN polls p ON p.election_id = a.election_id AND p.institute = a.institute AND p.fieldwork_end = last.fieldwork_end
WHERE a.vote_intention AND a.institute IS NOT NULL;
