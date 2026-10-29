-- Fiches candidat créées par erreur ('% Bertrand' : le signe % restait collé au nom dans les tableaux
-- français de 2022, corrigé dans le collecteur) et plus référencées nulle part après rechargement.
DELETE FROM candidates c
WHERE c.name LIKE '\%%'
  AND NOT EXISTS (SELECT 1 FROM poll_results r WHERE r.candidate = c.name)
  AND NOT EXISTS (SELECT 1 FROM results r WHERE r.candidate = c.name)
  AND NOT EXISTS (SELECT 1 FROM markets m WHERE m.candidate_name = c.name)
  AND NOT EXISTS (SELECT 1 FROM favorites f WHERE f.candidate = c.name);
