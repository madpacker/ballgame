"""Seed Timnas Indonesia players from 2010-2026 into quiz_items (category=garuda).

Sources:
- https://www.transfermarkt.com/indonesia/erweiterterkader/verein/13958/plus/1  (36 current / recent)
- https://www.transfermarkt.com/indonesia/kader/verein/13958/saison_id/2013     (2010-2015 era)

Players without an actual Transfermarkt portrait photo are intentionally excluded
because this is a "tebak gambar" (guess the picture) quiz.

Usage:
    python3 /app/backend/seed_timnas.py
    python3 /app/backend/seed_timnas.py --force   # reseed, soft-deletes old garuda items
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

POS_LABEL = {"GK": "Kiper", "DEF": "Bek", "MID": "Gelandang", "FWD": "Penyerang"}

# Each entry: (name, position, era_tag, photo_filename)
# photo_filename is the "{player_id}-{lm}.jpg|png|jpeg" segment from Transfermarkt.
TIMNAS_PLAYERS: list[tuple[str, str, str, str]] = [
    # ----- Current / Extended squad (2024-2026) -----
    ("Emil Audero", "GK", "2024-2026", "256339-1663679682.jpg"),
    ("Maarten Paes", "GK", "2024-2026", "396077-1740506730.jpg"),
    ("Nadeo Argawinata", "GK", "2021-2026", "506141-1737545403.png"),
    ("Cahya Supriadi", "GK", "2024-2026", "875194-1779412586.jpg"),
    ("Muhamad Riyandi", "GK", "2021-2026", "501148-1689561268.jpg"),
    ("Ernando Ari", "GK", "2022-2025", "683488-1708091095.jpg"),
    ("Jay Idzes", "DEF", "2024-2026", "546926-1781679094.jpg"),
    ("Kevin Diks", "DEF", "2024-2026", "335209-1760966816.jpg"),
    ("Elkan Baggott", "DEF", "2021-2026", "758030-1668433994.jpg"),
    ("Justin Hubner", "DEF", "2024-2026", "678641-1764159388.png"),
    ("Rizky Ridho", "DEF", "2021-2026", "734648-1734334228.jpeg"),
    ("Jordi Amat", "DEF", "2022-2026", "85289-1541150488.jpg"),
    ("Dion Markx", "DEF", "2026", "930986-1771822133.jpeg"),
    ("Wahyu Prasetyo", "DEF", "2023-2026", "719822-1753882421.png"),
    ("Muhammad Ferarri", "DEF", "2022-2026", "824649-1755664937.jpeg"),
    ("Brian Fatari", "DEF", "2026", "928131-1739595929.png"),
    ("Calvin Verdonk", "DEF", "2024-2026", "258364-1723716421.jpg"),
    ("Dean James", "DEF", "2025-2026", "529223-1763723012.jpg"),
    ("Nathan Tjoe-A-On", "DEF", "2024-2026", "606023-1785596552.jpg"),
    ("Shayne Pattynama", "DEF", "2023-2026", "409335-1706869174.jpg"),
    ("Dony Tri Pamungkas", "DEF", "2024-2026", "939539-1792377332.jpeg"),
    ("Tim Geypens", "DEF", "2026", "880604-1760619105.jpg"),
    ("Mathew Baker", "DEF", "2026", "1275360-1762398653.jpg"),
    ("Sandy Walsh", "DEF", "2023-2026", "187329-1705489109.jpg"),
    ("Eliano Reijnders", "DEF", "2024-2026", "538057-1756360506.jpg"),
    ("Asnawi Mangkualam", "DEF", "2021-2026", "686920-1708091209.jpg"),
    ("Pratama Arhan", "DEF", "2021-2026", "686921-1708091239.jpg"),
    ("Thom Haye", "MID", "2024-2026", "178219-1789636671.png"),
    ("Joey Pelupessy", "MID", "2025-2026", "187293-1723456380.jpg"),
    ("Marc Klok", "MID", "2022-2026", "272708-1789636624.png"),
    ("Ivar Jenner", "MID", "2023-2026", "656796-1753297913.jpg"),
    ("Kadek Agung", "MID", "2021-2026", "597136-1737534938.png"),
    ("Rayhan Hannan", "MID", "2024-2026", "1024630-1779117791.jpeg"),
    ("Marselino Ferdinan", "MID", "2022-2026", "875219-1692895052.jpg"),
    ("Ragnar Oratmangoen", "FWD", "2024-2026", "410854-1789636282.png"),
    ("Saddil Ramdani", "FWD", "2017-2026", "506303-1759335571.jpg"),
    ("Rizky Eka Pratama", "FWD", "2026", "697701-1770713163.jpeg"),
    ("Beckham Putra", "FWD", "2025-2026", "662777-1737431497.png"),
    ("Yakob Sayuri", "FWD", "2021-2026", "663274-1758705805.jpg"),
    ("Luke Vickery", "FWD", "2026", "1234443-1775631898.jpg"),
    ("Egy Maulana Vikri", "FWD", "2018-2026", "548371-1771969248.png"),
    ("Ole Romeny", "FWD", "2025-2026", "361070-1682331084.jpg"),
    ("Ramadhan Sananta", "FWD", "2022-2026", "971960-1689735521.jpg"),
    ("Mitchell Baker", "FWD", "2026", "1552927-1785303784.jpg"),
    ("Mauro Zijlstra", "FWD", "2025-2026", "935250-1758624934.jpg"),
    ("Jens Raven", "FWD", "2026", "1158008-1721226576.jpg"),
    # ----- Historic 2010-2015 era (Transfermarkt 2013 squad) -----
    ("Wahyu Tri Nugroho", "GK", "2013-2015", "252682-1621305934.jpg"),
    ("Kurnia Meiga", "GK", "2010-2015", "185403-1710164765.jpeg"),
    ("Made Wirawan", "GK", "2010-2015", "204130-1615690810.jpg"),
    ("Jandia", "GK", "2013-2015", "294609-1615952890.jpg"),
    ("Andritany", "GK", "2013-2020", "323470-1634793503.jpg"),
    ("Ricardo Salampessy", "DEF", "2010-2015", "64579-1643696099.jpg"),
    ("Muhammad Roby", "DEF", "2010-2015", "64575-1661923597.jpg"),
    ("Maman Abdurahman", "DEF", "2010-2014", "192476-1637573219.jpg"),
    ("Victor Igbonefo", "DEF", "2013-2020", "148073-1737430988.png"),
    ("Fachruddin Aryanto", "DEF", "2013-2022", "252643-1737697920.png"),
    ("Achmad Jufriyanto", "DEF", "2013-2018", "64556-1737430859.png"),
    ("Hasim Kipuw", "DEF", "2013-2016", "285473-1741245015.png"),
    ("Ngurah Nanak", "DEF", "2013-2014", "298875-1613752065.jpg"),
    ("Hamka Hamzah", "DEF", "2010-2015", "206896-1617851539.jpg"),
    ("Novan Sasongko", "DEF", "2013-2015", "252687-1754567852.png"),
    ("Ruben Sanadi", "DEF", "2013-2017", "285478-1760075248.png"),
    ("Supardi Nasir", "DEF", "2013-2018", "201663-1739711667.png"),
    ("Yustinus Pae", "DEF", "2013-2017", "148079-1760075488.png"),
    ("Zulkifli Syukur", "DEF", "2010-2015", "185408-1646635436.jpg"),
    ("Beny Wahyudi", "DEF", "2010-2016", "185410-1639196394.jpeg"),
    ("Ian Kabes", "MID", "2013-2018", "64557-1760075930.png"),
    ("Muhammad Taufiq", "MID", "2013-2016", "218030-1702284892.jpeg"),
    ("Tony Sucipto", "MID", "2013-2018", "192483-1741248257.png"),
    ("Hendro Siswanto", "MID", "2013-2018", "505888-1737545020.png"),
    ("Ahmad Bustomi", "MID", "2010-2016", "185416-1776348898.jpeg"),
    ("Rasyid Bakri", "MID", "2013-2017", "252711-1770713099.png"),
    ("Raphael Maitimo", "MID", "2013-2016", "252671-1617849618.jpg"),
    ("Imanuel Wanggai", "MID", "2010-2015", "64595-1613431393.jpg"),
    ("Slamet Nurcahyono", "MID", "2013-2015", "218031-1702464651.png"),
    ("Stefano Lilipaly", "FWD", "2013-2020", "195271-1737545052.png"),
    ("Greg Nwokolo", "FWD", "2013-2016", "128174-1702636951.png"),
    ("Oktovianus Maniani", "FWD", "2010-2014", "192478-1613751026.jpg"),
    ("Boaz Solossa", "FWD", "2010-2016", "148088-1760077075.png"),
    ("Irfan Bachdim", "FWD", "2010-2018", "68944-1663741693.png"),
    ("Andik Vermansyah", "FWD", "2010-2017", "252717-1738255616.png"),
    ("Ferdinan Sinaga", "FWD", "2013-2018", "206997-1617769072.jpg"),
    ("Samsul Arif", "FWD", "2013-2016", "207084-1617851330.jpg"),
    ("Titus Bonai", "FWD", "2010-2014", "264237-1613432537.jpg"),
]


def _photo_url(filename: str) -> str:
    # Transfermarkt serves big/medium/small sizes. We use "big" for quiz clarity.
    return f"https://img.a.transfermarkt.technology/portrait/big/{filename}?lm=1"


async def seed(force: bool = False):
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME", "test_database")
    if not mongo_url:
        print("MONGO_URL not set", file=sys.stderr)
        sys.exit(1)
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    existing = await db.quiz_items.count_documents(
        {"category": "garuda", "deleted_at": {"$exists": False}}
    )
    if existing and not force:
        print(f"[skip] {existing} garuda item(s) already present. Use --force to replace.")
        return
    if force and existing:
        res = await db.quiz_items.update_many(
            {"category": "garuda", "deleted_at": {"$exists": False}},
            {"$set": {"deleted_at": datetime.now(timezone.utc)}},
        )
        print(f"[reset] soft-deleted {res.modified_count} existing garuda item(s).")

    names = [p[0] for p in TIMNAS_PLAYERS]
    now = datetime.now(timezone.utc)
    docs: list[dict] = []
    rnd = random.Random(42)

    for idx, (name, pos, era, photo_file) in enumerate(TIMNAS_PLAYERS):
        distractors = [n for n in names if n != name]
        rnd.shuffle(distractors)
        options = [name, *distractors[:3]]
        rnd.shuffle(options)
        answer_index = options.index(name)
        prompt = (
            f"Siapa pemain Timnas Indonesia era {era} ini? "
            f"({POS_LABEL[pos]})"
        )
        docs.append(
            {
                "item_id": f"qi_{uuid.uuid4().hex[:12]}",
                "category": "garuda",
                "prompt": prompt,
                "image_url": _photo_url(photo_file),
                "options": options,
                "answer_index": answer_index,
                "active": True,
                "order_index": idx,
                "created_at": now,
                "updated_at": now,
                "created_by": "seed:timnas_2010_2026",
                "player_name": name,
                "player_position": pos,
                "player_era": era,
            }
        )

    if docs:
        await db.quiz_items.insert_many(docs)
    print(f"[ok] inserted {len(docs)} Timnas Indonesia quiz items (2010-2026 era).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    asyncio.run(seed(force=args.force))
