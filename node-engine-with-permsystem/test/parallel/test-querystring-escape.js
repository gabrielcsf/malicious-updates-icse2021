'use strict';
require('../common');
const assert = require('assert');

const qs = require('querystring');

assert.deepStrictEqual(qs.escape(5), '5');
assert.deepStrictEqual(qs.escape('test'), 'test');
assert.deepStrictEqual(qs.escape({}), '%5Bobject%20Object%5D');
assert.deepStrictEqual(qs.escape([5, 10]), '5%2C10');

// using toString for objects
assert.strictEqual(
  qs.escape({test: 5, toString: () => 'test', valueOf: () => 10 }),
  'test'
);

// toString is not callable, must throw an error
assert.throws(() => qs.escape({toString: 5}));

// should use valueOf instead of non-callable toString
assert.strictEqual(qs.escape({toString: 5, valueOf: () => 'test'}), 'test');

assert.throws(() => qs.escape(Symbol('test')));
