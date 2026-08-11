/**
 * TEST F/G/H — concurrent order / duplicate order / same-item stress
 * Requires a valid USER JWT and a restaurant that can accept orders.
 *
 *   k6 run -e BASE_URL=http://127.0.0.1:5000 -e TOKEN=... -e RESTAURANT_ID=... \
 *     -e ITEM_ID=... Backend/load-tests/concurrency-orders.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:5000';
const TOKEN = __ENV.TOKEN || '';
const RESTAURANT_ID = __ENV.RESTAURANT_ID || '';
const ITEM_ID = __ENV.ITEM_ID || '';

const successOrders = new Counter('successful_orders');
const duplicateReplays = new Counter('idempotent_replays');
const failedOrders = new Counter('failed_orders');

export const options = {
  scenarios: {
    // TEST F — 100 simultaneous order attempts
    test_f_simultaneous_orders: {
      executor: 'per-vu-iterations',
      vus: 100,
      iterations: 1,
      maxDuration: '2m',
      exec: 'placeOrder',
      tags: { test: 'F' },
    },
    // TEST H — same user double-submit with same Idempotency-Key
    test_h_duplicate_idempotency: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 5,
      startTime: '2m30s',
      exec: 'duplicateOrderSameKey',
      tags: { test: 'H' },
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.2'],
  },
};

function headers(idempotencyKey) {
  const h = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${TOKEN}`,
  };
  if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey;
  return h;
}

const orderBody = () =>
  JSON.stringify({
    restaurantId: RESTAURANT_ID,
    paymentMethod: 'cash',
    items: [{ itemId: ITEM_ID, quantity: 1 }],
    address: {
      label: 'Home',
      name: 'Load Test',
      street: 'Test Street',
      city: 'Test',
      state: 'TS',
      zipCode: '000000',
      phone: '9999999999',
      location: { type: 'Point', coordinates: [78.4867, 17.385] },
    },
    customerName: 'Load Test',
    customerPhone: '9999999999',
  });

export function placeOrder() {
  if (!TOKEN || !RESTAURANT_ID || !ITEM_ID) {
    failedOrders.add(1);
    return;
  }
  const key = `k6-order-${__VU}-${Date.now()}`;
  const res = http.post(`${BASE_URL}/api/v1/food/orders`, orderBody(), {
    headers: headers(key),
  });
  const ok = check(res, {
    'order create 2xx or expected 4xx': (r) => r.status >= 200 && r.status < 500,
  });
  if (res.status >= 200 && res.status < 300) successOrders.add(1);
  else failedOrders.add(1);
  sleep(0.1);
}

export function duplicateOrderSameKey() {
  if (!TOKEN || !RESTAURANT_ID || !ITEM_ID) {
    failedOrders.add(1);
    return;
  }
  const key = 'k6-fixed-idempotency-key-test-h';
  const res = http.post(`${BASE_URL}/api/v1/food/orders`, orderBody(), {
    headers: headers(key),
  });
  if (res.headers['Idempotency-Replayed'] === 'true' || res.headers['Idempotency-Replayed'] === true) {
    duplicateReplays.add(1);
  }
  check(res, {
    'duplicate path returns success or client error': (r) => r.status < 500,
  });
}

export default function () {
  placeOrder();
}
