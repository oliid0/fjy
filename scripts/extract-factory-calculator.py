"""Extract the supplied calculator's unchanged DEX and compiled resources.

No compilation, APK installation, manifest rewriting or vendor service startup.
The remaining three DEX files contain support libraries already provided by the
host; every com.bsd.bsdcalculator class is in the verified classes4.dex.
"""

import hashlib
from pathlib import Path
import zipfile


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "ss/HWhiteBoard-deps-apk/06_计算器_Calculator_com.bsd.bsdcalculator_v16.apk"
DESTINATION = ROOT / "android/app/src/main/assets/factory/calculator-core.apk"
SOURCE_SHA256 = "35bcb7c6dc1349ec69a0d20ccc0c5caeb566a6f4d3f1889caeefd18e1d21420a"


def extract():
    if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError("Calculator source differs from the inspected APK")
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(SOURCE) as source, zipfile.ZipFile(DESTINATION, "w") as target:
        names = [name for name in source.namelist() if name.startswith("res/") or name in ("AndroidManifest.xml", "resources.arsc", "classes4.dex")]
        for name in sorted(names):
            entry = zipfile.ZipInfo("classes.dex" if name == "classes4.dex" else name)
            entry.compress_type = zipfile.ZIP_STORED if name == "resources.arsc" else zipfile.ZIP_DEFLATED
            target.writestr(entry, source.read(name), compresslevel=9)
    print(f"{DESTINATION.relative_to(ROOT)}: {DESTINATION.stat().st_size} bytes; SHA256 {hashlib.sha256(DESTINATION.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    extract()
