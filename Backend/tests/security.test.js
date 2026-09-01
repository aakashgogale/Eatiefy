/**
 * Security invariants for handover and pricing.
 *
 * The delivery OTP authorises handing over goods and collecting cash, and the
 * pricing functions decide what the customer is charged. Both are places where a
 * silent regression costs real money, so they are pinned here.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateDeliveryOtp,
  isWellFormedDeliveryOtp,
  timingSafeEquals,
  DELIVERY_OTP_LENGTH,
  DELIVERY_OTP_MAX_ATTEMPTS,
  DELIVERY_OTP_LOCK_MS,
} from '../src/modules/food/orders/services/order.helpers.js';

import {
  computeDeliveryFeeGst,
  resolveUserDeliveryFee,
  calculateRiderEarning,
  DELIVERY_FEE_GST_RATE,
} from '../src/modules/food/orders/services/order-pricing.service.js';

describe('delivery OTP', () => {
  test('is exactly DELIVERY_OTP_LENGTH digits', () => {
    for (let i = 0; i < 500; i += 1) {
      const otp = generateDeliveryOtp();
      assert.equal(otp.length, DELIVERY_OTP_LENGTH, `bad length: ${otp}`);
      assert.match(otp, /^[0-9]+$/, `non-numeric: ${otp}`);
    }
  });

  test('every generated code passes its own well-formed check', () => {
    // This is the guard that catches a client/server length drift. If the generator
    // and the validator ever disagree, handover breaks for every order.
    for (let i = 0; i < 200; i += 1) {
      assert.equal(isWellFormedDeliveryOtp(generateDeliveryOtp()), true);
    }
  });

  test('rejects codes of the wrong length', () => {
    assert.equal(isWellFormedDeliveryOtp('331190'), false, 'six digits must be rejected');
    assert.equal(isWellFormedDeliveryOtp('331'), false);
    assert.equal(isWellFormedDeliveryOtp(''), false);
    assert.equal(isWellFormedDeliveryOtp('abcd'), false);
    assert.equal(isWellFormedDeliveryOtp('33 1'), false);
  });

  test('accepts a padded code and a leading-zero code', () => {
    assert.equal(isWellFormedDeliveryOtp(' 3311 '), true);
    assert.equal(isWellFormedDeliveryOtp('0000'), true);
  });

  test('spans the full range for its length', () => {
    const min = 10 ** (DELIVERY_OTP_LENGTH - 1);
    const max = 10 ** DELIVERY_OTP_LENGTH - 1;
    for (let i = 0; i < 500; i += 1) {
      const n = Number(generateDeliveryOtp());
      assert.ok(n >= min && n <= max, `out of range: ${n}`);
    }
  });

  test('attempt cap and lock window are set to sane values', () => {
    assert.ok(DELIVERY_OTP_MAX_ATTEMPTS >= 3 && DELIVERY_OTP_MAX_ATTEMPTS <= 10);
    assert.ok(DELIVERY_OTP_LOCK_MS >= 5 * 60 * 1000);
  });

  test('the attempt cap keeps a short code non-brute-forceable', () => {
    // Length alone was never the protection — the cap is. A guesser gets
    // DELIVERY_OTP_MAX_ATTEMPTS tries per lockout window against the whole space.
    const space = 10 ** DELIVERY_OTP_LENGTH - 10 ** (DELIVERY_OTP_LENGTH - 1);
    const chancePerWindow = DELIVERY_OTP_MAX_ATTEMPTS / space;
    assert.ok(chancePerWindow < 0.001, `too guessable: ${chancePerWindow}`);
  });
});

describe('timingSafeEquals', () => {
  test('matches identical strings', () => {
    assert.equal(timingSafeEquals('123456', '123456'), true);
  });

  test('rejects different strings of equal length', () => {
    assert.equal(timingSafeEquals('123456', '123457'), false);
  });

  test('rejects different lengths without throwing', () => {
    assert.equal(timingSafeEquals('1234', '123456'), false);
    assert.equal(timingSafeEquals('123456', '1234'), false);
  });

  test('treats null and undefined as non-matching input', () => {
    assert.equal(timingSafeEquals(null, '123456'), false);
    assert.equal(timingSafeEquals(undefined, undefined), true); // both empty
    assert.equal(timingSafeEquals('', '123456'), false);
  });
});

describe('delivery fee GST', () => {
  test('applies the declared rate', () => {
    assert.equal(computeDeliveryFeeGst(100), Number((100 * DELIVERY_FEE_GST_RATE).toFixed(2)));
  });

  test('is zero for a zero fee', () => {
    assert.equal(computeDeliveryFeeGst(0), 0);
  });

  test('never returns a negative or NaN value', () => {
    for (const input of [-50, null, undefined, NaN, 'abc']) {
      const gst = computeDeliveryFeeGst(input);
      assert.ok(Number.isFinite(gst) && gst >= 0, `bad GST for ${String(input)}: ${gst}`);
    }
  });
});

describe('resolveUserDeliveryFee', () => {
  const settings = {
    deliveryFeeRanges: [
      { min: 0, max: 3, fee: 20, deliveryBoyBasePay: 15 },
      { min: 3, max: 7, fee: 40, deliveryBoyBasePay: 30 },
      { min: 7, max: 15, fee: 70, deliveryBoyBasePay: 55 },
    ],
  };

  test('picks the fee for the matching distance band', () => {
    assert.equal(resolveUserDeliveryFee(settings, { distanceKm: 1 }).deliveryFee, 20);
    assert.equal(resolveUserDeliveryFee(settings, { distanceKm: 5 }).deliveryFee, 40);
    assert.equal(resolveUserDeliveryFee(settings, { distanceKm: 10 }).deliveryFee, 70);
  });

  test('reports which rule produced the fee', () => {
    assert.equal(resolveUserDeliveryFee(settings, { distanceKm: 1 }).source, 'distance');
    assert.equal(resolveUserDeliveryFee(settings, { distanceKm: null }).source, 'default');
    assert.equal(
      resolveUserDeliveryFee(settings, { distanceKm: 999 }).source,
      'default_unmatched_range',
    );
  });

  test('always returns a finite non-negative fee', () => {
    for (const distanceKm of [null, undefined, -1, NaN, 999]) {
      const { deliveryFee } = resolveUserDeliveryFee(settings, { distanceKm });
      assert.ok(
        Number.isFinite(deliveryFee) && deliveryFee >= 0,
        `bad fee for ${String(distanceKm)}: ${deliveryFee}`,
      );
    }
  });

  test('does not throw when no ranges are configured', () => {
    const { deliveryFee } = resolveUserDeliveryFee({}, { distanceKm: 5 });
    assert.ok(Number.isFinite(deliveryFee) && deliveryFee >= 0);
  });
});

describe('calculateRiderEarning', () => {
  const settings = {
    deliveryFeeRanges: [
      { min: 0, max: 3, fee: 20, deliveryBoyBasePay: 15 },
      { min: 3, max: 7, fee: 40, deliveryBoyBasePay: 30 },
    ],
  };

  test('pays the configured base for the band', () => {
    assert.equal(calculateRiderEarning(settings, 1), 15);
    assert.equal(calculateRiderEarning(settings, 5), 30);
  });

  test('never pays for an invalid distance', () => {
    assert.equal(calculateRiderEarning(settings, -1), 0);
    assert.equal(calculateRiderEarning(settings, NaN), 0);
    assert.equal(calculateRiderEarning(settings, null), 0);
  });

  test('never exceeds what the customer paid for delivery', () => {
    // A rider earning more than the delivery fee collected is a loss on every order.
    for (const km of [0.5, 2, 4, 6]) {
      const { deliveryFee } = resolveUserDeliveryFee(settings, { distanceKm: km });
      const earning = calculateRiderEarning(settings, km);
      assert.ok(earning <= deliveryFee, `rider ${earning} > customer ${deliveryFee} at ${km}km`);
    }
  });
});
