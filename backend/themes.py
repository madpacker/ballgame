"""Weekly themes rotation. Picked by ISO week number modulo list length so it rotates
automatically. Each theme has a filter the frontend can apply to the question pool.
"""

THEMES = [
    {
        "id": "rahmad-era",
        "title": "Era Rahmad Darmawan",
        "subtitle": "Pemain 2017 - 2019",
        "filter_type": "years_contains",
        "filter_value": ["2017", "2018", "2019"],
        "accent": "#D4AF37",
    },
    {
        "id": "legend-strikers",
        "title": "Legenda Striker",
        "subtitle": "Pemain depan Laskar Sape Kerap",
        "filter_type": "position",
        "filter_value": ["FWD"],
        "accent": "#C8102E",
    },
    {
        "id": "defense-wall",
        "title": "Tembok Pertahanan",
        "subtitle": "Para bek & kiper tangguh",
        "filter_type": "position",
        "filter_value": ["DEF", "GK"],
        "accent": "#1976D2",
    },
    {
        "id": "brazilian-legion",
        "title": "Legiun Brasil",
        "subtitle": "Pemain dari Negeri Samba",
        "filter_type": "previous_club_contains",
        "filter_value": ["Corinthians", "Botafogo", "Sao Paulo", "Flamengo", "Palmeiras"],
        "accent": "#2E7D32",
    },
    {
        "id": "liga-indonesia",
        "title": "Jebolan Liga Indonesia",
        "subtitle": "Pemain lokal lintas klub Liga 1",
        "filter_type": "previous_club_contains",
        "filter_value": ["Persija", "Arema", "Persipura", "Sriwijaya", "Mitra Kukar", "Barito"],
        "accent": "#F57C00",
    },
    {
        "id": "midfield-maestro",
        "title": "Jenderal Lini Tengah",
        "subtitle": "Gelandang terbaik Madura United",
        "filter_type": "position",
        "filter_value": ["MID"],
        "accent": "#C8102E",
    },
    {
        "id": "runner-up-2019",
        "title": "Skuad Runner-Up 2019",
        "subtitle": "Pemain era puncak Laskar Sape Kerap",
        "filter_type": "years_contains",
        "filter_value": ["2019", "2020"],
        "accent": "#D4AF37",
    },
    {
        "id": "foreign-stars",
        "title": "Bintang Asing",
        "subtitle": "Para legiuner Madura United",
        "filter_type": "foreign",
        "filter_value": True,
        "accent": "#1976D2",
    },
]


def pick_theme_for_week(week_key: str) -> dict:
    """week_key is 'YYYY-Wnn'. Rotate deterministically through THEMES."""
    try:
        wk = int(week_key.split("-W")[-1])
    except Exception:
        wk = 0
    return THEMES[wk % len(THEMES)]
