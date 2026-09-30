"""
scripts/llm.py
Provider-neutral structured generation for scout, tailor, and orientation.

LLM_PROVIDER=openrouter  OpenRouter chat completions with a strict JSON schema. Agents get Tavily-backed
                         web_search / web_fetch function tools. A model id ending in ':batch' goes through
                         OpenRouter's async Batch API (submit, then poll until done).
LLM_PROVIDER=claude-code Claude Agent SDK on the local Claude Code login; the same Tavily tools are served
                         as an in-process MCP server.

Every call records a telemetry_costs row.
"""

import asyncio
import copy
import json
import re
import time
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import httpx

import tavily
from config import env, effort_for, model_for, provider
from db import log_telemetry

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
APP_HEADERS = {"X-Title": "Job Hunter"}
TOOL_NAMES = ("web_search", "web_fetch")
FETCH_CHARS = 14000

TOOL_SPECS = {
    "web_search": {
        "description": "Search the web. Returns up to max_results results with title, url, and a content snippet.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "max_results": {"type": "integer", "description": "1-20, default 10"},
            },
            "required": ["query"],
        },
    },
    "web_fetch": {
        "description": "Fetch one web page and return its main text as markdown.",
        "parameters": {
            "type": "object",
            "properties": {"url": {"type": "string", "description": "Absolute http(s) URL"}},
            "required": ["url"],
        },
    },
}


class LLMError(RuntimeError):
    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------------------
# Schema and payload helpers
# ---------------------------------------------------------------------------

