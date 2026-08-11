/**
 * Production-hardening automated tests.
 * Run: node --test tests/*.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  verifyRazorpayWebhookSignature,
  verifyRazorpayPaymentSignature,
} from '../src/utils/razorpaySignatures.js';
import { canTransitionPayment, PAYMENT_STATUSES } from '../src/modules/food/orders/services/payment-state.machine.js';
import { canDeliveryPartnerUpdateOrderLocation } from '../src/config/socketAuthz.js';
import { safeEqualString } from '../src/utils/cryptoSafeCompare.js';

describe('Razorpay HMAC signatures', () => {
  const secret = 'whsec_test_secret_123';

  it('accepts valid webhook signature', () => {
    const raw = Buffer.from(JSON.stringify({ event: 'payment.captured', id: 'evt_1' }));
    const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    assert.equal(verifyRazorpayWebhookSignature(raw, sig, secret), true);
  });

  it('rejects invalid webhook signature', () => {
    const raw = Buffer.from('{"event":"payment.captured"}');
    assert.equal(verifyRazorpayWebhookSignature(raw, 'deadbeef', secret), false);
  });

  it('rejects modified payload', () => {
    const raw = Buffer.from('{"event":"payment.captured","amount":100}');
    const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const modified = Buffer.from('{"event":"payment.captured","amount":999}');
    assert.equal(verifyRazorpayWebhookSignature(modified, sig, secret), false);
  });

  it('rejects missing signature', () => {
    const raw = Buffer.from('{}');
    assert.equal(verifyRazorpayWebhookSignature(raw, '', secret), false);
    assert.equal(verifyRazorpayWebhookSignature(raw, null, secret), false);
  });

  it('accepts valid payment checkout signature', () => {
    const orderId = 'order_ABC';
    const paymentId = 'pay_XYZ';
    const sig = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
    assert.equal(verifyRazorpayPaymentSignature(orderId, paymentId, sig, secret), true);
  });

  it('rejects invalid payment checkout signature', () => {
    assert.equal(verifyRazorpayPaymentSignature('order_A', 'pay_B', 'nope', secret), false);
  });
});

describe('Payment state machine', () => {
  it('allows created → paid and created → failed', () => {
    assert.equal(canTransitionPayment(PAYMENT_STATUSES.CREATED, PAYMENT_STATUSES.PAID), true);
    assert.equal(canTransitionPayment(PAYMENT_STATUSES.CREATED, PAYMENT_STATUSES.FAILED), true);
  });

  it('rejects paid → created (no regression)', () => {
    assert.equal(canTransitionPayment(PAYMENT_STATUSES.PAID, PAYMENT_STATUSES.CREATED), false);
  });

  it('allows paid → refunded only', () => {
    assert.equal(canTransitionPayment(PAYMENT_STATUSES.PAID, PAYMENT_STATUSES.REFUNDED), true);
    assert.equal(canTransitionPayment(PAYMENT_STATUSES.PAID, PAYMENT_STATUSES.FAILED), false);
  });

  it('allows late paid after failed (webhook after timeout path)', () => {
    assert.equal(canTransitionPayment(PAYMENT_STATUSES.FAILED, PAYMENT_STATUSES.PAID), true);
  });
});

describe('Socket update-location authorization', () => {
  it('allows assigned delivery partner', () => {
    assert.equal(
      canDeliveryPartnerUpdateOrderLocation({
        role: 'DELIVERY_PARTNER',
        partnerId: 'partnerA',
        orderDispatchPartnerId: 'partnerA',
        dispatchStatus: 'accepted',
      }),
      true,
    );
  });

  it('rejects partner A updating partner B order (403 case)', () => {
    assert.equal(
      canDeliveryPartnerUpdateOrderLocation({
        role: 'DELIVERY_PARTNER',
        partnerId: 'partnerA',
        orderDispatchPartnerId: 'partnerB',
        dispatchStatus: 'accepted',
      }),
      false,
    );
  });

  it('rejects unassigned / non-accepted dispatch', () => {
    assert.equal(
      canDeliveryPartnerUpdateOrderLocation({
        role: 'DELIVERY_PARTNER',
        partnerId: 'partnerA',
        orderDispatchPartnerId: 'partnerA',
        dispatchStatus: 'offered',
      }),
      false,
    );
  });
});

describe('Atomic inventory race (in-memory CAS simulator)', () => {
  /**
   * Mirrors Mongo findOneAndUpdate({ stockQuantity: { $gte: qty } }, { $inc: -qty })
   */
  function atomicReserve(store, itemId, qty) {
    const item = store.get(itemId);
    if (!item || item.stockQuantity == null) return { ok: false, reason: 'missing' };
    if (item.stockQuantity < qty) return { ok: false, reason: 'oos' };
    item.stockQuantity -= qty;
    if (item.stockQuantity <= 0) item.isAvailable = false;
    return { ok: true };
  }

  it('100 concurrent reserves of stock=1 yield exactly 1 success', async () => {
    const store = new Map([['item1', { stockQuantity: 1, isAvailable: true }]]);
    let successes = 0;
    let failures = 0;

    // Serialize critical section the same way Mongo does per-document
    let chain = Promise.resolve();
    const tasks = Array.from({ length: 100 }, () =>
      new Promise((resolve) => {
        chain = chain.then(() => {
          const result = atomicReserve(store, 'item1', 1);
          if (result.ok) successes += 1;
          else failures += 1;
          resolve(result);
        });
      }),
    );

    await Promise.all(tasks);
    assert.equal(successes, 1);
    assert.equal(failures, 99);
    assert.equal(store.get('item1').stockQuantity, 0);
    assert.equal(store.get('item1').isAvailable, false);
  });

  it('stock=5 allows exactly 5 successes under 50 concurrent attempts', async () => {
    const store = new Map([['item1', { stockQuantity: 5, isAvailable: true }]]);
    let successes = 0;
    let chain = Promise.resolve();
    const tasks = Array.from({ length: 50 }, () =>
      new Promise((resolve) => {
        chain = chain.then(() => {
          const result = atomicReserve(store, 'item1', 1);
          if (result.ok) successes += 1;
          resolve(result);
        });
      }),
    );
    await Promise.all(tasks);
    assert.equal(successes, 5);
    assert.equal(store.get('item1').stockQuantity, 0);
  });
});

