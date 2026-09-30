"""
scripts/db.py
PostgreSQL ledger: database creation, schema, and telemetry writes. Owns every table definition.
"""

import json
from typing import Any, Dict, Optional

import psycopg
from psycopg import sql

from config import db_conninfo, db_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS opportunities (
    id SERIAL PRIMARY KEY,
    role_slug TEXT UNIQUE NOT NULL,
    company TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    canonical_url TEXT,
    req_id TEXT,
    score INTEGER NOT NULL DEFAULT 0,
    archetype TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'filed',
    work_arrangement TEXT,
    compensation TEXT,
    benefits TEXT[],
    summary TEXT,
    fit_strengths TEXT[],
    gaps TEXT[],
    raw_text TEXT,
    sector TEXT,
    location TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS sector TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS location TEXT;
CREATE INDEX IF NOT EXISTS opp_canonical_url_idx ON opportunities (canonical_url);
CREATE INDEX IF NOT EXISTS opp_req_id_idx ON opportunities (req_id);
CREATE INDEX IF NOT EXISTS opp_company_title_idx ON opportunities (LOWER(company), LOWER(title));
CREATE INDEX IF NOT EXISTS opp_sector_idx ON opportunities (sector);

CREATE TABLE IF NOT EXISTS telemetry_costs (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    service TEXT NOT NULL,
    operation TEXT NOT NULL,
    prompt_tokens INTEGER DEFAULT 0,
    candidate_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    tavily_credits INTEGER DEFAULT 0,
    cost_usd NUMERIC(12, 6) DEFAULT 0,
    meta JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS telemetry_timestamp_idx ON telemetry_costs (timestamp);
"""


def connect(**kwargs) -> psycopg.Connection:
    return psycopg.connect(db_conninfo(), **kwargs)


def ensure_database() -> bool:
    """Creates the configured database if it is missing. Returns True when it was created."""
    name = db_settings()["dbname"]
    with psycopg.connect(db_conninfo("postgres"), autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s;", (name,))
            if cur.fetchone():
                return False
            cur.execute(sql.SQL("CREATE DATABASE {};").format(sql.Identifier(name)))
            return True


def init_schema(conn: Optional[psycopg.Connection] = None) -> None:
    if conn is None:
        with connect() as own:
            init_schema(own)
        return
    with conn.cursor() as cur:
        cur.execute(SCHEMA)
    conn.commit()


def setup() -> Dict[str, Any]:
    created = ensure_database()
    init_schema()
    return {"created": created, **{k: v for k, v in db_settings().items() if k != "password"}}


def status() -> Dict[str, Any]:
    settings = {k: v for k, v in db_settings().items() if k != "password"}
    try:
        with connect(connect_timeout=3) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT to_regclass('public.opportunities') IS NOT NULL, to_regclass('public.telemetry_costs') IS NOT NULL;")
                opp, tel = cur.fetchone()
                count = 0
                if opp:
                    cur.execute("SELECT COUNT(*) FROM opportunities;")
                    count = cur.fetchone()[0]
        return {"ok": True, "initialized": bool(opp and tel), "opportunities": count, **settings}
    except Exception as e:
        return {"ok": False, "initialized": False, "error": str(e).strip(), **settings}


def log_telemetry(service: str, operation: str, p_tok: int = 0, c_tok: int = 0, tavily_credits: int = 0,
                  cost_usd: float = 0.0, meta: Optional[Dict[str, Any]] = None) -> None:
    try:
        with connect(connect_timeout=3) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO telemetry_costs (service, operation, prompt_tokens, candidate_tokens, total_tokens, tavily_credits, cost_usd, meta)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s);""",
                    (service, operation, p_tok, c_tok, p_tok + c_tok, tavily_credits, cost_usd, json.dumps(meta or {})),
                )
    except Exception:
        pass
