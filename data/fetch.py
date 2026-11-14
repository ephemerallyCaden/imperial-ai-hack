"""Download raw data into $CLOSURECALL_DATA (default data/raw). Skips files already present at full size."""
import json, os, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.environ.get("CLOSURECALL_DATA", os.path.join(os.path.dirname(__file__), "raw"))
GIGA = "https://s3.ap-northeast-1.wasabisys.com/gigadb-datasets/live/pub/10.5524/100001_101000/100118/"


def get(url, path, size=None):
    if os.path.exists(path) and (size is None or os.path.getsize(path) == size):
        return f"skip {os.path.basename(path)}"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    urllib.request.urlretrieve(url, path + ".part")
    os.replace(path + ".part", path)
    return f"got  {os.path.basename(path)}"


def main():
    jobs = [
        ("https://zenodo.org/api/records/7660424/files/Dataset.zip/content", f"{ROOT}/embryo/Dataset.zip", 198715081),
        ("https://raw.githubusercontent.com/jlager/BINNs/master/Data/cell_density_profiles.npy", f"{ROOT}/jin/cell_density_profiles.npy", None),
        (GIGA + "metadata.mat", f"{ROOT}/zaritsky/metadata.mat", None),
    ]
    os.makedirs(f"{ROOT}/zaritsky", exist_ok=True)
    get("https://gigadb.org/api/dataset?doi=100118", f"{ROOT}/zaritsky/gigadb_index.json")  # file list + conditions
    files = json.load(open(f"{ROOT}/zaritsky/gigadb_index.json"))["data"]["files"]
    jobs += [(f["url"], f"{ROOT}/zaritsky/{f['file_name']}", f["file_size"]) for f in files if f["file_name"].endswith(".tar.gz")]
    with ThreadPoolExecutor(6) as ex:  # GigaDB throttles per connection
        for msg in ex.map(lambda j: get(*j), jobs):
            print(msg)


if __name__ == "__main__":
    main()
