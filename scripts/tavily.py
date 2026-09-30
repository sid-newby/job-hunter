"""
scripts/tavily.py
Tavily search and extract, shared by scout's search channel and the agents' web tools.
"""

from typing import Any, Dict, List, Optional

import httpx

from config import env
from db import log_telemetry

SEARCH_URL = "https://api.tavily.com/search"
EXTRACT_URL = "https://api.tavily.com/extract"
CREDIT_USD = 0.008
BASE_EXCLUDE_DOMAINS = ["youtube.com", "reddit.com", "wikipedia.org", "glassdoor.com"]


def api_key() -> str:
    return env("TAVILY_API_KEY")


async def search(client: httpx.AsyncClient, query: str, max_results: int = 10, exclude_domains: Optional[List[str]] = None,
                 operation: str = "search") -> List[Dict[str, Any]]:
    key = api_key()
    if not key:
        raise RuntimeError("TAVILY_API_KEY is not set.")
    payload = {
        "query": query,
        "search_depth": "basic",
        "max_results": max(1, min(max_results, 20)),
        "include_raw_content": False,
        "exclude_domains": sorted(set(BASE_EXCLUDE_DOMAINS + list(exclude_domains or []))),
    }
    r = await client.post(SEARCH_URL, json=payload, headers={"Authorization": f"Bearer {key}"}, timeout=20.0)
    r.raise_for_status()
    log_telemetry("tavily", operation, tavily_credits=1, cost_usd=CREDIT_USD, meta={"query": query[:200]})
    return [{"title": x.get("title", ""), "url": x.get("url", ""), "content": x.get("content", "")} for x in r.json().get("results", [])]


async def extract(client: httpx.AsyncClient, urls: List[str], operation: str = "extract") -> Dict[str, str]:
    """Returns {url: markdown} for pages Tavily could read. Billed at one credit per five URLs."""
    key = api_key()
    if not key or not urls:
        return {}
    out: Dict[str, str] = {}
    for i in range(0, len(urls), 5):
        batch = urls[i:i + 5]
        r = await client.post(EXTRACT_URL, json={"urls": batch}, headers={"Authorization": f"Bearer {key}"}, timeout=40.0)
        if r.status_code != 200:
            continue
        log_telemetry("tavily", operation, tavily_credits=1, cost_usd=CREDIT_USD, meta={"batch_size": len(batch)})
        for res in r.json().get("results", []):
            if res.get("url") and len(res.get("raw_content") or "") > 200:
                out[res["url"]] = res["raw_content"]
    return out
