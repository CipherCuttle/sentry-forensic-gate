#!/usr/bin/env bash
# Ephemeral read-only public RPC+WS transport preflight. Does not read API keys.
set +e
set -uo pipefail
outdir="${1:?runner temp directory required}"
resultfile="${2:?GitHub output path required}"
summaryfile="${3:?GitHub summary path required}"

test_pair() {
  local label="$1" http_url="$2" ws_url="$3" output="$4"
  printf 'Testing public endpoint pair %s\n' "$label"
  timeout -k 5s 50s env \
    PONS_SPEED_HTTP_URL="$http_url" \
    PONS_SPEED_WS_URL="$ws_url" \
    PONS_SPEED_DURATION_SECONDS=15 \
    node scripts/pons-speed-observer-v0.mjs > "$output"
  local rc=$?
  if [ "$rc" -eq 0 ] && jq -se '
    any(.[]; .type == "BENCHMARK_START"
      and (.configuredSources | index("HTTP") != null)
      and (.configuredSources | index("WS") != null))
    and any(.[]; .type == "BENCHMARK_VERDICT"
      and .httpScanErrors == 0
      and .wsSubscriptionErrors == 0)
  ' "$output" >/dev/null; then
    printf 'PUBLIC_PAIRED_PILOT_QUALIFIED: %s\n' "$label"
    return 0
  fi
  printf 'PUBLIC_PAIRED_PILOT_INCONCLUSIVE: %s, exit %d\n' "$label" "$rc"
  if test -s "$output"; then
    jq -sc '[.[] | select(.type == "BENCHMARK_BLOCKED" or .type == "BENCHMARK_VERDICT")]' "$output" || true
  fi
  return 1
}

if test_pair BLOCKREQ_PUBLIC \
  https://robinhood-mainnet-rpc.blockreq.com/v1/rpc/public \
  wss://robinhood-mainnet-rpc.blockreq.com/v1/rpc/public \
  "$outdir/pons-speed-paired-pilot.jsonl"; then
  echo 'qualified=true' >> "$resultfile"
  echo 'source=BLOCKREQ_PUBLIC' >> "$resultfile"
  echo 'Public BlockReq HTTP+RPC-WS qualified. Only endpoint availability has been demonstrated.' >> "$summaryfile"
elif test_pair ALCHEMY_DOCS_DEMO \
  https://robinhood-mainnet.g.alchemy.com/v2/docs-demo \
  wss://robinhood-mainnet.g.alchemy.com/v2/docs-demo \
  "$outdir/pons-speed-paired-alchemy-pilot.jsonl"; then
  echo 'qualified=true' >> "$resultfile"
  echo 'source=ALCHEMY_DOCS_DEMO' >> "$resultfile"
  echo 'Public Alchemy docs-demo HTTP+RPC-WS qualified. Only endpoint availability has been demonstrated.' >> "$summaryfile"
else
  echo 'qualified=false' >> "$resultfile"
  echo 'source=NONE' >> "$resultfile"
  echo 'PUBLIC_PAIRED_BENCHMARK_BLOCKED: neither keyless endpoint pair qualified; no latency comparison was run.' >> "$summaryfile"
fi

exit 0
