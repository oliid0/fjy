import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from zipfile import ZipFile, ZIP_DEFLATED


spec = importlib.util.spec_from_file_location(
    "prepare_android_ort", Path(__file__).with_name("prepare-android-ort.py")
)
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


def archive(entries):
    output = io.BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as zipped:
        for name, data in entries.items():
            zipped.writestr(name, data)
    return output.getvalue()


class NativeRuntimePackagingTest(unittest.TestCase):
    def test_removes_only_duplicate_libraries_and_preserves_jni_classes_and_licenses(self):
        duplicates = {f"jni/{abi}/libonnxruntime.so" for abi in
                      ("arm64-v8a", "armeabi-v7a", "x86_64")}
        retained = {"classes.jar": b"java", "META-INF/LICENSE": b"license",
                    "jni/arm64-v8a/libmoonshine.so": b"speech",
                    "jni/arm64-v8a/libmoonshine-jni.so": b"jni"}
        source = archive({**retained, **{name: b"runtime" for name in duplicates}})
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "moonshine.aar"
            runtime.strip_libraries(source, target, duplicates)
            with ZipFile(target) as result:
                self.assertEqual(set(result.namelist()), set(retained))
                for name, data in retained.items():
                    self.assertEqual(result.read(name), data)

    def test_missing_expected_library_cannot_replace_previous_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "runtime.aar"
            target.write_bytes(b"previous verified artifact")
            with self.assertRaises(ValueError):
                runtime.strip_libraries(archive({"classes.jar": b"java"}), target,
                                        {"jni/x86/libonnxruntime.so"})
            self.assertEqual(target.read_bytes(), b"previous verified artifact")

    def test_published_checksums_and_size_are_both_required(self):
        data = b"pinned artifact"
        for algorithm in ("sha256", "sha1"):
            entry = {"size": len(data), algorithm: hashlib.new(algorithm, data).hexdigest()}
            self.assertTrue(runtime.verified(data, entry))
            self.assertFalse(runtime.verified(data + b"tampered", entry))
            self.assertFalse(runtime.verified(b"wrong artifact", entry))


    def test_download_uses_verified_fallback_when_primary_is_rate_limited(self):
        data = b"pinned artifact"
        entry = {
            "url": "https://example.com/primary",
            "fallback": "https://example.com/fallback",
            "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
        rate_limit = HTTPError(entry["url"], 429, "Too Many Requests", None, None)
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "runtime.aar"
            with patch.object(runtime.urllib.request, "urlopen",
                              side_effect=[rate_limit, io.BytesIO(data)]) as open_url:
                self.assertEqual(runtime.download(entry, target), data)
                self.assertEqual(target.read_bytes(), data)
                self.assertEqual(runtime.download(entry, target), data)
                self.assertEqual(
                    [call.args[0].full_url for call in open_url.call_args_list],
                    [entry["url"], entry["fallback"]],
                )

    def test_download_rejects_corrupt_responses_from_both_sources(self):
        entry = {
            "url": "https://example.com/primary",
            "fallback": "https://example.com/fallback",
            "size": 3,
            "sha1": hashlib.sha1(b"aar").hexdigest(),
        }
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "runtime.aar"
            with patch.object(runtime.urllib.request, "urlopen",
                              side_effect=[io.BytesIO(b"html"), io.BytesIO(b"bad")]):
                with self.assertRaisesRegex(RuntimeError, "size or checksum mismatch"):
                    runtime.download(entry, target)
                self.assertFalse(target.exists())

    def test_repository_assets_are_verified_and_never_need_network(self):
        manifest = json.loads((runtime.ROOT / "scripts/android-ort.json").read_text())
        resources = [
            (manifest, "android/app/libs/onnxruntime-android-source.aar"),
            (manifest["moonshine"], "android/app/libs/moonshine-voice-source.aar"),
            (manifest["fastenhancer"], "android/app/src/main/assets/media/fastenhancer-s-48khz.onnx"),
            (manifest["fastenhancerLicense"], "android/app/src/main/assets/media/fastenhancer-LICENSE"),
        ]
        with patch.object(runtime.urllib.request, "urlopen", side_effect=AssertionError("Local resources must not download")):
            for entry, path in resources:
                with self.subTest(path=path):
                    data = runtime.download(entry, runtime.ROOT / path)
                    self.assertTrue(runtime.verified(data, entry))

    def test_invalid_local_resource_is_preserved_until_verified_replacement(self):
        data = b"verified artifact"
        entry = {"url": "https://example.com/primary", "fallback": "https://example.com/fallback",
                 "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "runtime.aar"
            target.write_bytes(b"previous local content")
            with patch.object(runtime.urllib.request, "urlopen", side_effect=[io.BytesIO(b"html"), io.BytesIO(b"bad")]):
                with self.assertRaises(RuntimeError):
                    runtime.download(entry, target)
            self.assertEqual(target.read_bytes(), b"previous local content")
            with patch.object(runtime.urllib.request, "urlopen", return_value=io.BytesIO(data)):
                self.assertEqual(runtime.download(entry, target), data)
            self.assertEqual(target.read_bytes(), data)

    def test_transient_failures_retry_after_trying_the_other_source(self):
        data = b"verified artifact"
        entry = {"url": "https://example.com/primary", "fallback": "https://example.com/fallback",
                 "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        limited = HTTPError(entry["url"], 429, "Too Many Requests", None, None)
        forbidden = HTTPError(entry["fallback"], 403, "Forbidden", None, None)
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "runtime.aar"
            with patch.object(runtime.urllib.request, "urlopen", side_effect=[limited, forbidden, io.BytesIO(data)]) as open_url, patch.object(runtime.time, "sleep") as sleep:
                self.assertEqual(runtime.download(entry, target), data)
                self.assertEqual([call.args[0].full_url for call in open_url.call_args_list],
                                 [entry["url"], entry["fallback"], entry["url"]])
                sleep.assert_called_once_with(2)
                self.assertEqual(target.read_bytes(), data)
                self.assertFalse(target.with_suffix(".aar.pending").exists())


if __name__ == "__main__":
    unittest.main()
