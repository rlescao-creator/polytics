-- Référentiel des partis et des candidats : les couleurs et les noms vivent en base, plus dans le code.

CREATE TABLE parties (
  code  text PRIMARY KEY,                 -- sigle, ex. 'RN'
  name  text NOT NULL,
  color text NOT NULL                     -- couleur d'affichage (#rrggbb)
);

CREATE TABLE candidates (
  name      text PRIMARY KEY,             -- nom tel qu'écrit dans les sondages, ex. 'Le Pen'
  full_name text UNIQUE,                  -- nom complet, tel qu'écrit sur Polymarket
  party     text REFERENCES parties(code),
  kind      text NOT NULL DEFAULT 'personne' CHECK (kind IN ('personne', 'autre'))
);

INSERT INTO parties (code, name, color) VALUES
  ('RN', 'Rassemblement national', '#3550c4'), ('LFI', 'La France insoumise', '#d6334d'),
  ('HOR', 'Horizons', '#13a1b4'), ('PP', 'Place publique', '#df5297'), ('LR', 'Les Républicains', '#5aaef0'),
  ('RE', 'Renaissance', '#e6a019'), ('REC', 'Reconquête', '#8c6a4a'), ('LE', 'Les Écologistes', '#3f9e4d'),
  ('PCF', 'Parti communiste français', '#a3263a'), ('LO', 'Lutte ouvrière', '#7a1f2b'),
  ('NPA', 'Nouveau Parti anticapitaliste', '#c2185b'), ('PS', 'Parti socialiste', '#e0709a'),
  ('DLF', 'Debout la France', '#4b5e9e'), ('RES', 'Résistons !', '#a0855b'), ('NE', 'Nouvelle Énergie', '#2f6e8f'),
  ('LFH', 'La France humaniste', '#8a7fb5'), ('D!', 'Debout !', '#c0392b'), ('GRS', 'Gauche républicaine et socialiste', '#e57373');

-- Tous les noms déjà présents dans les sondages et les résultats.
INSERT INTO candidates (name, kind)
SELECT DISTINCT candidate,
       CASE WHEN candidate IN ('Autres', 'Vote blanc') OR candidate LIKE '%/%' OR candidate LIKE 'Candidat %' THEN 'autre' ELSE 'personne' END
FROM (SELECT candidate FROM poll_results UNION SELECT candidate FROM results) c;

UPDATE candidates c SET full_name = v.full_name, party = v.party
FROM (VALUES
  ('Le Pen', 'Marine Le Pen', 'RN'), ('Bardella', 'Jordan Bardella', 'RN'), ('Mélenchon', 'Jean-Luc Mélenchon', 'LFI'),
  ('Philippe', 'Édouard Philippe', 'HOR'), ('Glucksmann', 'Raphaël Glucksmann', 'PP'), ('Retailleau', 'Bruno Retailleau', 'LR'),
  ('Attal', 'Gabriel Attal', 'RE'), ('Zemmour', 'Éric Zemmour', 'REC'), ('Knafo', 'Sarah Knafo', 'REC'),
  ('Macron', 'Emmanuel Macron', 'RE'), ('Pécresse', 'Valérie Pécresse', 'LR'), ('Jadot', 'Yannick Jadot', 'LE'),
  ('Tondelier', 'Marine Tondelier', 'LE'), ('Rousseau', 'Sandrine Rousseau', 'LE'), ('Roussel', 'Fabien Roussel', 'PCF'),
  ('Arthaud', 'Nathalie Arthaud', 'LO'), ('Poutou', 'Philippe Poutou', 'NPA'), ('Dupont-Aignan', 'Nicolas Dupont-Aignan', 'DLF'),
  ('Lassalle', 'Jean Lassalle', 'RES'), ('Hidalgo', 'Anne Hidalgo', 'PS'), ('Faure', 'Olivier Faure', 'PS'),
  ('Hollande', 'François Hollande', 'PS'), ('Royal', 'Ségolène Royal', 'PS'), ('Delga', 'Carole Delga', 'PS'),
  ('Cazeneuve', 'Bernard Cazeneuve', 'PS'), ('Bouamrane', 'Karim Bouamrane', 'PS'), ('Guedj', 'Jérôme Guedj', 'PS'),
  ('Wauquiez', 'Laurent Wauquiez', 'LR'), ('Bertrand', 'Xavier Bertrand', 'LR'), ('Barnier', 'Michel Barnier', 'LR'),
  ('Lisnard', 'David Lisnard', 'NE'), ('Villepin', 'Dominique de Villepin', 'LFH'), ('Ruffin', 'François Ruffin', 'D!'),
  ('Maurel', 'Emmanuel Maurel', 'GRS'), ('Darmanin', 'Gérald Darmanin', 'RE'), ('Le Maire', 'Bruno Le Maire', 'RE'),
  ('Lecornu', 'Sébastien Lecornu', 'RE'), ('Castex', 'Jean Castex', 'RE'), ('Borne', 'Élisabeth Borne', 'RE'),
  ('Braun-Pivet', 'Yaël Braun-Pivet', 'RE'), ('Bayrou', 'François Bayrou', NULL), ('Polony', 'Natacha Polony', NULL)
) AS v(name, full_name, party)
WHERE c.name = v.name;

