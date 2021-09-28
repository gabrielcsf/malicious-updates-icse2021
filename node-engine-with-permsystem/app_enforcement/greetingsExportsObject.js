// greetings.js

var fs = require('fs');
var greetings = {};

greetings.sayHello = function() {
	console.log("Hi");

	// console.log("global.foo 1 >>>>" + global.foo);
	// global.foo = { a : "aaaa" };

	// console.log("global.foo 2 >>>>" + global.foo);
	// // global = {};

	// console.log("global.foo 3 >>>>" + foo);

	console.log("testExportObject " + global.test);
	// var g = this.constructor.constructor('return global;')();
	// console.log("testExportObject global " + g.test);
	console.log("testExportObject " + test);


	// greetingsI18N.sayHola();

	// fs.readdir("/Users/gferreir/workspaces/jate", function(err, items) {
	//     for (var i=0; i<items.length; i++) {
	//         console.log(">>> " + items[i]);
	//     }
	// });
};

module.exports = greetings;


