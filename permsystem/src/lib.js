var escope = require('escope');
var espree = require('espree');
var estraverse = require('estraverse');
var escodegen = require('escodegen');
var fs = require('fs');

var nodesbox = {};
nodesbox.debug = false;
nodesbox.ast = {};
nodesbox.scopeManager = {};
nodesbox.currentScope = {};
nodesbox.globalImplicitVariables = [];

nodesbox.generateRandomPropertyEnforcementFunctionName = function() { return "$prop" + Math.random().toString(36).substring(2, 15); }

const internalObjectKeys = ['start', 'end', 'parent', 'arguments', 'type'];

nodesbox.blacklistedLocalObjects = ["module", "global", "require"];
nodesbox.blacklistedObjects = nodesbox.blacklistedLocalObjects.concat(nodesbox.nativeObjectNames);

nodesbox.nativeObjectNames = ["JSON", "Buffer", "Date", "Math", "String", "Boolean", "Number", "Array", "Object", "Reflect", "RegExp", "Map", "WeakMap", "Promise", "Proxy", "Set"];

nodesbox.localVariables = nodesbox.nativeObjectNames.concat(["self", "window", "require", "module", "global", "GLOBAL", "root", "exports", "__filename", "__dirname"]);

nodesbox.blacklistedProperties = ["main", "constructor", "require", "parent", "children", "_load", "paths", "globalPaths", "eval", "Function", "process", "prototype", "__proto__", "create", "setPrototypeOf"];

nodesbox.isBlacklistedProperty = function (propertyName) {
    return nodesbox.blacklistedProperties.indexOf(propertyName) > -1;
}
nodesbox.includePropertyEnforcementFunction = function(code, propCheckFunctionName) {
    code = code.substring(code.indexOf("\n"));
    code = code.substring(code.lastIndexOf("\n"), -1);
    var prop = "\r\n   var blacklisted = {};\r\n   blacklisted[\"parent\"] = module;\r\n   blacklisted[\"children\"] = module;\r\n   blacklisted[\"require\"] = module;\r\n   " +
        "blacklisted[\"main\"] = require;\r\n   blacklisted[\"paths\"] = module;\r\n   blacklisted[\"globalPaths\"] = module;\r\n   blacklisted[\"eval\"] = global;\r\n   " +
        "blacklisted[\"process\"] = global;\r\n   blacklisted[\"prototype\"] = Object;\r\n   blacklisted[\"Function\"] = global;\r\n   \r\n   \/\/" +
        " checks permissions to access properties\r\n function " + propCheckFunctionName + "(obj, p) {\r\n if (obj == undefined) return undefined;\r\n if (p == undefined) return undefined;\r\n" +
        " if (blacklisted[p] != undefined && obj === blacklisted[p]) {\r\n   //console.log(\"*** [PERM-ERROR-REPORT] Accessing blacklisted property: \" + p);\r\n    return obj[p];\r\n  }\r\n  return obj[p];\r\n}";

    return prop + "\n" + code;
}

nodesbox.wrapper = [
    '(function (exports, require, module, __filename, __dirname) {\n',
    '\n});'
];

nodesbox.wrap = function (script) {
    return nodesbox.wrapper[0] + script + nodesbox.wrapper[1];
};

nodesbox.rewrite = function(input) {
    var AST = nodesbox.parse(nodesbox.wrap(input));
    var scopeManager = nodesbox.getScopeManager(AST);
    var propertyEnforcementFunctionName = nodesbox.generateRandomPropertyEnforcementFunctionName();

    var resultAST = nodesbox.normalizeVariablesScope(AST, scopeManager);
    resultAST = nodesbox.normalizeMemberExpr(AST);
    resultAST = nodesbox.rewriteMemberExpr(resultAST, propertyEnforcementFunctionName);

    var code = nodesbox.genCode(resultAST);
    return nodesbox.wrap(nodesbox.includePropertyEnforcementFunction(code, propertyEnforcementFunctionName));
}

nodesbox.readFile = function(fileName) {
    var content = fs.readFileSync(fileName, 'utf8');
    return content;
}

nodesbox.writeFile = function(fileName, content) {
    let stream;
    if (fileName) stream = fs.createWriteStream(fileName);
    else stream = process.stdout;
    stream.write(content,'utf8');
    stream.end();
}

nodesbox.parse = function(code) {
    try {
    var ast = espree.parse(code, { ecmaVersion: 6 });
    } catch(e) {
        console.error("Error when parsing JavaScript code");
        throw e;
    }
    nodesbox.visitAST(ast, function(){});
    nodesbox.disableLeftSideRewrite(ast);
    return ast;
}

nodesbox.getScopeManager = function(ast) {
    var sm = escope.analyze(ast);
    nodesbox.scopeManager = sm;
    return sm;
}

nodesbox.disableLeftSideRewrite = function(ast) {
    estraverse.traverse(ast, {
        enter: function(node) {
            if (node.type == 'AssignmentExpression') {
                node.left.doNotRewrite = true;
            }
            if (node.type == 'VariableDeclarator') {
                node.id.doNotRewrite = true;
            }
        }
    });
}

