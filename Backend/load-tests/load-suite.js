/**
 * k6 load suite for Eatiefy Backend
 *
 * Usage:
 *   k6 run Backend/load-tests/smoke.js
 *   k6 run -e BASE_URL=https://api.example.com -e TOKEN=eyJ... Backend/load-tests/concurrency.js
 *
 * Scenarios map to Production Readiness TEST A–J.
 * Results are evidence only when executed against a real environment.
 * Do NOT invent pass/fail without running these scripts.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:5000';
const TOKEN = __ENV.TOKEN || '';
const errorRate = new Rate('errors');
const latency = new Trend('api_latency', true);

export const options = {
  scenarios: {
    // TEST A — 100 concurrent users
    test_a_100: {
      executor: 'constant-vus',
      vus: 100,
      duration: '1m',
      startTime: '0s',
      tags: { test: 'A' },
      exec: 'healthAndPublic',
    },
    // TEST B — 500 concurrent users
    test_b_500: {
      executor: 'constant-vus',
      vus: 500,
      duration: '1m',
      startTime: '2m',
      tags: { test: 'B' },
      exec: 'healthAndPublic',
    },
    // TEST C — 1,000 concurrent users
    test_c_1000: {
      executor: 'constant-vus',
      vus: 1000,
      duration: '1m',
      startTime: '4m',
      tags: { test: 'C' },
      exec: 'healthAndPublic',
    },
    // TEST D — 5,000 concurrent users (requires substantial infra)
    test_d_5000: {
      executor: 'constant-vus',
      vus: 5000,
      duration: '45s',
      startTime: '6m',
      tags: { test: 'D' },
      exec: 'healthAndPublic',
    },
    // TEST E — traffic spike 100 → 1000 → 5000
    test_e_spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 100 },
        { duration: '20s', target: 1000 },
        { duration: '20s', target: 5000 },
        { duration: '20s', target: 0 },
      ],
      startTime: '8m',
      tags: { test: 'E' },
      exec: 'healthAndPublic',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<700', 'p(99)<2000'],
    errors: ['rate<0.05'],
  },
};

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

export function healthAndPublic() {
  const res = http.get(`${BASE_URL}/health`, { headers: authHeaders() });
  latency.add(res.timings.duration);
  const ok = check(res, {
    'health status 200 or 503': (r) => r.status === 200 || r.status === 503,
    'body has status': (r) => {
      try {
        const j = r.json();
        return j && (j.status === 'UP' || j.status === 'DEGRADED' || j.status === 'DOWN');
      } catch {
        return false;
      }
    },
  });
  errorRate.add(!ok);
  sleep(0.2);
}

export default function () {
  healthAndPublic();
}
