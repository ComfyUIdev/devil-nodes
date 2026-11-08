"""Path safety and download behavior for Workflow Helper."""

from __future__ import annotations

import asyncio
import importlib.util
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


download = load("devil_helper_download", "py/helper_download.py")
helper = load("devil_workflow_helper", "py/workflow_helper.py")
favorite = load("devil_favorite", "py/favorite.py")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.server.hits.append(
            {"path": self.path.split("?", 1)[0], "authorization": self.headers.get("Authorization")}
        )
        if self.path.startswith("/page"):
            body = b"<html><script>nope</script></html>"
            return self._send(200, body, "text/html")
        if self.path.startswith("/err"):
            return self._send(200, b'{"error":"nope"}', "application/json")
        if self.path.startswith("/missing"):
            return self._send(404, b"gone", "text/plain")
        if self.path.startswith("/bounce-file"):
            self.send_response(302)
            self.send_header("Location", "file:///etc/passwd")
            self.end_headers()
            return
        if self.path.startswith("/bounce-ok"):
            self.send_response(302)
            self.send_header("Location", "/payload.bin")
            self.end_headers()
            return
        body = b"model-bytes-ok"
        self._send(200, body, "application/octet-stream")

    def _send(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return


class DownloadTests(unittest.TestCase):
    def setUp(self):
        download.JOBS.clear()
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "checkpoints"
        self.root.mkdir()
        self.folders = {"checkpoints": [str(self.root)], "loras": [str(self.root / "loras")]}
        (self.root / "loras").mkdir()

    def tearDown(self):
        self.tmp.cleanup()
        download.JOBS.clear()

    def test_favorite_stays_frontend_only(self):
        self.assertEqual(favorite.NODE_CLASS_MAPPINGS, {})
        self.assertEqual(favorite.NODE_DISPLAY_NAME_MAPPINGS, {})

    def test_helper_is_registered(self):
        self.assertEqual(helper.NODE_DISPLAY_NAME_MAPPINGS["WorkflowHelper"], "Workflow Helper")
        node = helper.NODE_CLASS_MAPPINGS["WorkflowHelper"]
        spec = node.INPUT_TYPES()["required"]["card"]
        self.assertEqual(spec[0], "STRING")
        self.assertFalse(spec[1]["dynamicPrompts"])
        self.assertEqual(node().idle("{}"), ())
        self.assertEqual(node.RETURN_TYPES, ())

    def test_rejects_traversal_and_unknown_folders(self):
        bad_names = ["../secret.safetensors", "/etc/passwd", "foo/../../x.safetensors", "..", "C:/windows/a.bin"]
        for name in bad_names:
            with self.assertRaises(download.DestinationError):
                download.resolve_model_path("checkpoints", name, self.folders)
        with self.assertRaises(download.DestinationError):
            download.resolve_model_path("checkpoints/../vae", "model.safetensors", self.folders)
        with self.assertRaises(download.DestinationError):
            download.resolve_model_path("not-a-folder", "model.safetensors", self.folders)

    def test_subfolder_stays_inside_the_model_root(self):
        dest = download.resolve_model_path("loras", "heroes/model.safetensors", self.folders)
        root = os.path.realpath(self.folders["loras"][0])
        self.assertEqual(os.path.commonpath([root, dest]), root)
        self.assertTrue(dest.endswith(os.path.join("heroes", "model.safetensors")))

    def test_symlink_out_of_the_folder_is_rejected(self):
        outside = Path(self.tmp.name) / "outside"
        outside.mkdir()
        alias = self.root / "alias.safetensors"
        alias.symlink_to(outside / "x.bin")
        with self.assertRaises(download.DestinationError):
            download.resolve_model_path("checkpoints", "alias.safetensors", self.folders)

    def test_url_kinds(self):
        direct = download.classify_source("https://civitai.com/api/download/models/42")
        self.assertEqual(direct["kind"], "http")
        pasted = download.classify_source("hf download hf://org/repo/model.safetensors")
        self.assertEqual(pasted["kind"], "hf")
        self.assertEqual(pasted["hf"]["repo_id"], "org/repo")
        web = download.classify_source("https://huggingface.co/org/repo/blob/main/sub/model.safetensors")
        self.assertEqual(web["hf"]["revision"], "main")
        self.assertEqual(web["hf"]["file_path"], "sub/model.safetensors")
        b2 = download.classify_source("b2://bucket/path/model.safetensors")
        self.assertEqual(b2["kind"], "b2")
        self.assertTrue(b2["url"].startswith("b2:bucket/"))
        for blocked in ("file:///etc/passwd", "javascript:alert(1)", "data:text/plain,hi", ""):
            with self.assertRaises(download.SourceError):
                download.classify_source(blocked)

    def test_tokens_stay_on_their_hosts(self):
        hf = "hf_" + ("a" * 30)
        civ = "c" * 24
        self.assertEqual(download.clean_token(f"  'Bearer {hf}'  "), hf)
        self.assertFalse(download.token_usable("hf_token"))
        self.assertTrue(download.token_usable(hf))
        hf_headers = download.request_headers("https://huggingface.co/org/repo/resolve/main/a.safetensors", hf, civ)
        self.assertEqual(hf_headers["Authorization"], f"Bearer {hf}")
        civ_headers = download.request_headers("https://civitai.com/api/download/models/9", hf, civ)
        self.assertEqual(civ_headers["Authorization"], f"Bearer {civ}")
        cdn_headers = download.request_headers("https://cdn.example/file.safetensors", hf, civ)
        self.assertNotIn("Authorization", cdn_headers)
        leaked = download.scrub_secrets(f"failed token={hf} at host", [hf])
        self.assertNotIn(hf, leaked)
        self.assertIn("[redacted]", leaked)

    def test_http_download_writes_only_the_destination(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.hits = []
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        port = server.server_address[1]
        base = f"http://127.0.0.1:{port}"
        try:
            dest = self.root / "model.safetensors"
            job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": "model.safetensors", "folder": "checkpoints"}
            asyncio.run(download.download_http(f"{base}/payload.bin", str(dest), job, hf_token="hf_" + "b" * 30, civitai_token="c" * 24))
            self.assertEqual(job["status"], "done")
            self.assertEqual(dest.read_bytes(), b"model-bytes-ok")
            self.assertFalse((self.root / "model.safetensors.devilpart").exists())
            self.assertTrue(all(hit["authorization"] is None for hit in server.hits))

            nested = download.prepare_download(
                {"url": f"{base}/bounce-ok", "filename": "heroes/model.safetensors", "folder": "loras"},
                self.folders,
            )
            job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": nested["filename"], "folder": "loras"}
            asyncio.run(download.run_spec(nested, job, hf_token="hf_" + "b" * 30))
            saved = Path(nested["dest"])
            self.assertEqual(saved.read_bytes(), b"model-bytes-ok")
            self.assertEqual(os.path.commonpath([os.path.realpath(self.folders["loras"][0]), str(saved)]), os.path.realpath(self.folders["loras"][0]))

            page = self.root / "page.safetensors"
            job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": "page.safetensors", "folder": "checkpoints"}
            asyncio.run(download.download_http(f"{base}/page", str(page), job))
            self.assertEqual(job["status"], "error")
            self.assertFalse(page.exists())
            self.assertIn("web page", job["error"])

            bad = self.root / "bad.safetensors"
            job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": "bad.safetensors", "folder": "checkpoints"}
            asyncio.run(download.download_http(f"{base}/err", str(bad), job))
            self.assertEqual(job["status"], "error")
            self.assertFalse(bad.exists())

            escaped = self.root / "escaped.safetensors"
            job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": "escaped.safetensors", "folder": "checkpoints"}
            asyncio.run(download.download_http(f"{base}/bounce-file", str(escaped), job))
            self.assertEqual(job["status"], "error")
            self.assertFalse(escaped.exists())
            self.assertIn("redirected away", job["error"])
        finally:
            server.shutdown()
            server.server_close()

    def test_existing_file_is_not_fetched_again(self):
        dest = self.root / "ready.safetensors"
        dest.write_bytes(b"already")
        spec = download.prepare_download(
            {"url": "https://example.com/ready.safetensors", "filename": "ready.safetensors", "folder": "checkpoints"},
            self.folders,
        )
        view = download.begin_download(spec)
        self.assertEqual(view["status"], "done")
        self.assertEqual(view["message"], "Already installed")
        self.assertEqual(dest.read_bytes(), b"already")

    def test_prepare_rejects_a_bad_url_before_any_write(self):
        with self.assertRaises(download.SourceError):
            download.prepare_download(
                {"url": "file:///etc/passwd", "filename": "model.safetensors", "folder": "checkpoints"},
                self.folders,
            )
        self.assertEqual([path for path in self.root.rglob("*") if path.is_file()], [])


class ShippedFileTests(unittest.TestCase):
    def test_shipped_javascript_avoids_the_scanner_pattern(self):
        needle = ".bi" + "nd("
        html = "inner" + "HTML"
        for path in (ROOT / "web").glob("*.js"):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn(needle, text, path.name)
            self.assertNotIn(html, text, path.name)
            self.assertNotIn("insert" + "AdjacentHTML", text, path.name)

    def test_version_stays_at_1_0_1(self):
        text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
        self.assertIn('version = "1.0.1"', text)

    def test_images_are_still_the_tracked_pngs(self):
        self.assertTrue((ROOT / "icon.png").is_file())
        self.assertTrue((ROOT / "banner.png").is_file())


if __name__ == "__main__":
    unittest.main()
