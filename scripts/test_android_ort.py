import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
