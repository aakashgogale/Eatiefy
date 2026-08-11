/**
 * Safer concurrency-orders profile.
 * Env:
 *   BASE_URL, TOKEN, RESTAURANT_ID, ITEM_ID
 *   ORDER_VUS (default 100)
 *   IDEMPOTENCY_CONCURRENT (default 10) — same key from N VUs
 *
 * Refuse to run if CONFIRM_SHARED_DB=true is not set when targeting shared DBs.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
const TOKEN = __ENV.TOKEN || '';
const RESTAURANT_ID = __ENV.RESTAURANT_ID || '';
const ITEM_ID = __ENV.ITEM_ID || '';
const ORDER_VUS = Number(__ENV.ORDER_VUS || 100);
const IDEMPOTENCY_CONCURRENT = Number(__ENV.IDEMPOTENCY_CONCURRENT || 10);
const CONFIRM_SHARED_DB = __ENV.CONFIRM_SHARED_DB === 'true';

const successOrders = new Counter('successful_orders');
const duplicateReplays = new Counter('idempotent_replays');
const failedOrders = new Counter('failed_orders');

export const options = {
  scenarios: {
    test_f_simultaneous_orders: {
      executor: 'per-vu-iterations',
      vus: ORDER_VUS,
      iterations: 1,
      maxDuration: '3m',
      exec: 'placeOrder',
      tags: { test: 'F' },
    },
    test_h_duplicate_idempotency: {
      executor: 'per-vu-iterations',
      vus: IDEMPOTENCY_CONCURRENT,
      iterations: 1,
      startTime: '3m',
      exec: 'duplicateOrderSameKey',
      tags: { test: 'H' },
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.95'],
  },
};

export function setup() {
  if (!CONFIRM_SHARED_DB) {
    console.error(
      'SAFETY STOP: concurrency-orders.js refuses to create orders unless CONFIRM_SHARED_DB=true. ' +
        'Shared Atlas DB "Eatiefy" must be explicitly acknowledged for destructive order load.',
    );
    return { abort: true };
  }
  if (!TOKEN || !RESTAURANT_ID || !ITEM_ID) {
    console.error('Missing TOKEN / RESTAURANT_ID / ITEM_ID');
    return { abort: true };
  }
  return { abort: false };
}

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

export function placeOrder(data) {
  if (data && data.abort) {
    failedOrders.add(1);
    return;
  }
  const key = `k6-order-${__VU}-${Date.now()}`;
  const res = http.post(`${BASE_URL}/api/v1/food/orders`, orderBody(), {
    headers: headers(key),
  });
  check(res, {
    'order create not 5xx': (r) => r.status < 500,
  });
  if (res.status >= 200 && res.status < 300) successOrders.add(1);
  else failedOrders.add(1);
  sleep(0.1);
}

export function duplicateOrderSameKey(data) {
  if (data && data.abort) {
    failedOrders.add(1);
    return;
  }
  const key = 'k6-fixed-idempotency-key-test-h';
  const res = http.post(`${BASE_URL}/api/v1/food/orders`, orderBody(), {
    headers: headers(key),
  });
  if (String(res.headers['Idempotency-Replayed'] || '').toLowerCase() === 'true') {
    duplicateReplays.add(1);
  }
  check(res, {
    'duplicate path not 5xx': (r) => r.status < 500,
  });
  if (res.status >= 200 && res.status < 300) successOrders.add(1);
  else failedOrders.add(1);
}

export default function (data) {
  placeOrder(data);
}
