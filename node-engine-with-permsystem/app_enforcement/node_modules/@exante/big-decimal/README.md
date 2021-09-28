# BigDecimal number converter

A very small set of utility functions to convert numbers in Big Decimal format to JavaScript
numbers and back.

[![version][version-badge]][package]
[![styled with prettier](https://img.shields.io/badge/styled_with-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)


### Install

```bash
npm install --save @exante/big-decimal
```

### Usage

```javascript
import { toBigDec, fromBigDec } from '@exante/big-decimal';

fromBigDec({ scale: 2, value: 12345 }); // -> 123.45

toBigDec(123.45); // -> { scale: 2, value: 12345 }
```

### Features
* Robust: The library is tested to behave correctly with all kinds of input. It correctly handles all JavaScript quirks when dealing with numbers and accounts for strings, scientific notation, leading and trailing zeros and invalid input.
* Lightweight: 800 bytes minified

#### NOTE: Does not provide BigDecimal arithmetic
This library is intended to be as lightweight as possible. Therefore it only provides helpers to convert numbers
to and from BigDecimal format. It does not provide utilities for BigDecimal arithmetic.
If you need precision arithmetic in JavaScript, take a look at
[big.js](https://github.com/MikeMcl/big.js/) or [bignumber.js](https://github.com/MikeMcl/bignumber.js/)


[version-badge]: https://img.shields.io/npm/v/@exante/big-decimal.svg?style=flat-square
[package]: https://www.npmjs.com/package/@exante/big-decimal
