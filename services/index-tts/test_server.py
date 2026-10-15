import http.client
import json
from pathlib import Path
from threading import Thread
import unittest
from http.server import ThreadingHTTPServer

from server import create_handler


class AdapterTest(unittest.TestCase):
    def setUp(self):
        class Model:
            def infer(self, **kwargs):
                Path(kwargs["output_path"]).write_bytes(b"RIFF-test-WAVE")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), create_handler(Model(), "reference.wav", "test-service-key-123", {"https://localhost"}))
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, text="Hello", token="test-service-key-123", origin="https://localhost"):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        client.request("POST", "/v1/audio/speech", json.dumps({"input": text}), {"Authorization": f"Bearer {token}", "Origin": origin})
        response = client.getresponse()
        result = response.status, response.getheader("Content-Type"), response.read()
        client.close()
        return result

    def test_returns_real_audio_payload(self):
        status, mime, body = self.request()
        self.assertEqual((status, mime, body), (200, "audio/wav", b"RIFF-test-WAVE"))

    def test_requires_key_and_allowed_origin(self):
        self.assertEqual(self.request(token="wrong")[0], 401)
        self.assertEqual(self.request(origin="https://untrusted.example")[0], 403)

    def test_rejects_empty_or_excessive_input(self):
        self.assertEqual(self.request(text=" ")[0], 400)
        self.assertEqual(self.request(text="x" * 4001)[0], 400)


if __name__ == "__main__":
    unittest.main()
