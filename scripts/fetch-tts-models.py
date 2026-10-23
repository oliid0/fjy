"""Prepare verified Android TTS inputs only. No compilation or system TTS download."""
import hashlib
import json
from pathlib import Path
import tarfile
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
    files = manifest["files"]
    if all((target / item["name"]).is_file() and verified((target / item["name"]).read_bytes(), item) for item in files):
        return
    archive = ROOT / "node_modules/.cache/fcboard-tts/melo.tar.bz2"
    download(manifest["archive"], archive)
    with tarfile.open(archive) as bundle:
        for item in files:
            # Extract only pinned regular files; never follow archive links or paths.
            member = bundle.getmember("vits-melo-tts-zh_en/" + item["name"])
            if not member.isfile():
                raise ValueError("Invalid TTS model archive member")
            with bundle.extractfile(member) as source:
                data = source.read()
            if not verified(data, item):
                raise ValueError("TTS model checksum mismatch: " + item["name"])
            output = target / item["name"]
            pending = output.with_suffix(output.suffix + ".pending")
            pending.write_bytes(data)
            pending.replace(output)
            print("Verified", item["name"], len(data), "bytes", flush=True)


if __name__ == "__main__":
    main()
