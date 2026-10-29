-- Index sur les clés étrangères signalées par l'outil de conseil de Supabase (jointures et suppressions en cascade).
CREATE INDEX IF NOT EXISTS idx_candidates_party ON candidates(party);
CREATE INDEX IF NOT EXISTS idx_favorites_candidate ON favorites(candidate);
CREATE INDEX IF NOT EXISTS idx_markets_candidate_name ON markets(candidate_name);
CREATE INDEX IF NOT EXISTS idx_poll_results_candidate ON poll_results(candidate);
CREATE INDEX IF NOT EXISTS idx_results_candidate ON results(candidate);
