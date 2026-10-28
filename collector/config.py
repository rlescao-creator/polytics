"""Élections suivies et sources associées."""

ELECTIONS = {
    "fr-2027": {
        "name": "Élection présidentielle française 2027",
        "country": "FR",
        "election_date": None,  # date du 1er tour pas encore fixée par décret
        "polymarket_events": ["next-french-presidential-election"],
        "wikipedia": ("fr", "Liste de sondages sur l'élection présidentielle française de 2027"),
    },
    "fr-2022": {
        "name": "Élection présidentielle française 2022",
        "country": "FR",
        "election_date": "2022-04-10",
        # Marché de l'ancien système Polymarket (AMM) : pas d'historique via l'API.
        "polymarket_events": ["who-will-win-the-2022-french-presidential-election"],
        "wikipedia": ("fr", "Liste de sondages sur l'élection présidentielle française de 2022"),
    },
    "us-2024": {
        "name": "US Presidential Election 2024",
        "country": "US",
        "election_date": "2024-11-05",
        "polymarket_events": ["presidential-election-winner-2024"],
        "wikipedia": None,  # sondages US : pas de Commission des sondages, à brancher plus tard
    },
}

# Résultats officiels (% des exprimés), source : Conseil constitutionnel via Wikipedia.
RESULTS = {
    "fr-2022": {
        "source": "https://fr.wikipedia.org/wiki/%C3%89lection_pr%C3%A9sidentielle_fran%C3%A7aise_de_2022",
        1: {"Macron": 27.85, "Le Pen": 23.15, "Mélenchon": 21.95, "Zemmour": 7.07, "Pécresse": 4.78,
            "Jadot": 4.63, "Lassalle": 3.13, "Roussel": 2.28, "Dupont-Aignan": 2.06, "Hidalgo": 1.74,
            "Poutou": 0.76, "Arthaud": 0.56},
        2: {"Macron": 58.55, "Le Pen": 41.45},
    },
}

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
