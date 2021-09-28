var nodesbox = require('./lib');
if (process.argv.length != 3)
	throw Error("Illegal number of arguments. Usage: node rewrite.js [inputFile] [outputFile]");

var inputFile = nodesbox.readFile(process.argv[2]);
let outputFile = process.argv[3];

var code = nodesbox.rewrite(inputFile, outputFile);
nodesbox.writeFile(outputFile, code);
