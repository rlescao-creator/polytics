-- Autres pays : partis et finalistes (couleurs d'affichage), et liaison plus souple des marchés Polymarket.

INSERT INTO parties (code, name, color) VALUES
  ('AR-LLA', 'La Libertad Avanza', '#7b3fbf'), ('AR-UXP', 'Unión por la Patria', '#3a8dde'),
  ('MX-MORENA', 'Morena', '#a3263a'), ('MX-PAN', 'Fuerza y Corazón por México', '#1f4fa3'), ('MX-MC', 'Movimiento Ciudadano', '#f08a24'),
  ('TW-DPP', 'Parti démocrate progressiste', '#2e9e4f'), ('TW-KMT', 'Kuomintang', '#2a3f9e'), ('TW-TPP', 'Parti populaire taïwanais', '#29b3b3'),
  ('RO-IND', 'Indépendant (Roumanie)', '#2f7fd6'), ('RO-AUR', 'Alliance pour l''union des Roumains', '#c9a227'),
  ('PL-PIS', 'Droit et justice (soutien)', '#263c8a'), ('PL-KO', 'Coalition civique', '#f07d1a'),
  ('KR-DPK', 'Parti démocrate de Corée', '#1f6fd1'), ('KR-PPP', 'Parti du pouvoir au peuple', '#d63a3a'), ('KR-RP', 'Parti de la réforme', '#f28c28'),
  ('CL-REP', 'Parti républicain (Chili)', '#1d3f8f'), ('CL-UPCH', 'Unidad por Chile', '#d6334d'),
  ('PT-PS', 'Parti socialiste (Portugal)', '#e0709a'), ('PT-CH', 'Chega', '#1d2c5e'),
  ('PE-FP', 'Fuerza Popular', '#f07d1a'), ('PE-JP', 'Juntos por el Perú', '#3f9e4d'),
  ('CO-SN', 'Salvación Nacional', '#1d3f8f'), ('CO-PH', 'Pacto Histórico', '#8e3fa8'),
  ('BR-PT', 'Parti des travailleurs', '#d6334d'), ('BR-PL', 'Parti libéral (Brésil)', '#1f4fa3')
ON CONFLICT (code) DO NOTHING;

INSERT INTO candidates (name, full_name, party) VALUES
  ('Milei', 'Javier Milei', 'AR-LLA'), ('Massa', 'Sergio Massa', 'AR-UXP'),
  ('Sheinbaum', 'Claudia Sheinbaum', 'MX-MORENA'), ('Gálvez', 'Xóchitl Gálvez', 'MX-PAN'), ('Máynez', 'Jorge Álvarez Máynez', 'MX-MC'),
  ('Lai', 'Lai Ching-te', 'TW-DPP'), ('Hou', 'Hou Yu-ih', 'TW-KMT'), ('Ko', 'Ko Wen-je', 'TW-TPP'),
  ('Dan', 'Nicușor Dan', 'RO-IND'), ('Simion', 'George Simion', 'RO-AUR'),
  ('Nawrocki', 'Karol Nawrocki', 'PL-PIS'), ('Trzaskowski', 'Rafał Trzaskowski', 'PL-KO'),
  ('Lee Jae-myung', 'Lee Jae-myung', 'KR-DPK'), ('Kim Moon-soo', 'Kim Moon-soo', 'KR-PPP'), ('Lee Jun-seok', 'Lee Jun-seok', 'KR-RP'),
  ('Kast', 'José Antonio Kast', 'CL-REP'), ('Jara', 'Jeannette Jara', 'CL-UPCH'),
  ('Seguro', 'António José Seguro', 'PT-PS'), ('Ventura', 'André Ventura', 'PT-CH'),
  ('Fujimori', 'Keiko Fujimori', 'PE-FP'), ('Sánchez', 'Roberto Sánchez', 'PE-JP'),
  ('De la Espriella', 'Abelardo de la Espriella', 'CO-SN'), ('Cepeda', 'Iván Cepeda', 'CO-PH'),
  ('Lula', 'Luiz Inácio Lula da Silva', 'BR-PT'), ('Flávio Bolsonaro', 'Flávio Bolsonaro', 'BR-PL')
ON CONFLICT (name) DO UPDATE SET full_name = excluded.full_name, party = excluded.party;

-- 'Lee Jae Myung' = 'Lee Jae-myung' : seules les lettres comptent, sans accents ni casse.
CREATE FUNCTION name_key(raw text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, extensions AS $$
  SELECT regexp_replace(lower(unaccent(raw)), '[^a-z]', '', 'g')
$$;

-- Un marché est relié au candidat dont le nom complet ou court s'écrit pareil ; à défaut, pour les
-- candidats de la même élection, au nom court en fin ou début d'intitulé ('Lula' pour 'Lula da Silva').
CREATE OR REPLACE FUNCTION markets_link_candidate() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
  NEW.candidate_name := coalesce(
    (SELECT name FROM candidates
     WHERE name_key(full_name) = name_key(NEW.candidate) OR name_key(name) = name_key(NEW.candidate)
     ORDER BY full_name IS NULL LIMIT 1),
    (SELECT c.name FROM candidates c JOIN results r ON r.candidate = c.name AND r.election_id = NEW.election_id
     WHERE unaccent(lower(NEW.candidate)) LIKE '% ' || unaccent(lower(c.name))
        OR unaccent(lower(NEW.candidate)) LIKE unaccent(lower(c.name)) || ' %'
     LIMIT 1));
  RETURN NEW;
END $$;

UPDATE markets SET candidate = candidate WHERE candidate_name IS NULL;
