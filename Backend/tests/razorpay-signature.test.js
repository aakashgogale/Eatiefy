/**
 * Payment activation helper — pure contract tests (mocked filter shape)
 * Run: node --test tests/*.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyPaymentSignature } from '../src/modules/food/orders/helpers/razorpay.helper.js';

describe('verifyPaymentSignature', () => {
  it('returns false when secret/signature missing', () => {
    // Without env secrets configured, helper returns false
    assert.equal(verifyPaymentSignature('order', 'pay', ''), false);
  });
});
