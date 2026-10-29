"""Élections suivies et sources associées."""

ELECTIONS = {
    "fr-2027": {
        "name": "Élection présidentielle française 2027",
        "country": "FR",
        "election_date": None,  # date du 1er tour pas encore fixée par décret
        "second_round_date": None,
        "polymarket_events": ["next-french-presidential-election"],
        "wikipedia": ("fr", "Liste de sondages sur l'élection présidentielle française de 2027"),
    },
    "fr-2022": {
        "name": "Élection présidentielle française 2022",
        "country": "FR",
        "election_date": "2022-04-10",
        "second_round_date": "2022-04-24",
        # Marché de l'ancien système Polymarket (AMM) : pas d'historique via l'API.
        "polymarket_events": ["who-will-win-the-2022-french-presidential-election"],
        "wikipedia": ("fr", "Liste de sondages sur l'élection présidentielle française de 2022"),
    },
    "us-2024": {
        "name": "US Presidential Election 2024",
        "country": "US",
        "election_date": "2024-11-05",
        "second_round_date": None,  # scrutin à un tour
        "polymarket_events": ["presidential-election-winner-2024"],
        # Sondages nationaux (vote populaire). Pas de Commission des sondages : pas de commanditaire.
        "wikipedia": ("en", "Nationwide opinion polling for the 2024 United States presidential election"),
    },
    # Autres pays : marchés Polymarket récents (historique via l'API) et sondages de la Wikipedia anglaise.
    # "candidates" : nom court -> titre de la page Wikipedia ; sert à reconnaître les colonnes des tableaux.
    "ar-2023": {
        "name": "Élection présidentielle argentine 2023", "country": "AR",
        "election_date": "2023-10-22", "second_round_date": "2023-11-19",
        "polymarket_events": ["argentina-presidential-election-who-will-win"],
        "wikipedia": ("en", "Opinion polling for the 2023 Argentine general election"),
        "candidates": {"Milei": "Javier Milei", "Massa": "Sergio Massa", "Bullrich": "Patricia Bullrich",
                       "Schiaretti": "Juan Schiaretti", "Bregman": "Myriam Bregman"},
    },
    "mx-2024": {
        "name": "Élection présidentielle mexicaine 2024", "country": "MX",
        "election_date": "2024-06-02", "second_round_date": None,
        "polymarket_events": ["mexican-presidential-election-who-will-win"],
        "wikipedia": ("en", "Opinion polling for the 2024 Mexican general election"),
        "candidates": {"Sheinbaum": "Claudia Sheinbaum", "Gálvez": "Xóchitl Gálvez", "Máynez": "Jorge Álvarez Máynez"},
    },
    "tw-2024": {
        "name": "Élection présidentielle taïwanaise 2024", "country": "TW",
        "election_date": "2024-01-13", "second_round_date": None,
        "polymarket_events": ["taiwan-presidential-election-who-will-win"],
        "wikipedia": ("en", "Opinion polling for the 2024 Taiwanese presidential election"),
        "candidates": {"Lai": "Lai Ching-te", "Hou": "Hou Yu-ih", "Ko": "Ko Wen-je", "Gou": "Terry Gou"},
    },
    "ro-2025": {
        "name": "Élection présidentielle roumaine 2025", "country": "RO",
        "election_date": "2025-05-04", "second_round_date": "2025-05-18",
        "polymarket_events": ["romania-presidential-election-winner"],
        "wikipedia": ("en", "2025 Romanian presidential election"),
        "candidates": {"Dan": "Nicușor Dan", "Simion": "George Simion", "Antonescu": "Crin Antonescu",
                       "Ponta": "Victor Ponta", "Lasconi": "Elena Lasconi"},
    },
    "pl-2025": {
        "name": "Élection présidentielle polonaise 2025", "country": "PL",
        "election_date": "2025-05-18", "second_round_date": "2025-06-01",
        "polymarket_events": ["poland-presidential-election"],
        "wikipedia": ("en", "Opinion polling for the 2025 Polish presidential election"),
        "candidates": {"Nawrocki": "Karol Nawrocki", "Trzaskowski": "Rafał Trzaskowski", "Mentzen": "Sławomir Mentzen",
                       "Hołownia": "Szymon Hołownia", "Braun": "Grzegorz Braun"},
    },
    "kr-2025": {
        "name": "Élection présidentielle sud-coréenne 2025", "country": "KR",
        "election_date": "2025-06-03", "second_round_date": None,
        "polymarket_events": ["next-president-of-south-korea"],
        "wikipedia": ("en", "Opinion polling for the 2025 South Korean presidential election"),
        "candidates": {"Lee Jae-myung": "Lee Jae-myung", "Kim Moon-soo": "Kim Moon-soo", "Lee Jun-seok": "Lee Jun-seok"},
    },
    "cl-2025": {
        "name": "Élection présidentielle chilienne 2025", "country": "CL",
        "election_date": "2025-11-16", "second_round_date": "2025-12-14",
        "polymarket_events": ["chile-presidential-election"],
        "wikipedia": ("en", "Opinion polling for the 2025 Chilean presidential election"),
        "candidates": {"Kast": "José Antonio Kast", "Jara": "Jeannette Jara", "Parisi": "Franco Parisi",
                       "Kaiser": "Johannes Kaiser", "Matthei": "Evelyn Matthei"},
    },
    "pt-2026": {
        "name": "Élection présidentielle portugaise 2026", "country": "PT",
        "election_date": "2026-01-18", "second_round_date": "2026-02-08",
        "polymarket_events": ["portugal-presidential-election"],
        "wikipedia": ("en", "Opinion polling for the 2026 Portuguese presidential election"),
        "candidates": {"Seguro": "António José Seguro", "Ventura": "André Ventura", "Gouveia e Melo": "Henrique Gouveia e Melo",
                       "Marques Mendes": "Luís Marques Mendes", "Cotrim": "João Cotrim de Figueiredo"},
    },
    "pe-2026": {
        "name": "Élection présidentielle péruvienne 2026", "country": "PE",
        "election_date": "2026-04-12", "second_round_date": "2026-06-07",
        "polymarket_events": ["peru-presidential-election-winner"],
        "wikipedia": ("en", "Opinion polling for the 2026 Peruvian general election"),
        "candidates": {"Fujimori": "Keiko Fujimori", "Sánchez": "Roberto Sánchez"},
    },
    "co-2026": {
        "name": "Élection présidentielle colombienne 2026", "country": "CO",
        "election_date": "2026-05-31", "second_round_date": "2026-06-21",
        "polymarket_events": ["colombia-presidential-election"],
        "wikipedia": ("en", "2026 Colombian presidential election"),
        "candidates": {"De la Espriella": "Abelardo de la Espriella", "Cepeda": "Iván Cepeda",
                       "Valencia": "Paloma Valencia", "Fajardo": "Sergio Fajardo"},
    },
    "br-2026": {
        "name": "Élection présidentielle brésilienne 2026", "country": "BR",
        "election_date": "2026-10-04", "second_round_date": "2026-10-25",
        "polymarket_events": ["brazil-presidential-election"],
        "wikipedia": ("en", "Opinion polling for the 2026 Brazilian presidential election"),
        "candidates": {"Lula": "Luiz Inácio Lula da Silva", "Flávio Bolsonaro": "Flávio Bolsonaro"},
    },
}

