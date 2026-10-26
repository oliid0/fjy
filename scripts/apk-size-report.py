"""Read CI APKs without extracting models; distinguish ZIP and installed content."""
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile


for apk in sorted(Path("android/app/build/outputs/apk/debug").glob("*.apk")):
    groups = defaultdict(lambda: [0, 0])
    with ZipFile(apk) as archive:
        for item in archive.infolist():
            if item.is_dir():
                continue
            name = item.filename
            group = (
                "/".join(name.split("/")[:2])
                if name.startswith(("assets/", "lib/"))
                else "code and resources"
            )
            groups[group][0] += item.compress_size
            groups[group][1] += item.file_size
    print(f"### {apk.name} ({apk.stat().st_size / 1048576:.1f} MiB)")
    print("\n| Content | Compressed MiB | Uncompressed MiB |")
    print("| --- | ---: | ---: |")
    for group, (packed, unpacked) in sorted(groups.items()):
        print(f"| {group} | {packed / 1048576:.1f} | {unpacked / 1048576:.1f} |")
    print("\nUncompressed ZIP sizes exclude app data, extracted model copies and caches.\n")
