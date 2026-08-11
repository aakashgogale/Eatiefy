/**
 * Mongo-backed concurrency tests — run when MONGO_URI is available and reachable.
 * Skipped automatically otherwise.
 *
 *   MONGO_URI=... npm run test:mongo
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { FoodItem } from '../src/modules/food/admin/models/food.model.js';
import { reserveInventoryForItems } from '../src/modules/food/orders/services/inventory.service.js';
import { claimWebhookEvent, WebhookEvent } from '../src/core/payments/models/webhookEvent.model.js';
import { FoodUserWallet } from '../src/modules/food/user/models/userWallet.model.js';
import * as userWalletService from '../src/modules/food/user/services/userWallet.service.js';

const MONGO = process.env.MONGO_URI || process.env.MONGODB_URI || '';
let mongoReady = false;

async function ensureMongo() {
  if (!MONGO) return false;
  if (mongoose.connection.readyState === 1) return true;
  try {
    await mongoose.connect(MONGO, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
    });
    return true;
  } catch (err) {
    console.warn(`[mongo-concurrency] Skipping Mongo tests: ${err.message}`);
    return false;
  }
}

describe('Mongo inventory concurrency', () => {
  let itemId;

  before(async () => {
    mongoReady = await ensureMongo();
  });

  after(async () => {
    if (itemId && mongoReady) await FoodItem.deleteOne({ _id: itemId }).catch(() => {});
  });

  it('100 concurrent reserves → exactly 1 success', async (t) => {
    if (!mongoReady) return t.skip('Mongo unavailable');
    const item = await FoodItem.create({
      restaurantId: new mongoose.Types.ObjectId(),
      name: `Concurrency Test ${Date.now()}`,
      price: 99,
      isAvailable: true,
      stockQuantity: 1,
      approvalStatus: 'approved',
    });
    itemId = String(item._id);

    const results = await Promise.allSettled(
      Array.from({ length: 100 }, () =>
        reserveInventoryForItems([{ itemId, quantity: 1 }]),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const fail = results.filter((r) => r.status === 'rejected').length;
    assert.equal(ok, 1);
    assert.equal(fail, 99);
    const fresh = await FoodItem.findById(itemId).lean();
    assert.equal(fresh.stockQuantity, 0);
    assert.equal(fresh.isAvailable, false);
  });
});

describe('Mongo webhook event dedupe', () => {
  before(async () => {
    if (!mongoReady) mongoReady = await ensureMongo();
  });

  it('duplicate claims → one claimed', async (t) => {
    if (!mongoReady) return t.skip('Mongo unavailable');
    const eventId = `test:${Date.now()}:pay_dup`;
    const claims = await Promise.all(
      Array.from({ length: 10 }, () =>
        claimWebhookEvent({ provider: 'razorpay', eventId, eventType: 'payment.captured' }),
      ),
    );
    assert.equal(claims.filter((c) => c.claimed && !c.duplicate).length, 1);
    assert.equal(claims.filter((c) => c.duplicate).length, 9);
    await WebhookEvent.deleteOne({ provider: 'razorpay', eventId });
  });
});

describe('Mongo wallet concurrent debit', () => {
  let userId;

  before(async () => {
    if (!mongoReady) mongoReady = await ensureMongo();
  });

  after(async () => {
    if (userId && mongoReady) await FoodUserWallet.deleteOne({ userId }).catch(() => {});
  });

  it('concurrent debits cannot overdraw', async (t) => {
    if (!mongoReady) return t.skip('Mongo unavailable');
    userId = new mongoose.Types.ObjectId();
    await FoodUserWallet.create({ userId, balance: 100, transactions: [] });

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        userWalletService.deductWalletBalance(userId, 30, 'concurrency test'),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const fail = results.filter((r) => r.status === 'rejected').length;
    assert.equal(ok, 3);
    assert.equal(fail, 17);
    const wallet = await FoodUserWallet.findOne({ userId }).lean();
    assert.equal(wallet.balance, 10);
    assert.ok(wallet.balance >= 0);
  });
});

after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect().catch(() => {});
  }
});
