# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "fastapi",
#     "uvicorn",
#     "psycopg[binary]>=3.1",
#     "pydantic",
#     "httpx",
#     "python-multipart",
#     "pypdf",
#     "python-docx",
# ]
# ///

"""
ui/server.py
FastAPI backend for the dashboard: orientation and settings, opportunity reads and status moves,
and background jobs that run scripts/scout.py, tailor.py, and orient.py as subprocesses.

Runs via `uv run --script ui/server.py` on 127.0.0.1:58880.
"""

import asyncio
import json
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, ValidationError

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

import artifacts
import db
import tavily
from candidate_profile import Profile, load_profile, save_profile
from config import (DECLINED_DIR, DEFAULT_MODELS, FACTS_FILE, INTERVIEW_FILE, OPPORTUNITIES_DIR, PROVIDERS, RECOMMENDATIONS_FILE,
                    ROLES, SKILLS_FILE, VOICE_FILE, company_dirname, db_settings, env, env_file_values, model_for, provider, write_env)

APP_NAME = "Job Hunter"
app = FastAPI(title=f"{APP_NAME} API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:58888", "http://127.0.0.1:58888"],
    allow_methods=["*"],
    allow_headers=["*"],
)

LOCATION_HAYSTACK = (
    "CASE WHEN COALESCE(location,'') NOT IN ('', 'Not specified') "
    "THEN location || ' ' || COALESCE(work_arrangement,'') "
    "ELSE COALESCE(work_arrangement,'') || ' ' || url || ' ' || COALESCE(raw_text,'') END"
)


def find_opportunity_file(slug: str) -> Optional[Path]:
    for pattern in (f"**/{slug}.md", f"**/*--{slug}.md"):
        for f in OPPORTUNITIES_DIR.glob(pattern):
            if not f.name.endswith((".resume.md", ".rationale.md", ".resume.rejected.md")):
                return f
    return None


def get_db():
    return db.connect()


def pg_regex(py_regex: str) -> str:
    """Python word boundaries (\\b) become PostgreSQL ARE boundaries (\\y)."""
    return py_regex.replace(r"\b", r"\y")


def metro_filters() -> Dict[str, str]:
    prof = current_profile()
    filters = {m.key: pg_regex(m.signal) for m in (prof.search.metros if prof else []) if m.signal}
    filters["remote"] = r"\mremote\M"
    filters["targets"] = "|".join(f"({p})" for p in filters.values())
    return filters


def current_profile() -> Optional[Profile]:
    try:
        return load_profile(required=False)
    except Exception as e:
        print(f"profile.json is unreadable: {e}", file=sys.stderr)
        return None


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def key_hint(value: str) -> str:
    return f"{value[:5]}…{value[-4:]}" if len(value) > 12 else ("set" if value else "")


