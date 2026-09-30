"""
scripts/browser_extract.py
agent-browser (Rust CLI, headless Chrome via CDP) fallback for job postings that Tavily and
plain HTTP cannot read: JavaScript-rendered ATS pages (Workday, iCIMS, Taleo, SPAs). Optional: without
agent-browser on PATH every fetch reports 'unavailable' and callers fall back to what they have.

fetch_posting_text(url) renders the page, waits for network idle, picks the largest content
container, and returns cleaned text. Each call uses its own session so calls can run in parallel.
"""

import json
import re
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent

STUB_MIN_CHARS = 600
STUB_KEYWORDS = re.compile(r"responsibilit|qualification|requirement|experience|what you.ll do|about the role|we are looking", re.I)

PICK_MAIN_JS = r"""
(() => {
  const sel = 'main, article, [role="main"], #content, #main, .job-description, .jobdescription, .job-details, [class*="job-detail"], [class*="jobDetail"], [class*="jobDescription"], [class*="posting"], [data-automation-id="jobPostingDescription"], [id*="job"]';
  const cands = [...document.querySelectorAll(sel)];
  let best = null, bestLen = 0;
  for (const el of cands) { const t = (el.innerText || '').trim(); if (t.length > bestLen) { best = el; bestLen = t.length; } }
  const body = (document.body.innerText || '').trim();
  const text = (best && bestLen > 800) ? best.innerText : body;
  return JSON.stringify({title: document.title, len: text.length, text});
})()
"""

BOT_WALL = re.compile(r"just a moment|403 forbidden|access denied|security verification|verify (that )?you are (a )?human|enable javascript and cookies|attention required|request blocked|pardon our interruption", re.I)
CLOSED_POSTING = re.compile(r"page doesn'?t exist|this page doesn'?t|no longer available|no longer accepting|position has been filled|job has expired|this job is no longer|posting has closed|job not found|page not found|404", re.I)
CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"

BOILERPLATE_LINE = re.compile(
    r"^(share (this )?job|share .* with (facebook|linkedin|twitter|x)\b|apply now|back to search results|save job|"
    r"caution against fraudulent|accept (all )?cookies|cookie settings|we use cookies|skip to main content|sign in|log in|"
    r"privacy policy|terms of use|©|all rights reserved)",
    re.I,
)


def agent_browser_available() -> bool:
    return shutil.which("agent-browser") is not None


def is_stub(text: Optional[str]) -> bool:
    t = (text or "").strip()
    return len(t) < STUB_MIN_CHARS or not STUB_KEYWORDS.search(t)


def normalize_fetch_url(url: str) -> str:
    """Drops tracking params and ATS 'apply' suffixes so we land on the posting page, not the form."""
    u = url.strip()
    u = re.sub(r"[?&](utm_[a-z]+|source|src|iis|iisn|gh_src|ref|referrer)=[^&#]*", "", u)
    u = re.sub(r"\?&", "?", u).rstrip("?&")
    u = re.sub(r"(jobs\.ashbyhq\.com/[^/]+/[0-9a-f-]{36})/application$", r"\1", u)
    u = re.sub(r"(greenhouse\.io/[^/]+/jobs/\d+)/?#app$", r"\1", u)
    return u


def _clean(text: str) -> str:
    lines = []
    for raw in text.splitlines():
        line = re.sub(r"[ \t]+", " ", raw).strip()
        if not line or BOILERPLATE_LINE.match(line):
            continue
        lines.append(line)
    out = "\n".join(lines)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def _eval_page(base: List[str], timeout: int) -> Dict[str, Any]:
    res = subprocess.run(base + ["eval", "--stdin"], input=PICK_MAIN_JS, capture_output=True, text=True, timeout=timeout)
    raw = res.stdout.strip()
    if not raw:
        return {}
    data = json.loads(raw)
    if isinstance(data, str):
        data = json.loads(data)
    return data if isinstance(data, dict) else {}


