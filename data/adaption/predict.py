"""Predictions on the REAL test set for score.py (issue #90, docs/adaption-handoff.md step 6).

  python -I data/adaption/predict.py hf --model <HF base id> --out preds_base.jsonl
  python -I data/adaption/predict.py hf --model <HF base id> --adapter best.tgz --out preds_ft.jsonl
  python -I data/adaption/predict.py claude --out preds_claude.jsonl          # needs Anthropic credentials

Every backend gets the same single user message, build_prompt(paragraph) from prompt.py, with no system prompt and no
examples. hf: the model's chat template (training used data_format "chat"), greedy decoding, max 300 new tokens.
claude: claude-opus-5-5, zero-shot, same prompt (sampling params are not settable on this model; effort "low").
Output rows: {"id", "completion"}.
"""
import argparse, json, os, sys, tarfile, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prompt import build_prompt

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("backend", choices=["hf", "claude"])
ap.add_argument("--model")
ap.add_argument("--adapter", help="LoRA dir or the downloaded .tgz")
ap.add_argument("--test", default=os.path.join(HERE, "test_real.jsonl"))
ap.add_argument("--out", required=True)
ap.add_argument("--limit", type=int)
a = ap.parse_args()
rows = [json.loads(l) for l in open(a.test) if l.strip()][: a.limit]


def hf_generate():
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    adapter = a.adapter
    if adapter and adapter.endswith((".tgz", ".tar.gz")):
        d = tempfile.mkdtemp()
        tarfile.open(adapter).extractall(d, filter="data")
        hits = [r for r, _, fs in os.walk(d) if "adapter_config.json" in fs]
        adapter = hits[0]
    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    tok = AutoTokenizer.from_pretrained(adapter or a.model)
    model = AutoModelForCausalLM.from_pretrained(a.model, torch_dtype=torch.bfloat16 if dev == "mps" else torch.float32)
    if adapter:
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, adapter)
    model.to(dev).eval()
    for r in rows:
        msgs = [{"role": "user", "content": build_prompt(r["paragraph"])}]
        enc = tok.apply_chat_template(msgs, add_generation_prompt=True, return_tensors="pt", return_dict=True,
                                      enable_thinking=False).to(dev)  # extra kwarg is ignored by non-Qwen templates
        with torch.no_grad():
            out = model.generate(**enc, max_new_tokens=300, do_sample=False,
                                 pad_token_id=tok.pad_token_id or tok.eos_token_id)
        yield r["id"], tok.decode(out[0, enc["input_ids"].shape[1]:], skip_special_tokens=True)


def claude_generate():
    import anthropic
    client = anthropic.Anthropic()
    for r in rows:
        resp = client.beta.messages.create(
            model="claude-opus-5-5", max_tokens=16000, output_config={"effort": "low"},
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
            messages=[{"role": "user", "content": build_prompt(r["paragraph"])}])
        if resp.stop_reason == "refusal":
            print(r["id"], "refused", file=sys.stderr)
        yield r["id"], "".join(b.text for b in resp.content if b.type == "text")


gen = hf_generate() if a.backend == "hf" else claude_generate()
with open(a.out, "w") as f:
    for i, (rid, text) in enumerate(gen, 1):
        f.write(json.dumps({"id": rid, "completion": text}, ensure_ascii=False) + "\n")
        f.flush()
        print(f"{i}/{len(rows)} {rid}: {text[:90]!r}", flush=True)
