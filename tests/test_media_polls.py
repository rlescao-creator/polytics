"""Lecture d'un article de chaîne (page fictive au format des sites d'information). Lancer : python -m unittest"""
import json
import unittest

from collector.media_polls import _date_in_url, _wanted, parse_article


def page(headline, body, published="2026-10-23T07:51:23+02:00"):
    ld = json.dumps({"@type": "NewsArticle", "headline": headline, "datePublished": published, "articleBody": body})
    return f'<html><head><script type="application/ld+json">{ld}</script></head><body><article><p>{body}</p></article></body></html>'


class ParseArticle(unittest.TestCase):
    def test_institute_and_sponsors(self):
        a = parse_article(page("Présidentielle 2027 : Le Pen largement en tête au second tour",
                               "C'est ce que prévoit un nouveau sondage Harris Interactive pour M6/RTL, réalisé après le 17 octobre."))
        self.assertEqual((a["institute"], a["commissioned_by"], a["vote_intention"]), ("Harris", "M6, RTL", True))
        self.assertEqual(a["published_at"][:10], "2026-10-23")

    def test_first_institute_cited_wins(self):
        a = parse_article(page("SONDAGE LCI", "D'après un sondage Ifop-Fiducial pour LCI, Le Figaro et Sud Radio, "
                                              "le premier tour reste ouvert. Elabe donnait d'autres chiffres."))
        self.assertEqual(a["institute"], "Ifop")
        self.assertEqual(a["commissioned_by"], "LCI, Sud Radio, Le Figaro")

    def test_opinion_poll_is_not_a_vote_intention(self):
        a = parse_article(page("Sondage : 77 % des Français pessimistes", "Selon un sondage CSA pour CNEWS, publié jeudi."))
        self.assertFalse(a["vote_intention"])

    def test_title_entities(self):
        self.assertEqual(parse_article(page("Glucksmann veut &quot;mettre fin&quot;", "x"))["title"], 'Glucksmann veut "mettre fin"')


class Addresses(unittest.TestCase):
    def test_foreign_election_left_out(self):
        self.assertFalse(_wanted("https://www.bfmtv.com/international/bresil/presidentielle-sondage-lula_AN-202610230098.html", "fr-2027"))
        self.assertTrue(_wanted("https://www.bfmtv.com/politique/presidentielle-2027-un-sondage-le-pen_AD-202610230176.html", "fr-2027"))

    def test_date_in_url(self):
        self.assertEqual(str(_date_in_url("https://www.bfmtv.com/x_AD-202610230176.html")), "2026-10-23")


if __name__ == "__main__":
    unittest.main()
