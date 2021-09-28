'use strict';
var common = require('../common');
var assert = require('assert');

if (!common.hasCrypto) {
  common.skip('missing crypto');
  return;
}
var crypto = require('crypto');

crypto.DEFAULT_ENCODING = 'buffer';


/*
 * Input data
 */

const ODD_LENGTH_PLAIN = 'Hello node world!';
const EVEN_LENGTH_PLAIN = 'Hello node world!AbC09876dDeFgHi';

const KEY_PLAIN = 'S3c.r.e.t.K.e.Y!';
const IV_PLAIN = 'blahFizz2011Buzz';

var CIPHER_NAME = 'aes-128-cbc';


/*
 * Expected result data
 */

// echo -n 'Hello node world!' | \
// openssl enc -aes-128-cbc -e -K 5333632e722e652e742e4b2e652e5921 \
// -iv 626c616846697a7a3230313142757a7a | xxd -p -c256
var ODD_LENGTH_ENCRYPTED =
    '7f57859550d4d2fdb9806da2a750461a9fe77253cd1cbd4b07beee4e070d561f';

// echo -n 'Hello node world!AbC09876dDeFgHi' | \
// openssl enc -aes-128-cbc -e -K 5333632e722e652e742e4b2e652e5921 \
// -iv 626c616846697a7a3230313142757a7a | xxd -p -c256
var EVEN_LENGTH_ENCRYPTED =
    '7f57859550d4d2fdb9806da2a750461ab46e71b3d78ebe2d9684dfc87f7575b988' +
    '6119866912cb8c7bcaf76c5ebc2378';

// echo -n 'Hello node world!AbC09876dDeFgHi' | \
// openssl enc -aes-128-cbc -e -K 5333632e722e652e742e4b2e652e5921 \
// -iv 626c616846697a7a3230313142757a7a -nopad | xxd -p -c256
var EVEN_LENGTH_ENCRYPTED_NOPAD =
    '7f57859550d4d2fdb9806da2a750461ab46e' +
    '71b3d78ebe2d9684dfc87f7575b9';


/*
 * Helper wrappers
 */

function enc(plain, pad) {
  var encrypt = crypto.createCipheriv(CIPHER_NAME, KEY_PLAIN, IV_PLAIN);
  encrypt.setAutoPadding(pad);
  var hex = encrypt.update(plain, 'ascii', 'hex');
  hex += encrypt.final('hex');
  return hex;
}

function dec(encd, pad) {
  var decrypt = crypto.createDecipheriv(CIPHER_NAME, KEY_PLAIN, IV_PLAIN);
  decrypt.setAutoPadding(pad);
  var plain = decrypt.update(encd, 'hex');
  plain += decrypt.final('latin1');
  return plain;
}


/*
 * Test encryption
 */

assert.equal(enc(ODD_LENGTH_PLAIN, true), ODD_LENGTH_ENCRYPTED);
assert.equal(enc(EVEN_LENGTH_PLAIN, true), EVEN_LENGTH_ENCRYPTED);

assert.throws(function() {
  // input must have block length %
  enc(ODD_LENGTH_PLAIN, false);
});

assert.doesNotThrow(function() {
  assert.equal(enc(EVEN_LENGTH_PLAIN, false), EVEN_LENGTH_ENCRYPTED_NOPAD);
});


/*
 * Test decryption
 */

assert.equal(dec(ODD_LENGTH_ENCRYPTED, true), ODD_LENGTH_PLAIN);
assert.equal(dec(EVEN_LENGTH_ENCRYPTED, true), EVEN_LENGTH_PLAIN);

assert.doesNotThrow(function() {
  // returns including original padding
  assert.equal(dec(ODD_LENGTH_ENCRYPTED, false).length, 32);
  assert.equal(dec(EVEN_LENGTH_ENCRYPTED, false).length, 48);
});

assert.throws(function() {
  // must have at least 1 byte of padding (PKCS):
  assert.equal(dec(EVEN_LENGTH_ENCRYPTED_NOPAD, true), EVEN_LENGTH_PLAIN);
});

assert.doesNotThrow(function() {
  // no-pad encrypted string should return the same:
  assert.equal(dec(EVEN_LENGTH_ENCRYPTED_NOPAD, false), EVEN_LENGTH_PLAIN);
});
