/**
 * Unit tests — no DB required
 * Run: node --test tests/*.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeEqualString } from '../src/utils/cryptoSafeCompare.js';
import { buildPaginationOptions } from '../src/utils/helpers.js';

describe('safeEqualString', () => {
  it('matches equal strings', () => {
    assert.equal(safeEqualString('abc', 'abc'), true);
  });

  it('rejects unequal strings', () => {
    assert.equal(safeEqualString('abc', 'abd'), false);
  });

  it('rejects different lengths', () => {
    assert.equal(safeEqualString('abc', 'abcd'), false);
  });

  it('rejects non-strings', () => {
    assert.equal(safeEqualString(null, 'a'), false);
    assert.equal(safeEqualString('a', undefined), false);
  });
});

describe('buildPaginationOptions', () => {
  it('defaults page/limit', () => {
    const p = buildPaginationOptions({});
    assert.equal(p.page, 1);
    assert.equal(p.limit, 20);
    assert.equal(p.skip, 0);
  });

  it('caps limit at 100', () => {
    const p = buildPaginationOptions({ page: 2, limit: 1000 });
    assert.equal(p.limit, 100);
    assert.equal(p.page, 2);
    assert.equal(p.skip, 100);
  });

  it('floors invalid page to 1', () => {
    const p = buildPaginationOptions({ page: -5, limit: 10 });
    assert.equal(p.page, 1);
  });
});
