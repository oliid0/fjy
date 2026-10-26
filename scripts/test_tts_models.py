"""Asset replacement must be verified, atomic, and limited to known managed files."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("tts_models", Path(__file__).with_name("fetch-tts-models.py"))
models = importlib.util.module_from_spec(spec)
spec.loader.exec_module(models)


def entry(name, data):
    return {"name": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "url": "https://example.invalid/" + name}


class TtsModelAssetsTest(unittest.TestCase):
    def test_corrupt_download_preserves_the_existing_model(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "model.int8.onnx"
            target.write_bytes(b"previous")
            with patch.object(models.urllib.request, "urlopen", return_value=io.BytesIO(b"corrupt")):
                with self.assertRaises(ValueError):
                    models.download(entry(target.name, b"verified"), target)
            self.assertEqual(target.read_bytes(), b"previous")

    def test_verified_replacement_removes_only_the_known_old_weight(self):
        self.run_replacement(b"old", False)

    def test_unrecognized_old_file_is_retained_and_blocks_packaging(self):
        self.run_replacement(b"user-model", True)

    def run_replacement(self, old, fails):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "scripts").mkdir()
            (root / "scripts/tts-Sherpa-LICENSE.txt").write_text("license")
            manifest = {"runtime": entry("runtime.aar", b"runtime"), "files": [entry("model.int8.onnx", b"new")], "obsolete": [entry("model.onnx", b"old")]}
            (root / "scripts/tts-models.json").write_text(json.dumps(manifest))
            target = root / "android/app/src/main/assets/tts/melo"
            target.mkdir(parents=True)
            (target / "model.onnx").write_bytes(old)
            (target / "notes.txt").write_bytes(b"keep")

            def download(item, output):
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(b"new" if item["name"].endswith("onnx") else b"runtime")

            with patch.object(models, "ROOT", root), patch.object(models, "download", side_effect=download):
                if fails:
                    with self.assertRaises(ValueError):
                        models.main()
                else:
                    models.main()
            self.assertEqual((target / "model.int8.onnx").read_bytes(), b"new")
            self.assertEqual((target / "notes.txt").read_bytes(), b"keep")
            self.assertEqual((target / "model.onnx").exists(), fails)


if __name__ == "__main__":
    unittest.main()
