"""
scripts/profile.py
The candidate profile (workspace/profile.json): who the candidate is, where and what they want,
how postings are scored, and resume preferences. Orientation drafts it; the dashboard edits it;
scout, tailor, and the PDF renderer read it.
"""

import json
import re
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from config import PROFILE_FILE, rel


class Candidate(BaseModel):
    name: str = Field(description="Full name as it should appear on a resume")
    headline: str = Field(description="Plain, stable professional headline, e.g. 'Director of Data Engineering'")
    location: str = Field(description="Home base as 'City, ST' or 'City, Country'")
    email: str = Field(description="Email address, or empty string")
    phone: str = Field(description="Phone number, or empty string")
    website: str = Field(description="Personal site without scheme, or empty string")
    linkedin: str = Field(description="LinkedIn path like 'linkedin.com/in/handle', or empty string")
    summary: str = Field(description="Three to five sentences on background, seniority, domains, and strongest evidence")


class Metro(BaseModel):
    key: str = Field(description="Short lowercase slug, e.g. 'chicago'")
    label: str = Field(description="Display label, e.g. 'Chicago, IL'")
    search: str = Field(description="Term to put in search queries, e.g. 'Chicago'")
    signal: str = Field(description="Case-insensitive Python regex of place names that indicate this metro, e.g. 'chicago|evanston|illinois|, il\\\\b'")


class Board(BaseModel):
    company: str
    ats: Literal["greenhouse", "ashby"]
    slug: str = Field(description="Board slug from boards.greenhouse.io/<slug> or jobs.ashbyhq.com/<slug>")


class Scope(BaseModel):
    key: str = Field(description="Short lowercase slug used on the command line, e.g. 'fintech'")
    label: str
    brief: str = Field(description="One paragraph telling a research agent which employers and roles to look for")
    queries: List[str] = Field(description="Three to six web search queries for open postings in this scope")
    location_gate: bool = Field(description="True to drop search results with no target-location signal before scoring")


class Search(BaseModel):
    country: str = Field(description="Country the candidate will work in, e.g. 'United States'")
    remote_ok: bool = Field(description="True if remote roles in that country are acceptable")
    metros: List[Metro] = Field(description="Target metro areas, home base first")
    title_keywords: List[str] = Field(description="Lowercase words; a posting title needs at least one unless the employer is a target company. Empty list disables the filter.")
    exclude_title_keywords: List[str] = Field(description="Lowercase words that disqualify a title, e.g. 'intern', 'sales development'")
    target_companies: List[str] = Field(description="Employers the candidate especially wants")
    boards: List[Board] = Field(description="Public Greenhouse or Ashby boards to sweep directly; only include slugs you are confident exist")
    scopes: List[Scope] = Field(description="Two to six search scopes covering the candidate's target sectors")
    exclude_domains: List[str] = Field(description="Domains that never host real postings for this search")


class Scoring(BaseModel):
    bullseye: List[str] = Field(description="Role families that score 88-100, each one sentence with example titles")
    strong_fit: str = Field(description="What a 70-87 role looks like for this candidate")
    priority_bonus: List[str] = Field(description="Employer types or sectors that earn extra weight")
    low_fit: List[str] = Field(description="Role types that score under 20 regardless of domain")


class ResumePrefs(BaseModel):
    positioning: str = Field(description="Default positioning angle for tailored resumes")
    rules: List[str] = Field(description="Candidate-specific truth rules the resume writer must follow, e.g. exact titles, tenure end dates, no degree claims")
    accent_color: str = Field(description="Hex color for PDF section headings, e.g. '#1d4ed8'")


class Profile(BaseModel):
    candidate: Candidate
    search: Search
    scoring: Scoring
    resume: ResumePrefs


class ProfileMissing(RuntimeError):
    pass


def load_profile(required: bool = True) -> Optional[Profile]:
    if not PROFILE_FILE.exists():
        if required:
            raise ProfileMissing(f"{rel(PROFILE_FILE)} not found. Run orientation in the dashboard (task dev) or `task orient -- build`.")
        return None
    return Profile.model_validate_json(PROFILE_FILE.read_text(encoding="utf-8"))


def save_profile(profile: Profile) -> None:
    PROFILE_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROFILE_FILE.write_text(json.dumps(profile.model_dump(), indent=2) + "\n", encoding="utf-8")


def contact_items(c: Candidate) -> List[tuple]:
    """(visible text, href or None) for each contact field that is set, in display order."""
    items: List[tuple] = []
    if c.location:
        items.append((c.location, None))
    if c.email:
        items.append((c.email, f"mailto:{c.email}"))
    if c.phone:
        items.append((c.phone, "tel:+" + re.sub(r"\D", "", c.phone) if re.sub(r"\D", "", c.phone) else None))
    for site in (c.website, c.linkedin):
        if site:
            bare = re.sub(r"^https?://(www\.)?", "", site).rstrip("/")
            items.append((bare, f"https://{bare}"))
    return items


def contact_line(c: Candidate) -> str:
    return " · ".join(f"[{text}]({href})" if href else text for text, href in contact_items(c))


def location_text(p: Profile, keys: Optional[List[str]] = None) -> str:
    metros = [m for m in p.search.metros if not keys or m.key in keys]
    parts = [m.label for m in metros]
    if p.search.remote_ok:
        parts.append(f"or explicitly remote-eligible from {p.search.country}")
    return "; ".join(parts) if parts else f"anywhere in {p.search.country}"
