var assert = require('chai').assert;
var nodesbox = require('../src/lib');

function assertStrEqual(actual, expected) {
	return assert.equal(actual.escape(), expected.escape());
}

let generateCode = nodesbox.genCode;
let randomPropFunctionName = nodesbox.generateRandomPropertyEnforcementFunctionName();

String.prototype.escape = function() {
	return this.replace(/\s+/g,' ').trim();
}

function normalizeMemberExpr(expr) {
	var ast = nodesbox.parse(expr);
	var sm = nodesbox.getScopeManager(ast);
	return generateCode(nodesbox.normalizeMemberExpr(nodesbox.normalizeVariablesScope(ast, sm)));
}

function rewriteMemberExpr(expr) {
	return generateCode(nodesbox.rewriteMemberExpr(nodesbox.parse(expr), randomPropFunctionName));
}

function normalizeAndRewriteMemberExpr(expr) {
	var ast = nodesbox.parse(expr);
	var sm = nodesbox.getScopeManager(ast);
	return generateCode(nodesbox.rewriteMemberExpr(nodesbox.normalizeMemberExpr(nodesbox.normalizeVariablesScope(ast, sm)), randomPropFunctionName));
}

function normalizeVariablesScope(ast) {
	var ast = nodesbox.parse(ast);
	var sm = nodesbox.getScopeManager(ast);
	var code = generateCode(nodesbox.normalizeVariablesScope(ast, sm));
	return code;
}

it('should resolve variables scope', function() {
	// variables that are not modified
	assertStrEqual(normalizeVariablesScope("global;"), "global;");
	assertStrEqual(normalizeVariablesScope("GLOBAL;"), "GLOBAL;");
	assertStrEqual(normalizeVariablesScope("root;"), "root;");
	assertStrEqual(normalizeVariablesScope("module;"), "module;");
	assertStrEqual(normalizeVariablesScope("require;"), "require;");
	assertStrEqual(normalizeVariablesScope("exports;"), "exports;");
	assertStrEqual(normalizeVariablesScope("__dirname;"), "__dirname;");
	assertStrEqual(normalizeVariablesScope("__filename;"), "__filename;");

	// variables that are modified
	assertStrEqual(normalizeVariablesScope("r;"), "global['r'];");
	assertStrEqual(normalizeVariablesScope("x;"), "global['x'];");
	assertStrEqual(normalizeVariablesScope("a = r;"), "a = global['r'];");
	assertStrEqual(normalizeVariablesScope("a = x;"), "a = global['x'];");
	assertStrEqual(normalizeVariablesScope("require;"), "require;");
	assertStrEqual(normalizeVariablesScope("eval;"), "global['eval'];");
	assertStrEqual(normalizeVariablesScope("console.log('test');"), "global['console'].log('test');");
	assertStrEqual(normalizeVariablesScope("var http = module.parent.require('http')"), "var http = module.parent.require('http');");
	assertStrEqual(normalizeVariablesScope("var bomHandling = require('./bom-handling'), iconv = module.exports;"), "var bomHandling = require('./bom-handling'), iconv = module.exports;");

	// global variables in global scope
	assertStrEqual(normalizeVariablesScope(
	`
		e = x;
	`),
	`
		e = global['x'];
	`);

	// global variables (with declaration) in global scope
	assertStrEqual(normalizeVariablesScope(`
		var x = '';
		e = x;
    `),`
		var x = '';
		e = global['x'];
	`);

	// local variable x (with declaration) in local scope
	assertStrEqual(normalizeVariablesScope(`
		function foo() {
			var x = '';
			e = x;
		}
    `),`
    	function foo() {
			var x = '';
			e = x;
		}
	`);

	// global variable referenced inside function
	assertStrEqual(normalizeVariablesScope(`
		function foo() {
			bar();
			function f() {
				z = require;
			}
		}
	`),`
		function foo() {
			global['bar']();
			function f() {
				z = require;
			}
		}
	`);

	// more complex example
	assertStrEqual(normalizeVariablesScope(`
		function foo() {
		    bar();
		    function f() {
		      z = require;
		    }
		  	f()
		    e = x;
			r = require;
			return r('fs');
		}
		foo();
		`),`
		function foo() {
		    global['bar']();
		    function f() {
		        z = require;
		    }
		    f();
		    e = global['x'];
		    r = require;
		    return global['r']('fs');
		}
		global['foo']();
	`);

	assertStrEqual(normalizeVariablesScope(`
		function foo() {
			let parent = module;
		    do {
		      parent = parent.parent;
		    } while (parent);
	    }
    `),`
    	function foo() {
			let parent = module;
		    do {
		      parent = parent.parent;
		    } while (parent);
		}
    `);
});

