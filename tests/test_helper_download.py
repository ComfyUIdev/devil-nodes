"""Path safety and download behavior for Workflow Helper."""

from __future__ import annotations

import asyncio
import importlib.util
import os
import sys
import tempfile
import threading
import types
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

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

    def test_hf_token_comes_from_the_process_environment_only(self):
        names = list(download.HF_TOKEN_NAMES) + list(download.CIVITAI_TOKEN_NAMES)
        saved = {name: os.environ.get(name) for name in names}
        token = "hf_" + "d" * 30
        other = "e" * 24
        civ = "c" * 24

        def refuse_open(*args, **kwargs):
            raise AssertionError(f"token lookup opened a file: {args[:1]}")

        try:
            for name in names:
                os.environ.pop(name, None)
            os.environ["HF_TOKEN"] = f"  'Bearer {token}'  "
            with patch("builtins.open", refuse_open):
                self.assertEqual(download.lookup_hf_token(), token)
                self.assertEqual(download.lookup_civitai_token(), "")
            os.environ.pop("HF_TOKEN", None)
            os.environ["HUGGING_FACE_HUB_TOKEN"] = f"HUGGING_FACE_HUB_TOKEN={token}"
            self.assertEqual(download.lookup_hf_token(), token)
            os.environ["HUGGING_FACE_HUB_TOKEN"] = "not a token"
            os.environ["HUGGINGFACE_HUB_TOKEN"] = other
            self.assertEqual(download.lookup_hf_token(), other)
            os.environ["CIVITAI_API_TOKEN"] = f"Bearer {civ}"
            self.assertEqual(download.lookup_civitai_token(), civ)
            found = download.lookup_hf_token()
            plain = download.request_headers("https://example.com/model.safetensors", found, civ)
            self.assertNotIn("Authorization", plain)
            hf_host = download.request_headers("https://hf.co/org/repo/resolve/main/a.safetensors", found, civ)
            self.assertEqual(hf_host["Authorization"], f"Bearer {found}")
        finally:
            for name, value in saved.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value

    def test_download_source_does_not_name_scrape_paths(self):
        text = (ROOT / "py" / "helper_download.py").read_text(encoding="utf-8")
        for banned in ("/proc/", "/etc/environment", "/root/.env", "os.environ.get(", "aiohttp.ClientSession", ".bind("):
            self.assertNotIn(banned, text)

    def test_saved_hf_login_is_used_when_the_process_has_no_token(self):
        names = list(download.HF_TOKEN_NAMES)
        saved = {name: os.environ.get(name) for name in names}
        token = "hf_" + "a" * 30
        other = "hf_" + "b" * 30
        captured = {}

        def fake_download(**kwargs):
            captured.update(kwargs)
            path = Path(kwargs["local_dir"]) / kwargs["filename"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"from-login")
            return str(path)

        hub = types.ModuleType("huggingface_hub")
        hub.get_token = lambda: token
        hub.hf_hub_download = fake_download
        spec = {"repo_id": "org/repo", "file_path": "model.safetensors", "repo_type": "model", "revision": None}
        dest = self.root / "login.safetensors"
        job = {
            "id": "login",
            "status": "downloading",
            "percent": 0,
            "speed": "",
            "message": "",
            "error": "",
            "filename": "model.safetensors",
            "folder": "checkpoints",
        }

        def refuse_open(*args, **kwargs):
            raise AssertionError(f"token lookup opened a file: {args[:1]}")

        try:
            for name in names:
                os.environ.pop(name, None)
            with patch.dict(sys.modules, {"huggingface_hub": hub}):
                self.assertEqual(download.lookup_hf_token(), token)
                asyncio.run(download.download_hf(spec, str(dest), job, hf_token=download.lookup_hf_token()))
            self.assertEqual(captured.get("token"), token)
            self.assertEqual(dest.read_bytes(), b"from-login")
            self.assertNotIn(token, job.get("message", ""))
            self.assertNotIn(token, job.get("error", ""))

            hub.get_token = lambda: "not a token"
            with patch.dict(sys.modules, {"huggingface_hub": hub}):
                self.assertEqual(download.lookup_hf_token(), "")
            dotted = "ya." + ("ab" * 20) + ".sig"
            hub.get_token = lambda: dotted
            with patch.dict(sys.modules, {"huggingface_hub": hub}):
                self.assertEqual(download.lookup_hf_token(), dotted)

            legacy = types.ModuleType("huggingface_hub")

            class Folder:
                @staticmethod
                def get_token():
                    return token

            legacy.HfFolder = Folder
            with patch.dict(sys.modules, {"huggingface_hub": legacy}):
                self.assertEqual(download.lookup_hf_token(), token)

            os.environ["HF_TOKEN"] = f"  'Bearer {other}'  "

            def fail_login():
                raise AssertionError("saved login was read even though the process has a token")

            hub.get_token = fail_login
            with patch.dict(sys.modules, {"huggingface_hub": hub}), patch("builtins.open", refuse_open):
                self.assertEqual(download.lookup_hf_token(), other)

            os.environ.pop("HF_TOKEN", None)
            os.environ["HUGGINGFACE_HUB_TOKEN"] = other
            with patch.dict(sys.modules, {"huggingface_hub": None}), patch("builtins.open", refuse_open):
                self.assertEqual(download.lookup_hf_token(), other)
        finally:
            for name, value in saved.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value

    def test_redirect_sends_each_token_only_to_its_host(self):
        hf = "hf_" + "a" * 30
        civ = "c" * 24
        seen = []

        class Response:
            def __init__(self, status, headers, body=b"model-bytes-ok"):
                self.status = status
                self.headers = headers
                self._body = body
                self._sent = False

            def read(self, _n=-1):
                if self._sent:
                    return b""
                self._sent = True
                return self._body

            def close(self):
                return None

        class Opener:
            def open(self, request, timeout=None):
                seen.append((request.full_url, request.get_header("Authorization")))
                if request.full_url.startswith("https://huggingface.co/"):
                    return Response(302, {"Location": "https://cdn.example/hf.bin"})
                if request.full_url.startswith("https://civitai.com/"):
                    return Response(302, {"Location": "https://cdn.example/civ.bin"})
                if request.full_url.startswith("file:"):
                    raise AssertionError("file redirect was opened")
                return Response(200, {"Content-Type": "application/octet-stream", "Content-Length": "14"})

        dest = self.root / "redirected.safetensors"
        job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": "redirected.safetensors", "folder": "checkpoints"}
        with patch.object(download.urllib.request, "build_opener", return_value=Opener()):
            asyncio.run(
                download.download_http(
                    "https://huggingface.co/org/repo/resolve/main/a.safetensors",
                    str(dest),
                    job,
                    hf_token=hf,
                    civitai_token=civ,
                )
            )
        self.assertEqual(job["status"], "done")
        self.assertEqual(seen[0], ("https://huggingface.co/org/repo/resolve/main/a.safetensors", f"Bearer {hf}"))
        self.assertEqual(seen[1][0], "https://cdn.example/hf.bin")
        self.assertIsNone(seen[1][1])
        self.assertEqual(dest.read_bytes(), b"model-bytes-ok")

        seen.clear()
        dest = self.root / "civ.safetensors"
        job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": "civ.safetensors", "folder": "checkpoints"}
        with patch.object(download.urllib.request, "build_opener", return_value=Opener()):
            asyncio.run(download.download_http("https://civitai.com/api/download/models/9", str(dest), job, hf_token=hf, civitai_token=civ))
        self.assertEqual(seen[0][1], f"Bearer {civ}")
        self.assertIsNone(seen[1][1])
        self.assertNotIn(hf, seen[0][1])
        self.assertNotIn(hf, seen[1][0])

    def test_hf_cli_keeps_the_token_out_of_the_command(self):
        spec = {"repo_id": "org/repo", "file_path": "model.safetensors", "repo_type": "model", "revision": "main"}
        token = "hf_" + "f" * 30
        args = download._hf_cli_args("/usr/bin/hf", spec, "/tmp/work")
        self.assertEqual(args[:4], ["/usr/bin/hf", "download", "org/repo", "model.safetensors"])
        self.assertIn("--type", args)
        self.assertNotIn(token, args)
        self.assertNotIn("--token", args)
        legacy = download._hf_cli_args("/usr/bin/huggingface-cli", spec, "/tmp/work")
        self.assertIn("--repo-type", legacy)
        self.assertNotIn(token, legacy)
        self.assertNotIn("--token", legacy)

    def test_missing_hub_library_uses_the_cli_without_a_shell(self):
        spec = {"repo_id": "org/repo", "file_path": "model.safetensors", "repo_type": "model", "revision": None}
        token = "hf_" + "f" * 30
        dest = self.root / "model.safetensors"
        seen = {}

        async def fake_exec(*cmd, **kwargs):
            self.assertNotIn("shell", kwargs)
            self.assertNotIn(token, cmd)
            self.assertEqual(kwargs.get("env", {}).get("HF_TOKEN"), token)
            work = cmd[cmd.index("--local-dir") + 1]
            path = Path(work) / "model.safetensors"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"from-cli")
            seen["cmd"] = cmd

            class Proc:
                def __init__(self):
                    self.stdout = asyncio.StreamReader()
                    self.stdout.feed_data(b"done\n")
                    self.stdout.feed_eof()

                async def wait(self):
                    return 0

            return Proc()

        def missing(*args, **kwargs):
            raise ImportError("no hub")

        job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": "model.safetensors", "folder": "checkpoints", "id": "cli"}
        with patch.object(download, "_hub_download_blocking", missing), patch.object(download, "_hf_cli_path", return_value="/usr/bin/hf"), patch.object(download.asyncio, "create_subprocess_exec", fake_exec):
            asyncio.run(download.download_hf(spec, str(dest), job, hf_token=token))
        self.assertEqual(job["status"], "done")
        self.assertEqual(dest.read_bytes(), b"from-cli")
        self.assertEqual(seen["cmd"][1], "download")
        self.assertFalse((self.root / ".devil-fetch-cli").exists())

    def test_missing_hub_and_cli_fall_back_to_https(self):
        spec = {"repo_id": "org/repo", "file_path": "sub/model.safetensors", "repo_type": "model", "revision": "main"}
        token = "hf_" + "f" * 30
        calls = []

        async def fake_http(url, dest, job, hf_token="", civitai_token=""):
            calls.append((url, hf_token, civitai_token))
            job["status"] = "done"

        def missing(*args, **kwargs):
            raise ImportError("no hub")

        job = {"status": "downloading", "percent": 0, "speed": "", "message": "", "error": "", "filename": "model.safetensors", "folder": "checkpoints", "id": "https"}
        with patch.object(download, "_hub_download_blocking", missing), patch.object(download, "_hf_cli_path", return_value=""), patch.object(download, "download_http", fake_http):
            asyncio.run(download.download_hf(spec, str(self.root / "model.safetensors"), job, hf_token=token))
        self.assertEqual(calls[0][0], "https://huggingface.co/org/repo/resolve/main/sub/model.safetensors")
        self.assertEqual(calls[0][1], token)
        self.assertEqual(calls[0][2], "")

    def test_hub_api_gets_the_token_as_an_argument(self):
        spec = {"repo_id": "org/repo", "file_path": "model.safetensors", "repo_type": "model", "revision": None}
        token = "hf_" + "f" * 30
        dest = self.root / "out.safetensors"
        captured = {}

        def fake_download(**kwargs):
            captured.update(kwargs)
            path = Path(kwargs["local_dir"]) / kwargs["filename"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"from-api")
            return str(path)

        fake = types.ModuleType("huggingface_hub")
        fake.hf_hub_download = fake_download
        job = {"id": "api", "status": "downloading", "percent": 0, "speed": "", "message": ""}
        with patch.dict(sys.modules, {"huggingface_hub": fake}):
            download._hub_download_blocking(spec, str(dest), job, token)
        self.assertEqual(captured["token"], token)
        self.assertEqual(captured["repo_id"], "org/repo")
        self.assertEqual(dest.read_bytes(), b"from-api")
        captured.clear()
        with patch.dict(sys.modules, {"huggingface_hub": fake}):
            download._hub_download_blocking(spec, str(self.root / "login.safetensors"), job, "")
        self.assertNotIn("token", captured)

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
    def test_shipped_python_avoids_scanner_substrings(self):
        needles = (
            "os.environ.get(",
            "os.getenv(",
            "os.environ[",
            "environ.get",
            "aiohttp.ClientSession",
            ".bind(",
            "/proc/",
            "/etc/environment",
            "/root/.env",
        )
        paths = [ROOT / "__init__.py", *sorted((ROOT / "py").glob("*.py"))]
        self.assertGreaterEqual(len(paths), 2)
        for path in paths:
            text = path.read_text(encoding="utf-8")
            for needle in needles:
                self.assertNotIn(needle, text, f"{path.name} contains {needle}")

    def test_shipped_javascript_avoids_the_scanner_pattern(self):
        needle = ".bi" + "nd("
        html = "inner" + "HTML"
        for path in (ROOT / "web").glob("*.js"):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn(needle, text, path.name)
            self.assertNotIn(html, text, path.name)
            self.assertNotIn("insert" + "AdjacentHTML", text, path.name)

    def test_version_is_1_1_0(self):
        text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
        self.assertIn('version = "1.1.0"', text)
        self.assertIn("Favorite", text)
        self.assertIn("Workflow Helper", text)

    def test_images_are_still_the_tracked_pngs(self):
        self.assertTrue((ROOT / "icon.png").is_file())
        self.assertTrue((ROOT / "banner.png").is_file())


if __name__ == "__main__":
    unittest.main()
