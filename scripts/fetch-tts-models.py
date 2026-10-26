"""Prepare verified Android TTS inputs only. No compilation or system TTS download."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def verified(data, entry):
    return len(data) == entry["size"] and hashlib.sha256(data).hexdigest() == entry["sha256"]


def download(entry, target):
    if target.is_file() and verified(target.read_bytes(), entry):
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(entry["url"], timeout=180) as response:
        data = response.read()
    if not verified(data, entry):
        raise ValueError("TTS resource checksum mismatch: " + target.name)
    pending = target.with_suffix(target.suffix + ".pending")
    pending.write_bytes(data)
    pending.replace(target)
    print("Verified", target.name, len(data), "bytes", flush=True)


def main():
    manifest = json.loads((ROOT / "scripts/tts-models.json").read_text())
    download(manifest["runtime"], ROOT / "android/app/libs/sherpa-onnx-1.13.8.aar")
    target = ROOT / "android/app/src/main/assets/tts/melo"
    target.mkdir(parents=True, exist_ok=True)
    (target.parent / "Sherpa-LICENSE.txt").write_bytes((ROOT / "scripts/tts-Sherpa-LICENSE.txt").read_bytes())
    for item in manifest["files"]:
        if Path(item["name"]).name != item["name"]:
            raise ValueError("Invalid TTS asset name")
        download(item, target / item["name"])
    # Remove the former managed weight only after every replacement is verified.
    # Never delete a user-supplied or unrecognized file to make an APK smaller.
    for item in manifest.get("obsolete", []):
        if Path(item["name"]).name != item["name"]:
            raise ValueError("Invalid obsolete TTS asset name")
        old = target / item["name"]
        if old.is_file():
            if not verified(old.read_bytes(), item):
                raise ValueError("Unrecognized obsolete TTS asset: " + old.name)
            old.unlink()


if __name__ == "__main__":
    main()
