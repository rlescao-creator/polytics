-- Hors France, Wikipedia écrit 'Institut / Média' ('IBRiS / Onet') : l'institut garde son seul nom, pour être
-- comparé d'un sondage à l'autre, et le média va dans sa propre colonne (en France : notices et notice_sponsors).
ALTER TABLE polls ADD COLUMN media text;
