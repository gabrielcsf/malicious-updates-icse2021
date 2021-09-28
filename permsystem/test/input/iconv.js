var bomHandling = require("./bom-handling"), iconv = module.exports;
iconv.encodings = null;
iconv.decode = function decode(buf, encoding, options) {
    var decoder = iconv.getDecoder(encoding, options);
}