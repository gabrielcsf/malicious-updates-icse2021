var nodesbox = require('./lib');

var inputFile = nodesbox.readFile(process.argv[2]);
var outputFilePath = process.argv[3];
var ast = nodesbox.parse(inputFile);
var scopeManager = nodesbox.getScopeManager(ast);

resultAST = nodesbox.normalizeVariablesScope(ast, scopeManager);
resultAST = nodesbox.normalizeMemberExpr(resultAST);

var code = nodesbox.genCode(resultAST);
var outputFile = nodesbox.writeFile(outputFilePath, code);
