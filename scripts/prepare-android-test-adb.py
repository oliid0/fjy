"""Confirm the emulator's ADB TCP port after adbd restarts its transport."""
import os
import subprocess
import time


def adb(*arguments):
    try:
        result = subprocess.run(
            ["adb", "-s", os.environ.get("ANDROID_SERIAL", "emulator-5554"), *arguments],
            capture_output=True, text=True, timeout=5, check=False,
        )
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except subprocess.TimeoutExpired:
        return 1, "", "ADB transport did not respond"


deadline = time.monotonic() + 60
last_restart = -20.0
last_error = ""
while time.monotonic() < deadline:
    code, port, error = adb("shell", "getprop", "service.adb.tcp.port")
    if code == 0 and port == "5555":
        print("Verified emulator adbd TCP port 5555", flush=True)
        break
    last_error = error
    if time.monotonic() - last_restart > 15:
        code, output, error = adb("tcpip", "5555")
        print(output or error or "Waiting for adbd to restart", flush=True)
        last_restart = time.monotonic()
    time.sleep(1)
else:
    raise SystemExit("Emulator ADB TCP port could not be verified: " + last_error)
