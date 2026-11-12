"""Verify and prepare common-word dictionary data only; no model/build tooling."""
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def verified(data, entry):
    return len(data) == entry["size"] and hashlib.sha256(data).hexdigest() == entry["sha256"]


def meaning(row):
    lines = [line.strip() for line in row["translation"].replace("\\n", "\n").splitlines() if line.strip()]
    # The dataset documents s=noun plural, p/d/i=verb inflections. A word with
    # verb inflections but no noun plural uses its verb sense when available.
    forms = {part.split(":", 1)[0] for part in row.get("exchange", "").split("/")}
    if forms.intersection({"p", "d", "i"}) and "s" not in forms:
        verbs = [line for line in lines if re.match(r"^(?:vt|vi|v)\.", line)]
        if verbs:
            lines = verbs
    for line in lines:
        if line.startswith("["):
            continue
        line = re.sub(r"^[a-zA-Z.&/ ]+\.\s*", "", line)
        first = re.split(r"[,，;；]", line, maxsplit=1)[0].strip()
        if 0 < len(first) <= 40 and re.search(r"[\u3400-\u9fff]", first):
            return first
    return None


def project(data):
    result = {}
    for row in csv.DictReader(io.StringIO(data.decode("utf-8-sig"))):
        word = row["word"].strip().lower()
        if not re.fullmatch(r"[a-z][a-z '\-]{0,100}", word):
            continue
        def rank(key):
            try:
                return int(row.get(key) or "0")
            except ValueError:
                return 0
        if not (0 < rank("frq") <= 20000 or 0 < rank("bnc") <= 20000 or rank("collins") > 0 or rank("oxford") > 0):
            continue
        translation = meaning(row)
        if translation:
            result.setdefault(word, translation)
    if len(result) < 10000:
        raise ValueError("Common-word dictionary unexpectedly incomplete")
    return result


def main():
    manifest = json.loads((ROOT / "scripts/dictionary.json").read_text())
    cache = ROOT / ".cache/fcboard-dictionary"
    cache.mkdir(parents=True, exist_ok=True)
    files = {}
    for item in manifest["files"]:
        target = cache / item["name"]
        if not target.exists() or not verified(target.read_bytes(), item):
            with urllib.request.urlopen(item["url"], timeout=180) as response:
                data = response.read()
            if not verified(data, item):
                raise ValueError("Dictionary checksum mismatch: " + item["name"])
            target.write_bytes(data)
        files[item["name"]] = target.read_bytes()
    entries = project(files["ecdict.csv"])
    content = json.dumps({"version": 1, "source": manifest["source"], "revision": manifest["revision"], "entries": entries}, ensure_ascii=False, separators=(",", ":")).encode()
    for directory in [ROOT / "public/dictionary", ROOT / "android/app/src/main/assets/dictionary"]:
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "en-zh.json").write_bytes(content)
        (directory / "LICENSE").write_bytes(files["LICENSE"])
    print("Verified common-word dictionary:", len(entries), "entries,", len(content), "bytes")


if __name__ == "__main__":
    main()