it('should normalize member expressions', function() {
	assertStrEqual(normalizeMemberExpr("require.main;"), "require['main'];");
	assertStrEqual(normalizeMemberExpr("require.constructor;"), "require['constructor'];");
	assertStrEqual(normalizeMemberExpr("module.parent;"), "module['parent'];");
	assertStrEqual(normalizeMemberExpr("module.children;"), "module['children'];");
	assertStrEqual(normalizeMemberExpr("module.constructor;"), "module['constructor'];");
	assertStrEqual(normalizeMemberExpr("module.prototype;"), "module['prototype'];");
	assertStrEqual(normalizeMemberExpr("x = eval();"), "x = global['eval']();");
});

it('should not normalize member expressions', function() {
	assertStrEqual(normalizeMemberExpr("x.a;"), "global['x'].a;");
	assertStrEqual(normalizeMemberExpr("global.console;"), "global.console;");
	assertStrEqual(normalizeMemberExpr("x[str()];"), "global['x'][global['str']()];");
	assertStrEqual(normalizeMemberExpr("require.cache;"), "require.cache;");
	assertStrEqual(normalizeMemberExpr("x.foo;"), "global['x'].foo;");
	assertStrEqual(normalizeMemberExpr("y.bar;"), "global['y'].bar;");
	assertStrEqual(normalizeMemberExpr("y['bar']"), "global['y']['bar'];");

});

it('should not rewrite member expressions by *prop* call', function() {
	assertStrEqual(rewriteMemberExpr("module.id;"), "module.id;");
	assertStrEqual(rewriteMemberExpr("module.exports;"), "module.exports;");
	assertStrEqual(rewriteMemberExpr("module.filename;"), "module.filename;");
	assertStrEqual(rewriteMemberExpr("module.loaded;"), "module.loaded;");
	assertStrEqual(rewriteMemberExpr("global.console;"), "global.console;");
	assertStrEqual(rewriteMemberExpr("x.foo;"), "x.foo;");
	assertStrEqual(rewriteMemberExpr("y.bar;"), "y.bar;");
	assertStrEqual(rewriteMemberExpr("y['bar']"), "y['bar'];");
	assertStrEqual(rewriteMemberExpr("x.cache;"), "x.cache;");
});

it('should not normalize and not rewrite member expressions by *prop* call', function() {
	assertStrEqual(normalizeAndRewriteMemberExpr("x.y;"), "global['x'].y;");
	assertStrEqual(normalizeAndRewriteMemberExpr("require.cache;"), "require.cache;");
	assertStrEqual(normalizeAndRewriteMemberExpr("module.id;"), "module.id;");
	assertStrEqual(normalizeAndRewriteMemberExpr("module.exports;"), "module.exports;");
	assertStrEqual(normalizeAndRewriteMemberExpr("module.filename;"), "module.filename;");
	assertStrEqual(normalizeAndRewriteMemberExpr("module.loaded;"), "module.loaded;");
	assertStrEqual(normalizeAndRewriteMemberExpr("x.cache;"), "global['x'].cache;");
	assertStrEqual(normalizeAndRewriteMemberExpr("y.foo;"), "global['y'].foo;");
	assertStrEqual(normalizeAndRewriteMemberExpr("z.bar;"), "global['z'].bar;");
});