# ---------------------------------------------------------------------------
# Background jobs: scripts run in a thread; the UI polls /api/jobs/{id}.
# ---------------------------------------------------------------------------
JOBS: Dict[str, Dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()
JOB_TTL_SECONDS = 6 * 3600


def _prune_jobs() -> None:
    cutoff = time.time() - JOB_TTL_SECONDS
    with JOBS_LOCK:
        for jid in [j for j, v in JOBS.items() if v.get("finished_at") and v["finished_at"] < cutoff]:
            JOBS.pop(jid, None)


def start_job(kind: str, cmd: List[str], on_done, meta: Optional[Dict[str, Any]] = None) -> str:
    """Runs cmd in a thread, streaming stdout+stderr lines into the job log. on_done(job, returncode, stdout) fills the result."""
    _prune_jobs()
    job_id = uuid.uuid4().hex[:12]
    job: Dict[str, Any] = {
        "id": job_id, "kind": kind, "status": "running", "log": [], "result": None, "error": None,
        "started_at": time.time(), "finished_at": None, "meta": meta or {},
    }
    with JOBS_LOCK:
        JOBS[job_id] = job

    def run() -> None:
        lines: List[str] = []
        try:
            proc = subprocess.Popen(
                cmd, cwd=str(REPO_ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
                env={**os.environ, "PYTHONUNBUFFERED": "1"},
            )
            assert proc.stdout is not None
            for line in proc.stdout:
                line = line.rstrip("\n")
                lines.append(line)
                with JOBS_LOCK:
                    job["log"].append(line)
                    if len(job["log"]) > 400:
                        del job["log"][:-400]
            rc = proc.wait()
            result = on_done(job, rc, "\n".join(lines))
            with JOBS_LOCK:
                job["result"] = result
                job["status"] = "done" if rc == 0 else "error"
                if rc != 0 and not job.get("error"):
                    job["error"] = "\n".join(lines[-40:])
        except Exception as e:
            with JOBS_LOCK:
                job["status"] = "error"
                job["error"] = str(e)
        finally:
            with JOBS_LOCK:
                job["finished_at"] = time.time()

    threading.Thread(target=run, name=f"job-{kind}-{job_id}", daemon=True).start()
    return job_id


def script_cmd(name: str, *args: str) -> List[str]:
    return ["uv", "run", "--script", str(SCRIPTS / name), *args]


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found or expired")
        return {
            "id": job["id"], "kind": job["kind"], "status": job["status"], "log": job["log"][-120:],
            "result": job["result"], "error": job["error"], "elapsed_s": int((job["finished_at"] or time.time()) - job["started_at"]),
            "meta": job["meta"],
        }


# ---------------------------------------------------------------------------
# Orientation and settings
# ---------------------------------------------------------------------------
def settings_payload() -> Dict[str, Any]:
    file_vals = env_file_values()
    or_key, tv_key = env("OPENROUTER_API_KEY"), env("TAVILY_API_KEY")
    overrides: Dict[str, Dict[str, str]] = {}
    for p, pre in (("openrouter", "OPENROUTER"), ("claude-code", "CLAUDE")):
        vals = {"default": env(f"{pre}_MODEL")}
        vals.update({r: env(f"{pre}_{r.upper()}_MODEL") for r in ROLES})
        overrides[p] = {k: v for k, v in vals.items() if v}
    s = db_settings()
    return {
        "provider": provider(),
        "openrouter_key_set": bool(or_key), "openrouter_key_hint": key_hint(or_key),
        "tavily_key_set": bool(tv_key), "tavily_key_hint": key_hint(tv_key),
        "models": {p: {r: model_for(r, p) for r in ROLES} for p in PROVIDERS},
        "model_overrides": overrides,
        "defaults": {p: {r: DEFAULT_MODELS[p].get(r, DEFAULT_MODELS[p]["default"]) for r in ROLES} for p in PROVIDERS},
        "db": {"host": s["host"], "port": s["port"], "dbname": s["dbname"], "user": s["user"], "password_set": bool(s["password"])},
        "env_file": bool(file_vals),
    }


class DbUpdate(BaseModel):
    host: Optional[str] = None
    port: Optional[str] = None
    dbname: Optional[str] = None
    user: Optional[str] = None
    password: Optional[str] = None


class SettingsUpdate(BaseModel):
    provider: Optional[str] = None
    openrouter_api_key: Optional[str] = None
    tavily_api_key: Optional[str] = None
    models: Optional[Dict[str, Dict[str, str]]] = None
    db: Optional[DbUpdate] = None


@app.get("/api/settings")
def get_settings():
    return settings_payload()


@app.post("/api/settings")
def update_settings(req: SettingsUpdate):
    updates: Dict[str, Optional[str]] = {}
    if req.provider is not None:
        if req.provider not in PROVIDERS:
            raise HTTPException(status_code=422, detail=f"provider must be one of {', '.join(PROVIDERS)}")
        updates["LLM_PROVIDER"] = req.provider
    for field, key in (("openrouter_api_key", "OPENROUTER_API_KEY"), ("tavily_api_key", "TAVILY_API_KEY")):
        val = (getattr(req, field) or "").strip()
        if val:
            if re.search(r"\s", val):
                raise HTTPException(status_code=422, detail=f"{key} must not contain whitespace")
            updates[key] = val
    for p, roles in (req.models or {}).items():
        if p not in PROVIDERS:
            raise HTTPException(status_code=422, detail=f"Unknown provider '{p}'")
        pre = "OPENROUTER" if p == "openrouter" else "CLAUDE"
        for role, mid in roles.items():
            if role != "default" and role not in ROLES:
                raise HTTPException(status_code=422, detail=f"Unknown role '{role}'")
            name = f"{pre}_MODEL" if role == "default" else f"{pre}_{role.upper()}_MODEL"
            mid = (mid or "").strip()
            if re.search(r"\s", mid):
                raise HTTPException(status_code=422, detail=f"Model id '{mid}' must not contain whitespace")
            updates[name] = mid or None
    if req.db:
        for field, key in (("host", "PGHOST"), ("port", "PGPORT"), ("dbname", "PGDATABASE"), ("user", "PGUSER"), ("password", "PGPASSWORD")):
            val = getattr(req.db, field)
            if val is not None:
                val = val.strip()
                if key == "PGDATABASE" and val and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,62}", val):
                    raise HTTPException(status_code=422, detail="Database name must be letters, digits, and underscores")
                if key == "PGPORT" and val and not val.isdigit():
                    raise HTTPException(status_code=422, detail="Port must be a number")
                updates[key] = val or None
    if updates:
        write_env(updates)
    return settings_payload()


@app.get("/api/setup/status")
def setup_status():
    prof = current_profile()
    p = provider()
    llm_configured = p == "claude-code" or bool(env("OPENROUTER_API_KEY"))
    db_state = db.status()
    tavily_set = bool(env("TAVILY_API_KEY"))
    return {
        "complete": bool(llm_configured and tavily_set and db_state.get("ok") and db_state.get("initialized") and prof),
        "llm": {"provider": p, "configured": llm_configured, "openrouter_key_set": bool(env("OPENROUTER_API_KEY")),
                "models": {r: model_for(r, p) for r in ROLES}},
        "tavily": {"key_set": tavily_set},
        "db": db_state,
        "profile": {"exists": prof is not None, "name": prof.candidate.name if prof else None,
                    "facts": FACTS_FILE.exists(), "voice": VOICE_FILE.exists(), "skills": SKILLS_FILE.exists()},
        "uploads": artifacts.list_uploads(),
        "interview_chars": len(read(INTERVIEW_FILE)),
    }


@app.post("/api/setup/check-llm")
def check_llm():
    try:
        res = subprocess.run(script_cmd("orient.py", "check"), cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=240)
    except subprocess.TimeoutExpired:
        return {"ok": False, "provider": provider(), "models": {r: model_for(r) for r in ROLES}, "error": "Connection check timed out after 240s."}
    for line in reversed(res.stdout.strip().splitlines()):
        if line.startswith("{"):
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                break
    return {"ok": False, "provider": provider(), "models": {r: model_for(r) for r in ROLES},
            "error": (res.stderr or res.stdout).strip()[-1500:] or f"check exited {res.returncode}"}


@app.post("/api/setup/check-tavily")
def check_tavily():
    if not tavily.api_key():
        return {"ok": False, "error": "TAVILY_API_KEY is not set."}

    async def probe():
        async with httpx.AsyncClient() as client:
            return await tavily.search(client, "software engineer job posting", 1, operation="connection-check")

    try:
        return {"ok": True, "results": len(asyncio.run(probe()))}
    except httpx.HTTPStatusError as e:
        return {"ok": False, "error": f"Tavily returned {e.response.status_code}: {e.response.text[:300]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/setup/db")
def setup_db():
    try:
        created = db.ensure_database()
        db.init_schema()
        return {**db.status(), "created": created}
    except Exception as e:
        return {**db.status(), "ok": False, "error": str(e).strip()}


_MODELS_CACHE: Dict[str, Any] = {"at": 0.0, "data": []}


@app.get("/api/openrouter/models")
def openrouter_models():
    if time.time() - _MODELS_CACHE["at"] > 600:
        try:
            r = httpx.get("https://openrouter.ai/api/v1/models", timeout=20.0)
            r.raise_for_status()
            _MODELS_CACHE.update(at=time.time(), data=r.json().get("data", []))
        except Exception as e:
            if not _MODELS_CACHE["data"]:
                raise HTTPException(status_code=502, detail=f"Could not load the OpenRouter catalog: {e}")
    out = []
    for m in _MODELS_CACHE["data"]:
        params = set(m.get("supported_parameters") or [])
        structured = "structured_outputs" in params or "response_format" in params
        if not structured:
            continue
        pricing = m.get("pricing") or {}
        out.append({
            "id": m["id"], "name": m.get("name", m["id"]), "context_length": int(m.get("context_length") or 0),
            "prompt_per_m": round(float(pricing.get("prompt") or 0) * 1e6, 4),
            "completion_per_m": round(float(pricing.get("completion") or 0) * 1e6, 4),
            "tools": "tools" in params, "structured": structured, "batch": m["id"].endswith(":batch"),
        })
    return sorted(out, key=lambda x: x["id"])


@app.get("/api/setup/uploads")
def get_uploads():
    return artifacts.list_uploads()


@app.post("/api/setup/uploads")
async def post_uploads(files: List[UploadFile] = File(...)):
    errors = []
    for f in files:
        try:
            path = artifacts.save_upload(f.filename or "upload", await f.read())
            try:
                artifacts.cached_text(path)
            except Exception as e:
                errors.append(f"{path.name}: saved, but text extraction failed ({e})")
        except ValueError as e:
            errors.append(str(e))
    if errors and len(errors) == len(files):
        raise HTTPException(status_code=422, detail="; ".join(errors))
    return artifacts.list_uploads()


@app.delete("/api/setup/uploads/{name}")
def delete_upload(name: str):
    artifacts.delete_upload(name)
    return artifacts.list_uploads()


class InterviewUpdate(BaseModel):
    text: str


@app.get("/api/setup/interview")
def get_interview():
    return {"text": read(INTERVIEW_FILE)}


@app.put("/api/setup/interview")
def put_interview(req: InterviewUpdate):
    INTERVIEW_FILE.parent.mkdir(parents=True, exist_ok=True)
    INTERVIEW_FILE.write_text(req.text, encoding="utf-8")
    return {"ok": True, "chars": len(req.text)}


def profile_bundle() -> Dict[str, Any]:
    prof = current_profile()
    return {"profile": prof.model_dump() if prof else None, "facts": read(FACTS_FILE), "voice": read(VOICE_FILE),
            "skills": read(SKILLS_FILE), "recommendations": read(RECOMMENDATIONS_FILE)}


@app.post("/api/setup/build-profile")
def build_profile():
    with JOBS_LOCK:
        if any(j["kind"] == "orient" and j["status"] == "running" for j in JOBS.values()):
            raise HTTPException(status_code=409, detail="A profile build is already running.")

    def on_done(job, rc, out):
        if rc != 0:
            job["error"] = out[-3000:]
            return None
        return profile_bundle()

    return {"job_id": start_job("orient", script_cmd("orient.py", "build"), on_done)}


class ProfileUpdate(BaseModel):
    profile: Optional[Dict[str, Any]] = None
    facts: Optional[str] = None
    voice: Optional[str] = None
    skills: Optional[str] = None
    recommendations: Optional[str] = None


@app.get("/api/profile")
def get_profile():
    return profile_bundle()


@app.put("/api/profile")
def put_profile(req: ProfileUpdate):
    if req.profile is not None:
        try:
            prof = Profile.model_validate(req.profile)
        except ValidationError as e:
            raise HTTPException(status_code=422, detail="; ".join(f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors()[:8]))
        for m in prof.search.metros:
            try:
                re.compile(m.signal)
            except re.error as e:
                raise HTTPException(status_code=422, detail=f"Metro '{m.key}' signal is not a valid regex: {e}")
        save_profile(prof)
    for field, path in (("facts", FACTS_FILE), ("voice", VOICE_FILE), ("skills", SKILLS_FILE), ("recommendations", RECOMMENDATIONS_FILE)):
        val = getattr(req, field)
        if val is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(val, encoding="utf-8")
    return profile_bundle()


@app.get("/api/meta")
def meta():
    prof = current_profile()
    p = provider()
    return {
        "app_name": APP_NAME,
        "candidate_name": prof.candidate.name if prof else None,
        "provider": p,
        "models": {r: model_for(r, p) for r in ROLES},
        "scopes": [{"key": s.key, "label": s.label} for s in prof.search.scopes] if prof else [],
        "metros": [{"key": m.key, "label": m.label} for m in prof.search.metros] if prof else [],
        "positioning": prof.resume.positioning if prof else "",
    }


# ---------------------------------------------------------------------------
# Opportunities
# ---------------------------------------------------------------------------
class StatusUpdateRequest(BaseModel):
    status: str


class TailorRequest(BaseModel):
    intel: Optional[str] = ""
    highlights: Optional[List[str]] = []
    positioning: Optional[str] = ""
    revise: Optional[str] = ""


class ScoutRequest(BaseModel):
    scope: str = "all"
    custom_query: Optional[str] = None


def sector_condition(sector: Optional[str], conditions: List[str], params: List[Any]) -> None:
    if sector and sector != "all":
        if sector == "untracked":
            conditions.append("sector IS NULL")
        else:
            conditions.append("sector = %s")
            params.append(sector)


@app.get("/api/stats")
def get_stats(sector: Optional[str] = None):
    try:
        conditions: List[str] = ["status <> 'noise'"]
        params: List[Any] = []
        sector_condition(sector, conditions, params)
        with get_db() as conn, conn.cursor() as cur:
            cur.execute(f"""
                SELECT COUNT(*),
                       COUNT(*) FILTER (WHERE status = 'filed'),
                       COUNT(*) FILTER (WHERE status = 'review'),
                       COUNT(*) FILTER (WHERE status = 'declined'),
                       COUNT(*) FILTER (WHERE status = 'applied'),
                       COUNT(*) FILTER (WHERE status = 'weak'),
                       COALESCE(AVG(score) FILTER (WHERE score > 0), 0)
                FROM opportunities WHERE {" AND ".join(conditions)};
            """, tuple(params))
            row = cur.fetchone()
            return {"total": row[0], "filed": row[1], "review": row[2], "declined": row[3], "applied": row[4],
                    "weak": row[5], "avg_score": round(float(row[6]), 1)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/companies")
def list_companies():
    try:
        with get_db() as conn, conn.cursor() as cur:
            cur.execute("SELECT company, COUNT(*) FROM opportunities WHERE status <> 'noise' GROUP BY company ORDER BY 2 DESC, 1 ASC;")
            return [{"company": r[0], "count": r[1]} for r in cur.fetchall()]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sectors")
def list_sectors():
    try:
        with get_db() as conn, conn.cursor() as cur:
            cur.execute("SELECT COALESCE(sector, 'untracked'), COUNT(*) FROM opportunities WHERE status <> 'noise' GROUP BY 1 ORDER BY 2 DESC, 1 ASC;")
            return [{"sector": r[0], "count": r[1]} for r in cur.fetchall()]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/opportunities")
def list_opportunities(
    status: Optional[str] = None,
    company: Optional[str] = None,
    sector: Optional[str] = None,
    metro: Optional[str] = None,
    min_score: Optional[int] = None,
    has_comp: bool = False,
    sort_by: str = "score_desc",
):
    try:
        conditions: List[str] = []
        params: List[Any] = []
        if status and status != "all":
            conditions.append("status = %s")
            params.append(status)
        else:
            conditions.append("status <> 'noise'")
        if company and company != "all":
            conditions.append("company = %s")
            params.append(company)
        sector_condition(sector, conditions, params)
        if metro and metro != "all" and status != "declined":
            filters = metro_filters()
            if metro not in filters:
                raise HTTPException(status_code=400, detail=f"Unknown metro '{metro}'. Use one of: {', '.join(filters)}, all.")
            conditions.append(f"({LOCATION_HAYSTACK}) ~* %s")
            params.append(filters[metro])
        if min_score is not None:
            conditions.append("score >= %s")
            params.append(min_score)
        if has_comp:
            conditions.append("(compensation IS NOT NULL AND compensation NOT IN ('Not listed', 'Not specified', ''))")
        order = {
            "newest": "ORDER BY created_at DESC",
            "company_asc": "ORDER BY company ASC, score DESC",
            "comp_desc": "ORDER BY (compensation NOT IN ('Not listed', 'Not specified')) DESC, score DESC",
        }.get(sort_by, "ORDER BY score DESC, updated_at DESC")
        with get_db() as conn, conn.cursor() as cur:
            cur.execute(f"""
                SELECT id, role_slug, company, title, url, score, archetype, status,
                       work_arrangement, compensation, benefits, summary, fit_strengths, gaps,
                       raw_text, created_at, updated_at, sector, location
                FROM opportunities WHERE {" AND ".join(conditions)} {order};
            """, tuple(params))
            return [
                {
                    "id": r[0], "role_slug": r[1], "company": r[2], "title": r[3], "url": r[4], "score": r[5],
                    "archetype": r[6], "status": r[7], "work_arrangement": r[8] or "Not specified",
                    "compensation": r[9] or "Not listed", "benefits": r[10] or [], "summary": r[11] or "",
                    "fit_strengths": r[12] or [], "gaps": r[13] or [], "raw_text": r[14] or "",
                    "created_at": r[15].isoformat() if r[15] else "", "updated_at": r[16].isoformat() if r[16] else "",
                    "sector": r[17], "location": r[18],
                }
                for r in cur.fetchall()
            ]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/opportunities/{opp_id}/status")
def update_status(opp_id: int, req: StatusUpdateRequest):
    if req.status not in ("filed", "review", "weak", "declined", "applied"):
        raise HTTPException(status_code=422, detail="Unknown status")
    try:
        with get_db() as conn, conn.cursor() as cur:
            cur.execute("SELECT company, role_slug FROM opportunities WHERE id = %s;", (opp_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Opportunity not found")
            company, slug = row
            cur.execute("UPDATE opportunities SET status = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s;", (req.status, opp_id))
            conn.commit()
        if req.status == "declined":
            f = find_opportunity_file(slug)
            if f and "_declined" not in f.parts:
                dest_dir = DECLINED_DIR / company_dirname(company)
                dest_dir.mkdir(parents=True, exist_ok=True)
                for side in (f, *f.parent.glob(f"{f.stem}.resume.*"), *f.parent.glob(f"{f.stem}.rationale.md")):
                    side.rename(dest_dir / side.name)
        return {"success": True, "id": opp_id, "new_status": req.status}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def opportunity_slug(opp_id: int) -> tuple:
    with get_db() as conn, conn.cursor() as cur:
        cur.execute("SELECT company, role_slug FROM opportunities WHERE id = %s;", (opp_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    return row


@app.post("/api/opportunities/{opp_id}/tailor")
def trigger_tailor(opp_id: int, req: Optional[TailorRequest] = None):
    """Starts a tailor job and returns its id immediately. Poll /api/jobs/{id}; result carries resume + rationale."""
    company, slug = opportunity_slug(opp_id)
    opp_file = find_opportunity_file(slug)
    if not opp_file:
        raise HTTPException(status_code=400, detail=f"Opportunity markdown file for {slug} not found on disk")

    cmd = script_cmd("tailor.py", str(opp_file))
    if req:
        if req.intel:
            cmd.extend(["--intel", req.intel])
        if req.highlights:
            cmd.extend(["--highlights", "; ".join(req.highlights)])
        if req.positioning:
            cmd.extend(["--positioning", req.positioning])
        if req.revise:
            cmd.extend(["--revise", req.revise])

    resume_p = opp_file.parent / f"{opp_file.stem}.resume.md"
    rationale_p = opp_file.parent / f"{opp_file.stem}.rationale.md"
    rejected_p = opp_file.parent / f"{opp_file.stem}.resume.rejected.md"

    def on_done(job, rc, out):
        if rc != 0:
            job["error"] = out[-3000:]
            return {"rejected_resume": rejected_p.read_text(encoding="utf-8")} if rejected_p.exists() else None
        return {"success": True, "resume": read(resume_p) or "Resume generated.", "rationale": read(rationale_p) or "Rationale generated."}

    job_id = start_job("tailor", cmd, on_done, meta={"opportunity_id": opp_id, "company": company, "slug": slug})
    return {"job_id": job_id, "status": "running"}


@app.get("/api/opportunities/{opp_id}/pdf")
def get_opportunity_pdf(opp_id: int):
    _, slug = opportunity_slug(opp_id)
    prof = current_profile()
    who = re.sub(r"[^A-Za-z0-9]+", "_", prof.candidate.name).strip("_") if prof else "Resume"
    filename = f"{who}_{slug}_Resume.pdf"
    opp_file = find_opportunity_file(slug)
    stem = opp_file.stem if opp_file else slug
    for pdf_p in OPPORTUNITIES_DIR.glob(f"**/{stem}.resume.pdf"):
        return FileResponse(path=pdf_p, media_type="application/pdf", filename=filename)
    for md_p in OPPORTUNITIES_DIR.glob(f"**/{stem}.resume.md"):
        out_pdf = md_p.parent / f"{stem}.resume.pdf"
        res = subprocess.run(script_cmd("render_cv_pdf.py", str(md_p), str(out_pdf)), capture_output=True, text=True, timeout=90)
        if out_pdf.exists():
            return FileResponse(path=out_pdf, media_type="application/pdf", filename=filename)
        raise HTTPException(status_code=500, detail=f"PDF render failed: {(res.stderr or res.stdout)[-400:]}")
    raise HTTPException(status_code=404, detail="Tailored PDF not found. Click 'Tailor' first to generate.")


@app.get("/api/costs")
def get_costs():
    try:
        with get_db() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT COALESCE(SUM(cost_usd), 0),
                       COALESCE(SUM(CASE WHEN service <> 'tavily' THEN cost_usd ELSE 0 END), 0),
                       COALESCE(SUM(CASE WHEN service <> 'tavily' THEN total_tokens ELSE 0 END), 0),
                       COALESCE(SUM(CASE WHEN service = 'tavily' THEN cost_usd ELSE 0 END), 0),
                       COALESCE(SUM(CASE WHEN service = 'tavily' THEN tavily_credits ELSE 0 END), 0),
                       COUNT(*)
                FROM telemetry_costs;
            """)
            t = cur.fetchone()
            cur.execute("""
                SELECT DATE(timestamp),
                       COALESCE(SUM(CASE WHEN service <> 'tavily' THEN total_tokens ELSE 0 END), 0),
                       COALESCE(SUM(CASE WHEN service <> 'tavily' THEN cost_usd ELSE 0 END), 0),
                       COALESCE(SUM(CASE WHEN service = 'tavily' THEN tavily_credits ELSE 0 END), 0),
                       COALESCE(SUM(CASE WHEN service = 'tavily' THEN cost_usd ELSE 0 END), 0),
                       COALESCE(SUM(cost_usd), 0),
                       COUNT(*)
                FROM telemetry_costs GROUP BY 1 ORDER BY 1 DESC;
            """)
            daily = [{"day": str(r[0]), "llm_tokens": int(r[1]), "llm_cost": float(r[2]), "tavily_credits": int(r[3]),
                      "tavily_cost": float(r[4]), "total_cost": float(r[5]), "event_count": int(r[6])} for r in cur.fetchall()]
        return {"total_usd": float(t[0]), "llm_total_usd": float(t[1]), "llm_total_tokens": int(t[2]),
                "tavily_total_usd": float(t[3]), "tavily_total_credits": int(t[4]), "total_events": int(t[5]), "daily": daily}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/scout")
def trigger_scout(req: ScoutRequest):
    """Starts a scout job and returns its id immediately. Poll /api/jobs/{id}; result carries the filed opportunities."""
    prof = current_profile()
    if not prof:
        raise HTTPException(status_code=400, detail="Finish orientation before running a hunt.")
    scopes = [s.key for s in prof.search.scopes]
    if req.scope != "all" and req.scope not in scopes:
        raise HTTPException(status_code=422, detail=f"Unknown scope '{req.scope}'. Use one of: all, {', '.join(scopes)}")
    cmd = script_cmd("scout.py", "--scope", req.scope, "--json")
    if req.custom_query:
        cmd.extend(["--query", req.custom_query])

    def on_done(job, rc, out):
        if rc != 0:
            job["error"] = out[-3000:]
            return None
        output_json: List[Any] = []
        lines = out.strip().split("\n")
        for i, line in enumerate(lines):
            if line.strip() == "[" or (line.strip().startswith("[") and "{" in line):
                try:
                    output_json = json.loads("\n".join(lines[i:]))
                except json.JSONDecodeError:
                    pass
                break
        return {"success": True, "count": len(output_json), "opportunities": output_json, "raw_log": out[-2000:]}

    job_id = start_job("scout", cmd, on_done, meta={"scope": req.scope, "custom_query": req.custom_query})
    return {"job_id": job_id, "status": "running"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=58880)
