"""Prepare verified native artifacts only; never compile or modify machine code.

The pinned Sherpa AAR statically links ORT on ARM/x64, but shares ORT1.28.2
on x86. ORT's versioned C API preserves older API tables, so its runtime serves
both Sherpa API28 and Java JNI API23. Moonshine also needs API23, but bundles
a reduced runtime. Keep the full official runtime and remove Moonshine's
duplicate libraries. Preserve every retained entry byte-for-byte.
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
    algorithm = "sha256" if "sha256" in entry else "sha1"
    return len(data) == entry["size"] and hashlib.new(algorithm, data).hexdigest() == entry[algorithm]


def prepare(source, sherpa, target, manifest, speech):
    if not verified(source, manifest) or not verified(sherpa, speech["runtime"]):
        raise ValueError("Native runtime source checksum mismatch")
    with ZipFile(io.BytesIO(sherpa)) as existing:
        shared = existing.read(REMOVED)
        if (manifest["sharedX86Runtime"].encode() + b"\0") not in shared:
            raise ValueError("Sherpa's shared ORT runtime version changed")
    strip_libraries(source, target, {REMOVED})


def strip_libraries(source, target, removed):
    target.parent.mkdir(parents=True, exist_ok=True)
    pending = target.with_suffix(".aar.pending")
    with ZipFile(io.BytesIO(source)) as original, ZipFile(pending, "w") as output:
        if not removed.issubset(original.namelist()):
            raise ValueError("Expected duplicate ORT library is missing")
        for entry in original.infolist():
            if entry.filename not in removed:
                output.writestr(entry, original.read(entry))
    with ZipFile(io.BytesIO(source)) as original, ZipFile(pending) as output:
        if set(output.namelist()) != set(original.namelist()) - removed:
            raise ValueError("Unexpected native artifact contents")
        for entry in output.namelist():
            if output.read(entry) != original.read(entry):
                raise ValueError("Modified native artifact entry: " + entry)
    pending.replace(target)


def download(entry, cache):
    if not cache.exists() or not verified(cache.read_bytes(), entry):
        with urllib.request.urlopen(entry["url"], timeout=180) as response:
            data = response.read()
        if not verified(data, entry):
            raise ValueError("Native artifact checksum mismatch")
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(data)
    return cache.read_bytes()


def main():
    manifest = json.loads((ROOT / "scripts/android-ort.json").read_text())
    speech = json.loads((ROOT / "scripts/tts-models.json").read_text())
    libs = ROOT / "android/app/libs"
    source = download(manifest, libs / "onnxruntime-android-source.aar")
    prepare(source, (libs / "sherpa-onnx-1.13.8.aar").read_bytes(),
            libs / f'onnxruntime-android-{manifest["version"]}.aar', manifest, speech)
    moonshine = download(manifest["moonshine"], libs / "moonshine-voice-source.aar")
    strip_libraries(moonshine, libs / "moonshine-voice-0.1.5.aar", {
        f"jni/{abi}/libonnxruntime.so" for abi in ["arm64-v8a", "armeabi-v7a", "x86_64"]
    })
    print("Verified full ORT runtime; Moonshine duplicates removed, x86 uses pinned Sherpa")


if __name__ == "__main__":
    main()