it('should normalize and rewrite member expressions (literal properties) by *prop* call', function() {
	assertStrEqual(normalizeAndRewriteMemberExpr("x = require.main;"), "x = " + randomPropFunctionName + "(require, 'main');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = require.constructor;"), "x = " + randomPropFunctionName + "(require, 'constructor');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = x.main;"), "x = " + randomPropFunctionName + "(global['x'], 'main');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module._load;"), "x = " + randomPropFunctionName + "(module, '_load');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module.parent;"), "x = " + randomPropFunctionName + "(module, 'parent');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module.children;"), "x = " + randomPropFunctionName + "(module, 'children');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module.paths;"), "x = " + randomPropFunctionName + "(module, 'paths');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module.globalPaths;"), "x = " + randomPropFunctionName + "(module, 'globalPaths');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module.constructor;"), "x = " + randomPropFunctionName + "(module, 'constructor');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module.require;"), "x = " + randomPropFunctionName + "(module, 'require');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = x.require;"), "x = " + randomPropFunctionName + "(global['x'], 'require');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = y.parent;"), "x = " + randomPropFunctionName + "(global['y'], 'parent');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = z.children;"), "x = " + randomPropFunctionName + "(global['z'], 'children');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = w.paths;"), "x = " + randomPropFunctionName + "(global['w'], 'paths');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = t.globalPaths;"), "x = " + randomPropFunctionName + "(global['t'], 'globalPaths');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = u.constructor;"), "x = " + randomPropFunctionName + "(global['u'], 'constructor');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = ert.require;"), "x = " + randomPropFunctionName + "(global['ert'], 'require');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = global.eval;"), "x = " + randomPropFunctionName + "(global, 'eval');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = global.Function;"), "x = " + randomPropFunctionName + "(global, 'Function');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = global.process;"), "x = " + randomPropFunctionName + "(global, 'process');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = myGlobal.eval;"), "x = " + randomPropFunctionName + "(global['myGlobal'], 'eval');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = myGlobal.Function;"), "x = " + randomPropFunctionName + "(global['myGlobal'], 'Function');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = myGlobal.process;"), "x = " + randomPropFunctionName + "(global['myGlobal'], 'process');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = eval();"), "x = " + randomPropFunctionName + "(global, 'eval')();");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = Function;"), "x = " + randomPropFunctionName + "(global, 'Function');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = process;"), "x = " + randomPropFunctionName + "(global, 'process');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = x.prototype;"), "x = " + randomPropFunctionName + "(global['x'], 'prototype');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = Object.prototype"), "x = " + randomPropFunctionName + "(Object, 'prototype');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = x.prototype.foo;"), "x = " + randomPropFunctionName + "(global['x'], 'prototype').foo;");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = Object.prototype.toString;"), "x = " + randomPropFunctionName + "(Object, 'prototype').toString;");

	assertStrEqual(normalizeAndRewriteMemberExpr("x = require['main'];"), "x = " + randomPropFunctionName + "(require, 'main');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = require['constructor'];"), "x = " + randomPropFunctionName + "(require, 'constructor');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = x['main'];"), "x = " + randomPropFunctionName + "(global['x'], 'main');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module['_load'];"), "x = " + randomPropFunctionName + "(module, '_load');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module['parent'];"), "x = " + randomPropFunctionName + "(module, 'parent');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module['children'];"), "x = " + randomPropFunctionName + "(module, 'children');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module['paths'];"), "x = " + randomPropFunctionName + "(module, 'paths');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module['globalPaths'];"), "x = " + randomPropFunctionName + "(module, 'globalPaths');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module['constructor'];"), "x = " + randomPropFunctionName + "(module, 'constructor');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module['require'];"), "x = " + randomPropFunctionName + "(module, 'require');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = x['require'];"), "x = " + randomPropFunctionName + "(global['x'], 'require');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = y['parent'];"), "x = " + randomPropFunctionName + "(global['y'], 'parent');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = z['children'];"), "x = " + randomPropFunctionName + "(global['z'], 'children');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = w['paths'];"), "x = " + randomPropFunctionName + "(global['w'], 'paths');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = t['globalPaths'];"), "x = " + randomPropFunctionName + "(global['t'], 'globalPaths');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = u['constructor'];"), "x = " + randomPropFunctionName + "(global['u'], 'constructor');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = ert['require'];"), "x = " + randomPropFunctionName + "(global['ert'], 'require');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = global['eval'];"), "x = " + randomPropFunctionName + "(global, 'eval');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = global['Function'];"), "x = " + randomPropFunctionName + "(global, 'Function');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = global['process'];"), "x = " + randomPropFunctionName + "(global, 'process');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = myGlobal['eval'];"), "x = " + randomPropFunctionName + "(global['myGlobal'], 'eval');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = myGlobal['Function'];"), "x = " + randomPropFunctionName + "(global['myGlobal'], 'Function');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = myGlobal['process'];"), "x = " + randomPropFunctionName + "(global['myGlobal'], 'process');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = eval();"), "x = " + randomPropFunctionName + "(global, 'eval')();");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = Function;"), "x = " + randomPropFunctionName + "(global, 'Function');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = process;"), "x = " + randomPropFunctionName + "(global, 'process');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = x['prototype'];"), "x = " + randomPropFunctionName + "(global['x'], 'prototype');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = Object['prototype']"), "x = " + randomPropFunctionName + "(Object, 'prototype');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = x['prototype'].foo;"), "x = " + randomPropFunctionName + "(global['x'], 'prototype').foo;");
	assertStrEqual(normalizeAndRewriteMemberExpr("x = Object['prototype'].toString;"), "x = " + randomPropFunctionName + "(Object, 'prototype').toString;");
	assertStrEqual(normalizeAndRewriteMemberExpr("var bomHandling = require('./bom-handling'), iconv = module.exports;"), "var bomHandling = require('./bom-handling'), iconv = module.exports;");
});

