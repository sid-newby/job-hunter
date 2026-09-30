# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "psycopg[binary]>=3.1",
# ]
# ///
"""Backfills readable text into opportunities whose posting snippet was stored as escaped HTML.
Rewrites the '## Original Job Posting Snippet' section of each workspace/opportunities/**/*.md and the
raw_text column in PostgreSQL. Idempotent; plain-text rows are left untouched."""
import os
import re
import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import OPPORTUNITIES_DIR, db_conninfo, db_settings
from htmltext import html_to_text, looks_like_html

SNIPPET_RE = re.compile(r'(## Original Job Posting(?: Snippet)?\n)(.*)\Z', re.DOTALL)


def clean_markdown() -> int:
    changed = 0
    for path in OPPORTUNITIES_DIR.rglob("*.md"):
        if path.name.endswith((".resume.md", ".rationale.md")) or ".job-scout" in path.parts:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        m = SNIPPET_RE.search(text)
        if not m or not looks_like_html(m.group(2)):
            continue
        path.write_text(text[:m.start(2)] + html_to_text(m.group(2)) + "\n", encoding="utf-8")
        changed += 1
    return changed


def clean_postgres() -> int:
    changed = 0
    conn_info = db_conninfo()
    with psycopg.connect(conn_info) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, raw_text FROM opportunities WHERE raw_text IS NOT NULL;")
            rows = cur.fetchall()
            for opp_id, raw in rows:
                if looks_like_html(raw):
                    cur.execute("UPDATE opportunities SET raw_text = %s WHERE id = %s;", (html_to_text(raw), opp_id))
                    changed += 1
        conn.commit()
    return changed


if __name__ == "__main__":
    md = clean_markdown()
    print(f"Cleaned {md} markdown snippet(s) under workspace/opportunities/.")
    try:
        pg = clean_postgres()
        print(f"Cleaned {pg} raw_text row(s) in PostgreSQL '{db_settings()['dbname']}'.")
    except Exception as e:
        print(f"Notice: PostgreSQL unavailable ({e}); markdown only.")
