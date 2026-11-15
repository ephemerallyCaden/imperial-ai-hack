"""Launch one AutoScientist run on the raw-uploaded train.jsonl (issue #90, docs/adaption-handoff.md steps 3-4).

  ADAPTION_API_KEY=... python -I data/adaption/launch.py [--model ID]   # launch on the uploaded dataset, writes run_ids.json
  python -I data/adaption/launch.py --models                        # list trainable base models
  python -I data/adaption/launch.py --status                        # poll the run in run_ids.json

The key is read from the environment only and never written anywhere. run_ids.json holds IDs only (safe to commit).
data_format is the default "chat", so local eval must apply the model's chat template to the prompt.
"""
import json, os, sys
from adaption import Adaption

HERE = os.path.dirname(os.path.abspath(__file__))
IDS = os.path.join(HERE, "run_ids.json")
DATASET_ID = "8d3f3b8e-4896-4339-940e-28420f4456fb"  # train.jsonl already uploaded raw (01:3x Sun); reused, not re-uploaded


def size_b(m):
    try:
        return float((m.api_model_size or "999").upper().rstrip("B"))
    except ValueError:
        return 999.0


c = Adaption()
models = c.autoscientist.list_models().models
for m in models:
    print("model", m.id, m.api_model_size, m.methods, "reasoning" if m.train_with_reasoning else "", flush=True)
if "--models" in sys.argv:
    sys.exit(0)
# smallest SFT model without reasoning traces (plain JSON replies, fast training and local eval); override with --model ID
ok = [m for m in models if "sft" in m.methods and not m.train_with_reasoning] or models
# prefer instruction-tuned bases (-it / Instruct): base "-pt" models have no chat template for local eval
ok = [m for m in ok if m.id.lower().endswith("-it") or "instruct" in m.id.lower()] or ok
MODEL = sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else min(ok, key=size_b).id
print("chosen model", MODEL, flush=True)
if "--status" in sys.argv:
    ids = json.load(open(IDS))
    r = c.autoscientist.get(ids["run_id"])
    print(r.status, "iterations", r.iterations_completed, "/", r.max_iterations, "best_win_rate", r.best_win_rate,
          "download", r.download_available, "error", r.error)
    sys.exit(0)

if os.path.exists(IDS):
    sys.exit(f"{IDS} exists: a run was already launched. Use --status.")

ds = c.datasets.get(DATASET_ID)
print("dataset", ds.to_dict() if hasattr(ds, "to_dict") else ds, flush=True)
try:
    print("recommended", c.autoscientist.recommend_hyperparams(dataset_id=DATASET_ID, model=MODEL), flush=True)
except Exception as e:  # dry look only; never block the launch
    print("recommend_hyperparams failed:", e, flush=True)
run = c.autoscientist.create(dataset_id=DATASET_ID, model=MODEL, training_method="instruction",
                             # no column_mapping: the raw upload canonicalised prompt/completion, AutoScientist infers
                             target_win_rate=0.7, max_iterations=1, idempotency_key="closurecall-90-run1-" + MODEL)
json.dump({"dataset_id": DATASET_ID, "run_id": run.id, "model": MODEL, "training_method": "instruction",
           "data_format": "chat", "max_iterations": 1, "target_win_rate": 0.7, "rows": 1500,
           "created_at": str(run.created_at)}, open(IDS, "w"), indent=2)
print("run_id", run.id, "status", run.status, "-> wrote", IDS)
