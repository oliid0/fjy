#!/usr/bin/env bash
set -euo pipefail

# Keep native renderer/ANR evidence even if an instrumentation test stops responding.
fcboard_root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
fcboard_reports="$fcboard_root/android/app/build/reports/native-runtime"
mkdir -p "$fcboard_reports"
adb logcat -c
adb logcat -v threadtime > "$fcboard_reports/logcat.txt" &
fcboard_logcat_pid=$!
trap 'kill "$fcboard_logcat_pid" 2>/dev/null || true' EXIT

cd "$fcboard_root/android"
./gradlew :app:connectedDebugAndroidTest --no-daemon -Pandroid.testInstrumentationRunnerArguments.timeout_msec=90000
