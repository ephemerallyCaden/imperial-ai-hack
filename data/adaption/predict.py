"""Predictions on the REAL test set for score.py (issue #90, docs/adaption-handoff.md step 6).

  python -I data/adaption/predict.py hf --model <HF base id> --out preds_base.jsonl
  python -I data/adaption/predict.py hf --model <HF base id> --adapter best.tgz --out preds_ft.jsonl
  python -I data/adaption/predict.py claude --out preds_claude.jsonl          # needs Anthropic credentials

Every backend gets the same single user message, build_prompt(paragraph) from prompt.py, with no system prompt and no
examples. hf: the model's chat template (training used data_format "chat"), greedy decoding, max 512 new tokens, thinking off where the template supports it.
claude: claude-opus-5-5, zero-shot, same prompt (sampling params are not settable on this model; effort "low").
Output rows: {"id", "completion"}.
"""
import argparse, atexit, json, os, shutil, sys, tempfile

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
ap.add_argument("--max-new", type=int, default=512)
ap.add_argument("--raw-prompt", action="store_true", help="rows carry their own 'prompt' (reporter/triage test sets)")
a = ap.parse_args()
rows = [json.loads(l) for l in open(a.test) if l.strip()][: a.limit]


def tmpdir():
    """Temp dir removed when the script exits (renamed adapter copy, unpacked archive)."""
    d = tempfile.mkdtemp()
    atexit.register(shutil.rmtree, d, ignore_errors=True)
    return d


def text_only_adapter(src):
    """Adaption trains Qwen3.5 through its multimodal wrapper, so LoRA keys read model.language_model.layers.N...; the
    text-only AutoModelForCausalLM names the same layers model.layers.N... . PEFT silently attaches NOTHING on a name
    mismatch (fine-tune output == base output), so rename the keys into a temp copy and check every key maps."""
    from safetensors.torch import load_file, save_file
    w = load_file(os.path.join(src, "adapter_model.safetensors"))
    if not any(".language_model." in k for k in w):
        return src
    dst = tmpdir()
    for f in os.listdir(src):
        if f != "adapter_model.safetensors":
            shutil.copy(os.path.join(src, f), dst)
    save_file({k.replace("model.language_model.", "model."): v for k, v in w.items()}, os.path.join(dst, "adapter_model.safetensors"))
    print(f"adapter: renamed {len(w)} LoRA tensors to the text-only layer names", file=sys.stderr)
    return dst


def hf_generate():
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    adapter = a.adapter
    if adapter and adapter.endswith((".tgz", ".tar.gz")):
        d = tmpdir()
        import subprocess  # Adaption serves zstd despite the .tgz name and gzip content-type; bsdtar/GNU tar autodetect
        # Only ever run on our own Adaption adapter download. bsdtar and GNU tar both refuse members with absolute paths or
        # '..' by default (no -P), so a crafted archive can't write outside d. Belt and braces: list the members first and
        # refuse the archive if any is absolute or has a '..' component (tarfile can't read zstd on Python 3.12).
        names = subprocess.run(["tar", "-tf", adapter], check=True, capture_output=True, text=True).stdout.splitlines()
        bad = [n for n in names if n.startswith("/") or ".." in n.replace("\\", "/").split("/")]
        if bad:
            sys.exit(f"refusing adapter archive with unsafe member paths: {bad[:3]}")
        subprocess.run(["tar", "-xf", adapter, "-C", d], check=True)
        hits = [r for r, _, fs in os.walk(d) if "adapter_config.json" in fs]
        adapter = hits[0]
    if adapter:
        adapter = text_only_adapter(adapter)
    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    tok = AutoTokenizer.from_pretrained(adapter or a.model)
    model = AutoModelForCausalLM.from_pretrained(a.model, torch_dtype=torch.bfloat16 if dev == "mps" else torch.float32)
    if adapter:
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, adapter)
        n_lora = sum(1 for n, _ in model.named_modules() if n.endswith("lora_A"))
        if n_lora == 0:
            sys.exit("adapter attached to 0 modules: key names do not match the base model")
        print(f"adapter: LoRA attached to {n_lora} modules", file=sys.stderr)
    model.to(dev).eval()
    for r in rows:
        msgs = [{"role": "user", "content": r["prompt"] if a.raw_prompt else build_prompt(r["paragraph"])}]
        enc = tok.apply_chat_template(msgs, add_generation_prompt=True, return_tensors="pt", return_dict=True,
                                      enable_thinking=False).to(dev)  # extra kwarg is ignored by non-Qwen templates
        with torch.no_grad():
            out = model.generate(**enc, max_new_tokens=a.max_new, do_sample=False,
                                 pad_token_id=tok.pad_token_id if tok.pad_token_id is not None else tok.eos_token_id)
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
