#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def quantity(value, label):
    if isinstance(value, int):
        return value
    if not isinstance(value, str):
        raise RuntimeError(label + "_INVALID")
    if value.startswith("0x"):
        return int(value, 16)
    return int(value, 10)

def hex_quantity(value):
    return hex(int(value))

class State:
    def __init__(self, args):
        self.upstream = args.upstream
        self.factory = args.factory.lower()
        self.topic0 = args.topic0.lower()
        with open(args.launch_index, "r", encoding="utf-8") as fh:
            index = json.load(fh)
        if index.get("schema") != "ROBINHOOD_RPC_PONS_S0_LAUNCH_INDEX_V1":
            raise RuntimeError("PROXY_LAUNCH_INDEX_SCHEMA_MISMATCH")
        if str(index.get("factory", "")).lower() != self.factory:
            raise RuntimeError("PROXY_LAUNCH_INDEX_FACTORY_MISMATCH")
        if str(index.get("eventTopic", "")).lower() != self.topic0:
            raise RuntimeError("PROXY_LAUNCH_INDEX_TOPIC_MISMATCH")
        logs = index.get("logs")
        if not isinstance(logs, list):
            raise RuntimeError("PROXY_LAUNCH_INDEX_LOGS_MISSING")
        self.logs = logs
        self.lock = threading.Lock()
        self.block_hash_cache = {}

    def upstream_call(self, request_obj):
        raw = json.dumps(
            request_obj,
            separators=(",", ":"),
        ).encode()
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
                    "--max-time", "90",
                    "--retry", "6",
                    "--retry-delay", "3",
                    "--retry-all-errors",
                    "--user-agent",
                    "sentry-forensic-gate-pons-s0-archive-proxy/2",
                    "--header", "content-type: application/json",
                    "--output", body_path,
                    "--write-out", "%{http_code}",
                    "--data-binary", raw.decode("utf-8"),
                    self.upstream,
                ],
                check=False,
                text=True,
                capture_output=True,
            )
            with open(body_path, "rb") as fh:
                body = fh.read()
            status_text = (proc.stdout or "").strip()
            status = int(status_text) if status_text.isdigit() else 0
            if proc.returncode != 0 or status < 200 or status >= 300:
                raise RuntimeError(
                    "UPSTREAM_RPC_TRANSPORT_FAILURE:"
                    + str(proc.returncode)
                    + ":"
                    + str(status)
                    + ":"
                    + (proc.stderr or "")[:512]
                )
            parsed = json.loads(body.decode("utf-8"))
            if not isinstance(parsed, dict):
                raise RuntimeError("UPSTREAM_RPC_NON_JSON_OBJECT")
            return parsed
        finally:
            try:
                os.unlink(body_path)
            except FileNotFoundError:
                pass

    def block_hash(self, block_number):
        key = int(block_number)
        cached = self.block_hash_cache.get(key)
        if cached:
            return cached
        response = self.upstream_call({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_getBlockByNumber",
            "params": [hex_quantity(key), False],
        })
        block = response.get("result")
        if not isinstance(block, dict):
            raise RuntimeError(
                "PROXY_BLOCK_MISSING:" + str(key)
            )
        block_hash = block.get("hash")
        if (
            not isinstance(block_hash, str)
            or len(block_hash) != 66
            or not block_hash.startswith("0x")
        ):
            raise RuntimeError(
                "PROXY_BLOCK_HASH_INVALID:" + str(key)
            )
        self.block_hash_cache[key] = block_hash.lower()
        return block_hash.lower()

    def indexed_logs(self, request_obj):
        params = request_obj.get("params")
        if not isinstance(params, list) or len(params) != 1:
            raise RuntimeError("PROXY_LOG_PARAMS_INVALID")
        filt = params[0]
        if not isinstance(filt, dict):
            raise RuntimeError("PROXY_LOG_FILTER_INVALID")
        if "blockHash" in filt:
            raise RuntimeError("PROXY_BLOCK_HASH_LOG_QUERY_UNSUPPORTED")
        address = str(filt.get("address", "")).lower()
        topics = filt.get("topics")
        if address != self.factory:
            raise RuntimeError("PROXY_NON_PONS_LOG_ADDRESS")
        if (
            not isinstance(topics, list)
            or not topics
            or str(topics[0]).lower() != self.topic0
        ):
            raise RuntimeError("PROXY_NON_PONS_LOG_TOPIC")
        if any(topic is not None for topic in topics[1:]):
            raise RuntimeError("PROXY_INDEXED_TOPIC_FILTER_UNSUPPORTED")

        start = quantity(
            filt.get("fromBlock"),
            "PROXY_FROM_BLOCK",
        )
        end = quantity(
            filt.get("toBlock"),
            "PROXY_TO_BLOCK",
        )
        if end < start:
            return []
        selected = [
            item
            for item in self.logs
            if start <= int(item["blockNumber"]) <= end
        ]

        result = []
        for item in selected:
            block_number = int(item["blockNumber"])
            result.append({
                "address": str(item["address"]).lower(),
                "topics": [
                    str(topic).lower()
                    for topic in item["topics"]
                ],
                "data": str(item["data"]).lower(),
                "blockNumber": hex_quantity(block_number),
                "transactionHash":
                    str(item["transactionHash"]).lower(),
                "transactionIndex":
                    hex_quantity(item["transactionIndex"]),
                "blockHash": str(item["blockHash"]).lower(),
                "logIndex": hex_quantity(item["logIndex"]),
                "removed": False,
            })
        return result

    def handle_rpc(self, request_obj):
        if not isinstance(request_obj, dict):
            raise RuntimeError("PROXY_RPC_REQUEST_INVALID")
        method = request_obj.get("method")
        if method == "eth_getLogs":
            result = self.indexed_logs(request_obj)
            return {
                "jsonrpc": "2.0",
                "id": request_obj.get("id"),
                "result": result,
            }
        return self.upstream_call(request_obj)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--upstream", required=True)
    parser.add_argument("--launch-index", required=True)
    parser.add_argument("--factory", required=True)
    parser.add_argument("--topic0", required=True)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    state = State(args)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            return

        def do_GET(self):
            if self.path != "/health":
                self.send_response(404)
                self.end_headers()
                return
            body = json.dumps({
                "ok": True,
                "indexedLaunchLogs": len(state.logs),
            }, separators=(",", ":")).encode()
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
                    raise RuntimeError("PROXY_RPC_BATCH_UNSUPPORTED")
                with state.lock:
                    response_obj = state.handle_rpc(request_obj)
                body = json.dumps(
                    response_obj,
                    separators=(",", ":"),
                ).encode()
                self.send_response(200)
            except Exception as exc:
                body = json.dumps({
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {
                        "code": -32099,
                        "message": str(exc)[:1024],
                    },
                }, separators=(",", ":")).encode()
                self.send_response(502)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    ThreadingHTTPServer(
        ("127.0.0.1", args.port),
        Handler,
    ).serve_forever()

if __name__ == "__main__":
    main()
