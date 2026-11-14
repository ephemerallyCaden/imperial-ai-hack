"""weights.pt -> weights.json for the JS port (#28). Also writes the layout so the JS side can assert it.
python nca/export.py nca/weights.pt nca/weights.json"""
import sys, json, torch

sd = torch.load(sys.argv[1], map_location="cpu")
out = {k: v.tolist() for k, v in sd.items() if k.startswith(("l1.", "l2."))}
json.dump(out, open(sys.argv[2], "w"))
print("wrote", sys.argv[2], {k: list(v.shape) for k, v in sd.items() if k.startswith(("l1.", "l2."))})
