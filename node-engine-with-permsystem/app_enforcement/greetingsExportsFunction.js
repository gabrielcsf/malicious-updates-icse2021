// greetings.js

var greetings = {};

greetings.sayHello = function() {
	console.log("Hello");
	test = "zzzzz";
	// var test = eval;
	// global.test = eval;
	// console.log(this);
	// var b = this == global;
	// console.log("this == global " + b);

	// console.log("testExportFunction " + global.test);
	console.log("testExportFunction " + test);
};

module.exports = greetings.sayHello;