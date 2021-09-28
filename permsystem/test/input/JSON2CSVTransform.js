'use strict';

const Transform = require('stream').Transform;
const Parser = require('jsonparse');
const JSON2CSVBase = require('./JSON2CSVBase');

class JSON2CSVTransform extends Transform {
  constructor(opts, transformOpts) {
    super(transformOpts);

    // Inherit methods from JSON2CSVBase since extends doesn't
    // allow multiple inheritance and manually preprocess opts
    Object.getOwnPropertyNames(JSON2CSVBase.prototype)
      .forEach(key => (this[key] = JSON2CSVBase.prototype[key]));
  }
}

module.exports = JSON2CSVTransform;
