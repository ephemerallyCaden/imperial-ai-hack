"""Download raw data into $CLOSURECALL_DATA (default data/raw). Skips files already present at full size.

Whole files: fly embryo (Zenodo 7660424), Jin profiles (BINNs repo), Zaritsky (GigaDB 100118).
Selected members of large zips, fetched with HTTP range requests (no 12.6 GB download):
  WHAD (Zenodo 12806149, whad_camad.zip):
    whad/x/whad/{masks,images}/MCF10A/exp1/...  the 16 annotated positions (data/build_whad.py, data/segment.py)
    whad_full/whad/images/MCF10A/exp{1,2}/...   unannotated positions (data/build_whad_auto.py, nca/real_data.py)
  WHiM-BC (Zenodo 8131123): whimbc/WHiM-BC Dataset/{Monolayer,Sphere}/*/gray/*.png (data/build_whimbc.py)
Zenodo rate-limits many small requests, so members are fetched as a few large contiguous byte ranges.
Usage: python data/fetch.py [--only whad|whimbc|basic]
"""
import io, json, os, re, struct, sys, time, urllib.error, urllib.request, zipfile, zlib
from concurrent.futures import ThreadPoolExecutor

ROOT = os.environ.get("CLOSURECALL_DATA", os.path.join(os.path.dirname(__file__), "raw"))
GIGA = "https://s3.ap-northeast-1.wasabisys.com/gigadb-datasets/live/pub/10.5524/100001_101000/100118/"
WHAD_ZIP = "https://zenodo.org/api/records/12806149/files/whad_camad.zip/content"
WHIMBC_ZIP = "https://zenodo.org/api/records/8131123/files/WHiM-BC%20Dataset.zip/content"
ANNOTATED = r"/exp1/part_I/(C61/P[123]|CC/P[134]|N61/P1|NC/P1)/|/exp1/part_II/(C61/P[123]|CC/P[1234]|N61/P1)/"


def get(url, path, size=None):
    if os.path.exists(path) and (size is None or os.path.getsize(path) == size):
        return f"skip {os.path.basename(path)}"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    urllib.request.urlretrieve(url, path + ".part")
    os.replace(path + ".part", path)
    return f"got  {os.path.basename(path)}"


def get_range(url, a, b):
    for _ in range(8):
        try:
            req = urllib.request.Request(url, headers={"Range": f"bytes={a}-{b}"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            wait = int(e.headers.get("Retry-After", 30)); print(f"  rate-limited, waiting {wait}s", flush=True); time.sleep(wait)
        except Exception as e:  # network blip
            print("  retrying after:", e, flush=True); time.sleep(10)
    raise RuntimeError(f"gave up on {url} bytes {a}-{b}")


class _RangeFile(io.RawIOBase):
    """Seekable file over HTTP ranges, used only to read the zip's central directory."""
    def __init__(self, url):
        self.url, self.pos = url, 0
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Range": "bytes=0-0"})) as r:
            self.size = int(r.headers["Content-Range"].split("/")[-1]); self.url = r.geturl()
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = {0: off, 1: self.pos + off, 2: self.size + off}[whence]; return self.pos
    def readinto(self, b):
        if self.pos >= self.size:
            return 0
        d = get_range(self.url, self.pos, min(self.pos + len(b), self.size) - 1)
        b[:len(d)] = d; self.pos += len(d); return len(d)


def extract_members(url, out, pattern, skip=None):
    """Fetch zip members matching `pattern` (and not `skip`) into `out`, as few large ranges as possible."""
    z = zipfile.ZipFile(io.BufferedReader(_RangeFile(url), buffer_size=1 << 20))
    infos = sorted(z.infolist(), key=lambda i: i.header_offset)
    nxt = {i.filename: (infos[k + 1].header_offset if k + 1 < len(infos) else i.header_offset + 30 + 65536 + i.compress_size)
           for k, i in enumerate(infos)}
    pat, sk = re.compile(pattern), re.compile(skip) if skip else None
    want = [i for i in infos if not i.is_dir() and pat.search(i.filename) and not (sk and sk.search(i.filename))
            and not i.filename.startswith("/") and ".." not in i.filename.split("/")]
    want = [i for i in want if not (os.path.exists(os.path.join(out, i.filename))
                                    and os.path.getsize(os.path.join(out, i.filename)) == i.file_size)]
    print(f"  {len(want)} files to fetch ({sum(i.compress_size for i in want) / 1e9:.2f} GB)", flush=True)
    runs, cur = [], []
    for i in want:
        if cur and (i.header_offset - nxt[cur[-1].filename] > 8 << 20 or nxt[i.filename] - cur[0].header_offset > 400 << 20):
            runs.append(cur); cur = []
        cur.append(i)
    runs += [cur] if cur else []
    for n, run in enumerate(runs, 1):
        a = run[0].header_offset
        buf = get_range(url, a, nxt[run[-1].filename] - 1)
        for i in run:
            o = i.header_offset - a
            assert buf[o:o + 4] == b"PK\x03\x04", "bad local header"
            nlen, xlen = struct.unpack("<HH", buf[o + 26:o + 30])
            raw = buf[o + 30 + nlen + xlen:o + 30 + nlen + xlen + i.compress_size]
            data = raw if i.compress_type == 0 else zlib.decompress(raw, -15)
            assert len(data) == i.file_size
            dest = os.path.join(out, i.filename); os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as f:
                f.write(data)
        print(f"  range {n}/{len(runs)}: {len(run)} files", flush=True)


def basic():
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


def whad():
    print("WHAD annotated MCF10A exp1 (masks + images of the 16 annotated positions)")
    extract_members(WHAD_ZIP, f"{ROOT}/whad/x", r"^whad/masks/MCF10A/exp1/")
    extract_members(WHAD_ZIP, f"{ROOT}/whad/x", r"^whad/images/MCF10A/exp1/(" + ANNOTATED.replace("/exp1/", "") + ")")
    print("WHAD unannotated MCF10A exp1 + exp2 images (auto-segmented)")
    extract_members(WHAD_ZIP, f"{ROOT}/whad_full", r"^whad/images/MCF10A/exp[12]/", skip=ANNOTATED)


def whimbc():
    print("WHiM-BC segmentation masks")
    extract_members(WHIMBC_ZIP, f"{ROOT}/whimbc", r"/(Monolayer|Sphere)/[^/]+/gray/[^/]+\.png$|readme\.txt$", skip=r"__MACOSX")


if __name__ == "__main__":
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    for name, fn in (("basic", basic), ("whad", whad), ("whimbc", whimbc)):
        if only in (None, name):
            fn()
