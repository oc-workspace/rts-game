#!/usr/bin/env node

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4173";
const normalizedBase = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";

const checks = [
  {
    name: "固定 seed 入口",
    path: "?seed=20260810",
    required: [
      "KHEPRI RANDOM ENCOUNTER",
      'id="encounter-panel"',
      'id="copy-seed"',
      'id="restart-encounter"',
      'id="new-encounter"',
      'id="unit-scale"',
      'id="minimap"',
    ],
  },
  {
    name: "200 单位压力入口",
    path: "?seed=20260810&units=200",
    required: ['id="unit-scale"', 'value="200"'],
  },
];

let failures = 0;
for (const check of checks) {
  const url = new URL(check.path, normalizedBase);
  try {
    const response = await fetch(url);
    const body = await response.text();
    const missing = check.required.filter((value) => !body.includes(value));
    if (!response.ok || missing.length > 0) {
      failures += 1;
      console.error(
        `FAIL ${check.name}: HTTP ${response.status}; missing ${missing.join(", ") || "none"}`,
      );
      continue;
    }
    console.log(`PASS ${check.name}: HTTP ${response.status}, ${body.length} bytes`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${check.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

try {
  const indexResponse = await fetch(new URL("?seed=20260810", normalizedBase));
  const indexBody = await indexResponse.text();
  const scriptSource = indexBody.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i)?.[1];
  if (!indexResponse.ok || !scriptSource) {
    failures += 1;
    console.error(`FAIL module entry: HTTP ${indexResponse.status}; module script not found`);
  } else {
    const entry = await fetch(new URL(scriptSource, normalizedBase));
    const entryBody = await entry.text();
    if (!entry.ok || entryBody.length < 1000) {
      failures += 1;
      console.error(`FAIL module entry: HTTP ${entry.status}; ${entryBody.length} bytes`);
    } else {
      console.log(`PASS module entry: HTTP ${entry.status}, ${entryBody.length} bytes`);
    }
  }
} catch (error) {
  failures += 1;
  console.error(`FAIL module entry: ${error instanceof Error ? error.message : String(error)}`);
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log(`SMOKE PASS: ${checks.length + 1} checks against ${normalizedBase}`);
}