nodesbox.visitAST = function(ast, visit) {
    estraverse.traverse(ast, {
        enter: function(node, parent) {
            node.parent = parent;
            visit(node);
        }
    });
}

nodesbox.getReferences = function(scope) {
    var refs = [];
    for (var i = 0; i < scope.references.length; i++) {
        refs.push(scope.references[i]);
    }
    return refs;
}

nodesbox.getVariables = function(scope) {
    var vars = [];
    if (!scope || !scope.variables) return vars;

    for (var i = 0; i < scope.variables.length; i++) {
        vars.push(scope.variables[i]);
    }
    return vars;
}

nodesbox.getVariablesFromUpperScopes = function(scope) {
    var vars = [];
    for (var i = 0; i < scope.variables.length; i++) {
        vars.push(scope.variables[i]);
    }
    if (scope.upper) {
        return vars.concat(nodesbox.getVariablesFromUpperScopes(scope.upper));
    }
    return vars.concat(nodesbox.getVariables(scope.upper));
}

// transitive version
nodesbox.getVariableDefinitionsFromUpperScopes = function(scope) {
    var vars = [];
    for (var i = 0; i < scope.variables.length; i++) {
        if (scope.variables[i].defs[0] != undefined && scope.variables[i].defs[0].type === 'Variable') {
            vars.push(scope.variables[i]);
        }
    }
    if (scope.upper) {
        return vars.concat(nodesbox.getVariableDefinitionsFromUpperScopes(scope.upper));
    }
    return vars.concat(nodesbox.getVariableDefinitions(scope.upper));
}

nodesbox.getVariableDefinitions = function(scope) {
    var vars = [];
    for (var i = 0; i < scope.variables.length; i++) {
        if (scope.variables[i].defs[0] != undefined && scope.variables[i].defs[0].type === 'Variable') {
            vars.push(scope.variables[i]);
        }
    }
    return vars;
}

nodesbox.getFunctionDefinitions = function(scope) {
    var vars = [];
    if (!scope || !scope.variables) return vars;

    for (var i = 0; i < scope.variables.length; i++) {
        if (scope.variables[i].defs[0].type === 'FunctionName') {
            vars.push(scope.variables[i]);
        }
    }
    return vars;
}

nodesbox.getImplicitVariables = function(scope) {
    var vars = [];
    for (var i = 0; i < scope.implicit.variables.length; i++) {
        vars.push(scope.implicit.variables[i]);
    }
    return vars;
}

/*
 *  Normalizing Member Access
 */
nodesbox.normalizeMemberExpr = function(ast) {
    var result = estraverse.replace(ast, {
        enter: function(node) {
            if (node.type === 'MemberExpression' && node.doNotRewrite != true) {
                result = nodesbox.normalizeMemberExpression(node);
                return result;
            }
        }
    });
    return result;
}

nodesbox.normalizeMemberExpression = function(node) {
    var objectRef = node.object;
    let propertyName;
    if (node.property.type === 'Identifier') propertyName = node.property.name;
    if (node.property.type === 'Literal') propertyName = node.property.value;
    if (nodesbox.isBlacklistedProperty(propertyName)) {
        return nodesbox.genNormalizedMemberExprForLiteral(objectRef, propertyName);
    }
    return node;
}

nodesbox.genNormalizedMemberExprForLiteral = function(objectRef, propertyName) {
    var newNode = {};
    newNode.type = 'MemberExpression';
    newNode.property = { type: 'Literal', value: propertyName };
    setObjectReferenceOnNewNode(objectRef, newNode);
    newNode.computed = true;
    return newNode;
}

nodesbox.genNormalizedMemberExprForIdentifier = function(objectRef, propertyName, isLiteral) {
    var newNode = {};
    newNode.type = 'MemberExpression';
    newNode.property = propertyName;
    setObjectReferenceOnNewNode(objectRef, newNode);
    newNode.computed = true;
    return newNode;
}

nodesbox.genNewMemberExpr = function(objectName, propertyName) {
    var newNode = {};
    newNode.type = 'MemberExpression';
    newNode.object = { type: 'Identifier', name: objectName };
    newNode.property = { type: 'Literal', value: propertyName };
    newNode.rewrite =
    newNode.computed = true;
    return newNode;
}

nodesbox.rewriteMemberExpr = function(ast, propCheckFunctionName) {
    var result = estraverse.replace(ast, {
        enter: function(node) {
            if (node.type === 'MemberExpression' && node.doNotRewrite != true) {
                result = nodesbox.rewritePropAccess(node, propCheckFunctionName);
                return result;
            }
        }
    });
    return result;
}

