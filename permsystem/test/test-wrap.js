var assert = require('chai').assert;
var nodesbox = require('../src/lib');

let generateCode = nodesbox.genCode;
let randomPropFunctionName = nodesbox.generateRandomPropertyEnforcementFunctionName();

function assertStrEqual(actual, expected) {
	return assert.equal(actual.escape(), expected.escape());
}


String.prototype.escape = function() {
	return this.replace(/\s+/g,' ').trim();
}

function normalizeMemberExpr(expr) {
	var ast = nodesbox.parse(nodesbox.wrap(expr));
	var sm = nodesbox.getScopeManager(ast);
	return generateCode(nodesbox.normalizeMemberExpr(nodesbox.normalizeVariablesScope(ast, sm))).escape();
}

function rewriteMemberExpr(expr) {
	return generateCode(nodesbox.rewriteMemberExpr(nodesbox.parse(nodesbox.wrap(expr)), randomPropFunctionName)).escape();
}

function normalizeAndRewriteMemberExpr(expr) {
	var ast = nodesbox.parse(nodesbox.wrap(expr));
	var sm = nodesbox.getScopeManager(ast);
	return generateCode(nodesbox.rewriteMemberExpr(nodesbox.normalizeMemberExpr(nodesbox.normalizeVariablesScope(ast, sm)), randomPropFunctionName)).escape();
}

function normalizeVariablesScope(expr) {
	var ast = nodesbox.parse(nodesbox.wrap(expr));
	var sm = nodesbox.getScopeManager(ast);
	return generateCode(nodesbox.normalizeVariablesScope(ast, sm)).escape();
}