def strict_schema(schema: Dict[str, Any]) -> Dict[str, Any]:
    """Inlines $refs and marks every object closed with all properties required, as OpenAI strict mode demands."""
    schema = copy.deepcopy(schema)
    defs = schema.pop("$defs", {})
    schema.pop("$schema", None)

    def walk(node: Any) -> Any:
        if isinstance(node, list):
            return [walk(n) for n in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            target = copy.deepcopy(defs[node["$ref"].split("/")[-1]])
            extra = {k: v for k, v in node.items() if k != "$ref"}
            node = {**target, **extra}
        node = {k: v for k, v in node.items() if k not in ("default", "title")}
        if "properties" in node:
            node["properties"] = {k: walk(v) for k, v in node["properties"].items()}
            node["required"] = list(node["properties"].keys())
            node["additionalProperties"] = False
        for key in ("items", "anyOf", "allOf", "oneOf"):
            if key in node:
                node[key] = walk(node[key])
        return node

    return walk(schema)


def parse_json(content: Any) -> Dict[str, Any]:
    if isinstance(content, list):
        content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
    text = (content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            return json.loads(m.group(0))
        raise LLMError(f"Model returned non-JSON content: {text[:300]}")


def reasoning_effort(effort: str) -> str:
    return {"max": "xhigh"}.get(effort, effort)


def is_batch_model(model: str) -> bool:
    return model.endswith(":batch")


# ---------------------------------------------------------------------------
# Tavily-backed tools
# ---------------------------------------------------------------------------

async def run_tool(client: httpx.AsyncClient, name: str, args: Dict[str, Any], exclude_domains: Sequence[str]) -> str:
    try:
        if name == "web_search":
            results = await tavily.search(client, str(args.get("query", "")), int(args.get("max_results") or 10),
                                          list(exclude_domains), operation="agent-search")
            return json.dumps(results, ensure_ascii=False)
        if name == "web_fetch":
            url = str(args.get("url", ""))
            pages = await tavily.extract(client, [url], operation="agent-fetch")
            text = next(iter(pages.values()), "")
            return text[:FETCH_CHARS] if text else f"Could not read {url} (blocked, empty, or not found)."
        return f"Unknown tool: {name}"
    except Exception as e:
        return f"Tool error: {e}"


# ---------------------------------------------------------------------------
# OpenRouter
# ---------------------------------------------------------------------------

def openrouter_headers() -> Dict[str, str]:
    key = env("OPENROUTER_API_KEY")
    if not key:
        raise LLMError("OPENROUTER_API_KEY is not set.")
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json", **APP_HEADERS}


def response_format(schema: Dict[str, Any], strict: bool = True) -> Dict[str, Any]:
    return {"type": "json_schema", "json_schema": {"name": "result", "strict": strict, "schema": strict_schema(schema) if strict else schema}}


async def openrouter_chat(client: httpx.AsyncClient, body: Dict[str, Any]) -> Dict[str, Any]:
    r = await client.post(f"{OPENROUTER_BASE}/chat/completions", json=body, headers=openrouter_headers(), timeout=900.0)
    if r.status_code >= 400:
        raise LLMError(f"OpenRouter {r.status_code}: {r.text[:600]}", status=r.status_code)
    data = r.json()
    if data.get("error"):
        raise LLMError(f"OpenRouter error: {json.dumps(data['error'])[:600]}")
    if not data.get("choices"):
        raise LLMError(f"OpenRouter returned no choices: {json.dumps(data)[:600]}")
    return data


async def openrouter_structured(prompt: str, system_prompt: str, schema: Dict[str, Any], model: str, effort: str,
                                tools: Sequence[str], max_turns: int, on_tool_use, exclude_domains: Sequence[str]) -> Dict[str, Any]:
    messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}, {"role": "user", "content": prompt}]
    tool_defs = [{"type": "function", "function": {"name": n, **TOOL_SPECS[n]}} for n in tools]
    totals = {"input_tokens": 0, "output_tokens": 0, "cost": 0.0}
    strict = True
    async with httpx.AsyncClient(follow_redirects=True) as client:
        turn = 0
        while turn < max_turns:
            turn += 1
            body: Dict[str, Any] = {"model": model, "messages": messages, "response_format": response_format(schema, strict),
                                    "reasoning": {"effort": reasoning_effort(effort)}}
            if tool_defs:
                body["tools"] = tool_defs
                body["tool_choice"] = "auto" if turn < max_turns else "none"
            try:
                data = await openrouter_chat(client, body)
            except LLMError as e:
                if strict and e.status == 400 and "schema" in str(e).lower():
                    strict = False
                    turn -= 1
                    continue
                raise
            usage = data.get("usage") or {}
            totals["input_tokens"] += int(usage.get("prompt_tokens", 0) or 0)
            totals["output_tokens"] += int(usage.get("completion_tokens", 0) or 0)
            totals["cost"] += float(usage.get("cost", 0) or 0)
            msg = data["choices"][0]["message"]
            calls = msg.get("tool_calls") or []
            if calls and tool_defs:
                assistant = {"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls}
                if msg.get("reasoning_details"):
                    assistant["reasoning_details"] = msg["reasoning_details"]
                messages.append(assistant)
                for call in calls:
                    fn = call.get("function") or {}
                    try:
                        args = json.loads(fn.get("arguments") or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    if on_tool_use:
                        on_tool_use(fn.get("name", ""), args)
                    result = await run_tool(client, fn.get("name", ""), args, exclude_domains)
                    messages.append({"role": "tool", "tool_call_id": call.get("id"), "content": result})
                continue
            return {"payload": parse_json(msg.get("content")), **totals, "num_turns": turn}
    raise LLMError(f"No final answer within {max_turns} turns.")


async def openrouter_batch(items: Sequence[Tuple[str, str]], system_prompt: str, schema: Dict[str, Any], model: str, effort: str,
                           log: Callable[[str], None]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Submits one batch, polls to a terminal status, and returns ({custom_id: payload or LLMError}, batch usage)."""
    rf = response_format(schema)
    requests = [{"custom_id": cid, "body": {"messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": prompt}],
                                            "response_format": rf, "reasoning": {"effort": reasoning_effort(effort)}}}
                for cid, prompt in items]
    poll_s = float(env("LLM_BATCH_POLL_S", "30"))
    timeout_s = float(env("LLM_BATCH_TIMEOUT_S", "86400"))
    async with httpx.AsyncClient(timeout=120.0) as client:
        batch = None
        errors = []
        for slug in dict.fromkeys([model.removesuffix(":batch"), model]):
            r = await client.post(f"{OPENROUTER_BASE}/batches", headers=openrouter_headers(),
                                  json={"endpoint": "/v1/chat/completions", "model": slug, "requests": requests})
            if r.status_code < 400:
                batch = r.json()
                break
            errors.append(f"{slug}: {r.status_code} {r.text[:300]}")
        if batch is None:
            raise LLMError("Batch submit failed. " + " | ".join(errors))
        batch_id = batch["id"]
        log(f"  batch {batch_id} submitted: {len(requests)} requests on {model} (results within OpenRouter's 24h window)")
        started = time.time()
        last = ""
        while batch.get("status") not in ("completed", "failed", "expired", "cancelled"):
            if time.time() - started > timeout_s:
                raise LLMError(f"Batch {batch_id} still '{batch.get('status')}' after {int(timeout_s)}s; it keeps running on OpenRouter.")
            await asyncio.sleep(poll_s)
            r = await client.get(f"{OPENROUTER_BASE}/batches/{batch_id}", headers=openrouter_headers())
            if r.status_code >= 400:
                continue
            batch = r.json()
            counts = batch.get("request_counts") or {}
            line = f"{batch.get('status')} {counts.get('completed', 0)}/{counts.get('total', len(requests))} done, {counts.get('failed', 0)} failed"
            if line != last:
                log(f"  batch {batch_id}: {line} ({int(time.time() - started)}s)")
                last = line
    if batch.get("status") != "completed":
        raise LLMError(f"Batch {batch_id} ended {batch.get('status')}: {json.dumps(batch.get('error'))[:400]}")
    out: Dict[str, Any] = {}
    for res in batch.get("results") or []:
        cid = res.get("custom_id")
        try:
            if res.get("error"):
                raise LLMError(json.dumps(res["error"])[:300])
            body = (res.get("response") or {}).get("body") or {}
            out[cid] = parse_json(body["choices"][0]["message"].get("content"))
        except Exception as e:
            out[cid] = e if isinstance(e, LLMError) else LLMError(str(e))
    return out, {**(batch.get("usage") or {}), "batch_id": batch_id}


# ---------------------------------------------------------------------------
# Claude Code
# ---------------------------------------------------------------------------

def tavily_mcp_server(exclude_domains: Sequence[str]):
    from claude_agent_sdk import create_sdk_mcp_server, tool

    def make(name: str):
        @tool(name, TOOL_SPECS[name]["description"], TOOL_SPECS[name]["parameters"])
        async def handler(args: Dict[str, Any]) -> Dict[str, Any]:
            async with httpx.AsyncClient(follow_redirects=True) as client:
                text = await run_tool(client, name, args, exclude_domains)
            return {"content": [{"type": "text", "text": text}]}
        return handler

    return create_sdk_mcp_server(name="tavily", tools=[make(n) for n in TOOL_NAMES])


async def claude_structured(prompt: str, system_prompt: str, schema: Dict[str, Any], model: str, effort: str,
                            tools: Sequence[str], max_turns: int, on_tool_use, exclude_domains: Sequence[str]) -> Dict[str, Any]:
    from claude_agent import run_structured as sdk_run

    kwargs: Dict[str, Any] = {}
    if tools:
        kwargs = {"mcp_servers": {"tavily": tavily_mcp_server(exclude_domains)},
                  "allowed_tools": [f"mcp__tavily__{n}" for n in tools], "max_turns": max_turns}
    clean = copy.deepcopy(schema)
    clean.pop("$schema", None)
    res = await sdk_run(prompt, system_prompt=system_prompt, schema=clean, model=model, effort=effort, on_tool_use=on_tool_use, **kwargs)
    return {"payload": res["payload"], "input_tokens": res["input_tokens"], "output_tokens": res["output_tokens"],
            "cost": 0.0, "nominal_cost": res["nominal_cost"], "num_turns": res["num_turns"]}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def record(p: str, operation: str, model: str, res: Dict[str, Any], meta: Optional[Dict[str, Any]] = None) -> None:
    info = {"model": model, **(meta or {})}
    if p == "claude-code":
        info["nominal_list_cost_usd"] = res.get("nominal_cost", 0.0)
    log_telemetry("openrouter" if p == "openrouter" else "claude-code", operation, int(res.get("input_tokens", 0)),
                  int(res.get("output_tokens", 0)), cost_usd=float(res.get("cost", 0.0)), meta=info)


async def run_structured(prompt: str, *, system_prompt: str, schema: Dict[str, Any], role: str, operation: str,
                         model: Optional[str] = None, effort: Optional[str] = None, tools: Sequence[str] = (),
                         max_turns: int = 40, on_tool_use=None, exclude_domains: Sequence[str] = (),
                         meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Returns {"payload", "input_tokens", "output_tokens", "cost", "num_turns", "model"}. tools may name web_search and web_fetch."""
    p = provider()
    model = model or model_for(role, p)
    effort = effort or effort_for(role)
    if p == "openrouter" and is_batch_model(model):
        if tools:
            raise LLMError(f"{model} runs on the async Batch API and cannot drive a tool loop; set OPENROUTER_{role.upper()}_MODEL to a non-batch model.")
        results = await run_structured_many([("only", prompt)], system_prompt=system_prompt, schema=schema, role=role,
                                            operation=operation, model=model, effort=effort, meta=meta)
        value = results["only"]
        if isinstance(value, Exception):
            raise value
        return {"payload": value, "input_tokens": 0, "output_tokens": 0, "cost": 0.0, "num_turns": 1, "model": model}
    runner = openrouter_structured if p == "openrouter" else claude_structured
    res = await runner(prompt, system_prompt, schema, model, effort, list(tools), max_turns, on_tool_use, exclude_domains)
    record(p, operation, model, res, {**(meta or {}), "turns": res.get("num_turns", 1)})
    return {**res, "model": model}


def run_structured_sync(prompt: str, **kwargs) -> Dict[str, Any]:
    return asyncio.run(run_structured(prompt, **kwargs))


async def run_structured_many(items: Sequence[Tuple[str, str]], *, system_prompt: str, schema: Dict[str, Any], role: str,
                              operation: str, model: Optional[str] = None, effort: Optional[str] = None, concurrency: int = 8,
                              meta: Optional[Dict[str, Any]] = None, log: Callable[[str], None] = print,
                              on_result: Optional[Callable[[str, Any], None]] = None) -> Dict[str, Any]:
    """Tool-less structured calls for many prompts. Returns {custom_id: payload dict or Exception}.

    A ':batch' OpenRouter model sends everything as one batch; any other model runs `concurrency` calls at a time.
    on_result(custom_id, payload_or_exception) fires as each result lands.
    """
    p = provider()
    model = model or model_for(role, p)
    effort = effort or effort_for(role)
    if not items:
        return {}
    if p == "openrouter" and is_batch_model(model):
        results, usage = await openrouter_batch(items, system_prompt, schema, model, effort, log)
        log_telemetry("openrouter", operation, int(usage.get("prompt_tokens", 0) or 0), int(usage.get("completion_tokens", 0) or 0),
                      cost_usd=float(usage.get("cost", 0) or 0), meta={"model": model, "batch_id": usage.get("batch_id"), "requests": len(items), **(meta or {})})
        for cid, _ in items:
            results.setdefault(cid, LLMError("Missing from batch results."))
            if on_result:
                on_result(cid, results[cid])
        return results

    sem = asyncio.Semaphore(concurrency)
    out: Dict[str, Any] = {}

    async def one(cid: str, prompt: str) -> None:
        async with sem:
            try:
                res = await run_structured(prompt, system_prompt=system_prompt, schema=schema, role=role, operation=operation,
                                           model=model, effort=effort, meta=meta)
                out[cid] = res["payload"]
            except Exception as e:
                out[cid] = e
        if on_result:
            on_result(cid, out[cid])

    await asyncio.gather(*(one(cid, prompt) for cid, prompt in items))
    return out


# ---------------------------------------------------------------------------
# Connection check (orientation and settings)
# ---------------------------------------------------------------------------

CHECK_SCHEMA = {"type": "object", "properties": {"ok": {"type": "boolean"}, "reply": {"type": "string"}}, "required": ["ok", "reply"]}


async def check() -> Dict[str, Any]:
    """Validates provider credentials and model ids without touching a batch endpoint."""
    p = provider()
    models = {r: model_for(r, p) for r in ("discovery", "qualify", "tailor", "orient")}
    report: Dict[str, Any] = {"provider": p, "models": models, "ok": False}
    try:
        if p == "openrouter":
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.get(f"{OPENROUTER_BASE}/key", headers=openrouter_headers())
                if r.status_code >= 400:
                    raise LLMError(f"OpenRouter rejected the API key ({r.status_code}).")
                key_info = r.json().get("data") or {}
                report["key"] = {k: key_info.get(k) for k in ("label", "usage", "limit", "limit_remaining", "is_free_tier") if k in key_info}
                catalog = {m["id"]: m for m in (await client.get(f"{OPENROUTER_BASE}/models")).json().get("data", [])}
            problems = []
            for role, mid in models.items():
                m = catalog.get(mid)
                if not m:
                    problems.append(f"{role}: '{mid}' is not in the OpenRouter catalog")
                    continue
                params = set(m.get("supported_parameters") or [])
                if "structured_outputs" not in params and "response_format" not in params:
                    problems.append(f"{role}: '{mid}' does not support structured outputs")
                if role == "discovery" and "tools" not in params:
                    problems.append(f"discovery: '{mid}' does not support tool calling")
                if role in ("discovery", "tailor", "orient") and is_batch_model(mid):
                    problems.append(f"{role}: '{mid}' is a batch (async) model; use a non-batch model for interactive work")
            if problems:
                report["problems"] = problems
                return report
        res = await run_structured("Reply with ok=true and reply='ready'.", system_prompt="You are a connection test.",
                                   schema=CHECK_SCHEMA, role="orient", operation="connection-check", effort="low")
        report.update(ok=bool(res["payload"].get("ok")), reply=res["payload"].get("reply", ""), model=res["model"])
    except Exception as e:
        report["error"] = str(e)
    return report