-- Les sondages, les résultats et les marchés pointent vers le référentiel.
ALTER TABLE poll_results ADD CONSTRAINT poll_results_candidate_fkey
  FOREIGN KEY (candidate) REFERENCES candidates(name) ON UPDATE CASCADE;
ALTER TABLE results ADD CONSTRAINT results_candidate_fkey
  FOREIGN KEY (candidate) REFERENCES candidates(name) ON UPDATE CASCADE;
ALTER TABLE markets ADD COLUMN candidate_name text REFERENCES candidates(name) ON UPDATE CASCADE;

-- Trigger 1 : un nom inconnu crée sa fiche candidat, au lieu de faire échouer la collecte.
CREATE FUNCTION ensure_candidate() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  INSERT INTO candidates (name, kind)
  VALUES (NEW.candidate,
          CASE WHEN NEW.candidate IN ('Autres', 'Vote blanc') OR NEW.candidate LIKE '%/%' OR NEW.candidate LIKE 'Candidat %'
               THEN 'autre' ELSE 'personne' END)
  ON CONFLICT (name) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER poll_results_ensure_candidate BEFORE INSERT OR UPDATE OF candidate ON poll_results
  FOR EACH ROW EXECUTE FUNCTION ensure_candidate();
CREATE TRIGGER results_ensure_candidate BEFORE INSERT OR UPDATE OF candidate ON results
  FOR EACH ROW EXECUTE FUNCTION ensure_candidate();

-- Trigger 2 : un seul nom par institut, quelle que soit l'écriture de la source.
CREATE FUNCTION normalize_institute(raw text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(btrim(regexp_replace(raw, '\s*\(.*?\)', '', 'g')))
    WHEN 'harris interactive' THEN 'Harris' WHEN 'harris interractive' THEN 'Harris'
    WHEN 'toluna harris interactive' THEN 'Harris' WHEN 'cluster 17' THEN 'Cluster17'
    WHEN 'opinionway' THEN 'OpinionWay' WHEN 'ipsos-bva' THEN 'Ipsos' WHEN 'ipsos bva' THEN 'Ipsos'
    ELSE btrim(regexp_replace(raw, '\s*\(.*?\)', '', 'g'))
  END
$$;

CREATE FUNCTION polls_normalize_institute() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.institute := normalize_institute(NEW.institute);
  RETURN NEW;
END $$;

CREATE TRIGGER polls_normalize_institute BEFORE INSERT OR UPDATE OF institute ON polls
  FOR EACH ROW EXECUTE FUNCTION polls_normalize_institute();

-- Trigger 3 : un marché Polymarket ("Marine Le Pen") est relié à sa fiche candidat ("Le Pen").
CREATE FUNCTION markets_link_candidate() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.candidate_name := (SELECT name FROM candidates WHERE full_name = NEW.candidate);
  RETURN NEW;
END $$;

CREATE TRIGGER markets_link_candidate BEFORE INSERT OR UPDATE OF candidate ON markets
  FOR EACH ROW EXECUTE FUNCTION markets_link_candidate();

UPDATE markets SET candidate = candidate;  -- relie les marchés déjà présents

ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lecture publique" ON parties FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "lecture publique" ON candidates FOR SELECT TO anon, authenticated USING (true);