describe('Idempotency key concurrency (lock simulator)', () => {
  it('10 concurrent same key → one execution', async () => {
    const locks = new Map();
    const results = new Map();
    let executions = 0;

    async function withIdempotency(key, fn) {
      if (results.has(key)) return { replayed: true, value: results.get(key) };
      if (locks.get(key)) {
        // wait for winner
        while (locks.get(key)) await new Promise((r) => setTimeout(r, 1));
        return { replayed: true, value: results.get(key) };
      }
      locks.set(key, true);
      try {
        if (results.has(key)) return { replayed: true, value: results.get(key) };
        executions += 1;
        const value = await fn();
        results.set(key, value);
        return { replayed: false, value };
      } finally {
        locks.delete(key);
      }
    }

    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () =>
        withIdempotency('user1:POST:/orders:abc', async () => ({ orderId: 'order_1' })),
      ),
    );

    assert.equal(executions, 1);
    assert.equal(outcomes.filter((o) => !o.replayed).length, 1);
    assert.ok(outcomes.every((o) => o.value.orderId === 'order_1'));
  });
});

describe('Webhook event dedupe simulator', () => {
  it('same event 2x 5x 10x → one state transition', async () => {
    const seen = new Set();
    let transitions = 0;

    function claim(eventId) {
      if (seen.has(eventId)) return { duplicate: true };
      seen.add(eventId);
      transitions += 1;
      return { duplicate: false };
    }

    for (const n of [2, 5, 10]) {
      seen.clear();
      transitions = 0;
      const eventId = `payment.captured:pay_${n}`;
      for (let i = 0; i < n; i += 1) claim(eventId);
      assert.equal(transitions, 1, `expected 1 transition for ${n}x`);
    }
  });
});

describe('Wallet atomic debit simulator', () => {
  it('prevents negative balance under concurrent debits', async () => {
    const wallet = { balance: 100 };
    let chain = Promise.resolve();
    let success = 0;
    let fail = 0;

    function atomicDebit(amount) {
      return new Promise((resolve) => {
        chain = chain.then(() => {
          if (wallet.balance >= amount) {
            wallet.balance -= amount;
            success += 1;
            resolve(true);
          } else {
            fail += 1;
            resolve(false);
          }
        });
      });
    }

    await Promise.all(Array.from({ length: 20 }, () => atomicDebit(30)));
    assert.equal(success, 3);
    assert.equal(fail, 17);
    assert.equal(wallet.balance, 10);
    assert.ok(wallet.balance >= 0);
  });
});

describe('Route auth expectations (CMS + uploads)', () => {
  it('landing CMS mutations use requireAdmin', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.join(process.cwd(), 'src/modules/food/landing/routes/landing.routes.js');
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /requireAdmin/);
    assert.match(src, /authMiddleware/);
    assert.match(src, /requireRoles\('ADMIN'\)/);
    assert.match(src, /router\.post\('\/hero-banners\/multiple', \.\.\.requireAdmin/);
    assert.match(src, /router\.delete\('\/hero-banners\/:id', \.\.\.requireAdmin/);
  });

  it('upload route requires auth middleware', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.join(process.cwd(), 'src/modules/uploads/routes/upload.routes.js');
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /authMiddleware/);
    assert.match(src, /requireRoles\('ADMIN', 'RESTAURANT', 'USER', 'DELIVERY_PARTNER'\)/);
    assert.match(src, /imageUpload\.single\('file'\)/);
  });
});

describe('safeEqualString still works', () => {
  it('matches', () => assert.equal(safeEqualString('abc', 'abc'), true));
  it('rejects', () => assert.equal(safeEqualString('abc', 'abd'), false));
});
