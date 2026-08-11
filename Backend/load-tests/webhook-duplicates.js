/**
 * TEST I — duplicate payment webhook (signature must be provided for real runs)
 *
 * Without RAZORPAY_WEBHOOK_SECRET + valid HMAC this will get 400 (expected).
 * For a real concurrency check, set:
 *   -e WEBHOOK_SECRET=... -e RAW_PAYLOAD=... -e SIGNATURE=...
 */
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:5000';
const SIGNATURE = __ENV.SIGNATURE || 'invalid';
const RAW_PAYLOAD =
  __ENV.RAW_PAYLOAD ||
  JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_test_duplicate',
          order_id: 'order_test_duplicate',
          amount: 10000,
          status: 'captured',
        },
      },
    },
  });

const accepted = new Counter('webhook_accepted');
const rejected = new Counter('webhook_rejected');

export const options = {
  scenarios: {
    test_i_duplicate_webhook: {
      executor: 'per-vu-iterations',
      vus: 50,
      iterations: 1,
      maxDuration: '1m',
      tags: { test: 'I' },
    },
  },
};

export default function () {
  const res = http.post(`${BASE_URL}/api/v1/payments/webhook/razorpay`, RAW_PAYLOAD, {
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': SIGNATURE,
    },
  });

  check(res, {
    'webhook does not 5xx': (r) => r.status < 500,
  });

  if (res.status === 200) accepted.add(1);
  else rejected.add(1);
}