# Résultats officiels (% des exprimés), source : Conseil constitutionnel (France), FEC (États-Unis) via Wikipedia.
RESULTS = {
    "fr-2022": {
        "source": "https://fr.wikipedia.org/wiki/%C3%89lection_pr%C3%A9sidentielle_fran%C3%A7aise_de_2022",
        1: {"Macron": 27.85, "Le Pen": 23.15, "Mélenchon": 21.95, "Zemmour": 7.07, "Pécresse": 4.78,
            "Jadot": 4.63, "Lassalle": 3.13, "Roussel": 2.28, "Dupont-Aignan": 2.06, "Hidalgo": 1.74,
            "Poutou": 0.76, "Arthaud": 0.56},
        2: {"Macron": 58.55, "Le Pen": 41.45},
    },
    # Vote populaire national ; le vainqueur se décide au collège électoral (Trump, 312 grands électeurs).
    "us-2024": {
        "source": "https://en.wikipedia.org/wiki/2024_United_States_presidential_election",
        1: {"Trump": 49.80, "Harris": 48.32},
    },
}

# Autres pays : tour décisif seulement (le second s'il existe), source : page Wikipedia de l'élection.
for _eid, _decisive in {
    "ar-2023": {"Milei": 55.65, "Massa": 44.35},
    "mx-2024": {"Sheinbaum": 61.18, "Gálvez": 28.11, "Máynez": 10.57},
    "tw-2024": {"Lai": 40.05, "Hou": 33.49, "Ko": 26.46},
    "ro-2025": {"Dan": 53.60, "Simion": 46.40},
    "pl-2025": {"Nawrocki": 50.89, "Trzaskowski": 49.11},
    "kr-2025": {"Lee Jae-myung": 49.42, "Kim Moon-soo": 41.15, "Lee Jun-seok": 8.34},
    "cl-2025": {"Kast": 58.17, "Jara": 41.83},
    "pt-2026": {"Seguro": 66.84, "Ventura": 33.16},
    "pe-2026": {"Fujimori": 50.13, "Sánchez": 49.87},
    "co-2026": {"De la Espriella": 49.66, "Cepeda": 48.70},
    "br-2026": {"Lula": 51.79, "Flávio Bolsonaro": 48.21},
}.items():
    _round = 2 if ELECTIONS[_eid]["second_round_date"] else 1
    _page = {"ar-2023": "2023 Argentine general election", "mx-2024": "2024 Mexican general election",
             "pe-2026": "2026 Peruvian general election", "br-2026": "2026 Brazilian general election"}.get(
        _eid, ELECTIONS[_eid]["wikipedia"][1].replace("Opinion polling for the ", ""))
    RESULTS[_eid] = {"source": "https://en.wikipedia.org/wiki/" + _page.replace(" ", "_"), _round: _decisive}

