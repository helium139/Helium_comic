"""Offline tests for the Actions image generator; no real requests are made."""

import sys
sys.dont_write_bytecode = True

import importlib.util
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from io import BytesIO, StringIO
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from PIL import Image

spec = importlib.util.spec_from_file_location("og_images", Path(__file__).with_name("generate-og-images.py"))
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


class Response(BytesIO):
    def __init__(self, content, headers):
        super().__init__(content)
        self.headers = headers


class GeneratorTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="helium-og-tests-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        root_patch = patch.object(generator, "ROOT", self.root)
        root_patch.start()
        self.addCleanup(root_patch.stop)
        for directory in ("assets/data", "assets/images"):
            (self.root / directory).mkdir(parents=True)
        Image.new("RGBA", (312, 312), (160, 100, 190, 180)).save(self.root / "assets/images/helium_logo.webp")
        self.data = {"test-comic": {"cover": "https://example.invalid/cover.webp"}}
        self.write_data()
        self.cover = self.image_bytes("blue")
        self.etag = '"cover-v1"'
        self.headers = None
        self.requests = []
        self.conditional = False
        fetch_patch = patch.object(generator, "urlopen", self.fetch)
        fetch_patch.start()
        self.addCleanup(fetch_patch.stop)

    def write_data(self):
        (self.root / "assets/data/data.json").write_text(json.dumps(self.data), encoding="utf-8")

    def image_bytes(self, color):
        output = BytesIO()
        Image.new("RGB", (400, 800), color).save(output, "PNG")
        return output.getvalue()

    def fetch(self, request, timeout):
        self.assertEqual(timeout, 30)
        self.requests.append(request)
        if self.conditional and request.get_header("If-none-match") == self.etag:
            raise HTTPError(request.full_url, 304, "Not Modified", {}, None)
        return Response(self.cover, self.headers if self.headers is not None else {"ETag": self.etag})

    def build(self):
        with redirect_stdout(StringIO()) as logs:
            generator.build()
        return logs.getvalue()

    def target(self):
        return self.root / "assets/og/test-comic.jpg"

    def test_generate_then_reuse_304(self):
        self.assertIn("Generated 1, reused 0", self.build())
        with Image.open(self.target()) as image:
            self.assertEqual(image.size, (1200, 630))
            self.assertEqual(image.format, "JPEG")
        original = self.target().read_bytes()
        self.conditional = True
        self.assertIn("Generated 0, reused 1", self.build())
        self.assertEqual(self.target().read_bytes(), original)
        self.assertEqual(self.requests[-1].get_header("If-none-match"), self.etag)
        self.assertEqual(sorted(p.name for p in self.target().parent.iterdir()), [".sources.json", "test-comic.jpg"])

    def test_content_hash_without_validators(self):
        self.headers = {}
        self.build()
        self.assertIn("Generated 0, reused 1", self.build())

    def test_changed_cover_regenerates(self):
        self.build()
        original = self.target().read_bytes()
        self.cover = self.image_bytes("red")
        self.etag = '"cover-v2"'
        self.assertIn("Generated 1, reused 0", self.build())
        self.assertNotEqual(self.target().read_bytes(), original)

    def test_changed_url_does_not_send_old_validator(self):
        self.build()
        self.data["test-comic"]["cover"] = "https://example.invalid/new-cover.webp"
        self.write_data()
        self.build()
        self.assertIsNone(self.requests[-1].get_header("If-none-match"))

    def test_changed_logo_regenerates(self):
        self.build()
        Image.new("RGBA", (312, 312), "red").save(self.root / "assets/images/helium_logo.webp")
        self.assertIn("Generated 1, reused 0", self.build())
        self.assertIsNone(self.requests[-1].get_header("If-none-match"))

    def test_missing_or_damaged_output_regenerates(self):
        self.build()
        self.target().write_bytes(b"invalid JPEG")
        self.assertIn("Generated 1, reused 0", self.build())
        self.target().unlink()
        self.assertIn("Generated 1, reused 0", self.build())

    def test_last_modified_validator(self):
        self.headers = {"Last-Modified": "Fri, 02 Oct 2026 10:00:00 GMT"}
        self.build()
        self.build()
        self.assertEqual(self.requests[-1].get_header("If-modified-since"), self.headers["Last-Modified"])

    def test_download_failure_is_not_silently_reused(self):
        self.build()
        with patch.object(generator, "urlopen", side_effect=HTTPError("https://example.invalid", 503, "Unavailable", {}, None)):
            with self.assertRaises(HTTPError):
                self.build()


if __name__ == "__main__":
    unittest.main()
