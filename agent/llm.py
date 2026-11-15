"""The only place that talks to a model (design.md 9b, R21/R22). Provider and model come from env:

  STITCH_PROVIDER = stub | anthropic | bedrock   (default stub: no network, deterministic, for tests and replay)
  STITCH_MODEL    = model id (default claude-opus-5-5; bedrock adds the "anthropic." prefix if missing)
  STITCH_EFFORT   = low | medium | high | xhigh | max (default high; set "" to omit)
  AWS_PROFILE / AWS_REGION are read by the AWS SDK for bedrock. ANTHROPIC_API_KEY for anthropic.
Credentials never live in the repo.

call_model() returns a plain dict so callers never touch provider types:
  {"text": str, "tool_calls": [{"id", "name", "input"}], "stop_reason": str, "model": str,
   "usage": {"input_tokens": int, "output_tokens": int}}
"""
import json
import os

DEFAULT_MODEL = "claude-opus-5-5"
_stub_handler = None


def set_stub(handler):
    """Tests/replay: handler(messages, system, tools) -> dict in the call_model() shape (missing keys filled)."""
    global _stub_handler
    _stub_handler = handler


def _provider():
    return os.environ.get("STITCH_PROVIDER", "stub").strip().lower()


def _model_id(provider):
    m = os.environ.get("STITCH_MODEL", DEFAULT_MODEL).strip()
    if provider == "bedrock" and not m.startswith("anthropic."):
        m = "anthropic." + m
    return m


def _client(provider):
    if provider == "anthropic":
        import anthropic
        return anthropic.Anthropic()
    if provider == "bedrock":
        from anthropic import AnthropicBedrockMantle
        return AnthropicBedrockMantle(aws_region=os.environ.get("AWS_REGION") or "us-west-2")
    raise ValueError(f"unknown STITCH_PROVIDER {provider!r}")


def _normalise(resp, model):
    text, calls = [], []
    for b in resp.content:
        if b.type == "text":
            text.append(b.text)
        elif b.type == "tool_use":
            calls.append({"id": b.id, "name": b.name, "input": b.input if isinstance(b.input, dict) else json.loads(b.input)})
    u = resp.usage
    return {"text": "".join(text), "tool_calls": calls, "stop_reason": resp.stop_reason, "model": model,
            "usage": {"input_tokens": u.input_tokens, "output_tokens": u.output_tokens}}


def call_model(messages, system="", tools=None, max_tokens=4096):
    provider = _provider()
    if provider == "stub":
        if _stub_handler is None:
            raise RuntimeError("STITCH_PROVIDER=stub but no stub handler set (agent.llm.set_stub)")
        out = dict(_stub_handler(messages, system, tools or []))
        out.setdefault("text", ""); out.setdefault("tool_calls", []); out.setdefault("stop_reason", "end_turn")
        out.setdefault("model", "stub"); out.setdefault("usage", {"input_tokens": 0, "output_tokens": 0})
        return out
    model = _model_id(provider)
    kw = dict(model=model, max_tokens=max_tokens, messages=messages)
    if system:
        kw["system"] = system
    if tools:
        kw["tools"] = tools
    effort = os.environ.get("STITCH_EFFORT", "high").strip()
    if effort:
        kw["output_config"] = {"effort": effort}
    resp = _client(provider).messages.create(**kw)
    return _normalise(resp, model)