it('should normalize and rewrite complex programs', function() {
	assertStrEqual(normalizeAndRewriteMemberExpr(
	`
		function foo() {
			const a = module;
			while (a) {
			a = a.parent;
			}
		}
	`),
	`
		function foo() {
			const a = module;
			while (a) {
			a = ` + randomPropFunctionName + `(a, 'parent');
			}
		}
	`);

    assertStrEqual(normalizeAndRewriteMemberExpr(
	`
		function foo() {
			var a = this;
		    x = a.console.log;
		    x('test');
	    }
    `),`
    	function foo() {
			var a = this;
		    x = a.console.log;
		    global['x']('test');
	    }
	`
	);
});

it('should normalize and rewrite member expressions (expression properties) by *prop* call', function() {
	assertStrEqual(normalizeAndRewriteMemberExpr("x[str()]"), randomPropFunctionName + "(global['x'], global['str']());");
	assertStrEqual(normalizeAndRewriteMemberExpr("x['ev'+'al'];"), randomPropFunctionName + "(global['x'], 'ev' + 'al');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x['req'+'uire'];"), randomPropFunctionName + "(global['x'], 'req' + 'uire');");
	assertStrEqual(normalizeAndRewriteMemberExpr("x[str()];"), randomPropFunctionName + "(global['x'], global['str']());");

	assertStrEqual(normalizeAndRewriteMemberExpr(
		`
			x[str()];
		`),
			randomPropFunctionName + `(global['x'], global['str']());
		`
	);

	assertStrEqual(normalizeAndRewriteMemberExpr(
		`
			var x;
			x[str()];
		`),
		`
			var x; ` +
			randomPropFunctionName + `(global['x'], global['str']());
		`
	);

	assertStrEqual(normalizeAndRewriteMemberExpr(`
		function f() {
			var x;
			x[str()];
		} `
		).escape(), `
		function f() {
			var x; `
			+ randomPropFunctionName + `(x, global['str']());
		}`);
});

