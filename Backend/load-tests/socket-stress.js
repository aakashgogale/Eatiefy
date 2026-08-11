/**
 * TEST J — Socket.IO connection stress (requires k6 + xk6-socketio OR use ws upgrade smoke)
 * This script uses HTTP polling handshake to approximate connection pressure without custom builds.
 *
 * Prefer a dedicated socket stress tool in CI when available.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.SOCKET_URL || __ENV.BASE_URL || 'http://127.0.0.1:5001';
const TOKEN = __ENV.TOKEN || '';

export const options = {
  scenarios: {
    test_j_socket_handshake: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: 100 },
        { duration: '30s', target: 500 },
        { duration: '30s', target: 0 },
      ],
      tags: { test: 'J' },
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.1'],
  },
};

export default function () {
  // Engine.IO handshake probe — not a full authenticated socket session
  const url = `${BASE_URL}/socket.io/?EIO=4&transport=polling`;
  const res = http.get(url, {
    headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
  });
  check(res, {
    'socket engine responds': (r) => r.status === 200 || r.status === 400 || r.status === 401,
  });
  sleep(0.5);
}