it('should resolve variables scope', function() {
	// variables that are not modified
	assertStrEqual(normalizeVariablesScope("global;"), nodesbox.wrap("global;"));
	assertStrEqual(normalizeVariablesScope("GLOBAL;"), nodesbox.wrap("GLOBAL;"));
	assertStrEqual(normalizeVariablesScope("root;"), nodesbox.wrap("root;"));
	assertStrEqual(normalizeVariablesScope("module;"), nodesbox.wrap("module;"));
	assertStrEqual(normalizeVariablesScope("require;"), nodesbox.wrap("require;"));
	assertStrEqual(normalizeVariablesScope("exports;"), nodesbox.wrap("exports;"));
	assertStrEqual(normalizeVariablesScope("__dirname;"), nodesbox.wrap("__dirname;"));
	assertStrEqual(normalizeVariablesScope("__filename;"), nodesbox.wrap("__filename;"));

	// variables that are modified
	assertStrEqual(normalizeVariablesScope("r;"), nodesbox.wrap("global['r'];"));
	assertStrEqual(normalizeVariablesScope("x;"), nodesbox.wrap("global['x'];"));
	assertStrEqual(normalizeVariablesScope("a = r;"), nodesbox.wrap("a = global['r'];"));
	assertStrEqual(normalizeVariablesScope("a = x;"), nodesbox.wrap("a = global['x'];"));
	assertStrEqual(normalizeVariablesScope("require;"), nodesbox.wrap("require;"));
	assertStrEqual(normalizeVariablesScope("eval;"), nodesbox.wrap("global['eval'];"));
	assertStrEqual(normalizeVariablesScope("console.log('test');"), nodesbox.wrap("global['console'].log('test');"));
	assertStrEqual(normalizeVariablesScope("var http = module.parent.require('http')"), nodesbox.wrap("var http = module.parent.require('http');"));

	// global variables in global scope
	assertStrEqual(normalizeVariablesScope(`e = x;`), nodesbox.wrap(`e = global['x'];`));

	// global variables (with declaration) in global scope
	assertStrEqual(normalizeVariablesScope(`
		x = '';
    	e = x;
    `).escape() ,nodesbox.wrap(`
		x = '';
    	e = global['x'];
	`));

	// local variable x (with declaration) in local scope
	assertStrEqual(normalizeVariablesScope(`
		function foo() {
			var x = '';
    		e = x;
   	 	}
    `).escape() ,nodesbox.wrap(`
    	function foo() {
			var x = '';
    		e = x;
    	}
	`));

	// global variable referenced inside function
	assertStrEqual(normalizeVariablesScope(`
		function foo() {
			bar();
			function f() {
				z = require;
			}
		}
	`).escape() ,nodesbox.wrap(`
		function foo() {
			global['bar']();
			function f() {
				z = require;
			}
		}
	`));

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
		`).escape() ,nodesbox.wrap(`
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
		foo();
	`));

	assertStrEqual(normalizeVariablesScope(`
		function foo() {
			let parent = module;
		    do {
		      parent = parent.parent;
		    } while (parent);
	    }
    `).escape() ,nodesbox.wrap(`
    	function foo() {
			let parent = module;
		    do {
		      parent = parent.parent;
		    } while (parent);
		}
    `));
});

it('should normalize member expressions', function() {
	assertStrEqual(normalizeMemberExpr("require.main;"), nodesbox.wrap("require['main'];"));
	assertStrEqual(normalizeMemberExpr("require.constructor;"), nodesbox.wrap("require['constructor'];"));
	assertStrEqual(normalizeMemberExpr("module.parent;"), nodesbox.wrap("module['parent'];"));
	assertStrEqual(normalizeMemberExpr("module.children;"), nodesbox.wrap("module['children'];"));
	assertStrEqual(normalizeMemberExpr("module.constructor;"), nodesbox.wrap("module['constructor'];"));
	assertStrEqual(normalizeMemberExpr("module.prototype;"), nodesbox.wrap("module['prototype'];"));
	assertStrEqual(normalizeMemberExpr("x = eval();"), nodesbox.wrap("x = global['eval']();"));
});

it('should not normalize member expressions', function() {
	assertStrEqual(normalizeMemberExpr("x.a;"), nodesbox.wrap("global['x'].a;"));
	assertStrEqual(normalizeMemberExpr("global.console;"), nodesbox.wrap("global.console;"));
	assertStrEqual(normalizeMemberExpr("x[str()];"), nodesbox.wrap("global['x'][global['str']()];"));
	assertStrEqual(normalizeMemberExpr("require.cache;"), nodesbox.wrap("require.cache;"));
	assertStrEqual(normalizeMemberExpr("x.foo;"), nodesbox.wrap("global['x'].foo;"));
	assertStrEqual(normalizeMemberExpr("y.bar;"), nodesbox.wrap("global['y'].bar;"));
	assertStrEqual(normalizeMemberExpr("y['bar']"), nodesbox.wrap("global['y']['bar'];"));

});

it('should not rewrite member expressions by *prop* call', function() {
	assertStrEqual(rewriteMemberExpr("module.id;"), nodesbox.wrap("module.id;"));
	assertStrEqual(rewriteMemberExpr("module.exports;"), nodesbox.wrap("module.exports;"));
	assertStrEqual(rewriteMemberExpr("module.filename;"), nodesbox.wrap("module.filename;"));
	assertStrEqual(rewriteMemberExpr("module.loaded;"), nodesbox.wrap("module.loaded;"));
	assertStrEqual(rewriteMemberExpr("global.console;"), nodesbox.wrap("global.console;"));
	assertStrEqual(rewriteMemberExpr("x.foo;"), nodesbox.wrap("x.foo;"));
	assertStrEqual(rewriteMemberExpr("y.bar;"), nodesbox.wrap("y.bar;"));
	assertStrEqual(rewriteMemberExpr("y['bar']"), nodesbox.wrap("y['bar'];"));
	assertStrEqual(rewriteMemberExpr("x.cache;"), nodesbox.wrap("x.cache;"));
});

it('should not normalize and not rewrite member expressions by *prop* call', function() {
	assertStrEqual(normalizeAndRewriteMemberExpr("x.y;"), nodesbox.wrap("global['x'].y;"));
	assertStrEqual(normalizeAndRewriteMemberExpr("require.cache;"), nodesbox.wrap("require.cache;"));
	assertStrEqual(normalizeAndRewriteMemberExpr("module.id;"), nodesbox.wrap("module.id;"));
	assertStrEqual(normalizeAndRewriteMemberExpr("module.exports;"), nodesbox.wrap("module.exports;"));
	assertStrEqual(normalizeAndRewriteMemberExpr("module.filename;"), nodesbox.wrap("module.filename;"));
	assertStrEqual(normalizeAndRewriteMemberExpr("module.loaded;"), nodesbox.wrap("module.loaded;"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x.cache;"), nodesbox.wrap("global['x'].cache;"));
	assertStrEqual(normalizeAndRewriteMemberExpr("y.foo;"), nodesbox.wrap("global['y'].foo;"));
	assertStrEqual(normalizeAndRewriteMemberExpr("z.bar;"), nodesbox.wrap("global['z'].bar;"));
});

it('should normalize and rewrite member expressions (literal properties) by *prop* call', function() {
	assertStrEqual(normalizeAndRewriteMemberExpr("x = require.main;"), nodesbox.wrap("x = " + randomPropFunctionName + "(require, 'main');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = require.constructor;"), nodesbox.wrap("x = " + randomPropFunctionName + "(require, 'constructor');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = x.main;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['x'], 'main');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module._load;"), nodesbox.wrap("x = " + randomPropFunctionName + "(module, '_load');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module.parent;"), nodesbox.wrap("x = " + randomPropFunctionName + "(module, 'parent');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module.children;"), nodesbox.wrap("x = " + randomPropFunctionName + "(module, 'children');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module.paths;"), nodesbox.wrap("x = " + randomPropFunctionName + "(module, 'paths');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module.globalPaths;"), nodesbox.wrap("x = " + randomPropFunctionName + "(module, 'globalPaths');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module.constructor;"), nodesbox.wrap("x = " + randomPropFunctionName + "(module, 'constructor');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module.require;"), nodesbox.wrap("x = " + randomPropFunctionName + "(module, 'require');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = x.require;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['x'], 'require');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = y.parent;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['y'], 'parent');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = z.children;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['z'], 'children');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = w.paths;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['w'], 'paths');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = t.globalPaths;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['t'], 'globalPaths');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = u.constructor;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['u'], 'constructor');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = ert.require;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['ert'], 'require');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = global.eval;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global, 'eval');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = global.Function;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global, 'Function');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = global.process;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global, 'process');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = myGlobal.eval;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['myGlobal'], 'eval');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = myGlobal.Function;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['myGlobal'], 'Function');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = myGlobal.process;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['myGlobal'], 'process');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = eval();"), nodesbox.wrap("x = " + randomPropFunctionName + "(global, 'eval')();"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = Function;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global, 'Function');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = process;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global, 'process');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = x.prototype;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['x'], 'prototype');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = Object.prototype"), nodesbox.wrap("x = " + randomPropFunctionName + "(Object, 'prototype');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = x.prototype.foo;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['x'], 'prototype').foo;"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = Object.prototype.toString;"), nodesbox.wrap("x = " + randomPropFunctionName + "(Object, 'prototype').toString;"));

	assertStrEqual(normalizeAndRewriteMemberExpr("x = require['main'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(require, 'main');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = require['constructor'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(require, 'constructor');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = x['main'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['x'], 'main');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module['_load'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(module, '_load');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module['parent'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(module, 'parent');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module['children'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(module, 'children');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module['paths'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(module, 'paths');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module['globalPaths'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(module, 'globalPaths');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module['constructor'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(module, 'constructor');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = module['require'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(module, 'require');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = x['require'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['x'], 'require');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = y['parent'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['y'], 'parent');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = z['children'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['z'], 'children');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = w['paths'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['w'], 'paths');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = t['globalPaths'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['t'], 'globalPaths');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = u['constructor'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['u'], 'constructor');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = ert['require'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['ert'], 'require');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = global['eval'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(global, 'eval');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = global['Function'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(global, 'Function');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = global['process'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(global, 'process');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = myGlobal['eval'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['myGlobal'], 'eval');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = myGlobal['Function'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['myGlobal'], 'Function');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = myGlobal['process'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['myGlobal'], 'process');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = eval();"), nodesbox.wrap("x = " + randomPropFunctionName + "(global, 'eval')();"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = Function;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global, 'Function');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = process;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global, 'process');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = x['prototype'];"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['x'], 'prototype');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = Object['prototype']"), nodesbox.wrap("x = " + randomPropFunctionName + "(Object, 'prototype');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = x['prototype'].foo;"), nodesbox.wrap("x = " + randomPropFunctionName + "(global['x'], 'prototype').foo;"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x = Object['prototype'].toString;"), nodesbox.wrap("x = " + randomPropFunctionName + "(Object, 'prototype').toString;"));
});

it('should normalize and rewrite complex programs', function() {
	assertStrEqual(normalizeAndRewriteMemberExpr(`
		function foo() {
			let parent = module;
		    do {
		      parent = parent.parent;
		    } while (parent);
	    }
    `).escape() ,nodesbox.wrap(`
    	function foo() {
			let parent = module;
		    do {
		      parent = ` + randomPropFunctionName + `(parent, 'parent');
		    } while (parent);
		}
    `));

    assertStrEqual(normalizeAndRewriteMemberExpr(`
		function foo() {
			var a = this;
		    x = a.console.log;
		    x('test');
	    }
    `).escape() ,nodesbox.wrap(`
    	function foo() {
			var a = this;
		    x = a.console.log;
		    global['x']('test');
	    }
    `));
});

it('should normalize and rewrite member expressions (expression properties) by *prop* call', function() {
	assertStrEqual(normalizeAndRewriteMemberExpr("x[str()]"), nodesbox.wrap(randomPropFunctionName + "(global['x'], global['str']());"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x['ev'+'al'];"), nodesbox.wrap(randomPropFunctionName + "(global['x'], 'ev' + 'al');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x['req'+'uire'];"), nodesbox.wrap(randomPropFunctionName + "(global['x'], 'req' + 'uire');"));
	assertStrEqual(normalizeAndRewriteMemberExpr("x[str()];"), nodesbox.wrap(randomPropFunctionName + "(global['x'], global['str']());"));

	assertStrEqual(normalizeAndRewriteMemberExpr(`
			x[str()];
		`
		).escape(), nodesbox.wrap(randomPropFunctionName + `(global['x'], global['str']());
		`));

	assertStrEqual(normalizeAndRewriteMemberExpr(`
			var x; x[str()];
		`
		).escape(),
		nodesbox.wrap(`
			var x; ` + randomPropFunctionName + `(x, global['str']());
		`));

	assertStrEqual(normalizeAndRewriteMemberExpr(`
		function f() {
			var x; x[str()];
		} `
		).escape(), nodesbox.wrap(`
		function f() {
			var x; ` + randomPropFunctionName + `(x, global['str']());
		}`));
});

