"""Iter25 helper: print fetch-url output for a few Google News items to eyeball body cleanliness."""
import os
import re
import sys

import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
H = {"Authorization": "Bearer TEST_tok_it25_admin"}
n = int(sys.argv[1]) if len(sys.argv) > 1 else 6
t = requests.get("https://news.google.com/rss/search?q=madura+united&hl=id&gl=ID&ceid=ID:id", timeout=20).text
for title, link in re.findall(r"<item><title>(.*?)</title><link>(.*?)</link>", t)[:n]:
    r = requests.post(f"{BASE}/api/admin/news/fetch-url", headers=H, json={"url": link}, timeout=120)
    print("=" * 80)
    print(r.status_code, "|", title[:90])
    if r.status_code != 200:
        print(r.text[:200])
        continue
    d = r.json()
    print("TITLE:", d["title"])
    print("SOURCE:", d["source_name"], d["source_url"][:100])
    print("COVER:", d["cover_url"])
    print("BODY len", len(d["body"]))
    for ln in d["body"].split("\n\n"):
        print("  |", ln[:140])
