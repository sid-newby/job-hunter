"""
scripts/config.py
Settings shared by every entrypoint: paths, .env values, database connection, and model selection.

Lookup order for a setting: process environment, then the repository .env file (re-read when it changes),
then the built-in default. The dashboard edits .env, so values it saves take effect on the next call.
"""

import getpass
import os
import re
from pathlib import Path
from typing import Dict, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = Path(os.environ.get("JOB_HUNTER_ENV_FILE") or REPO_ROOT / ".env")
WORKSPACE = Path(os.environ.get("JOB_HUNTER_WORKSPACE") or REPO_ROOT / "workspace")
OPPORTUNITIES_DIR = WORKSPACE / "opportunities"
REVIEW_DIR = OPPORTUNITIES_DIR / "_review"
DECLINED_DIR = OPPORTUNITIES_DIR / "_declined"
WEAK_DIR = OPPORTUNITIES_DIR / "_weak"
UPLOADS_DIR = WORKSPACE / "uploads"
HISTORY_DIR = WORKSPACE / ".history"
PROFILE_FILE = WORKSPACE / "profile.json"
FACTS_FILE = WORKSPACE / "facts.md"
VOICE_FILE = WORKSPACE / "voice.md"
SKILLS_FILE = WORKSPACE / "skills.md"
RECOMMENDATIONS_FILE = WORKSPACE / "recommendations.md"
INTERVIEW_FILE = WORKSPACE / "interview.md"
TARGET_URLS_FILE = WORKSPACE / "target_urls.txt"

PROVIDERS = ("openrouter", "claude-code")
ROLES = ("discovery", "qualify", "tailor", "orient")

DEFAULT_MODELS: Dict[str, Dict[str, str]] = {
    "openrouter": {
        "default": "openai/gpt-6-luna",
        "qualify": "openai/gpt-6-luna:batch",
    },
    "claude-code": {
        "default": "claude-opus-4-8",
    },
}
DEFAULT_EFFORTS = {"discovery": "medium", "qualify": "low", "tailor": "high", "orient": "high"}

_env_cache: Tuple[float, Dict[str, str]] = (-1.0, {})


def parse_env_text(text: str) -> Dict[str, str]:
    values: Dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip().removeprefix("export ").strip()
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        values[key] = val
    return values


def env_file_values() -> Dict[str, str]:
    global _env_cache
    try:
        mtime = ENV_FILE.stat().st_mtime
    except FileNotFoundError:
        return {}
    if mtime != _env_cache[0]:
        _env_cache = (mtime, parse_env_text(ENV_FILE.read_text(encoding="utf-8")))
    return _env_cache[1]


def env(key: str, default: str = "") -> str:
    val = os.environ.get(key)
    if val not in (None, ""):
        return val
    return env_file_values().get(key, default) or default


def write_env(updates: Dict[str, Optional[str]]) -> None:
    """Sets or removes (value None) keys in .env, keeping comments and unrelated lines in place."""
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.exists() else []
    pending = dict(updates)
    out = []
    for line in lines:
        m = re.match(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
        if m and m.group(1) in pending:
            val = pending.pop(m.group(1))
            if val is not None:
                out.append(f"{m.group(1)}={val}")
            continue
        out.append(line)
    for key, val in pending.items():
        if val is not None:
            out.append(f"{key}={val}")
    ENV_FILE.write_text("\n".join(out).rstrip("\n") + "\n", encoding="utf-8")
    try:
        ENV_FILE.chmod(0o600)
    except OSError:
        pass


def provider() -> str:
    p = env("LLM_PROVIDER", "openrouter").strip().lower()
    return p if p in PROVIDERS else "openrouter"


def _prefix(p: str) -> str:
    return "OPENROUTER" if p == "openrouter" else "CLAUDE"


def model_for(role: str, p: Optional[str] = None) -> str:
    """Resolves {PROVIDER}_{ROLE}_MODEL, then {PROVIDER}_MODEL, then the built-in default for that provider and role."""
    p = p or provider()
    pre = _prefix(p)
    defaults = DEFAULT_MODELS[p]
    return env(f"{pre}_{role.upper()}_MODEL") or env(f"{pre}_MODEL") or defaults.get(role) or defaults["default"]


def effort_for(role: str) -> str:
    return env(f"{role.upper()}_EFFORT", DEFAULT_EFFORTS.get(role, "medium"))


def db_settings() -> Dict[str, str]:
    return {
        "host": env("PGHOST", "localhost"),
        "port": env("PGPORT", "5432"),
        "dbname": env("PGDATABASE", "job_hunter"),
        "user": env("PGUSER", getpass.getuser()),
        "password": env("PGPASSWORD", ""),
    }


def db_conninfo(dbname: Optional[str] = None) -> str:
    s = db_settings()
    parts = [f"host={s['host']}", f"port={s['port']}", f"dbname={dbname or s['dbname']}", f"user={s['user']}"]
    if s["password"]:
        parts.append(f"password={s['password']}")
    return " ".join(parts)


def rel(p: Path) -> str:
    try:
        return str(p.relative_to(REPO_ROOT))
    except ValueError:
        return str(p)


def company_dirname(company: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_\-]", "", company.replace(" ", "_")) or "Unknown"
