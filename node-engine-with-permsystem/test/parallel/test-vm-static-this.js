/* eslint-disable strict */
var common = require('../common');
var assert = require('assert');
var vm = require('vm');

common.globalCheck = false;

console.error('run a string');
var result = vm.runInThisContext('\'passed\';');
assert.equal('passed', result);

console.error('thrown error');
assert.throws(function() {
  vm.runInThisContext('throw new Error(\'test\');');
}, /test/);

global.hello = 5;
vm.runInThisContext('hello = 2');
assert.equal(2, global.hello);


console.error('pass values');
var code = 'foo = 1;' +
           'bar = 2;' +
           'if (typeof baz !== \'undefined\') throw new Error(\'test fail\');';
global.foo = 2;
global.obj = { foo: 0, baz: 3 };
/* eslint-disable no-unused-vars */
var baz = vm.runInThisContext(code);
/* eslint-enable no-unused-vars */
assert.equal(0, global.obj.foo);
assert.equal(2, global.bar);
assert.equal(1, global.foo);

console.error('call a function');
global.f = function() { global.foo = 100; };
vm.runInThisContext('f()');
assert.equal(100, global.foo);
