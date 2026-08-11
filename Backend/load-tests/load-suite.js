/**
 * Staged / profile-driven k6 load suite for Eatiefy Backend.
 *
 * Profiles (env PROFILE):
 *   baseline  — 10 VUs, 30s
 *   100       — 100 VUs, 1m
 *   500       — 500 VUs, 1m
 *   1000      — 1000 VUs, 1m
 *   staged    — ramp 0→100→500→1000 sustain → 0 (default for full validation)
 *
 * Never includes 5000 in default staged profile (local/staging safety).
 * Set ALLOW_5000=true to add a 5000 VU scenario separately.
 *
 *   k6 run -e BASE_URL=http://127.0.0.1:5000 -e PROFILE=baseline load-tests/load-suite.js
 *   k6 run -e BASE_URL=http://127.0.0.1:5000 -e PROFILE=staged load-tests/load-suite.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
const TOKEN = __ENV.TOKEN || '';
const PROFILE = (__ENV.PROFILE || 'staged').toLowerCase();
const SLEEP_SEC = Number(__ENV.SLEEP_SEC || 0.2);
const ALLOW_5000 = __ENV.ALLOW_5000 === 'true';

const errorRate = new Rate('errors');
const latency = new Trend('api_latency', true);
const healthOk = new Counter('health_ok');
const healthFail = new Counter('health_fail');

function buildOptions() {
  const thresholds = {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    errors: ['rate<0.05'],
  };

  if (PROFILE === 'baseline') {
    return {
      scenarios: {
        baseline_10: {
          executor: 'constant-vus',
          vus: 10,
          duration: '30s',
          exec: 'healthAndPublic',
          tags: { test: 'baseline' },
        },
      },
      thresholds,
    };
  }

  if (PROFILE === '100') {
    return {
      scenarios: {
        test_100: {
          executor: 'constant-vus',
          vus: 100,
          duration: '1m',
          exec: 'healthAndPublic',
          tags: { test: '100' },
        },
      },
      thresholds,
    };
  }

  if (PROFILE === '500') {
    return {
      scenarios: {
        test_500: {
          executor: 'constant-vus',
          vus: 500,
          duration: '1m',
          exec: 'healthAndPublic',
          tags: { test: '500' },
        },
      },
      thresholds,
    };
  }

  if (PROFILE === '1000') {
    return {
      scenarios: {
        test_1000: {
          executor: 'constant-vus',
          vus: 1000,
          duration: '1m',
          exec: 'healthAndPublic',
          tags: { test: '1000' },
        },
      },
      thresholds,
    };
  }

  // staged: 0→100 (1m) →500 (2m) →1000 (3m) → sustain 1000 (5m) → 0 (1m)
  const scenarios = {
    staged_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 100 },
        { duration: '2m', target: 500 },
        { duration: '3m', target: 1000 },
        { duration: '5m', target: 1000 },
        { duration: '1m', target: 0 },
      ],
      exec: 'healthAndPublic',
      tags: { test: 'staged' },
    },
  };

  if (ALLOW_5000) {
    scenarios.test_5000 = {
      executor: 'constant-vus',
      vus: 5000,
      duration: '45s',
      startTime: '13m',
      exec: 'healthAndPublic',
      tags: { test: '5000' },
    };
  }

  return { scenarios, thresholds };
}

export const options = buildOptions();

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
  if (ok) healthOk.add(1);
  else healthFail.add(1);
  sleep(SLEEP_SEC);
}

export default function () {
  healthAndPublic();
}
