-- Présidentielle américaine 2024 : partis et candidats des sondages nationaux et de Polymarket.

INSERT INTO parties (code, name, color) VALUES
  ('DEM', 'Parti démocrate', '#2f6fd6'), ('REP', 'Parti républicain', '#d63a3a'),
  ('GRN', 'Parti vert (États-Unis)', '#4c9a52'), ('IND', 'Indépendant', '#8a8f98')
ON CONFLICT (code) DO NOTHING;

INSERT INTO candidates (name, full_name, party) VALUES
  ('Trump', 'Donald Trump', 'REP'), ('Harris', 'Kamala Harris', 'DEM'), ('Biden', 'Joe Biden', 'DEM'),
  ('Kennedy', 'Robert F. Kennedy Jr.', 'IND'), ('Stein', 'Jill Stein', 'GRN'), ('West', 'Cornel West', 'IND')
ON CONFLICT (name) DO UPDATE SET full_name = excluded.full_name, party = excluded.party;

UPDATE markets SET candidate = candidate WHERE candidate_name IS NULL;  -- relie les marchés déjà présents