nodesbox.rewritePropAccess = function(node, propCheckFunctionName) {
    var objectRef = node.object;
    var propertyName = "undefined";

    if (node.property.type === 'Literal') {
        propertyName = node.property.value;
        if (nodesbox.isBlacklistedProperty(propertyName)) {
            return nodesbox.genPropAccessFunctionCallForLiteral(objectRef, propertyName, propCheckFunctionName);
        }
        return node;
    }
    else if (node.property.type === 'Identifier') {
        if (nodesbox.isBlacklistedProperty(propertyName)) {
            propertyName = node.property.name;
            return nodesbox.genPropAccessFunctionCallForIdentifier(objectRef, propertyName, propCheckFunctionName);
        }
    } else {
        propertyName = node.property;
        return nodesbox.genPropAccessFunctionCallForIdentifier(objectRef, propertyName, propCheckFunctionName);
    }
    return node;
}

nodesbox.genPropAccessFunctionCallForIdentifier = function(objectRef, propertyName, propCheckFunctionName) {
    var newNode = {};
    newNode.type = 'CallExpression';
    newNode.callee = { type: 'Identifier', name: propCheckFunctionName };
    newNode.arguments = [];
    newNode.arguments[0] = objectRef;
    newNode.arguments[1] = propertyName;
    return newNode;
}

nodesbox.genPropAccessFunctionCallForLiteral = function(objectRef, propertyName, propCheckFunctionName) {
    var newNode = {};
    newNode.type = 'CallExpression';
    newNode.callee = { type: 'Identifier', name: propCheckFunctionName };
    newNode.arguments = [];
    newNode.arguments[0] = objectRef;
    newNode.arguments[1] = { type: 'Literal', value: propertyName };
    return newNode;
}

nodesbox.normalizeVariablesScope = function(ast, scopeManager) {
    for (var i = 0; i < scopeManager.scopes.length; i++) {
        var scope = scopeManager.scopes[i];
        var references = nodesbox.getReferences(scope);
        var variables = nodesbox.getVariablesFromUpperScopes(scope);

        if (scope.type == 'global') {
            var implicitVariables = nodesbox.getImplicitVariables(scope);
            for (var k = references.length - 1; k >= 0; k--) {
                nodesbox.rewriteVariableReferencesOnGlobalScope(references[k].identifier, variables);
            }
        } else {
            for (var k = references.length - 1; k >= 0; k--) {
                nodesbox.rewriteVariableReferences(references[k].identifier, variables, implicitVariables);
            }
        }
    }
    return ast;
}

nodesbox.rewriteVariableReferencesOnGlobalScope = function(node, variables) {
    var definedVariableNames = variables.map(x => x.name);
    var isDefinedLocally = definedVariableNames.indexOf(node.name) > -1;
    var isLocalObject = nodesbox.localVariables.indexOf(node.name) > -1;

    var variableName = node.name;
    //replace references to global variables
    if (isDefinedLocally || !isLocalObject) {
        if (node.parent) {
            var parentKeys = Object.keys(node.parent).filter(x => internalObjectKeys.indexOf(x) < 0);
            for (var i = parentKeys.length - 1; i >= 0; i--) {
                if (node.parent[parentKeys[i]] === node && node.doNotRewrite != true) {
                    node.parent[parentKeys[i]] = nodesbox.genNewMemberExpr("global", variableName);
                }
            }
        }
    }
    return node;
}

nodesbox.rewriteVariableReferences = function(node, variables, implicitVariables) {
    var implicitVariablesNames = implicitVariables.map(x => x.name);
    var definedVariableNames = variables.map(x => x.name);

    var implicitVariable = implicitVariablesNames.indexOf(node.name) > -1;
    var isDefinedLocally = definedVariableNames.indexOf(node.name) > -1;
    var isLocalObject = nodesbox.localVariables.indexOf(node.name) > -1;

    // replace references to implicit variable 'x' to global.x
    var variableName = node.name;
    if (implicitVariable) {
        if (node.parent) {
            var parentKeys = Object.keys(node.parent).filter(x => internalObjectKeys.indexOf(x) < 0);
            for (var i = parentKeys.length - 1; i >= 0; i--) {
                if (node.parent[parentKeys[i]] === node && node.doNotRewrite != true) {
                    node.parent[parentKeys[i]] = nodesbox.genNewMemberExpr("global", variableName);
                }
            }
        }

    }
    // replace references to non-local variables
    if (!isDefinedLocally && !isLocalObject) {
        if (node.parent) {
            var parentKeys = Object.keys(node.parent).filter(x => internalObjectKeys.indexOf(x) < 0);
            for (var i = parentKeys.length - 1; i >= 0; i--) {
                if (node.parent[parentKeys[i]] === node && node.doNotRewrite != true) {
                    node.parent[parentKeys[i]] = nodesbox.genNewMemberExpr("global", variableName);
                }
            }
        }

    }
    return node;
}

nodesbox.genCode = function(ast) {
    return escodegen.generate(ast);
}

function setObjectReferenceOnNewNode(objectRef, newNode) {
    if (objectRef.type === 'Identifier') {
        newNode.object = { type: 'Identifier', name: objectRef.name };
    } else {
        newNode.object = objectRef;
    }
}


module.exports = nodesbox;
global.nodesbox = nodesbox;