def fetch_posting(url: str, timeout: int = 45, max_chars: int = 20000) -> Dict[str, Any]:
    """Renders the posting page. Returns {"status": ok|bot_wall|closed|empty|unavailable|error, "text": str, "url": str}."""
    if not url or not url.startswith("http"):
        return {"status": "empty", "text": "", "url": url}
    if not agent_browser_available():
        return {"status": "unavailable", "text": "", "url": url}
    target = normalize_fetch_url(url)
    session = f"jobs-{uuid.uuid4().hex[:8]}"
    base = ["agent-browser", "--session", session]
    try:
        subprocess.run(base + ["set", "headers", json.dumps({"User-Agent": CHROME_UA, "Accept-Language": "en-US,en;q=0.9"})], capture_output=True, text=True, timeout=timeout)
        subprocess.run(base + ["open", target], capture_output=True, text=True, timeout=timeout)
        subprocess.run(base + ["wait", "--load", "networkidle"], capture_output=True, text=True, timeout=timeout)
        data = _eval_page(base, timeout)
        head = f"{data.get('title', '')}\n{str(data.get('text', ''))[:600]}"
        if BOT_WALL.search(head) and len(str(data.get("text", ""))) < 1500:
            subprocess.run(base + ["wait", "8000"], capture_output=True, text=True, timeout=timeout)
            data = _eval_page(base, timeout)
            head = f"{data.get('title', '')}\n{str(data.get('text', ''))[:600]}"
            if BOT_WALL.search(head) and len(str(data.get("text", ""))) < 1500:
                return {"status": "bot_wall", "text": "", "url": target}
        text = _clean(str(data.get("text", "")))
        title = str(data.get("title", "")).strip()
        if title and title.lower() not in text[:300].lower():
            text = f"{title}\n\n{text}"
        if is_stub(text) and CLOSED_POSTING.search(head):
            return {"status": "closed", "text": text[:max_chars], "url": target}
        if not text:
            return {"status": "empty", "text": "", "url": target}
        return {"status": "ok" if not is_stub(text) else "empty", "text": text[:max_chars], "url": target}
    except Exception as e:
        print(f"agent-browser fetch failed for {target}: {e}", file=sys.stderr)
        return {"status": "error", "text": "", "url": target}
    finally:
        try:
            subprocess.run(base + ["close"], capture_output=True, text=True, timeout=15)
        except Exception:
            pass


def fetch_posting_text(url: str, timeout: int = 45, max_chars: int = 20000) -> str:
    """Returns cleaned posting text, or '' when the page is blocked, closed, or empty. Never raises."""
    res = fetch_posting(url, timeout=timeout, max_chars=max_chars)
    return res["text"] if res["status"] == "ok" else ""


def update_posting_record(opp_path: Path, text: str, url: str) -> None:
    """Rewrites the opportunity file's posting section and the DB raw_text with freshly fetched text."""
    from datetime import date

    if opp_path.exists():
        s = opp_path.read_text(encoding="utf-8")
        marker = None
        for m in ("## Original Job Posting Snippet", "## Original Job Posting"):
            if m in s:
                marker = m
                break
        head = s.split(marker, 1)[0] if marker else s.rstrip() + "\n\n"
        s = head + f"## Original Job Posting\n\nSource: {url} (fetched with agent-browser {date.today().isoformat()})\n\n{text}\n"
        opp_path.write_text(s, encoding="utf-8")

    slug = opp_path.name.replace(".md", "")
    if "--" in slug:
        slug = slug.split("--", 1)[1]
    try:
        import psycopg
        from config import db_conninfo
        with psycopg.connect(db_conninfo()) as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE opportunities SET raw_text = %s, updated_at = CURRENT_TIMESTAMP WHERE role_slug = %s;", (text[:20000], slug))
    except Exception as e:
        print(f"DB raw_text update skipped ({e})", file=sys.stderr)
