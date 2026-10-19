"""Optional LAN speech synthesis adapter for the official IndexTTS2 inference API.

Run inside an installed IndexTTS environment; this service is not part of Android.
"""

import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
from threading import Lock


def create_handler(model, reference_audio, token, origins):
    inference_lock = Lock()

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def send(self, status, content, mime="application/json; charset=utf-8"):
            self.send_response(status)
            origin = self.headers.get("Origin")
            if origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(content)

        def failure(self, status, message):
            self.send(status, json.dumps({"error": {"message": message}}).encode())

        def do_OPTIONS(self):
            self.send(204, b"")

        def do_POST(self):
            if self.path != "/v1/audio/speech":
                self.failure(404, "Unknown endpoint")
                return
            if not hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {token}"):
                self.failure(401, "Invalid service key")
                return
            if self.headers.get("Origin") and self.headers["Origin"] not in origins:
                self.failure(403, "Origin not allowed")
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 32000:
                    self.failure(413, "Request must be between 1 and 32000 bytes")
                    return
                data = json.loads(self.rfile.read(size))
                text = data.get("input")
                if not isinstance(text, str) or not 0 < len(text.strip()) <= 4000:
                    self.failure(400, "input must contain 1 to 4000 characters")
                    return
                if data.get("response_format", "wav") != "wav":
                    self.failure(400, "Only wav output is supported")
                    return
            except (ValueError, AttributeError, OSError):
                self.failure(400, "Invalid JSON request")
                return
            if not inference_lock.acquire(blocking=False):
                self.failure(429, "Speech engine busy; retry when playback finishes")
                return
            try:
                with tempfile.TemporaryDirectory(prefix="fcboard-tts-") as directory:
                    output = Path(directory) / "speech.wav"
                    model.infer(spk_audio_prompt=str(reference_audio), text=text, output_path=str(output))
                    self.send(200, output.read_bytes(), "audio/wav")
            except Exception:
                self.failure(500, "IndexTTS inference failed; check model files and reference audio")
            finally:
                inference_lock.release()

        def log_message(self, format, *args):
            # Do not put classroom text, headers or keys in service logs.
            pass

    return Handler


def main():
    from indextts.infer_v2 import IndexTTS2

    token = os.environ.get("FCBOARD_TTS_TOKEN", "")
    reference = Path(os.environ.get("FCBOARD_TTS_REFERENCE", ""))
    if len(token) < 16 or not reference.is_file():
        raise SystemExit("Set FCBOARD_TTS_TOKEN (16+ characters) and FCBOARD_TTS_REFERENCE (an authorized reference WAV).")
    directory = Path(os.environ.get("FCBOARD_TTS_MODELS", "checkpoints"))
    model = IndexTTS2(cfg_path=str(directory / "config.yaml"), model_dir=str(directory), use_fp16=False)
    origins = set(os.environ.get("FCBOARD_TTS_ORIGINS", "https://localhost,http://localhost").split(","))
    server = ThreadingHTTPServer(
        (os.environ.get("FCBOARD_TTS_HOST", "0.0.0.0"), int(os.environ.get("FCBOARD_TTS_PORT", "8766"))),
        create_handler(model, reference, token, origins),
    )
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
