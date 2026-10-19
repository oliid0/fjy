"""Use AGP's copied test output; the target APK is uninstalled after the test run."""
from pathlib import Path
import shutil


outputs = Path("android/app/build/outputs/connected_android_test_additional_output")
streams = list(outputs.rglob("scrcpy-stream.bin"))
if len(streams) != 1:
    raise SystemExit(f"Expected one actual device stream, found {len(streams)} in {outputs}")
if streams[0].stat().st_size <= 2000:
    raise SystemExit("The device stream is incomplete")
target = Path("node_modules/.fcboard-research/scrcpy-stream.bin")
target.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(streams[0], target)
print(f"Collected actual Scrcpy stream: {target.stat().st_size} bytes")