# Médias connus : regex (insensible à la casse) -> (nom normalisé, type).
MEDIA = [
    (r"\bBFM ?TV\b|\bBFM\b", "BFMTV", "tv"),
    (r"\bLCI\b", "LCI", "tv"),
    (r"\bTF1\b", "TF1", "tv"),
    (r"\bC ?News\b", "CNews", "tv"),
    (r"\bM6\b", "M6", "tv"),
    (r"France T[ée]l[ée]visions|\bFrance ?[23]\b", "France Télévisions", "tv"),
    (r"\bfrance ?info\b", "franceinfo", "tv"),
    (r"Public S[ée]nat", "Public Sénat", "tv"),
    (r"\bLCP\b", "LCP", "tv"),
    (r"\bRTL\b", "RTL", "radio"),
    (r"\bEurope ?1\b", "Europe 1", "radio"),
    (r"France Inter", "France Inter", "radio"),
    (r"Sud ?Radio", "Sud Radio", "radio"),
    (r"\bRMC\b", "RMC", "radio"),
    (r"Radio Classique", "Radio Classique", "radio"),
    (r"Figaro", "Le Figaro", "press"),
    (r"Parisien", "Le Parisien", "press"),
    (r"\bLe ?Monde\b", "Le Monde", "press"),
    (r"\bJDD\b|Journal du Dimanche", "JDD", "press"),
    (r"\b[ÉE]chos\b", "Les Échos", "press"),
    (r"\bLe ?Point\b", "Le Point", "press"),
    (r"Tribune", "La Tribune Dimanche", "press"),
    (r"\bChallenges\b", "Challenges", "press"),
    (r"\bL.?Opinion\b", "L'Opinion", "press"),
    (r"Valeurs ?actuelles", "Valeurs actuelles", "press"),
    (r"H[ée]micycle", "L'Hémicycle", "press"),
    (r"Ouest.?France", "Ouest-France", "press"),
    (r"\bL.?Express\b", "L'Express", "press"),
    (r"Lib[ée]ration", "Libération", "press"),
    (r"\bMarianne\b", "Marianne", "press"),
    (r"\bRegards\b", "Regards", "press"),
    (r"\bHexagone\b", "Hexagone", "press"),
    (r"Paris ?Match", "Paris Match", "press"),
    (r"Aujourd.?hui en France", "Aujourd'hui en France", "press"),
    (r"\bOrange\b", "Orange", "web"),
    (r"\bPolitico\b", "Politico", "web"),
    (r"Huff ?Post", "HuffPost", "web"),
    (r"Grand ?Continent", "Le Grand Continent", "web"),
]


# Sites des chaînes dont on relève les articles de sondage (collector/media_polls.py) :
#   sitemap  : comment lister leurs articles (CNews et Europe 1 refusent tous les robots : absents) ;
#   sponsors : noms (de MEDIA) sous lesquels la chaîne commande ses propres sondages.
MEDIA_SITES = {
    "BFMTV": {"site": "bfmtv.com", "sitemap": "bfmtv", "sponsors": ["BFMTV"]},
    "TF1-LCI": {"site": "tf1info.fr", "sitemap": "tf1info", "sponsors": ["TF1", "LCI"]},
    "franceinfo": {"site": "franceinfo.fr", "sitemap": "franceinfo", "sponsors": ["franceinfo", "France Télévisions"]},
}

# Période où un article de sondage est rattaché à une élection (fin ouverte : jusqu'à aujourd'hui).
MEDIA_WINDOWS = {
    "fr-2022": ("2021-09-01", "2022-04-24"),
    "fr-2027": ("2025-01-01", None),
}
