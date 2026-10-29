"""Cas réels rencontrés dans les tableaux Wikipedia. Lancer : python -m unittest"""
import unittest

from bs4 import BeautifulSoup

from collector.wikipedia_polls import _fieldwork_end_en, _merge_spellings, _parse_cell


def cell(html):
    return BeautifulSoup(f"<td>{html}</td>", "html.parser").td


class FieldworkEndEn(unittest.TestCase):
    def test_range_over_two_months(self):
        self.assertEqual(_fieldwork_end_en("October 30 – November 2, 2024"), "2024-11-02")

    def test_range_over_new_year(self):
        self.assertEqual(_fieldwork_end_en("31 December 2023–1 January 2024"), "2024-01-01")

    def test_year_from_section(self):
        self.assertEqual(_fieldwork_end_en("10–13 Aug", 2025), "2025-08-13")

    def test_month_only(self):
        self.assertEqual(_fieldwork_end_en("February 2026"), "2026-02-15")

    def test_no_date(self):
        self.assertIsNone(_fieldwork_end_en("Election result"))


class ParseCell(unittest.TestCase):
    def test_plain_value_is_the_column_candidate(self):
        self.assertEqual(_parse_cell(cell("24"), "Macron"), [("Macron", 24.0, None)])

    def test_other_candidate_named_in_cell(self):
        self.assertEqual(_parse_cell(cell("26 % Bertrand"), "Pécresse"), [("Bertrand", 26.0, "colonne Pécresse")])

    def test_two_candidates_without_separator(self):
        self.assertEqual([n for n, _, _ in _parse_cell(cell("12 % Bertrand 8 % Pécresse"), "LR")], ["Bertrand", "Pécresse"])

    def test_candidates_separated_by_hr(self):
        self.assertEqual([n for n, _, _ in _parse_cell(cell("3 % Hidalgo<hr>2 % Montebourg"), "Autres")], ["Hidalgo", "Montebourg"])

    def test_below(self):
        self.assertEqual(_parse_cell(cell("&lt; 0,5"), "Arthaud"), [("Arthaud", 0.5, "inférieur à")])

    def test_joint_candidacy_kept_whole(self):
        self.assertEqual(_parse_cell(cell("7 Mélenchon (LFI) / Roussel (PCF)"), "LFI")[0][0], "Mélenchon (LFI) / Roussel (PCF)")


class MergeSpellings(unittest.TestCase):
    def test_most_frequent_spelling_wins(self):
        polls = [{"institute": n} for n in ["Redfield & Wilton Strategies"] + ["Redfield and Wilton Strategies"] * 2
                 + ["Forbes /HarrisX", "HarrisX / Forbes", "HarrisX / Forbes", "Analogías", "Analogias", "Analogias"]]
        _merge_spellings(polls)
        self.assertEqual({p["institute"] for p in polls},
                         {"Redfield and Wilton Strategies", "HarrisX / Forbes", "Analogias"})


if __name__ == "__main__":
    unittest.main()
