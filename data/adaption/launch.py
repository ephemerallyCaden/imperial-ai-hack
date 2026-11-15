"""Launch one AutoScientist run on the raw-uploaded train.jsonl (issue #90, docs/adaption-handoff.md steps 3-4).

  ADAPTION_API_KEY=... python -I data/adaption/launch.py --model ID        # launch on the uploaded dataset, writes run_ids.json
  python -I data/adaption/launch.py --models                        # list trainable base models
  python -I data/adaption/launch.py --cancel                        # cancel that run, keep its IDs as run_ids.cancelled-*.json
  python -I data/adaption/launch.py --download                      # best LoRA -> data/adaption/best.tgz (gitignored)
  ... add --task reporter | triage to any command for those runs (own data file, run_ids_<task>.json, best_<task>.tgz)
  python -I data/adaption/launch.py --status                        # poll the run in run_ids.json

The key is read from the environment only and never written anywhere. run_ids.json holds IDs only (safe to commit).
data_format is the default "chat", so local eval must apply the model's chat template to the prompt.
"""
import json, os, sys
from adaption import Adaption

HERE = os.path.dirname(os.path.abspath(__file__))
# --task intake (default) | reporter | triage: each task has its own data file and run_ids file
TASK = sys.argv[sys.argv.index("--task") + 1] if "--task" in sys.argv else "intake"
DATA = {"intake": os.path.join(HERE, "train.jsonl"), "reporter": os.path.join(HERE, "reporter", "train.jsonl"),
        "triage": os.path.join(HERE, "reporter", "triage_train.jsonl")}[TASK]
IDS = os.path.join(HERE, "run_ids.json" if TASK == "intake" else f"run_ids_{TASK}.json")
DATASET_ID = "8d3f3b8e-4896-4339-940e-28420f4456fb"  # train.jsonl already uploaded raw (01:3x Sun); reused, not re-uploaded


def size_b(m):
    """Billions of parameters from model_size ("4B", "8x7B") or the id ("gemma-3-4b-it"); 999 if unknown."""
    import re
    for text in (m.api_model_size or "", m.id):
        x = re.search(r"(\d+)x(\d+(?:\.\d+)?)\s*[bB]", text)
        if x:
            return float(x.group(1)) * float(x.group(2))
        x = re.search(r"(\d+(?:\.\d+)?)\s*[bB](?![a-zA-Z])", text)
        if x:
            return float(x.group(1))
    return 999.0


c = Adaption()
if "--download" in sys.argv:  # best LoRA of the run in run_ids.json -> data/adaption/best.tgz (gitignored)
    rid, out = json.load(open(IDS))["run_id"], os.path.join(HERE, "best.tgz" if TASK == "intake" else f"best_{TASK}.tgz")
    print("downloading", rid, flush=True)
    n = 0
    with c.with_options(timeout=1800).autoscientist.with_streaming_response.download(rid) as r:
        print("HTTP", r.status_code, r.headers.get("content-type"), r.headers.get("content-length"), "bytes", flush=True)
        with open(out + ".part", "wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk); n += len(chunk)
                if n // (50 << 20) != (n - len(chunk)) // (50 << 20):
                    print(f"  {n >> 20} MB", flush=True)
    os.replace(out + ".part", out)
    print("saved", out, n, "bytes", flush=True)
    sys.exit(0)
models = c.autoscientist.list_models().models
for m in models:
    print("model", m.id, m.api_model_size, size_b(m), m.methods, "reasoning" if m.train_with_reasoning else "", flush=True)
if "--models" in sys.argv:
    sys.exit(0)
if not any(a in sys.argv for a in ("--model", "--status", "--cancel", "--download")):
    sys.exit("pass --model ID (auto-pick chose Mixtral-8x7B twice; pick explicitly from the list above)")
MODEL = sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else None
print("chosen model", MODEL, flush=True)
if "--cancel" in sys.argv:  # --cancel [RUN_ID]; default: the run in run_ids.json, which is then moved aside
    i = sys.argv.index("--cancel")
    rid = sys.argv[i + 1] if len(sys.argv) > i + 1 else json.load(open(IDS))["run_id"]
    print("cancel", rid, c.autoscientist.cancel(rid))
    if os.path.exists(IDS) and json.load(open(IDS))["run_id"] == rid:
        os.replace(IDS, IDS.replace(".json", f".cancelled-{rid[:8]}.json"))
    sys.exit(0)
if "--status" in sys.argv:  # --status [RUN_ID]; default: the run in run_ids.json
    i = sys.argv.index("--status")
    rid = sys.argv[i + 1] if len(sys.argv) > i + 1 else json.load(open(IDS))["run_id"]
    r = c.autoscientist.get(rid)
    print(rid, r.model)
    print(r.status, "iterations", r.iterations_completed, "/", r.max_iterations, "best_win_rate", r.best_win_rate,
          "download", r.download_available, "error", r.error)
    sys.exit(0)

if os.path.exists(IDS):
    sys.exit(f"{IDS} exists: a run was already launched. Use --status.")

if TASK != "intake":
    rows = sum(1 for _ in open(DATA))
    d = c.datasets.upload_file(DATA, name=f"closurecall-{TASK}-train-{rows}", processing_mode="raw",
                               column_mapping={"prompt": "prompt", "completion": "completion"})
    print("uploaded", TASK, rows, "rows -> dataset_id", d.dataset_id, flush=True)
    print("dataset status", c.datasets.wait_for_completion(d.dataset_id).status, flush=True)
    DATASET_ID = d.dataset_id
ds = c.datasets.get(DATASET_ID)
print("dataset", ds.to_dict() if hasattr(ds, "to_dict") else ds, flush=True)
try:
    print("recommended", c.autoscientist.recommend_hyperparams(dataset_id=DATASET_ID, model=MODEL), flush=True)
except Exception as e:  # dry look only; never block the launch
    print("recommend_hyperparams failed:", e, flush=True)
run = c.autoscientist.create(dataset_id=DATASET_ID, model=MODEL, training_method="instruction",
                             # no column_mapping: the raw upload canonicalised prompt/completion, AutoScientist infers
                             target_win_rate=0.7, max_iterations=1, idempotency_key=f"closurecall-{TASK}-run1-{MODEL}")
json.dump({"task": TASK, "dataset_id": DATASET_ID, "run_id": run.id, "model": MODEL, "training_method": "instruction",
           "data_format": "chat", "max_iterations": 1, "target_win_rate": 0.7, "rows": sum(1 for _ in open(DATA)),
           "created_at": str(run.created_at)}, open(IDS, "w"), indent=2)
print("run_id", run.id, "status", run.status, "-> wrote", IDS)
