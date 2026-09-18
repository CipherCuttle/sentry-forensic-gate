const endpoint = process.env.ROBINHOOD_ARCHIVE_RPC_URL ?? 'https://robinhood-mainnet.g.alchemy.com/v2/docs-demo';

const probes = [
  {
    label: 'hmn_factory_code_at_launch',
    method: 'eth_getCode',
    params: ['0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e', '0x3ec2990']
  },
  {
    label: 'prior_factory_code_at_launch',
    method: 'eth_getCode',
    params: ['0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e', '0x3ded702']
  },
  {
    label: 'prior_creator_logs_near_launch',
    method: 'eth_getLogs',
    params: [{
      address: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
      topics: [
        '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607',
        null,
        null,
        '0x00000000000000000000000009ee8fd79fb4a780a01038a88cedbca6d68b3fe4'
      ],
      fromBlock: '0x3ded6fd',
      toBlock: '0x3ded707'
    }]
  }
];

const results = [];
for (let i = 0; i < probes.length; i += 1) {
  const probe = probes[i];
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: i + 1,
      method: probe.method,
      params: probe.params
    })
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 512) }; }
  results.push({
    label: probe.label,
    httpStatus: response.status,
    ok: response.ok && !payload.error,
    error: payload.error ?? null,
    resultSummary: summarize(payload.result)
  });
}
console.log(JSON.stringify({ endpointClass: 'ALCHEMY_DOCS_DEMO', results }, null, 2));
if (results.some((item) => !item.ok)) process.exitCode = 2;

function summarize(value) {
  if (typeof value === 'string') return { type: 'hex', bytes: Math.max(0, (value.length - 2) / 2), prefix: value.slice(0, 18) };
  if (Array.isArray(value)) return { type: 'array', length: value.length, first: value[0] ?? null };
  return value ?? null;
}
