/**
 * Order lifecycle invariants.
 *
 * These cover the rules that cost money when they break: a status can never move
 * backwards, a terminal order can never be reopened, and an unpaid order must never
 * be exposed to a restaurant as work to start cooking.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  isStatusAdvance,
  canExposeOrderToRestaurant,
  buildOrderIdentityFilter,
  isCancelledOrderStatus,
  hasReachedStatus,
  haversineKm,
} from '../src/modules/food/orders/services/order.helpers.js';

describe('isStatusAdvance', () => {
  test('moves forward through the happy path', () => {
    const path = [
      'created',
      'confirmed',
      'preparing',
      'ready_for_pickup',
      'reached_pickup',
      'picked_up',
      'reached_drop',
      'delivered',
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      assert.equal(isStatusAdvance(path[i], path[i + 1]), true, `${path[i]} → ${path[i + 1]}`);
    }
  });

  test('refuses to move backwards', () => {
    assert.equal(isStatusAdvance('picked_up', 'preparing'), false);
    assert.equal(isStatusAdvance('delivered', 'picked_up'), false);
    assert.equal(isStatusAdvance('ready_for_pickup', 'confirmed'), false);
  });

  test('refuses to repeat the current status', () => {
    assert.equal(isStatusAdvance('preparing', 'preparing'), false);
    assert.equal(isStatusAdvance('delivered', 'delivered'), false);
  });

  test('a delivered order is final', () => {
    assert.equal(isStatusAdvance('delivered', 'cancelled_by_user'), false);
    assert.equal(isStatusAdvance('delivered', 'cancelled_by_admin'), false);
  });

  test('a cancelled order cannot be revived', () => {
    for (const terminal of ['cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin']) {
      assert.equal(isStatusAdvance(terminal, 'preparing'), false, terminal);
      assert.equal(isStatusAdvance(terminal, 'delivered'), false, terminal);
    }
  });

  test('cancellation is allowed from any live status', () => {
    for (const live of ['created', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up']) {
      assert.equal(isStatusAdvance(live, 'cancelled_by_user'), true, live);
    }
  });

  test('a missing current status is treated as the start of the flow', () => {
    assert.equal(isStatusAdvance(undefined, 'confirmed'), true);
    assert.equal(isStatusAdvance('', 'preparing'), true);
  });
});

describe('canExposeOrderToRestaurant', () => {
  test('hides an order that is still awaiting payment', () => {
    assert.equal(
      canExposeOrderToRestaurant({
        orderStatus: 'pending_payment',
        payment: { method: 'razorpay', status: 'paid' },
      }),
      false,
    );
  });

  test('shows cash and wallet orders immediately', () => {
    assert.equal(
      canExposeOrderToRestaurant({ orderStatus: 'created', payment: { method: 'cash' } }),
      true,
    );
    assert.equal(
      canExposeOrderToRestaurant({ orderStatus: 'created', payment: { method: 'wallet' } }),
      true,
    );
  });

  test('shows an online order only once the money has landed', () => {
    const online = (status) => ({
      orderStatus: 'created',
      payment: { method: 'razorpay', status },
    });
    for (const paid of ['paid', 'authorized', 'captured', 'settled']) {
      assert.equal(canExposeOrderToRestaurant(online(paid)), true, paid);
    }
    for (const unpaid of ['created', 'pending', 'failed', 'refunded']) {
      assert.equal(canExposeOrderToRestaurant(online(unpaid)), false, unpaid);
    }
  });
});

describe('buildOrderIdentityFilter', () => {
  test('uses _id for a valid ObjectId', () => {
    const filter = buildOrderIdentityFilter('507f1f77bcf86cd799439011');
    assert.ok(filter._id, 'expected an _id filter');
    assert.equal(filter.$or, undefined);
  });

  test('matches both id spellings for a human order code', () => {
    const filter = buildOrderIdentityFilter('FOD-12345');
    assert.deepEqual(filter, { $or: [{ order_id: 'FOD-12345' }, { orderId: 'FOD-12345' }] });
  });

  test('rejects empty input rather than matching everything', () => {
    assert.equal(buildOrderIdentityFilter(''), null);
    assert.equal(buildOrderIdentityFilter(null), null);
    assert.equal(buildOrderIdentityFilter(undefined), null);
  });
});

describe('isCancelledOrderStatus', () => {
  test('recognises every cancellation actor', () => {
    assert.equal(isCancelledOrderStatus('cancelled_by_user'), true);
    assert.equal(isCancelledOrderStatus('cancelled_by_restaurant'), true);
    assert.equal(isCancelledOrderStatus('cancelled_by_admin'), true);
    assert.equal(isCancelledOrderStatus('delivered'), false);
    assert.equal(isCancelledOrderStatus('preparing'), false);
  });
});

describe('haversineKm', () => {
  test('is zero for the same point', () => {
    assert.equal(haversineKm(22.7196, 75.8577, 22.7196, 75.8577), 0);
  });

  test('matches a known distance within 1%', () => {
    // Indore → Bhopal: ~170 km great-circle (the ~190 km figure is by road).
    const km = haversineKm(22.7196, 75.8577, 23.2599, 77.4126);
    assert.ok(km > 168 && km < 172, `expected ~170 km, got ${km}`);
  });

  test('is symmetric', () => {
    const a = haversineKm(19.076, 72.8777, 28.7041, 77.1025);
    const b = haversineKm(28.7041, 77.1025, 19.076, 72.8777);
    assert.ok(Math.abs(a - b) < 1e-9);
  });
});

describe('hasReachedStatus', () => {
  test('a repeated transition is recognised as already done', () => {
    // The case that broke pickup in production: the rider app did not refresh, the
    // rider swiped again, and the retry was answered 400 instead of idempotently.
    assert.equal(hasReachedStatus('picked_up', 'picked_up'), true);
    assert.equal(hasReachedStatus('delivered', 'delivered'), true);
  });

  test('a later status counts as having passed an earlier one', () => {
    assert.equal(hasReachedStatus('reached_drop', 'picked_up'), true);
    assert.equal(hasReachedStatus('delivered', 'reached_pickup'), true);
  });

  test('an earlier status has not reached a later one', () => {
    assert.equal(hasReachedStatus('ready_for_pickup', 'picked_up'), false);
    assert.equal(hasReachedStatus('preparing', 'delivered'), false);
  });

  test('a cancelled order has not "passed" any delivery step', () => {
    for (const cancelled of ['cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin']) {
      assert.equal(hasReachedStatus(cancelled, 'picked_up'), false, cancelled);
      assert.equal(hasReachedStatus(cancelled, 'delivered'), false, cancelled);
    }
  });

  test('unknown statuses are never treated as reached', () => {
    assert.equal(hasReachedStatus('nonsense', 'picked_up'), false);
    assert.equal(hasReachedStatus('picked_up', 'nonsense'), false);
    assert.equal(hasReachedStatus(undefined, 'picked_up'), false);
  });

  test('agrees with isStatusAdvance: never both advanceable and already reached', () => {
    const statuses = [
      'created', 'confirmed', 'preparing', 'ready_for_pickup',
      'reached_pickup', 'picked_up', 'reached_drop', 'delivered',
    ];
    for (const from of statuses) {
      for (const to of statuses) {
        assert.equal(
          isStatusAdvance(from, to) && hasReachedStatus(from, to),
          false,
          `${from} → ${to} claimed both`,
        );
      }
    }
  });
});
