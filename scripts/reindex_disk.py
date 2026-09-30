# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "psycopg[binary]>=3.1",
# ]
# ///

import os
import sys
import re
from pathlib import Path
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import OPPORTUNITIES_DIR, db_conninfo
from db import init_schema



def parse_frontmatter(text: str) -> dict:
    meta = {}
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            fm = parts[1]
            for line in fm.strip().splitlines():
                if ":" in line and not line.strip().startswith("-"):
                    k, v = line.split(":", 1)
                    meta[k.strip()] = v.strip()
    return meta


def extract_section(text: str, heading: str) -> str:
    pattern = rf'##\s+{re.escape(heading)}\s*\n(.*?)(?=\n##|\Z)'
    m = re.search(pattern, text, re.DOTALL)
    return m.group(1).strip() if m else ""


def extract_list(text: str, heading: str) -> list:
    sec = extract_section(text, heading)
    items = []
    for line in sec.splitlines():
        line = line.strip()
        if line.startswith("- "):
            items.append(line[2:].strip())
    return items


def main():
    conn_info = db_conninfo()
    conn = psycopg.connect(conn_info)
    init_schema(conn)

    count = 0
    with conn.cursor() as cur:
        for root, dirs, files in os.walk(OPPORTUNITIES_DIR):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for f in sorted(files):
                if f.endswith(".md") and not f.endswith((".resume.md", ".rationale.md")) and f not in ("_intel.md", "PRODUCT.md", "DESIGN.md"):
                    full_p = Path(root) / f
                    rel_p = full_p.relative_to(OPPORTUNITIES_DIR)
                    content = full_p.read_text(encoding="utf-8", errors="ignore")
                    
                    fm = parse_frontmatter(content)
                    company = fm.get("company", rel_p.parent.name.replace("_", " "))
                    title = fm.get("title", f.replace(".md", "").replace("-", " ").title())
                    role_slug = fm.get("role_slug", f.replace(".md", ""))
                    score = int(fm.get("score", 0))
                    archetype = fm.get("archetype", "Executive")
                    url = fm.get("url", "")
                    work_arr = fm.get("work_arrangement", "Not specified")
                    comp = fm.get("compensation", "Not specified")
                    
                    # Extract sections
                    summary = extract_section(content, "Executive Summary")
                    strengths = extract_list(content, "Key Strengths Matched")
                    gaps = extract_list(content, "Gaps & Concessions")
                    benefits = extract_list(content, "Key Benefits & Perks")
                    raw_snippet = extract_section(content, "Original Job Posting") or extract_section(content, "Original Job Posting Snippet")
                    
                    # Determine status
                    if "_declined" in str(rel_p):
                        status = "declined"
                    elif "_weak" in str(rel_p):
                        status = "weak"
                    elif "_review" in str(rel_p) or (0 < score < 70):
                        status = "review"
                    else:
                        status = "filed"
                        
                    # Clean canonical url & req id
                    canon_url = url.split("?")[0].rstrip("/").lower() if url else ""
                    m_req = re.search(r'/jobs/(\d+)', url)
                    req_id = m_req.group(1) if m_req else None
                    
                    cur.execute("""
                        INSERT INTO opportunities (
                            role_slug, company, title, url, canonical_url, req_id,
                            score, archetype, status, work_arrangement, compensation,
                            benefits, summary, fit_strengths, gaps, raw_text, updated_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                        ON CONFLICT (role_slug) DO UPDATE SET
                            company = EXCLUDED.company,
                            title = EXCLUDED.title,
                            score = EXCLUDED.score,
                            archetype = EXCLUDED.archetype,
                            status = CASE WHEN opportunities.status IN ('applied', 'rejected', 'borderline', 'unverifiable', 'noise')
                                          THEN opportunities.status ELSE EXCLUDED.status END,
                            work_arrangement = EXCLUDED.work_arrangement,
                            compensation = EXCLUDED.compensation,
                            benefits = EXCLUDED.benefits,
                            summary = EXCLUDED.summary,
                            fit_strengths = EXCLUDED.fit_strengths,
                            gaps = EXCLUDED.gaps,
                            raw_text = CASE WHEN length(coalesce(EXCLUDED.raw_text, '')) >= length(coalesce(opportunities.raw_text, ''))
                                            THEN EXCLUDED.raw_text ELSE opportunities.raw_text END,
                            updated_at = CURRENT_TIMESTAMP;
                    """, (
                        role_slug, company, title, url, canon_url, req_id,
                        score, archetype, status, work_arr, comp,
                        benefits, summary, strengths, gaps, raw_snippet
                    ))
                    count += 1
        conn.commit()
    conn.close()
    print(f"Successfully reindexed {count} opportunities from disk into PostgreSQL.")


if __name__ == "__main__":
    main()
