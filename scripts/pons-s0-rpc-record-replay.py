#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SCHEMA = "PONS_S0_RPC_RECORD_REPLAY_V1"


def canonical_request(method, params):
    return json.dumps(
        {"method": method, "params": params if params is not None else []},
        sort_keys=True,
        separators=(",", ":"),
    )


def request_key(method, params):
    return hashlib.sha256(canonical_request(method, params).encode()).hexdigest()


def load_cache(path):
    if not os.path.exists(path):
        return {"schema": SCHEMA, "entries": {}}
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if data.get("schema") != SCHEMA or not isinstance(data.get("entries"), dict):
        raise RuntimeError("PONS_S0_RPC_CACHE_INVALID")
    return data


def save_cache(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, sort_keys=True)
        fh.write("\n")
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


class State:
    def __init__(self, args):
        self.mode = args.mode
        self.cache_path = args.cache
        self.upstream = args.upstream
        self.min_interval = args.min_interval_ms / 1000.0
        self.cache = load_cache(self.cache_path)
        self.lock = threading.Lock()
        self.last_started = 0.0

    def upstream_call(self, body_text):
        now = time.monotonic()
        wait = max(0.0, self.last_started + self.min_interval - now)
        if wait > 0:
            time.sleep(wait)
        self.last_started = time.monotonic()

        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            body_path = tmp.name
        try:
            proc = subprocess.run(
                [
                    "curl",
                    "--silent",
                    "--show-error",
                    "--location",
                    "--connect-timeout", "10",
                    "--max-time", "60",
                    "--retry", "4",
                    "--retry-delay", "3",
                    "--retry-all-errors",
                    "--header", "content-type: application/json",
                    "--header", "user-agent: sentry-pons-s0-cohort/1",
                    "--output", body_path,
                    "--write-out", "%{http_code}",
                    "--data-binary", body_text,
                    self.upstream,
                ],
                check=False,
                text=True,
                capture_output=True,
            )
            try:
                with open(body_path, "r", encoding="utf-8") as fh:
                    response_text = fh.read()
            except Exception:
                response_text = ""
            status_text = (proc.stdout or "").strip()
            status = int(status_text) if status_text.isdigit() else 0
            return proc.returncode, status, response_text, (proc.stderr or "")[:2048]
        finally:
            try:
                os.unlink(body_path)
            except FileNotFoundError:
                pass

    def handle_rpc(self, request_obj):
        if not isinstance(request_obj, dict):
            raise RuntimeError("PONS_S0_RPC_REQUEST_NOT_OBJECT")
        method = request_obj.get("method")
        params = request_obj.get("params", [])
        rpc_id = request_obj.get("id")
        if not isinstance(method, str) or not isinstance(params, list):
            raise RuntimeError("PONS_S0_RPC_REQUEST_INVALID")

        key = request_key(method, params)
        with self.lock:
            entry = self.cache["entries"].get(key)
            if entry is None and self.mode == "acquire":
                upstream_body = json.dumps(
                    {"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                    separators=(",", ":"),
                )
                returncode, status, response_text, stderr = self.upstream_call(upstream_body)
                try:
                    parsed = json.loads(response_text)
                except Exception:
                    parsed = None
                entry = {
                    "request": {"method": method, "params": params},
                    "transport": {
                        "curlReturnCode": returncode,
                        "httpStatus": status,
                        "stderr": stderr,
                    },
                    "rawResponseText": response_text,
                    "parsedResponse": parsed,
                }
                self.cache["entries"][key] = entry
                save_cache(self.cache_path, self.cache)

            if entry is None:
                return {
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "error": {
                        "code": -32098,
                        "message": "PONS_S0_REPLAY_CACHE_MISS",
                        "data": {"requestKey": key, "method": method},
                    },
                }

            transport = entry.get("transport", {})
            parsed = entry.get("parsedResponse")
            if (
                transport.get("curlReturnCode") != 0
                or not isinstance(transport.get("httpStatus"), int)
                or transport.get("httpStatus", 0) < 200
                or transport.get("httpStatus", 0) >= 300
                or not isinstance(parsed, dict)
            ):
                return {
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "error": {
                        "code": -32097,
                        "message": "PONS_S0_RECORDED_TRANSPORT_FAILURE",
                        "data": {
                            "requestKey": key,
                            "httpStatus": transport.get("httpStatus"),
                            "curlReturnCode": transport.get("curlReturnCode"),
                        },
                    },
                }

            if "error" in parsed:
                return {"jsonrpc": "2.0", "id": rpc_id, "error": parsed["error"]}
            if "result" not in parsed:
                return {
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "error": {
                        "code": -32096,
                        "message": "PONS_S0_RECORDED_RESULT_MISSING",
                        "data": {"requestKey": key},
                    },
                }
            return {"jsonrpc": "2.0", "id": rpc_id, "result": parsed["result"]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["acquire", "replay"], required=True)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--upstream", default="")
    parser.add_argument("--min-interval-ms", type=int, default=650)
    args = parser.parse_args()

    if args.mode == "acquire" and not args.upstream:
        raise SystemExit("PONS_S0_UPSTREAM_REQUIRED")
    state = State(args)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            return

        def do_GET(self):
            if self.path != "/health":
                self.send_response(404)
                self.end_headers()
                return
            body = json.dumps(
                {"schema": SCHEMA, "mode": state.mode, "entries": len(state.cache["entries"])}
            ).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            length = int(self.headers.get("content-length", "0"))
            raw = self.rfile.read(length)
            try:
                request_obj = json.loads(raw.decode("utf-8"))
                if isinstance(request_obj, list):
                    raise RuntimeError("PONS_S0_RPC_BATCH_UNSUPPORTED")
                response_obj = state.handle_rpc(request_obj)
                body = json.dumps(response_obj, separators=(",", ":")).encode()
                self.send_response(200)
            except Exception as exc:
                body = json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": None,
                        "error": {"code": -32603, "message": str(exc)[:512]},
                    },
                    separators=(",", ":"),
                ).encode()
                self.send_response(500)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
