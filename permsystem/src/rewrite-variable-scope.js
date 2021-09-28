var nodesbox = require('./lib');

var inputFile = nodesbox.readFile(process.argv[2]);
var outputFilePath = process.argv[3];

var ast = nodesbox.parse(nodesbox.wrap(inputFile));
var scopeManager = nodesbox.getScopeManager(ast);

resultAST = nodesbox.normalizeVariablesScope(ast, scopeManager);
var code = nodesbox.genCode(resultAST);
var outputFile = nodesbox.writeFile(outputFilePath, code);
