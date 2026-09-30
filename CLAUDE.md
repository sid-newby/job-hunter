# Job Hunter: agent notes

A local job-search app: orientation builds a candidate workspace, scout discovers and scores postings, tailor writes resumes.
Read README.md for the user-facing picture. This file covers what an agent changing the code needs.

## Architecture
- Python entrypoints in `scripts/` run with `uv run --script` (PEP 723 inline deps). Shared helpers (`config`, `llm`, `db`,
  `tavily`, `candidate_profile`, `artifacts`) import from the caller's environment; add a new third-party import to every
  entrypoint that loads it (`scout.py`, `tailor.py`, `orient.py`, `render_cv_pdf.py`, `ui/server.py`).
- `ui/server.py` (FastAPI, 58880) never duplicates prompts: it runs scripts as subprocess jobs and reads their files.
  `ui/src` is React 19 + MUI on Vite (58888), built with Bun.
- All model calls go through `scripts/llm.py` (`run_structured`, `run_structured_many`). Never call a provider SDK directly.
  Agents get `web_search` / `web_fetch` backed by Tavily on both providers.
- `workspace/` (gitignored) holds all personal data. `workspace/profile.json` is validated by `candidate_profile.Profile`;
  nothing about a specific person belongs in code.
- `scripts/db.py` owns every table definition. `.env` holds settings; the dashboard edits it via `config.write_env`.

## Hazards
- `task scout` and `task tailor` are live runs: they spend Tavily credits and model calls and write records. Never use them as smoke tests.
- A `:batch` OpenRouter model can take up to 24h and cannot run tool loops; `llm.run_structured` refuses that combination.
- OpenRouter structured outputs use strict JSON schema: `llm.strict_schema` closes objects and requires every property.
  Keep Pydantic payload models free of open dicts.

## Verifying changes
- `task ui:build` for TypeScript. Python: `python3 -m py_compile` plus focused tests with temp paths
  (`JOB_HUNTER_WORKSPACE`, `JOB_HUNTER_ENV_FILE`) and a throwaway database name.
- Update README.md when a command, setting, or workflow changes.
