#!/bin/sh

rm bundle.js
browserify --entry lib.js > bundle.js

