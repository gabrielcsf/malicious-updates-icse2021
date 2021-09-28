var assert = require('chai').assert;
var nodesbox = require('../src/lib');

function assertStrEqual(actual, expected) {
	return assert.equal(actual.escape(), expected.escape());
}

String.prototype.escape = function() {
	return this.replace(/\s+/g,' ').trim();
}

it('should read file correctly', function() {
	assertStrEqual(nodesbox.readFile("test/input/textfile.txt"), "test");
});

it('should parse JS file correctly', function() {
	let AST = nodesbox.parse("test/input/simple.js");
	assert.isOk(AST);
	assert.equal(AST.type, "Program");
	assert.isArray(AST.body);
	assert.isNotEmpty(AST.body);
	assert.isOk(AST.body[0]);
	assert.equal(AST.body[0].type, "ExpressionStatement");
});

it('should throw error when parsing invalid JS file', function() {
	assert.throws(() => nodesbox.parse("const z = require('./);"), "Unterminated string constant");
});

