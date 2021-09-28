'use strict';

const common = require('../common');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

common.refreshTmpDir();

const dirname = path.join(common.tmpDir, '\u4e2d\u6587\u76ee\u5f55');
fs.mkdirSync(dirname);
fs.writeFileSync(path.join(dirname, 'file.js'), 'module.exports = 42;');
fs.writeFileSync(path.join(dirname, 'package.json'),
                 JSON.stringify({ name: 'test', main: 'file.js' }));
assert.equal(require(dirname), 42);
assert.equal(require(path.join(dirname, 'file.js')), 42);
