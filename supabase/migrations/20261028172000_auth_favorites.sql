-- Comptes utilisateurs (Supabase Auth) : chacun suit ses candidats favoris, et ne voit que les siens.

CREATE TABLE favorites (
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  candidate  text NOT NULL REFERENCES candidates(name) ON UPDATE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, candidate)
);

ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "voir ses favoris" ON favorites FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "ajouter ses favoris" ON favorites FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "retirer ses favoris" ON favorites FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- Les favoris de l'utilisateur connecté, avec sa moyenne récente dans les sondages et sa cote Polymarket.
-- SECURITY INVOKER (par défaut) : la RLS de favorites s'applique, un anonyme n'obtient rien.
CREATE FUNCTION mes_favoris(p_election text DEFAULT 'fr-2027')
RETURNS TABLE (candidat text, parti text, couleur text, moyenne numeric, mini numeric, maxi numeric, proba numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT f.candidate, c.party, pa.color, mr.moyenne, mr.mini, mr.maxi, round((m.last_price * 100)::numeric, 1)
  FROM favorites f
  JOIN candidates c ON c.name = f.candidate
  LEFT JOIN parties pa ON pa.code = c.party
  LEFT JOIN moyenne_recente(p_election, 30) mr ON mr.candidat = f.candidate
  LEFT JOIN markets m ON m.candidate_name = f.candidate AND m.election_id = p_election AND m.closed = 0
  WHERE f.user_id = (SELECT auth.uid())
  ORDER BY mr.moyenne DESC NULLS LAST
$$;

REVOKE EXECUTE ON FUNCTION mes_favoris(text) FROM anon;
