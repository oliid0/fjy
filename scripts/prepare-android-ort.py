"""Prepare verified native artifacts only; never compile or modify machine code.

The pinned Sherpa AAR statically links ORT on ARM/x64, but shares ORT1.28.2
on x86. ORT's versioned C API preserves older API tables, so its runtime serves
both Sherpa API28 and Java JNI API22. Remove only the duplicate older x86
runtime from the Java AAR; preserve every other entry exactly, including JNI.
"""
import hashlib
import io
import json
from pathlib import Path
import urllib.request
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent.parent
REMOVED = "jni/x86/libonnxruntime.so"


def verified(data, entry):
    return len(data) == entry["size"] and hashlib.sha256(data).hexdigest() == entry["sha256"]


def prepare(source, sherpa, target, manifest, speech):
    if not verified(source, manifest) or not verified(sherpa, speech["runtime"]):
        raise ValueError("Native runtime source checksum mismatch")
    with ZipFile(io.BytesIO(sherpa)) as existing:
        shared = existing.read(REMOVED)
        if (manifest["sharedX86Runtime"].encode() + b"\0") not in shared:
            raise ValueError("Sherpa's shared ORT runtime version changed")
    target.parent.mkdir(parents=True, exist_ok=True)
    pending = target.with_suffix(".aar.pending")
    with ZipFile(io.BytesIO(source)) as original, ZipFile(pending, "w") as output:
        if REMOVED not in original.namelist():
            raise ValueError("Expected duplicate x86 ORT library is missing")
        for entry in original.infolist():
            if entry.filename != REMOVED:
                output.writestr(entry, original.read(entry))
    with ZipFile(io.BytesIO(source)) as original, ZipFile(pending) as output:
        if set(output.namelist()) != set(original.namelist()) - {REMOVED}:
            raise ValueError("Unexpected native artifact contents")
        for entry in output.namelist():
            if output.read(entry) != original.read(entry):
                raise ValueError("Modified native artifact entry: " + entry)
    pending.replace(target)


def main():
    manifest = json.loads((ROOT / "scripts/android-ort.json").read_text())
    speech = json.loads((ROOT / "scripts/tts-models.json").read_text())
    cache = ROOT / "android/app/libs/onnxruntime-android-source.aar"
    if not cache.exists() or not verified(cache.read_bytes(), manifest):
        with urllib.request.urlopen(manifest["url"], timeout=180) as response:
            data = response.read()
        if not verified(data, manifest):
            raise ValueError("ORT Android AAR checksum mismatch")
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(data)
    prepare(cache.read_bytes(), (ROOT / "android/app/libs/sherpa-onnx-1.13.8.aar").read_bytes(),
            ROOT / "android/app/libs/onnxruntime-android-1.22.0.aar", manifest, speech)
    print("Verified native ORT artifacts; shared x86 runtime comes only from pinned Sherpa")


if __name__ == "__main__":
    main()
