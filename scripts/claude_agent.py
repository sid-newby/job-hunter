"""
scripts/claude_agent.py
Claude backend for scripts/llm.py, over the Claude Agent SDK.

Auth: the SDK uses the local Claude Code login when ANTHROPIC_API_KEY is unset.
setting_sources=[] keeps this repo's CLAUDE.md, hooks, and skills out of the agent.
"""

from pathlib import Path
from typing import Any, Dict, List, Optional

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    ToolUseBlock,
    query,
)

REPO_ROOT = Path(__file__).resolve().parent.parent


class AgentRunError(RuntimeError):
    pass


async def run_structured(
    prompt: str,
    *,
    system_prompt: str,
    schema: Dict[str, Any],
    model: str,
    effort: str = "high",
    mcp_servers: Optional[Dict[str, Any]] = None,
    allowed_tools: Optional[List[str]] = None,
    max_turns: Optional[int] = None,
    on_tool_use=None,
) -> Dict[str, Any]:
    """One structured turn, or an agentic loop over the given MCP tools. Built-in Claude Code tools are disabled."""
    allowed = list(allowed_tools or [])
    options = ClaudeAgentOptions(
        model=model,
        effort=effort,  # type: ignore[arg-type]
        system_prompt=system_prompt,
        tools=[],
        allowed_tools=allowed,
        mcp_servers=mcp_servers or {},
        permission_mode="dontAsk",
        setting_sources=[],
        cwd=str(REPO_ROOT),
        max_turns=max_turns if allowed else 1,
        output_format={"type": "json_schema", "schema": schema},
    )

    result: Optional[ResultMessage] = None
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, AssistantMessage) and on_tool_use:
            for block in message.content:
                if isinstance(block, ToolUseBlock) and block.name != "StructuredOutput":
                    on_tool_use(block.name.split("__")[-1], block.input)
        elif isinstance(message, ResultMessage):
            result = message

    if result is None:
        raise AgentRunError("Agent run produced no result message.")
    if result.is_error or result.subtype != "success":
        raise AgentRunError(f"Agent run ended with {result.subtype}: {str(result.result)[:500]}")
    if result.structured_output is None:
        raise AgentRunError("Agent run succeeded but returned no structured output.")

    usage = dict(result.usage or {})
    return {
        "payload": result.structured_output,
        "input_tokens": int(usage.get("input_tokens", 0) or 0) + int(usage.get("cache_read_input_tokens", 0) or 0) + int(usage.get("cache_creation_input_tokens", 0) or 0),
        "output_tokens": int(usage.get("output_tokens", 0) or 0),
        "nominal_cost": float(result.total_cost_usd or 0.0),
        "num_turns": int(getattr(result, "num_turns", 0) or 0),
    }
