"""Prepare the APK's offline Digital Ink assets; does not compile the app.

The pinned files and MDD metadata come from HWhiteBoard 5.42's model.zip.
Model bytes are fetched from Google, verified against both the original archive
SHA1 and extracted SHA256. Vendor binaries and installation IDs are not copied.
"""

import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile


def fetch_models():
    root = Path(__file__).resolve().parent.parent
    manifest = json.loads((root / "scripts/ink-models.json").read_text())
    target = root / "android/app/src/main/assets/digital-ink"
    target.mkdir(parents=True, exist_ok=True)
    for item in manifest["files"]:
        output = target / item["path"]
        if output.is_file() and hashlib.sha256(output.read_bytes()).hexdigest() == item["sha256"]:
            continue
        archive = bytearray()
        expected = None
        for attempt in range(20):
            try:
                request = urllib.request.Request(item["url"], headers={"Range": "bytes=" + str(len(archive)) + "-"})
                with urllib.request.urlopen(request, timeout=180) as response:
                    if response.status != 206:
                        archive.clear()
                    expected = len(archive) + int(response.headers["Content-Length"])
                    while True:
                        block = response.read(65536)
                        if not block:
                            break
                        archive.extend(block)
                if len(archive) == expected:
                    break
            except Exception:
                if attempt == 19:
                    raise
        if len(archive) != expected:
            raise ValueError("Incomplete Digital Ink download: " + item["url"])
        if hashlib.sha1(archive).hexdigest() != item["archiveSha1"]:
            raise ValueError("Digital Ink archive checksum mismatch: " + item["url"])
        with zipfile.ZipFile(io.BytesIO(archive)) as source:
            entries = [name for name in source.namelist() if Path(name).name == output.name]
            if len(entries) != 1:
                raise ValueError("Unexpected Digital Ink archive contents: " + item["url"])
            data = source.read(entries[0])
        if len(data) != item["size"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise ValueError("Digital Ink model checksum mismatch: " + output.name)
        output.parent.mkdir(parents=True, exist_ok=True)
        pending = output.with_suffix(output.suffix + ".pending")
        pending.write_bytes(data)
        pending.replace(output)
        print("Verified Digital Ink model:", output.name, len(data))
    (target / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    fetch_models()
