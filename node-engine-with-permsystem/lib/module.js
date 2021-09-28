'use strict';

const NativeModule = require('native_module');
const util = require('util');
const internalModule = require('internal/module');
const vm = require('vm');
const assert = require('assert').ok;
const fs = require('fs');
const path = require('path');
const internalModuleReadFile = process.binding('fs').internalModuleReadFile;
const internalModuleStat = process.binding('fs').internalModuleStat;
const preserveSymlinks = !!process.binding('config').preserveSymlinks;


// ############ BEGIN OF REWRITE
(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
  (function (process,global){
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
          " if (blacklisted[p] != undefined && obj === blacklisted[p]) {\r\n   console.log(\"[PERM-ERROR-REPORT] Accessing blacklisted property: \" + p);\r\n    return obj[p];\r\n  }\r\n  return obj[p];\r\n}";

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

  /*
   *  Re-writing
   */
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


  }).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
  },{"_process":117,"escodegen":72,"escope":75,"espree":85,"estraverse":93,"fs":111}],2:[function(require,module,exports){
  'use strict';

  const XHTMLEntities = require('./xhtml');

  const hexNumber = /^[\da-fA-F]+$/;
  const decimalNumber = /^\d+$/;

  const acorn = require("acorn");
  const tt = acorn.tokTypes;
  const TokContext = acorn.TokContext;
  const tokContexts = acorn.tokContexts;
  const TokenType = acorn.TokenType;
  const isNewLine = acorn.isNewLine;
  const isIdentifierStart = acorn.isIdentifierStart;
  const isIdentifierChar = acorn.isIdentifierChar;

  const tc_oTag = new TokContext('<tag', false);
  const tc_cTag = new TokContext('</tag', false);
  const tc_expr = new TokContext('<tag>...</tag>', true, true);

  const tok = {
    jsxName: new TokenType('jsxName'),
    jsxText: new TokenType('jsxText', {beforeExpr: true}),
    jsxTagStart: new TokenType('jsxTagStart'),
    jsxTagEnd: new TokenType('jsxTagEnd')
  }

  tok.jsxTagStart.updateContext = function() {
    this.context.push(tc_expr); // treat as beginning of JSX expression
    this.context.push(tc_oTag); // start opening tag context
    this.exprAllowed = false;
  };
  tok.jsxTagEnd.updateContext = function(prevType) {
    let out = this.context.pop();
    if (out === tc_oTag && prevType === tt.slash || out === tc_cTag) {
      this.context.pop();
      this.exprAllowed = this.curContext() === tc_expr;
    } else {
      this.exprAllowed = true;
    }
  };

  // Transforms JSX element name to string.

  function getQualifiedJSXName(object) {
    if (!object)
      return object;

    if (object.type === 'JSXIdentifier')
      return object.name;

    if (object.type === 'JSXNamespacedName')
      return object.namespace.name + ':' + object.name.name;

    if (object.type === 'JSXMemberExpression')
      return getQualifiedJSXName(object.object) + '.' +
      getQualifiedJSXName(object.property);
  }

  module.exports = function(options) {
    options = options || {};
    return function(Parser) {
      return plugin({
        allowNamespaces: options.allowNamespaces !== false,
        allowNamespacedObjects: !!options.allowNamespacedObjects
      }, Parser);
    }
  };
  module.exports.tokTypes = tok;

  function plugin(options, Parser) {
    return class extends Parser {
      // Reads inline JSX contents token.
      jsx_readToken() {
        let out = '', chunkStart = this.pos;
        for (;;) {
          if (this.pos >= this.input.length)
            this.raise(this.start, 'Unterminated JSX contents');
          let ch = this.input.charCodeAt(this.pos);

          switch (ch) {
          case 60: // '<'
          case 123: // '{'
            if (this.pos === this.start) {
              if (ch === 60 && this.exprAllowed) {
                ++this.pos;
                return this.finishToken(tok.jsxTagStart);
              }
              return this.getTokenFromCode(ch);
            }
            out += this.input.slice(chunkStart, this.pos);
            return this.finishToken(tok.jsxText, out);

          case 38: // '&'
            out += this.input.slice(chunkStart, this.pos);
            out += this.jsx_readEntity();
            chunkStart = this.pos;
            break;

          default:
            if (isNewLine(ch)) {
              out += this.input.slice(chunkStart, this.pos);
              out += this.jsx_readNewLine(true);
              chunkStart = this.pos;
            } else {
              ++this.pos;
            }
          }
        }
      }

      jsx_readNewLine(normalizeCRLF) {
        let ch = this.input.charCodeAt(this.pos);
        let out;
        ++this.pos;
        if (ch === 13 && this.input.charCodeAt(this.pos) === 10) {
          ++this.pos;
          out = normalizeCRLF ? '\n' : '\r\n';
        } else {
          out = String.fromCharCode(ch);
        }
        if (this.options.locations) {
          ++this.curLine;
          this.lineStart = this.pos;
        }

        return out;
      }

      jsx_readString(quote) {
        let out = '', chunkStart = ++this.pos;
        for (;;) {
          if (this.pos >= this.input.length)
            this.raise(this.start, 'Unterminated string constant');
          let ch = this.input.charCodeAt(this.pos);
          if (ch === quote) break;
          if (ch === 38) { // '&'
            out += this.input.slice(chunkStart, this.pos);
            out += this.jsx_readEntity();
            chunkStart = this.pos;
          } else if (isNewLine(ch)) {
            out += this.input.slice(chunkStart, this.pos);
            out += this.jsx_readNewLine(false);
            chunkStart = this.pos;
          } else {
            ++this.pos;
          }
        }
        out += this.input.slice(chunkStart, this.pos++);
        return this.finishToken(tt.string, out);
      }

      jsx_readEntity() {
        let str = '', count = 0, entity;
        let ch = this.input[this.pos];
        if (ch !== '&')
          this.raise(this.pos, 'Entity must start with an ampersand');
        let startPos = ++this.pos;
        while (this.pos < this.input.length && count++ < 10) {
          ch = this.input[this.pos++];
          if (ch === ';') {
            if (str[0] === '#') {
              if (str[1] === 'x') {
                str = str.substr(2);
                if (hexNumber.test(str))
                  entity = String.fromCharCode(parseInt(str, 16));
              } else {
                str = str.substr(1);
                if (decimalNumber.test(str))
                  entity = String.fromCharCode(parseInt(str, 10));
              }
            } else {
              entity = XHTMLEntities[str];
            }
            break;
          }
          str += ch;
        }
        if (!entity) {
          this.pos = startPos;
          return '&';
        }
        return entity;
      }

      // Read a JSX identifier (valid tag or attribute name).
      //
      // Optimized version since JSX identifiers can't contain
      // escape characters and so can be read as single slice.
      // Also assumes that first character was already checked
      // by isIdentifierStart in readToken.

      jsx_readWord() {
        let ch, start = this.pos;
        do {
          ch = this.input.charCodeAt(++this.pos);
        } while (isIdentifierChar(ch) || ch === 45); // '-'
        return this.finishToken(tok.jsxName, this.input.slice(start, this.pos));
      }

      // Parse next token as JSX identifier

      jsx_parseIdentifier() {
        let node = this.startNode();
        if (this.type === tok.jsxName)
          node.name = this.value;
        else if (this.type.keyword)
          node.name = this.type.keyword;
        else
          this.unexpected();
        this.next();
        return this.finishNode(node, 'JSXIdentifier');
      }

      // Parse namespaced identifier.

      jsx_parseNamespacedName() {
        let startPos = this.start, startLoc = this.startLoc;
        let name = this.jsx_parseIdentifier();
        if (!options.allowNamespaces || !this.eat(tt.colon)) return name;
        var node = this.startNodeAt(startPos, startLoc);
        node.namespace = name;
        node.name = this.jsx_parseIdentifier();
        return this.finishNode(node, 'JSXNamespacedName');
      }

      // Parses element name in any form - namespaced, member
      // or single identifier.

      jsx_parseElementName() {
        if (this.type === tok.jsxTagEnd) return '';
        let startPos = this.start, startLoc = this.startLoc;
        let node = this.jsx_parseNamespacedName();
        if (this.type === tt.dot && node.type === 'JSXNamespacedName' && !options.allowNamespacedObjects) {
          this.unexpected();
        }
        while (this.eat(tt.dot)) {
          let newNode = this.startNodeAt(startPos, startLoc);
          newNode.object = node;
          newNode.property = this.jsx_parseIdentifier();
          node = this.finishNode(newNode, 'JSXMemberExpression');
        }
        return node;
      }

      // Parses any type of JSX attribute value.

      jsx_parseAttributeValue() {
        switch (this.type) {
        case tt.braceL:
          let node = this.jsx_parseExpressionContainer();
          if (node.expression.type === 'JSXEmptyExpression')
            this.raise(node.start, 'JSX attributes must only be assigned a non-empty expression');
          return node;

        case tok.jsxTagStart:
        case tt.string:
          return this.parseExprAtom();

        default:
          this.raise(this.start, 'JSX value should be either an expression or a quoted JSX text');
        }
      }

      // JSXEmptyExpression is unique type since it doesn't actually parse anything,
      // and so it should start at the end of last read token (left brace) and finish
      // at the beginning of the next one (right brace).

      jsx_parseEmptyExpression() {
        let node = this.startNodeAt(this.lastTokEnd, this.lastTokEndLoc);
        return this.finishNodeAt(node, 'JSXEmptyExpression', this.start, this.startLoc);
      }

      // Parses JSX expression enclosed into curly brackets.

      jsx_parseExpressionContainer() {
        let node = this.startNode();
        this.next();
        node.expression = this.type === tt.braceR
          ? this.jsx_parseEmptyExpression()
          : this.parseExpression();
        this.expect(tt.braceR);
        return this.finishNode(node, 'JSXExpressionContainer');
      }

      // Parses following JSX attribute name-value pair.

      jsx_parseAttribute() {
        let node = this.startNode();
        if (this.eat(tt.braceL)) {
          this.expect(tt.ellipsis);
          node.argument = this.parseMaybeAssign();
          this.expect(tt.braceR);
          return this.finishNode(node, 'JSXSpreadAttribute');
        }
        node.name = this.jsx_parseNamespacedName();
        node.value = this.eat(tt.eq) ? this.jsx_parseAttributeValue() : null;
        return this.finishNode(node, 'JSXAttribute');
      }

      // Parses JSX opening tag starting after '<'.

      jsx_parseOpeningElementAt(startPos, startLoc) {
        let node = this.startNodeAt(startPos, startLoc);
        node.attributes = [];
        let nodeName = this.jsx_parseElementName();
        if (nodeName) node.name = nodeName;
        while (this.type !== tt.slash && this.type !== tok.jsxTagEnd)
          node.attributes.push(this.jsx_parseAttribute());
        node.selfClosing = this.eat(tt.slash);
        this.expect(tok.jsxTagEnd);
        return this.finishNode(node, nodeName ? 'JSXOpeningElement' : 'JSXOpeningFragment');
      }

      // Parses JSX closing tag starting after '</'.

      jsx_parseClosingElementAt(startPos, startLoc) {
        let node = this.startNodeAt(startPos, startLoc);
        let nodeName = this.jsx_parseElementName();
        if (nodeName) node.name = nodeName;
        this.expect(tok.jsxTagEnd);
        return this.finishNode(node, nodeName ? 'JSXClosingElement' : 'JSXClosingFragment');
      }

      // Parses entire JSX element, including it's opening tag
      // (starting after '<'), attributes, contents and closing tag.

      jsx_parseElementAt(startPos, startLoc) {
        let node = this.startNodeAt(startPos, startLoc);
        let children = [];
        let openingElement = this.jsx_parseOpeningElementAt(startPos, startLoc);
        let closingElement = null;

        if (!openingElement.selfClosing) {
          contents: for (;;) {
            switch (this.type) {
            case tok.jsxTagStart:
              startPos = this.start; startLoc = this.startLoc;
              this.next();
              if (this.eat(tt.slash)) {
                closingElement = this.jsx_parseClosingElementAt(startPos, startLoc);
                break contents;
              }
              children.push(this.jsx_parseElementAt(startPos, startLoc));
              break;

            case tok.jsxText:
              children.push(this.parseExprAtom());
              break;

            case tt.braceL:
              children.push(this.jsx_parseExpressionContainer());
              break;

            default:
              this.unexpected();
            }
          }
          if (getQualifiedJSXName(closingElement.name) !== getQualifiedJSXName(openingElement.name)) {
            this.raise(
              closingElement.start,
              'Expected corresponding JSX closing tag for <' + getQualifiedJSXName(openingElement.name) + '>');
          }
        }
        let fragmentOrElement = openingElement.name ? 'Element' : 'Fragment';

        node['opening' + fragmentOrElement] = openingElement;
        node['closing' + fragmentOrElement] = closingElement;
        node.children = children;
        if (this.type === tt.relational && this.value === "<") {
          this.raise(this.start, "Adjacent JSX elements must be wrapped in an enclosing tag");
        }
        return this.finishNode(node, 'JSX' + fragmentOrElement);
      }

      // Parse JSX text

      jsx_parseText(value) {
        let node = this.parseLiteral(value);
        node.type = "JSXText";
        return node;
      }

      // Parses entire JSX element from current position.

      jsx_parseElement() {
        let startPos = this.start, startLoc = this.startLoc;
        this.next();
        return this.jsx_parseElementAt(startPos, startLoc);
      }

      parseExprAtom(refShortHandDefaultPos) {
        if (this.type === tok.jsxText)
          return this.jsx_parseText(this.value);
        else if (this.type === tok.jsxTagStart)
          return this.jsx_parseElement();
        else
          return super.parseExprAtom(refShortHandDefaultPos);
      }

      readToken(code) {
        let context = this.curContext();

        if (context === tc_expr) return this.jsx_readToken();

        if (context === tc_oTag || context === tc_cTag) {
          if (isIdentifierStart(code)) return this.jsx_readWord();

          if (code == 62) {
            ++this.pos;
            return this.finishToken(tok.jsxTagEnd);
          }

          if ((code === 34 || code === 39) && context == tc_oTag)
            return this.jsx_readString(code);
        }

        if (code === 60 && this.exprAllowed && this.input.charCodeAt(this.pos + 1) !== 33) {
          ++this.pos;
          return this.finishToken(tok.jsxTagStart);
        }
        return super.readToken(code)
      }

      updateContext(prevType) {
        if (this.type == tt.braceL) {
          var curContext = this.curContext();
          if (curContext == tc_oTag) this.context.push(tokContexts.b_expr);
          else if (curContext == tc_expr) this.context.push(tokContexts.b_tmpl);
          else super.updateContext(prevType)
          this.exprAllowed = true;
        } else if (this.type === tt.slash && prevType === tok.jsxTagStart) {
          this.context.length -= 2; // do not consider JSX expr -> JSX open tag -> ... anymore
          this.context.push(tc_cTag); // reconsider as closing tag context
          this.exprAllowed = false;
        } else {
          return super.updateContext(prevType);
        }
      }
    };
  }

  },{"./xhtml":3,"acorn":4}],3:[function(require,module,exports){
  module.exports = {
    quot: '\u0022',
    amp: '&',
    apos: '\u0027',
    lt: '<',
    gt: '>',
    nbsp: '\u00A0',
    iexcl: '\u00A1',
    cent: '\u00A2',
    pound: '\u00A3',
    curren: '\u00A4',
    yen: '\u00A5',
    brvbar: '\u00A6',
    sect: '\u00A7',
    uml: '\u00A8',
    copy: '\u00A9',
    ordf: '\u00AA',
    laquo: '\u00AB',
    not: '\u00AC',
    shy: '\u00AD',
    reg: '\u00AE',
    macr: '\u00AF',
    deg: '\u00B0',
    plusmn: '\u00B1',
    sup2: '\u00B2',
    sup3: '\u00B3',
    acute: '\u00B4',
    micro: '\u00B5',
    para: '\u00B6',
    middot: '\u00B7',
    cedil: '\u00B8',
    sup1: '\u00B9',
    ordm: '\u00BA',
    raquo: '\u00BB',
    frac14: '\u00BC',
    frac12: '\u00BD',
    frac34: '\u00BE',
    iquest: '\u00BF',
    Agrave: '\u00C0',
    Aacute: '\u00C1',
    Acirc: '\u00C2',
    Atilde: '\u00C3',
    Auml: '\u00C4',
    Aring: '\u00C5',
    AElig: '\u00C6',
    Ccedil: '\u00C7',
    Egrave: '\u00C8',
    Eacute: '\u00C9',
    Ecirc: '\u00CA',
    Euml: '\u00CB',
    Igrave: '\u00CC',
    Iacute: '\u00CD',
    Icirc: '\u00CE',
    Iuml: '\u00CF',
    ETH: '\u00D0',
    Ntilde: '\u00D1',
    Ograve: '\u00D2',
    Oacute: '\u00D3',
    Ocirc: '\u00D4',
    Otilde: '\u00D5',
    Ouml: '\u00D6',
    times: '\u00D7',
    Oslash: '\u00D8',
    Ugrave: '\u00D9',
    Uacute: '\u00DA',
    Ucirc: '\u00DB',
    Uuml: '\u00DC',
    Yacute: '\u00DD',
    THORN: '\u00DE',
    szlig: '\u00DF',
    agrave: '\u00E0',
    aacute: '\u00E1',
    acirc: '\u00E2',
    atilde: '\u00E3',
    auml: '\u00E4',
    aring: '\u00E5',
    aelig: '\u00E6',
    ccedil: '\u00E7',
    egrave: '\u00E8',
    eacute: '\u00E9',
    ecirc: '\u00EA',
    euml: '\u00EB',
    igrave: '\u00EC',
    iacute: '\u00ED',
    icirc: '\u00EE',
    iuml: '\u00EF',
    eth: '\u00F0',
    ntilde: '\u00F1',
    ograve: '\u00F2',
    oacute: '\u00F3',
    ocirc: '\u00F4',
    otilde: '\u00F5',
    ouml: '\u00F6',
    divide: '\u00F7',
    oslash: '\u00F8',
    ugrave: '\u00F9',
    uacute: '\u00FA',
    ucirc: '\u00FB',
    uuml: '\u00FC',
    yacute: '\u00FD',
    thorn: '\u00FE',
    yuml: '\u00FF',
    OElig: '\u0152',
    oelig: '\u0153',
    Scaron: '\u0160',
    scaron: '\u0161',
    Yuml: '\u0178',
    fnof: '\u0192',
    circ: '\u02C6',
    tilde: '\u02DC',
    Alpha: '\u0391',
    Beta: '\u0392',
    Gamma: '\u0393',
    Delta: '\u0394',
    Epsilon: '\u0395',
    Zeta: '\u0396',
    Eta: '\u0397',
    Theta: '\u0398',
    Iota: '\u0399',
    Kappa: '\u039A',
    Lambda: '\u039B',
    Mu: '\u039C',
    Nu: '\u039D',
    Xi: '\u039E',
    Omicron: '\u039F',
    Pi: '\u03A0',
    Rho: '\u03A1',
    Sigma: '\u03A3',
    Tau: '\u03A4',
    Upsilon: '\u03A5',
    Phi: '\u03A6',
    Chi: '\u03A7',
    Psi: '\u03A8',
    Omega: '\u03A9',
    alpha: '\u03B1',
    beta: '\u03B2',
    gamma: '\u03B3',
    delta: '\u03B4',
    epsilon: '\u03B5',
    zeta: '\u03B6',
    eta: '\u03B7',
    theta: '\u03B8',
    iota: '\u03B9',
    kappa: '\u03BA',
    lambda: '\u03BB',
    mu: '\u03BC',
    nu: '\u03BD',
    xi: '\u03BE',
    omicron: '\u03BF',
    pi: '\u03C0',
    rho: '\u03C1',
    sigmaf: '\u03C2',
    sigma: '\u03C3',
    tau: '\u03C4',
    upsilon: '\u03C5',
    phi: '\u03C6',
    chi: '\u03C7',
    psi: '\u03C8',
    omega: '\u03C9',
    thetasym: '\u03D1',
    upsih: '\u03D2',
    piv: '\u03D6',
    ensp: '\u2002',
    emsp: '\u2003',
    thinsp: '\u2009',
    zwnj: '\u200C',
    zwj: '\u200D',
    lrm: '\u200E',
    rlm: '\u200F',
    ndash: '\u2013',
    mdash: '\u2014',
    lsquo: '\u2018',
    rsquo: '\u2019',
    sbquo: '\u201A',
    ldquo: '\u201C',
    rdquo: '\u201D',
    bdquo: '\u201E',
    dagger: '\u2020',
    Dagger: '\u2021',
    bull: '\u2022',
    hellip: '\u2026',
    permil: '\u2030',
    prime: '\u2032',
    Prime: '\u2033',
    lsaquo: '\u2039',
    rsaquo: '\u203A',
    oline: '\u203E',
    frasl: '\u2044',
    euro: '\u20AC',
    image: '\u2111',
    weierp: '\u2118',
    real: '\u211C',
    trade: '\u2122',
    alefsym: '\u2135',
    larr: '\u2190',
    uarr: '\u2191',
    rarr: '\u2192',
    darr: '\u2193',
    harr: '\u2194',
    crarr: '\u21B5',
    lArr: '\u21D0',
    uArr: '\u21D1',
    rArr: '\u21D2',
    dArr: '\u21D3',
    hArr: '\u21D4',
    forall: '\u2200',
    part: '\u2202',
    exist: '\u2203',
    empty: '\u2205',
    nabla: '\u2207',
    isin: '\u2208',
    notin: '\u2209',
    ni: '\u220B',
    prod: '\u220F',
    sum: '\u2211',
    minus: '\u2212',
    lowast: '\u2217',
    radic: '\u221A',
    prop: '\u221D',
    infin: '\u221E',
    ang: '\u2220',
    and: '\u2227',
    or: '\u2228',
    cap: '\u2229',
    cup: '\u222A',
    'int': '\u222B',
    there4: '\u2234',
    sim: '\u223C',
    cong: '\u2245',
    asymp: '\u2248',
    ne: '\u2260',
    equiv: '\u2261',
    le: '\u2264',
    ge: '\u2265',
    sub: '\u2282',
    sup: '\u2283',
    nsub: '\u2284',
    sube: '\u2286',
    supe: '\u2287',
    oplus: '\u2295',
    otimes: '\u2297',
    perp: '\u22A5',
    sdot: '\u22C5',
    lceil: '\u2308',
    rceil: '\u2309',
    lfloor: '\u230A',
    rfloor: '\u230B',
    lang: '\u2329',
    rang: '\u232A',
    loz: '\u25CA',
    spades: '\u2660',
    clubs: '\u2663',
    hearts: '\u2665',
    diams: '\u2666'
  };

  },{}],4:[function(require,module,exports){
  (function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
    typeof define === 'function' && define.amd ? define(['exports'], factory) :
    (global = global || self, factory(global.acorn = {}));
  }(this, (function (exports) { 'use strict';

    // Reserved word lists for various dialects of the language

    var reservedWords = {
      3: "abstract boolean byte char class double enum export extends final float goto implements import int interface long native package private protected public short static super synchronized throws transient volatile",
      5: "class enum extends super const export import",
      6: "enum",
      strict: "implements interface let package private protected public static yield",
      strictBind: "eval arguments"
    };

    // And the keywords

    var ecma5AndLessKeywords = "break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this";

    var keywords = {
      5: ecma5AndLessKeywords,
      "5module": ecma5AndLessKeywords + " export import",
      6: ecma5AndLessKeywords + " const class extends export import super"
    };

    var keywordRelationalOperator = /^in(stanceof)?$/;

    // ## Character categories

    // Big ugly regular expressions that match characters in the
    // whitespace, identifier, and identifier-start categories. These
    // are only applied when a character is found to actually have a
    // code point above 128.
    // Generated by `bin/generate-identifier-regex.js`.
    var nonASCIIidentifierStartChars = "\xaa\xb5\xba\xc0-\xd6\xd8-\xf6\xf8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376\u0377\u037a-\u037d\u037f\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u052f\u0531-\u0556\u0559\u0560-\u0588\u05d0-\u05ea\u05ef-\u05f2\u0620-\u064a\u066e\u066f\u0671-\u06d3\u06d5\u06e5\u06e6\u06ee\u06ef\u06fa-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07ca-\u07ea\u07f4\u07f5\u07fa\u0800-\u0815\u081a\u0824\u0828\u0840-\u0858\u0860-\u086a\u08a0-\u08b4\u08b6-\u08bd\u0904-\u0939\u093d\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc\u09dd\u09df-\u09e1\u09f0\u09f1\u09fc\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a59-\u0a5c\u0a5e\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0\u0ae1\u0af9\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3d\u0b5c\u0b5d\u0b5f-\u0b61\u0b71\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c39\u0c3d\u0c58-\u0c5a\u0c60\u0c61\u0c80\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cde\u0ce0\u0ce1\u0cf1\u0cf2\u0d05-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d\u0d4e\u0d54-\u0d56\u0d5f-\u0d61\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0e01-\u0e30\u0e32\u0e33\u0e40-\u0e46\u0e81\u0e82\u0e84\u0e86-\u0e8a\u0e8c-\u0ea3\u0ea5\u0ea7-\u0eb0\u0eb2\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0edc-\u0edf\u0f00\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u1000-\u102a\u103f\u1050-\u1055\u105a-\u105d\u1061\u1065\u1066\u106e-\u1070\u1075-\u1081\u108e\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1380-\u138f\u13a0-\u13f5\u13f8-\u13fd\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f8\u1700-\u170c\u170e-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u1820-\u1878\u1880-\u18a8\u18aa\u18b0-\u18f5\u1900-\u191e\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19b0-\u19c9\u1a00-\u1a16\u1a20-\u1a54\u1aa7\u1b05-\u1b33\u1b45-\u1b4b\u1b83-\u1ba0\u1bae\u1baf\u1bba-\u1be5\u1c00-\u1c23\u1c4d-\u1c4f\u1c5a-\u1c7d\u1c80-\u1c88\u1c90-\u1cba\u1cbd-\u1cbf\u1ce9-\u1cec\u1cee-\u1cf3\u1cf5\u1cf6\u1cfa\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2071\u207f\u2090-\u209c\u2102\u2107\u210a-\u2113\u2115\u2118-\u211d\u2124\u2126\u2128\u212a-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2160-\u2188\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2ce4\u2ceb-\u2cee\u2cf2\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303c\u3041-\u3096\u309b-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312f\u3131-\u318e\u31a0-\u31ba\u31f0-\u31ff\u3400-\u4db5\u4e00-\u9fef\ua000-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a\ua62b\ua640-\ua66e\ua67f-\ua69d\ua6a0-\ua6ef\ua717-\ua71f\ua722-\ua788\ua78b-\ua7bf\ua7c2-\ua7c6\ua7f7-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua840-\ua873\ua882-\ua8b3\ua8f2-\ua8f7\ua8fb\ua8fd\ua8fe\ua90a-\ua925\ua930-\ua946\ua960-\ua97c\ua984-\ua9b2\ua9cf\ua9e0-\ua9e4\ua9e6-\ua9ef\ua9fa-\ua9fe\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa60-\uaa76\uaa7a\uaa7e-\uaaaf\uaab1\uaab5\uaab6\uaab9-\uaabd\uaac0\uaac2\uaadb-\uaadd\uaae0-\uaaea\uaaf2-\uaaf4\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uab30-\uab5a\uab5c-\uab67\uab70-\uabe2\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc";
    var nonASCIIidentifierChars = "\u200c\u200d\xb7\u0300-\u036f\u0387\u0483-\u0487\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u0669\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed\u06f0-\u06f9\u0711\u0730-\u074a\u07a6-\u07b0\u07c0-\u07c9\u07eb-\u07f3\u07fd\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0859-\u085b\u08d3-\u08e1\u08e3-\u0903\u093a-\u093c\u093e-\u094f\u0951-\u0957\u0962\u0963\u0966-\u096f\u0981-\u0983\u09bc\u09be-\u09c4\u09c7\u09c8\u09cb-\u09cd\u09d7\u09e2\u09e3\u09e6-\u09ef\u09fe\u0a01-\u0a03\u0a3c\u0a3e-\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a66-\u0a71\u0a75\u0a81-\u0a83\u0abc\u0abe-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ae2\u0ae3\u0ae6-\u0aef\u0afa-\u0aff\u0b01-\u0b03\u0b3c\u0b3e-\u0b44\u0b47\u0b48\u0b4b-\u0b4d\u0b56\u0b57\u0b62\u0b63\u0b66-\u0b6f\u0b82\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd7\u0be6-\u0bef\u0c00-\u0c04\u0c3e-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62\u0c63\u0c66-\u0c6f\u0c81-\u0c83\u0cbc\u0cbe-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5\u0cd6\u0ce2\u0ce3\u0ce6-\u0cef\u0d00-\u0d03\u0d3b\u0d3c\u0d3e-\u0d44\u0d46-\u0d48\u0d4a-\u0d4d\u0d57\u0d62\u0d63\u0d66-\u0d6f\u0d82\u0d83\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0de6-\u0def\u0df2\u0df3\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0e50-\u0e59\u0eb1\u0eb4-\u0ebc\u0ec8-\u0ecd\u0ed0-\u0ed9\u0f18\u0f19\u0f20-\u0f29\u0f35\u0f37\u0f39\u0f3e\u0f3f\u0f71-\u0f84\u0f86\u0f87\u0f8d-\u0f97\u0f99-\u0fbc\u0fc6\u102b-\u103e\u1040-\u1049\u1056-\u1059\u105e-\u1060\u1062-\u1064\u1067-\u106d\u1071-\u1074\u1082-\u108d\u108f-\u109d\u135d-\u135f\u1369-\u1371\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17b4-\u17d3\u17dd\u17e0-\u17e9\u180b-\u180d\u1810-\u1819\u18a9\u1920-\u192b\u1930-\u193b\u1946-\u194f\u19d0-\u19da\u1a17-\u1a1b\u1a55-\u1a5e\u1a60-\u1a7c\u1a7f-\u1a89\u1a90-\u1a99\u1ab0-\u1abd\u1b00-\u1b04\u1b34-\u1b44\u1b50-\u1b59\u1b6b-\u1b73\u1b80-\u1b82\u1ba1-\u1bad\u1bb0-\u1bb9\u1be6-\u1bf3\u1c24-\u1c37\u1c40-\u1c49\u1c50-\u1c59\u1cd0-\u1cd2\u1cd4-\u1ce8\u1ced\u1cf4\u1cf7-\u1cf9\u1dc0-\u1df9\u1dfb-\u1dff\u203f\u2040\u2054\u20d0-\u20dc\u20e1\u20e5-\u20f0\u2cef-\u2cf1\u2d7f\u2de0-\u2dff\u302a-\u302f\u3099\u309a\ua620-\ua629\ua66f\ua674-\ua67d\ua69e\ua69f\ua6f0\ua6f1\ua802\ua806\ua80b\ua823-\ua827\ua880\ua881\ua8b4-\ua8c5\ua8d0-\ua8d9\ua8e0-\ua8f1\ua8ff-\ua909\ua926-\ua92d\ua947-\ua953\ua980-\ua983\ua9b3-\ua9c0\ua9d0-\ua9d9\ua9e5\ua9f0-\ua9f9\uaa29-\uaa36\uaa43\uaa4c\uaa4d\uaa50-\uaa59\uaa7b-\uaa7d\uaab0\uaab2-\uaab4\uaab7\uaab8\uaabe\uaabf\uaac1\uaaeb-\uaaef\uaaf5\uaaf6\uabe3-\uabea\uabec\uabed\uabf0-\uabf9\ufb1e\ufe00-\ufe0f\ufe20-\ufe2f\ufe33\ufe34\ufe4d-\ufe4f\uff10-\uff19\uff3f";

    var nonASCIIidentifierStart = new RegExp("[" + nonASCIIidentifierStartChars + "]");
    var nonASCIIidentifier = new RegExp("[" + nonASCIIidentifierStartChars + nonASCIIidentifierChars + "]");

    nonASCIIidentifierStartChars = nonASCIIidentifierChars = null;

    // These are a run-length and offset encoded representation of the
    // >0xffff code points that are a valid part of identifiers. The
    // offset starts at 0x10000, and each pair of numbers represents an
    // offset to the next range, and then a size of the range. They were
    // generated by bin/generate-identifier-regex.js

    // eslint-disable-next-line comma-spacing
    var astralIdentifierStartCodes = [0,11,2,25,2,18,2,1,2,14,3,13,35,122,70,52,268,28,4,48,48,31,14,29,6,37,11,29,3,35,5,7,2,4,43,157,19,35,5,35,5,39,9,51,157,310,10,21,11,7,153,5,3,0,2,43,2,1,4,0,3,22,11,22,10,30,66,18,2,1,11,21,11,25,71,55,7,1,65,0,16,3,2,2,2,28,43,28,4,28,36,7,2,27,28,53,11,21,11,18,14,17,111,72,56,50,14,50,14,35,477,28,11,0,9,21,155,22,13,52,76,44,33,24,27,35,30,0,12,34,4,0,13,47,15,3,22,0,2,0,36,17,2,24,85,6,2,0,2,3,2,14,2,9,8,46,39,7,3,1,3,21,2,6,2,1,2,4,4,0,19,0,13,4,159,52,19,3,21,0,33,47,21,1,2,0,185,46,42,3,37,47,21,0,60,42,14,0,72,26,230,43,117,63,32,0,161,7,3,38,17,0,2,0,29,0,11,39,8,0,22,0,12,45,20,0,35,56,264,8,2,36,18,0,50,29,113,6,2,1,2,37,22,0,26,5,2,1,2,31,15,0,328,18,270,921,103,110,18,195,2749,1070,4050,582,8634,568,8,30,114,29,19,47,17,3,32,20,6,18,689,63,129,74,6,0,67,12,65,1,2,0,29,6135,9,754,9486,286,50,2,18,3,9,395,2309,106,6,12,4,8,8,9,5991,84,2,70,2,1,3,0,3,1,3,3,2,11,2,0,2,6,2,64,2,3,3,7,2,6,2,27,2,3,2,4,2,0,4,6,2,339,3,24,2,24,2,30,2,24,2,30,2,24,2,30,2,24,2,30,2,24,2,7,2357,44,11,6,17,0,370,43,1301,196,60,67,8,0,1205,3,2,26,2,1,2,0,3,0,2,9,2,3,2,0,2,0,7,0,5,0,2,0,2,0,2,2,2,1,2,0,3,0,2,0,2,0,2,0,2,0,2,1,2,0,3,3,2,6,2,3,2,3,2,0,2,9,2,16,6,2,2,4,2,16,4421,42710,42,4148,12,221,3,5761,15,7472,3104,541];

    // eslint-disable-next-line comma-spacing
    var astralIdentifierCodes = [509,0,227,0,150,4,294,9,1368,2,2,1,6,3,41,2,5,0,166,1,574,3,9,9,525,10,176,2,54,14,32,9,16,3,46,10,54,9,7,2,37,13,2,9,6,1,45,0,13,2,49,13,9,3,4,9,83,11,7,0,161,11,6,9,7,3,56,1,2,6,3,1,3,2,10,0,11,1,3,6,4,4,193,17,10,9,5,0,82,19,13,9,214,6,3,8,28,1,83,16,16,9,82,12,9,9,84,14,5,9,243,14,166,9,232,6,3,6,4,0,29,9,41,6,2,3,9,0,10,10,47,15,406,7,2,7,17,9,57,21,2,13,123,5,4,0,2,1,2,6,2,0,9,9,49,4,2,1,2,4,9,9,330,3,19306,9,135,4,60,6,26,9,1014,0,2,54,8,3,19723,1,5319,4,4,5,9,7,3,6,31,3,149,2,1418,49,513,54,5,49,9,0,15,0,23,4,2,14,1361,6,2,16,3,6,2,1,2,4,262,6,10,9,419,13,1495,6,110,6,6,9,792487,239];

    // This has a complexity linear to the value of the code. The
    // assumption is that looking up astral identifier characters is
    // rare.
    function isInAstralSet(code, set) {
      var pos = 0x10000;
      for (var i = 0; i < set.length; i += 2) {
        pos += set[i];
        if (pos > code) { return false }
        pos += set[i + 1];
        if (pos >= code) { return true }
      }
    }

    // Test whether a given character code starts an identifier.

    function isIdentifierStart(code, astral) {
      if (code < 65) { return code === 36 }
      if (code < 91) { return true }
      if (code < 97) { return code === 95 }
      if (code < 123) { return true }
      if (code <= 0xffff) { return code >= 0xaa && nonASCIIidentifierStart.test(String.fromCharCode(code)) }
      if (astral === false) { return false }
      return isInAstralSet(code, astralIdentifierStartCodes)
    }

    // Test whether a given character is part of an identifier.

    function isIdentifierChar(code, astral) {
      if (code < 48) { return code === 36 }
      if (code < 58) { return true }
      if (code < 65) { return false }
      if (code < 91) { return true }
      if (code < 97) { return code === 95 }
      if (code < 123) { return true }
      if (code <= 0xffff) { return code >= 0xaa && nonASCIIidentifier.test(String.fromCharCode(code)) }
      if (astral === false) { return false }
      return isInAstralSet(code, astralIdentifierStartCodes) || isInAstralSet(code, astralIdentifierCodes)
    }

    // ## Token types

    // The assignment of fine-grained, information-carrying type objects
    // allows the tokenizer to store the information it has about a
    // token in a way that is very cheap for the parser to look up.

    // All token type variables start with an underscore, to make them
    // easy to recognize.

    // The `beforeExpr` property is used to disambiguate between regular
    // expressions and divisions. It is set on all token types that can
    // be followed by an expression (thus, a slash after them would be a
    // regular expression).
    //
    // The `startsExpr` property is used to check if the token ends a
    // `yield` expression. It is set on all token types that either can
    // directly start an expression (like a quotation mark) or can
    // continue an expression (like the body of a string).
    //
    // `isLoop` marks a keyword as starting a loop, which is important
    // to know when parsing a label, in order to allow or disallow
    // continue jumps to that label.

    var TokenType = function TokenType(label, conf) {
      if ( conf === void 0 ) conf = {};

      this.label = label;
      this.keyword = conf.keyword;
      this.beforeExpr = !!conf.beforeExpr;
      this.startsExpr = !!conf.startsExpr;
      this.isLoop = !!conf.isLoop;
      this.isAssign = !!conf.isAssign;
      this.prefix = !!conf.prefix;
      this.postfix = !!conf.postfix;
      this.binop = conf.binop || null;
      this.updateContext = null;
    };

    function binop(name, prec) {
      return new TokenType(name, {beforeExpr: true, binop: prec})
    }
    var beforeExpr = {beforeExpr: true}, startsExpr = {startsExpr: true};

    // Map keyword names to token types.

    var keywords$1 = {};

    // Succinct definitions of keyword token types
    function kw(name, options) {
      if ( options === void 0 ) options = {};

      options.keyword = name;
      return keywords$1[name] = new TokenType(name, options)
    }

    var types = {
      num: new TokenType("num", startsExpr),
      regexp: new TokenType("regexp", startsExpr),
      string: new TokenType("string", startsExpr),
      name: new TokenType("name", startsExpr),
      eof: new TokenType("eof"),

      // Punctuation token types.
      bracketL: new TokenType("[", {beforeExpr: true, startsExpr: true}),
      bracketR: new TokenType("]"),
      braceL: new TokenType("{", {beforeExpr: true, startsExpr: true}),
      braceR: new TokenType("}"),
      parenL: new TokenType("(", {beforeExpr: true, startsExpr: true}),
      parenR: new TokenType(")"),
      comma: new TokenType(",", beforeExpr),
      semi: new TokenType(";", beforeExpr),
      colon: new TokenType(":", beforeExpr),
      dot: new TokenType("."),
      question: new TokenType("?", beforeExpr),
      arrow: new TokenType("=>", beforeExpr),
      template: new TokenType("template"),
      invalidTemplate: new TokenType("invalidTemplate"),
      ellipsis: new TokenType("...", beforeExpr),
      backQuote: new TokenType("`", startsExpr),
      dollarBraceL: new TokenType("${", {beforeExpr: true, startsExpr: true}),

      // Operators. These carry several kinds of properties to help the
      // parser use them properly (the presence of these properties is
      // what categorizes them as operators).
      //
      // `binop`, when present, specifies that this operator is a binary
      // operator, and will refer to its precedence.
      //
      // `prefix` and `postfix` mark the operator as a prefix or postfix
      // unary operator.
      //
      // `isAssign` marks all of `=`, `+=`, `-=` etcetera, which act as
      // binary operators with a very low precedence, that should result
      // in AssignmentExpression nodes.

      eq: new TokenType("=", {beforeExpr: true, isAssign: true}),
      assign: new TokenType("_=", {beforeExpr: true, isAssign: true}),
      incDec: new TokenType("++/--", {prefix: true, postfix: true, startsExpr: true}),
      prefix: new TokenType("!/~", {beforeExpr: true, prefix: true, startsExpr: true}),
      logicalOR: binop("||", 1),
      logicalAND: binop("&&", 2),
      bitwiseOR: binop("|", 3),
      bitwiseXOR: binop("^", 4),
      bitwiseAND: binop("&", 5),
      equality: binop("==/!=/===/!==", 6),
      relational: binop("</>/<=/>=", 7),
      bitShift: binop("<</>>/>>>", 8),
      plusMin: new TokenType("+/-", {beforeExpr: true, binop: 9, prefix: true, startsExpr: true}),
      modulo: binop("%", 10),
      star: binop("*", 10),
      slash: binop("/", 10),
      starstar: new TokenType("**", {beforeExpr: true}),

      // Keyword token types.
      _break: kw("break"),
      _case: kw("case", beforeExpr),
      _catch: kw("catch"),
      _continue: kw("continue"),
      _debugger: kw("debugger"),
      _default: kw("default", beforeExpr),
      _do: kw("do", {isLoop: true, beforeExpr: true}),
      _else: kw("else", beforeExpr),
      _finally: kw("finally"),
      _for: kw("for", {isLoop: true}),
      _function: kw("function", startsExpr),
      _if: kw("if"),
      _return: kw("return", beforeExpr),
      _switch: kw("switch"),
      _throw: kw("throw", beforeExpr),
      _try: kw("try"),
      _var: kw("var"),
      _const: kw("const"),
      _while: kw("while", {isLoop: true}),
      _with: kw("with"),
      _new: kw("new", {beforeExpr: true, startsExpr: true}),
      _this: kw("this", startsExpr),
      _super: kw("super", startsExpr),
      _class: kw("class", startsExpr),
      _extends: kw("extends", beforeExpr),
      _export: kw("export"),
      _import: kw("import", startsExpr),
      _null: kw("null", startsExpr),
      _true: kw("true", startsExpr),
      _false: kw("false", startsExpr),
      _in: kw("in", {beforeExpr: true, binop: 7}),
      _instanceof: kw("instanceof", {beforeExpr: true, binop: 7}),
      _typeof: kw("typeof", {beforeExpr: true, prefix: true, startsExpr: true}),
      _void: kw("void", {beforeExpr: true, prefix: true, startsExpr: true}),
      _delete: kw("delete", {beforeExpr: true, prefix: true, startsExpr: true})
    };

    // Matches a whole line break (where CRLF is considered a single
    // line break). Used to count lines.

    var lineBreak = /\r\n?|\n|\u2028|\u2029/;
    var lineBreakG = new RegExp(lineBreak.source, "g");

    function isNewLine(code, ecma2019String) {
      return code === 10 || code === 13 || (!ecma2019String && (code === 0x2028 || code === 0x2029))
    }

    var nonASCIIwhitespace = /[\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]/;

    var skipWhiteSpace = /(?:\s|\/\/.*|\/\*[^]*?\*\/)*/g;

    var ref = Object.prototype;
    var hasOwnProperty = ref.hasOwnProperty;
    var toString = ref.toString;

    // Checks if an object has a property.

    function has(obj, propName) {
      return hasOwnProperty.call(obj, propName)
    }

    var isArray = Array.isArray || (function (obj) { return (
      toString.call(obj) === "[object Array]"
    ); });

    function wordsRegexp(words) {
      return new RegExp("^(?:" + words.replace(/ /g, "|") + ")$")
    }

    // These are used when `options.locations` is on, for the
    // `startLoc` and `endLoc` properties.

    var Position = function Position(line, col) {
      this.line = line;
      this.column = col;
    };

    Position.prototype.offset = function offset (n) {
      return new Position(this.line, this.column + n)
    };

    var SourceLocation = function SourceLocation(p, start, end) {
      this.start = start;
      this.end = end;
      if (p.sourceFile !== null) { this.source = p.sourceFile; }
    };

    // The `getLineInfo` function is mostly useful when the
    // `locations` option is off (for performance reasons) and you
    // want to find the line/column position for a given character
    // offset. `input` should be the code string that the offset refers
    // into.

    function getLineInfo(input, offset) {
      for (var line = 1, cur = 0;;) {
        lineBreakG.lastIndex = cur;
        var match = lineBreakG.exec(input);
        if (match && match.index < offset) {
          ++line;
          cur = match.index + match[0].length;
        } else {
          return new Position(line, offset - cur)
        }
      }
    }

    // A second optional argument can be given to further configure
    // the parser process. These options are recognized:

    var defaultOptions = {
      // `ecmaVersion` indicates the ECMAScript version to parse. Must be
      // either 3, 5, 6 (2015), 7 (2016), 8 (2017), 9 (2018), or 10
      // (2019). This influences support for strict mode, the set of
      // reserved words, and support for new syntax features. The default
      // is 9.
      ecmaVersion: 9,
      // `sourceType` indicates the mode the code should be parsed in.
      // Can be either `"script"` or `"module"`. This influences global
      // strict mode and parsing of `import` and `export` declarations.
      sourceType: "script",
      // `onInsertedSemicolon` can be a callback that will be called
      // when a semicolon is automatically inserted. It will be passed
      // the position of the comma as an offset, and if `locations` is
      // enabled, it is given the location as a `{line, column}` object
      // as second argument.
      onInsertedSemicolon: null,
      // `onTrailingComma` is similar to `onInsertedSemicolon`, but for
      // trailing commas.
      onTrailingComma: null,
      // By default, reserved words are only enforced if ecmaVersion >= 5.
      // Set `allowReserved` to a boolean value to explicitly turn this on
      // an off. When this option has the value "never", reserved words
      // and keywords can also not be used as property names.
      allowReserved: null,
      // When enabled, a return at the top level is not considered an
      // error.
      allowReturnOutsideFunction: false,
      // When enabled, import/export statements are not constrained to
      // appearing at the top of the program.
      allowImportExportEverywhere: false,
      // When enabled, await identifiers are allowed to appear at the top-level scope,
      // but they are still not allowed in non-async functions.
      allowAwaitOutsideFunction: false,
      // When enabled, hashbang directive in the beginning of file
      // is allowed and treated as a line comment.
      allowHashBang: false,
      // When `locations` is on, `loc` properties holding objects with
      // `start` and `end` properties in `{line, column}` form (with
      // line being 1-based and column 0-based) will be attached to the
      // nodes.
      locations: false,
      // A function can be passed as `onToken` option, which will
      // cause Acorn to call that function with object in the same
      // format as tokens returned from `tokenizer().getToken()`. Note
      // that you are not allowed to call the parser from the
      // callback—that will corrupt its internal state.
      onToken: null,
      // A function can be passed as `onComment` option, which will
      // cause Acorn to call that function with `(block, text, start,
      // end)` parameters whenever a comment is skipped. `block` is a
      // boolean indicating whether this is a block (`/* */`) comment,
      // `text` is the content of the comment, and `start` and `end` are
      // character offsets that denote the start and end of the comment.
      // When the `locations` option is on, two more parameters are
      // passed, the full `{line, column}` locations of the start and
      // end of the comments. Note that you are not allowed to call the
      // parser from the callback—that will corrupt its internal state.
      onComment: null,
      // Nodes have their start and end characters offsets recorded in
      // `start` and `end` properties (directly on the node, rather than
      // the `loc` object, which holds line/column data. To also add a
      // [semi-standardized][range] `range` property holding a `[start,
      // end]` array with the same numbers, set the `ranges` option to
      // `true`.
      //
      // [range]: https://bugzilla.mozilla.org/show_bug.cgi?id=745678
      ranges: false,
      // It is possible to parse multiple files into a single AST by
      // passing the tree produced by parsing the first file as
      // `program` option in subsequent parses. This will add the
      // toplevel forms of the parsed file to the `Program` (top) node
      // of an existing parse tree.
      program: null,
      // When `locations` is on, you can pass this to record the source
      // file in every node's `loc` object.
      sourceFile: null,
      // This value, if given, is stored in every node, whether
      // `locations` is on or off.
      directSourceFile: null,
      // When enabled, parenthesized expressions are represented by
      // (non-standard) ParenthesizedExpression nodes
      preserveParens: false
    };

    // Interpret and default an options object

    function getOptions(opts) {
      var options = {};

      for (var opt in defaultOptions)
        { options[opt] = opts && has(opts, opt) ? opts[opt] : defaultOptions[opt]; }

      if (options.ecmaVersion >= 2015)
        { options.ecmaVersion -= 2009; }

      if (options.allowReserved == null)
        { options.allowReserved = options.ecmaVersion < 5; }

      if (isArray(options.onToken)) {
        var tokens = options.onToken;
        options.onToken = function (token) { return tokens.push(token); };
      }
      if (isArray(options.onComment))
        { options.onComment = pushComment(options, options.onComment); }

      return options
    }

    function pushComment(options, array) {
      return function(block, text, start, end, startLoc, endLoc) {
        var comment = {
          type: block ? "Block" : "Line",
          value: text,
          start: start,
          end: end
        };
        if (options.locations)
          { comment.loc = new SourceLocation(this, startLoc, endLoc); }
        if (options.ranges)
          { comment.range = [start, end]; }
        array.push(comment);
      }
    }

    // Each scope gets a bitset that may contain these flags
    var
        SCOPE_TOP = 1,
        SCOPE_FUNCTION = 2,
        SCOPE_VAR = SCOPE_TOP | SCOPE_FUNCTION,
        SCOPE_ASYNC = 4,
        SCOPE_GENERATOR = 8,
        SCOPE_ARROW = 16,
        SCOPE_SIMPLE_CATCH = 32,
        SCOPE_SUPER = 64,
        SCOPE_DIRECT_SUPER = 128;

    function functionFlags(async, generator) {
      return SCOPE_FUNCTION | (async ? SCOPE_ASYNC : 0) | (generator ? SCOPE_GENERATOR : 0)
    }

    // Used in checkLVal and declareName to determine the type of a binding
    var
        BIND_NONE = 0, // Not a binding
        BIND_VAR = 1, // Var-style binding
        BIND_LEXICAL = 2, // Let- or const-style binding
        BIND_FUNCTION = 3, // Function declaration
        BIND_SIMPLE_CATCH = 4, // Simple (identifier pattern) catch binding
        BIND_OUTSIDE = 5; // Special case for function names as bound inside the function

    var Parser = function Parser(options, input, startPos) {
      this.options = options = getOptions(options);
      this.sourceFile = options.sourceFile;
      this.keywords = wordsRegexp(keywords[options.ecmaVersion >= 6 ? 6 : options.sourceType === "module" ? "5module" : 5]);
      var reserved = "";
      if (options.allowReserved !== true) {
        for (var v = options.ecmaVersion;; v--)
          { if (reserved = reservedWords[v]) { break } }
        if (options.sourceType === "module") { reserved += " await"; }
      }
      this.reservedWords = wordsRegexp(reserved);
      var reservedStrict = (reserved ? reserved + " " : "") + reservedWords.strict;
      this.reservedWordsStrict = wordsRegexp(reservedStrict);
      this.reservedWordsStrictBind = wordsRegexp(reservedStrict + " " + reservedWords.strictBind);
      this.input = String(input);

      // Used to signal to callers of `readWord1` whether the word
      // contained any escape sequences. This is needed because words with
      // escape sequences must not be interpreted as keywords.
      this.containsEsc = false;

      // Set up token state

      // The current position of the tokenizer in the input.
      if (startPos) {
        this.pos = startPos;
        this.lineStart = this.input.lastIndexOf("\n", startPos - 1) + 1;
        this.curLine = this.input.slice(0, this.lineStart).split(lineBreak).length;
      } else {
        this.pos = this.lineStart = 0;
        this.curLine = 1;
      }

      // Properties of the current token:
      // Its type
      this.type = types.eof;
      // For tokens that include more information than their type, the value
      this.value = null;
      // Its start and end offset
      this.start = this.end = this.pos;
      // And, if locations are used, the {line, column} object
      // corresponding to those offsets
      this.startLoc = this.endLoc = this.curPosition();

      // Position information for the previous token
      this.lastTokEndLoc = this.lastTokStartLoc = null;
      this.lastTokStart = this.lastTokEnd = this.pos;

      // The context stack is used to superficially track syntactic
      // context to predict whether a regular expression is allowed in a
      // given position.
      this.context = this.initialContext();
      this.exprAllowed = true;

      // Figure out if it's a module code.
      this.inModule = options.sourceType === "module";
      this.strict = this.inModule || this.strictDirective(this.pos);

      // Used to signify the start of a potential arrow function
      this.potentialArrowAt = -1;

      // Positions to delayed-check that yield/await does not exist in default parameters.
      this.yieldPos = this.awaitPos = this.awaitIdentPos = 0;
      // Labels in scope.
      this.labels = [];
      // Thus-far undefined exports.
      this.undefinedExports = {};

      // If enabled, skip leading hashbang line.
      if (this.pos === 0 && options.allowHashBang && this.input.slice(0, 2) === "#!")
        { this.skipLineComment(2); }

      // Scope tracking for duplicate variable names (see scope.js)
      this.scopeStack = [];
      this.enterScope(SCOPE_TOP);

      // For RegExp validation
      this.regexpState = null;
    };

    var prototypeAccessors = { inFunction: { configurable: true },inGenerator: { configurable: true },inAsync: { configurable: true },allowSuper: { configurable: true },allowDirectSuper: { configurable: true },treatFunctionsAsVar: { configurable: true } };

    Parser.prototype.parse = function parse () {
      var node = this.options.program || this.startNode();
      this.nextToken();
      return this.parseTopLevel(node)
    };

    prototypeAccessors.inFunction.get = function () { return (this.currentVarScope().flags & SCOPE_FUNCTION) > 0 };
    prototypeAccessors.inGenerator.get = function () { return (this.currentVarScope().flags & SCOPE_GENERATOR) > 0 };
    prototypeAccessors.inAsync.get = function () { return (this.currentVarScope().flags & SCOPE_ASYNC) > 0 };
    prototypeAccessors.allowSuper.get = function () { return (this.currentThisScope().flags & SCOPE_SUPER) > 0 };
    prototypeAccessors.allowDirectSuper.get = function () { return (this.currentThisScope().flags & SCOPE_DIRECT_SUPER) > 0 };
    prototypeAccessors.treatFunctionsAsVar.get = function () { return this.treatFunctionsAsVarInScope(this.currentScope()) };

    // Switch to a getter for 7.0.0.
    Parser.prototype.inNonArrowFunction = function inNonArrowFunction () { return (this.currentThisScope().flags & SCOPE_FUNCTION) > 0 };

    Parser.extend = function extend () {
        var plugins = [], len = arguments.length;
        while ( len-- ) plugins[ len ] = arguments[ len ];

      var cls = this;
      for (var i = 0; i < plugins.length; i++) { cls = plugins[i](cls); }
      return cls
    };

    Parser.parse = function parse (input, options) {
      return new this(options, input).parse()
    };

    Parser.parseExpressionAt = function parseExpressionAt (input, pos, options) {
      var parser = new this(options, input, pos);
      parser.nextToken();
      return parser.parseExpression()
    };

    Parser.tokenizer = function tokenizer (input, options) {
      return new this(options, input)
    };

    Object.defineProperties( Parser.prototype, prototypeAccessors );

    var pp = Parser.prototype;

    // ## Parser utilities

    var literal = /^(?:'((?:\\.|[^'\\])*?)'|"((?:\\.|[^"\\])*?)")/;
    pp.strictDirective = function(start) {
      for (;;) {
        // Try to find string literal.
        skipWhiteSpace.lastIndex = start;
        start += skipWhiteSpace.exec(this.input)[0].length;
        var match = literal.exec(this.input.slice(start));
        if (!match) { return false }
        if ((match[1] || match[2]) === "use strict") { return true }
        start += match[0].length;

        // Skip semicolon, if any.
        skipWhiteSpace.lastIndex = start;
        start += skipWhiteSpace.exec(this.input)[0].length;
        if (this.input[start] === ";")
          { start++; }
      }
    };

    // Predicate that tests whether the next token is of the given
    // type, and if yes, consumes it as a side effect.

    pp.eat = function(type) {
      if (this.type === type) {
        this.next();
        return true
      } else {
        return false
      }
    };

    // Tests whether parsed token is a contextual keyword.

    pp.isContextual = function(name) {
      return this.type === types.name && this.value === name && !this.containsEsc
    };

    // Consumes contextual keyword if possible.

    pp.eatContextual = function(name) {
      if (!this.isContextual(name)) { return false }
      this.next();
      return true
    };

    // Asserts that following token is given contextual keyword.

    pp.expectContextual = function(name) {
      if (!this.eatContextual(name)) { this.unexpected(); }
    };

    // Test whether a semicolon can be inserted at the current position.

    pp.canInsertSemicolon = function() {
      return this.type === types.eof ||
        this.type === types.braceR ||
        lineBreak.test(this.input.slice(this.lastTokEnd, this.start))
    };

    pp.insertSemicolon = function() {
      if (this.canInsertSemicolon()) {
        if (this.options.onInsertedSemicolon)
          { this.options.onInsertedSemicolon(this.lastTokEnd, this.lastTokEndLoc); }
        return true
      }
    };

    // Consume a semicolon, or, failing that, see if we are allowed to
    // pretend that there is a semicolon at this position.

    pp.semicolon = function() {
      if (!this.eat(types.semi) && !this.insertSemicolon()) { this.unexpected(); }
    };

    pp.afterTrailingComma = function(tokType, notNext) {
      if (this.type === tokType) {
        if (this.options.onTrailingComma)
          { this.options.onTrailingComma(this.lastTokStart, this.lastTokStartLoc); }
        if (!notNext)
          { this.next(); }
        return true
      }
    };

    // Expect a token of a given type. If found, consume it, otherwise,
    // raise an unexpected token error.

    pp.expect = function(type) {
      this.eat(type) || this.unexpected();
    };

    // Raise an unexpected token error.

    pp.unexpected = function(pos) {
      this.raise(pos != null ? pos : this.start, "Unexpected token");
    };

    function DestructuringErrors() {
      this.shorthandAssign =
      this.trailingComma =
      this.parenthesizedAssign =
      this.parenthesizedBind =
      this.doubleProto =
        -1;
    }

    pp.checkPatternErrors = function(refDestructuringErrors, isAssign) {
      if (!refDestructuringErrors) { return }
      if (refDestructuringErrors.trailingComma > -1)
        { this.raiseRecoverable(refDestructuringErrors.trailingComma, "Comma is not permitted after the rest element"); }
      var parens = isAssign ? refDestructuringErrors.parenthesizedAssign : refDestructuringErrors.parenthesizedBind;
      if (parens > -1) { this.raiseRecoverable(parens, "Parenthesized pattern"); }
    };

    pp.checkExpressionErrors = function(refDestructuringErrors, andThrow) {
      if (!refDestructuringErrors) { return false }
      var shorthandAssign = refDestructuringErrors.shorthandAssign;
      var doubleProto = refDestructuringErrors.doubleProto;
      if (!andThrow) { return shorthandAssign >= 0 || doubleProto >= 0 }
      if (shorthandAssign >= 0)
        { this.raise(shorthandAssign, "Shorthand property assignments are valid only in destructuring patterns"); }
      if (doubleProto >= 0)
        { this.raiseRecoverable(doubleProto, "Redefinition of __proto__ property"); }
    };

    pp.checkYieldAwaitInDefaultParams = function() {
      if (this.yieldPos && (!this.awaitPos || this.yieldPos < this.awaitPos))
        { this.raise(this.yieldPos, "Yield expression cannot be a default value"); }
      if (this.awaitPos)
        { this.raise(this.awaitPos, "Await expression cannot be a default value"); }
    };

    pp.isSimpleAssignTarget = function(expr) {
      if (expr.type === "ParenthesizedExpression")
        { return this.isSimpleAssignTarget(expr.expression) }
      return expr.type === "Identifier" || expr.type === "MemberExpression"
    };

    var pp$1 = Parser.prototype;

    // ### Statement parsing

    // Parse a program. Initializes the parser, reads any number of
    // statements, and wraps them in a Program node.  Optionally takes a
    // `program` argument.  If present, the statements will be appended
    // to its body instead of creating a new node.

    pp$1.parseTopLevel = function(node) {
      var exports = {};
      if (!node.body) { node.body = []; }
      while (this.type !== types.eof) {
        var stmt = this.parseStatement(null, true, exports);
        node.body.push(stmt);
      }
      if (this.inModule)
        { for (var i = 0, list = Object.keys(this.undefinedExports); i < list.length; i += 1)
          {
            var name = list[i];

            this.raiseRecoverable(this.undefinedExports[name].start, ("Export '" + name + "' is not defined"));
          } }
      this.adaptDirectivePrologue(node.body);
      this.next();
      node.sourceType = this.options.sourceType;
      return this.finishNode(node, "Program")
    };

    var loopLabel = {kind: "loop"}, switchLabel = {kind: "switch"};

    pp$1.isLet = function(context) {
      if (this.options.ecmaVersion < 6 || !this.isContextual("let")) { return false }
      skipWhiteSpace.lastIndex = this.pos;
      var skip = skipWhiteSpace.exec(this.input);
      var next = this.pos + skip[0].length, nextCh = this.input.charCodeAt(next);
      // For ambiguous cases, determine if a LexicalDeclaration (or only a
      // Statement) is allowed here. If context is not empty then only a Statement
      // is allowed. However, `let [` is an explicit negative lookahead for
      // ExpressionStatement, so special-case it first.
      if (nextCh === 91) { return true } // '['
      if (context) { return false }

      if (nextCh === 123) { return true } // '{'
      if (isIdentifierStart(nextCh, true)) {
        var pos = next + 1;
        while (isIdentifierChar(this.input.charCodeAt(pos), true)) { ++pos; }
        var ident = this.input.slice(next, pos);
        if (!keywordRelationalOperator.test(ident)) { return true }
      }
      return false
    };

    // check 'async [no LineTerminator here] function'
    // - 'async /*foo*/ function' is OK.
    // - 'async /*\n*/ function' is invalid.
    pp$1.isAsyncFunction = function() {
      if (this.options.ecmaVersion < 8 || !this.isContextual("async"))
        { return false }

      skipWhiteSpace.lastIndex = this.pos;
      var skip = skipWhiteSpace.exec(this.input);
      var next = this.pos + skip[0].length;
      return !lineBreak.test(this.input.slice(this.pos, next)) &&
        this.input.slice(next, next + 8) === "function" &&
        (next + 8 === this.input.length || !isIdentifierChar(this.input.charAt(next + 8)))
    };

    // Parse a single statement.
    //
    // If expecting a statement and finding a slash operator, parse a
    // regular expression literal. This is to handle cases like
    // `if (foo) /blah/.exec(foo)`, where looking at the previous token
    // does not help.

    pp$1.parseStatement = function(context, topLevel, exports) {
      var starttype = this.type, node = this.startNode(), kind;

      if (this.isLet(context)) {
        starttype = types._var;
        kind = "let";
      }

      // Most types of statements are recognized by the keyword they
      // start with. Many are trivial to parse, some require a bit of
      // complexity.

      switch (starttype) {
      case types._break: case types._continue: return this.parseBreakContinueStatement(node, starttype.keyword)
      case types._debugger: return this.parseDebuggerStatement(node)
      case types._do: return this.parseDoStatement(node)
      case types._for: return this.parseForStatement(node)
      case types._function:
        // Function as sole body of either an if statement or a labeled statement
        // works, but not when it is part of a labeled statement that is the sole
        // body of an if statement.
        if ((context && (this.strict || context !== "if" && context !== "label")) && this.options.ecmaVersion >= 6) { this.unexpected(); }
        return this.parseFunctionStatement(node, false, !context)
      case types._class:
        if (context) { this.unexpected(); }
        return this.parseClass(node, true)
      case types._if: return this.parseIfStatement(node)
      case types._return: return this.parseReturnStatement(node)
      case types._switch: return this.parseSwitchStatement(node)
      case types._throw: return this.parseThrowStatement(node)
      case types._try: return this.parseTryStatement(node)
      case types._const: case types._var:
        kind = kind || this.value;
        if (context && kind !== "var") { this.unexpected(); }
        return this.parseVarStatement(node, kind)
      case types._while: return this.parseWhileStatement(node)
      case types._with: return this.parseWithStatement(node)
      case types.braceL: return this.parseBlock(true, node)
      case types.semi: return this.parseEmptyStatement(node)
      case types._export:
      case types._import:
        if (this.options.ecmaVersion > 10 && starttype === types._import) {
          skipWhiteSpace.lastIndex = this.pos;
          var skip = skipWhiteSpace.exec(this.input);
          var next = this.pos + skip[0].length, nextCh = this.input.charCodeAt(next);
          if (nextCh === 40) // '('
            { return this.parseExpressionStatement(node, this.parseExpression()) }
        }

        if (!this.options.allowImportExportEverywhere) {
          if (!topLevel)
            { this.raise(this.start, "'import' and 'export' may only appear at the top level"); }
          if (!this.inModule)
            { this.raise(this.start, "'import' and 'export' may appear only with 'sourceType: module'"); }
        }
        return starttype === types._import ? this.parseImport(node) : this.parseExport(node, exports)

        // If the statement does not start with a statement keyword or a
        // brace, it's an ExpressionStatement or LabeledStatement. We
        // simply start parsing an expression, and afterwards, if the
        // next token is a colon and the expression was a simple
        // Identifier node, we switch to interpreting it as a label.
      default:
        if (this.isAsyncFunction()) {
          if (context) { this.unexpected(); }
          this.next();
          return this.parseFunctionStatement(node, true, !context)
        }

        var maybeName = this.value, expr = this.parseExpression();
        if (starttype === types.name && expr.type === "Identifier" && this.eat(types.colon))
          { return this.parseLabeledStatement(node, maybeName, expr, context) }
        else { return this.parseExpressionStatement(node, expr) }
      }
    };

    pp$1.parseBreakContinueStatement = function(node, keyword) {
      var isBreak = keyword === "break";
      this.next();
      if (this.eat(types.semi) || this.insertSemicolon()) { node.label = null; }
      else if (this.type !== types.name) { this.unexpected(); }
      else {
        node.label = this.parseIdent();
        this.semicolon();
      }

      // Verify that there is an actual destination to break or
      // continue to.
      var i = 0;
      for (; i < this.labels.length; ++i) {
        var lab = this.labels[i];
        if (node.label == null || lab.name === node.label.name) {
          if (lab.kind != null && (isBreak || lab.kind === "loop")) { break }
          if (node.label && isBreak) { break }
        }
      }
      if (i === this.labels.length) { this.raise(node.start, "Unsyntactic " + keyword); }
      return this.finishNode(node, isBreak ? "BreakStatement" : "ContinueStatement")
    };

    pp$1.parseDebuggerStatement = function(node) {
      this.next();
      this.semicolon();
      return this.finishNode(node, "DebuggerStatement")
    };

    pp$1.parseDoStatement = function(node) {
      this.next();
      this.labels.push(loopLabel);
      node.body = this.parseStatement("do");
      this.labels.pop();
      this.expect(types._while);
      node.test = this.parseParenExpression();
      if (this.options.ecmaVersion >= 6)
        { this.eat(types.semi); }
      else
        { this.semicolon(); }
      return this.finishNode(node, "DoWhileStatement")
    };

    // Disambiguating between a `for` and a `for`/`in` or `for`/`of`
    // loop is non-trivial. Basically, we have to parse the init `var`
    // statement or expression, disallowing the `in` operator (see
    // the second parameter to `parseExpression`), and then check
    // whether the next token is `in` or `of`. When there is no init
    // part (semicolon immediately after the opening parenthesis), it
    // is a regular `for` loop.

    pp$1.parseForStatement = function(node) {
      this.next();
      var awaitAt = (this.options.ecmaVersion >= 9 && (this.inAsync || (!this.inFunction && this.options.allowAwaitOutsideFunction)) && this.eatContextual("await")) ? this.lastTokStart : -1;
      this.labels.push(loopLabel);
      this.enterScope(0);
      this.expect(types.parenL);
      if (this.type === types.semi) {
        if (awaitAt > -1) { this.unexpected(awaitAt); }
        return this.parseFor(node, null)
      }
      var isLet = this.isLet();
      if (this.type === types._var || this.type === types._const || isLet) {
        var init$1 = this.startNode(), kind = isLet ? "let" : this.value;
        this.next();
        this.parseVar(init$1, true, kind);
        this.finishNode(init$1, "VariableDeclaration");
        if ((this.type === types._in || (this.options.ecmaVersion >= 6 && this.isContextual("of"))) && init$1.declarations.length === 1) {
          if (this.options.ecmaVersion >= 9) {
            if (this.type === types._in) {
              if (awaitAt > -1) { this.unexpected(awaitAt); }
            } else { node.await = awaitAt > -1; }
          }
          return this.parseForIn(node, init$1)
        }
        if (awaitAt > -1) { this.unexpected(awaitAt); }
        return this.parseFor(node, init$1)
      }
      var refDestructuringErrors = new DestructuringErrors;
      var init = this.parseExpression(true, refDestructuringErrors);
      if (this.type === types._in || (this.options.ecmaVersion >= 6 && this.isContextual("of"))) {
        if (this.options.ecmaVersion >= 9) {
          if (this.type === types._in) {
            if (awaitAt > -1) { this.unexpected(awaitAt); }
          } else { node.await = awaitAt > -1; }
        }
        this.toAssignable(init, false, refDestructuringErrors);
        this.checkLVal(init);
        return this.parseForIn(node, init)
      } else {
        this.checkExpressionErrors(refDestructuringErrors, true);
      }
      if (awaitAt > -1) { this.unexpected(awaitAt); }
      return this.parseFor(node, init)
    };

    pp$1.parseFunctionStatement = function(node, isAsync, declarationPosition) {
      this.next();
      return this.parseFunction(node, FUNC_STATEMENT | (declarationPosition ? 0 : FUNC_HANGING_STATEMENT), false, isAsync)
    };

    pp$1.parseIfStatement = function(node) {
      this.next();
      node.test = this.parseParenExpression();
      // allow function declarations in branches, but only in non-strict mode
      node.consequent = this.parseStatement("if");
      node.alternate = this.eat(types._else) ? this.parseStatement("if") : null;
      return this.finishNode(node, "IfStatement")
    };

    pp$1.parseReturnStatement = function(node) {
      if (!this.inFunction && !this.options.allowReturnOutsideFunction)
        { this.raise(this.start, "'return' outside of function"); }
      this.next();

      // In `return` (and `break`/`continue`), the keywords with
      // optional arguments, we eagerly look for a semicolon or the
      // possibility to insert one.

      if (this.eat(types.semi) || this.insertSemicolon()) { node.argument = null; }
      else { node.argument = this.parseExpression(); this.semicolon(); }
      return this.finishNode(node, "ReturnStatement")
    };

    pp$1.parseSwitchStatement = function(node) {
      this.next();
      node.discriminant = this.parseParenExpression();
      node.cases = [];
      this.expect(types.braceL);
      this.labels.push(switchLabel);
      this.enterScope(0);

      // Statements under must be grouped (by label) in SwitchCase
      // nodes. `cur` is used to keep the node that we are currently
      // adding statements to.

      var cur;
      for (var sawDefault = false; this.type !== types.braceR;) {
        if (this.type === types._case || this.type === types._default) {
          var isCase = this.type === types._case;
          if (cur) { this.finishNode(cur, "SwitchCase"); }
          node.cases.push(cur = this.startNode());
          cur.consequent = [];
          this.next();
          if (isCase) {
            cur.test = this.parseExpression();
          } else {
            if (sawDefault) { this.raiseRecoverable(this.lastTokStart, "Multiple default clauses"); }
            sawDefault = true;
            cur.test = null;
          }
          this.expect(types.colon);
        } else {
          if (!cur) { this.unexpected(); }
          cur.consequent.push(this.parseStatement(null));
        }
      }
      this.exitScope();
      if (cur) { this.finishNode(cur, "SwitchCase"); }
      this.next(); // Closing brace
      this.labels.pop();
      return this.finishNode(node, "SwitchStatement")
    };

    pp$1.parseThrowStatement = function(node) {
      this.next();
      if (lineBreak.test(this.input.slice(this.lastTokEnd, this.start)))
        { this.raise(this.lastTokEnd, "Illegal newline after throw"); }
      node.argument = this.parseExpression();
      this.semicolon();
      return this.finishNode(node, "ThrowStatement")
    };

    // Reused empty array added for node fields that are always empty.

    var empty = [];

    pp$1.parseTryStatement = function(node) {
      this.next();
      node.block = this.parseBlock();
      node.handler = null;
      if (this.type === types._catch) {
        var clause = this.startNode();
        this.next();
        if (this.eat(types.parenL)) {
          clause.param = this.parseBindingAtom();
          var simple = clause.param.type === "Identifier";
          this.enterScope(simple ? SCOPE_SIMPLE_CATCH : 0);
          this.checkLVal(clause.param, simple ? BIND_SIMPLE_CATCH : BIND_LEXICAL);
          this.expect(types.parenR);
        } else {
          if (this.options.ecmaVersion < 10) { this.unexpected(); }
          clause.param = null;
          this.enterScope(0);
        }
        clause.body = this.parseBlock(false);
        this.exitScope();
        node.handler = this.finishNode(clause, "CatchClause");
      }
      node.finalizer = this.eat(types._finally) ? this.parseBlock() : null;
      if (!node.handler && !node.finalizer)
        { this.raise(node.start, "Missing catch or finally clause"); }
      return this.finishNode(node, "TryStatement")
    };

    pp$1.parseVarStatement = function(node, kind) {
      this.next();
      this.parseVar(node, false, kind);
      this.semicolon();
      return this.finishNode(node, "VariableDeclaration")
    };

    pp$1.parseWhileStatement = function(node) {
      this.next();
      node.test = this.parseParenExpression();
      this.labels.push(loopLabel);
      node.body = this.parseStatement("while");
      this.labels.pop();
      return this.finishNode(node, "WhileStatement")
    };

    pp$1.parseWithStatement = function(node) {
      if (this.strict) { this.raise(this.start, "'with' in strict mode"); }
      this.next();
      node.object = this.parseParenExpression();
      node.body = this.parseStatement("with");
      return this.finishNode(node, "WithStatement")
    };

    pp$1.parseEmptyStatement = function(node) {
      this.next();
      return this.finishNode(node, "EmptyStatement")
    };

    pp$1.parseLabeledStatement = function(node, maybeName, expr, context) {
      for (var i$1 = 0, list = this.labels; i$1 < list.length; i$1 += 1)
        {
        var label = list[i$1];

        if (label.name === maybeName)
          { this.raise(expr.start, "Label '" + maybeName + "' is already declared");
      } }
      var kind = this.type.isLoop ? "loop" : this.type === types._switch ? "switch" : null;
      for (var i = this.labels.length - 1; i >= 0; i--) {
        var label$1 = this.labels[i];
        if (label$1.statementStart === node.start) {
          // Update information about previous labels on this node
          label$1.statementStart = this.start;
          label$1.kind = kind;
        } else { break }
      }
      this.labels.push({name: maybeName, kind: kind, statementStart: this.start});
      node.body = this.parseStatement(context ? context.indexOf("label") === -1 ? context + "label" : context : "label");
      this.labels.pop();
      node.label = expr;
      return this.finishNode(node, "LabeledStatement")
    };

    pp$1.parseExpressionStatement = function(node, expr) {
      node.expression = expr;
      this.semicolon();
      return this.finishNode(node, "ExpressionStatement")
    };

    // Parse a semicolon-enclosed block of statements, handling `"use
    // strict"` declarations when `allowStrict` is true (used for
    // function bodies).

    pp$1.parseBlock = function(createNewLexicalScope, node) {
      if ( createNewLexicalScope === void 0 ) createNewLexicalScope = true;
      if ( node === void 0 ) node = this.startNode();

      node.body = [];
      this.expect(types.braceL);
      if (createNewLexicalScope) { this.enterScope(0); }
      while (!this.eat(types.braceR)) {
        var stmt = this.parseStatement(null);
        node.body.push(stmt);
      }
      if (createNewLexicalScope) { this.exitScope(); }
      return this.finishNode(node, "BlockStatement")
    };

    // Parse a regular `for` loop. The disambiguation code in
    // `parseStatement` will already have parsed the init statement or
    // expression.

    pp$1.parseFor = function(node, init) {
      node.init = init;
      this.expect(types.semi);
      node.test = this.type === types.semi ? null : this.parseExpression();
      this.expect(types.semi);
      node.update = this.type === types.parenR ? null : this.parseExpression();
      this.expect(types.parenR);
      node.body = this.parseStatement("for");
      this.exitScope();
      this.labels.pop();
      return this.finishNode(node, "ForStatement")
    };

    // Parse a `for`/`in` and `for`/`of` loop, which are almost
    // same from parser's perspective.

    pp$1.parseForIn = function(node, init) {
      var isForIn = this.type === types._in;
      this.next();

      if (
        init.type === "VariableDeclaration" &&
        init.declarations[0].init != null &&
        (
          !isForIn ||
          this.options.ecmaVersion < 8 ||
          this.strict ||
          init.kind !== "var" ||
          init.declarations[0].id.type !== "Identifier"
        )
      ) {
        this.raise(
          init.start,
          ((isForIn ? "for-in" : "for-of") + " loop variable declaration may not have an initializer")
        );
      } else if (init.type === "AssignmentPattern") {
        this.raise(init.start, "Invalid left-hand side in for-loop");
      }
      node.left = init;
      node.right = isForIn ? this.parseExpression() : this.parseMaybeAssign();
      this.expect(types.parenR);
      node.body = this.parseStatement("for");
      this.exitScope();
      this.labels.pop();
      return this.finishNode(node, isForIn ? "ForInStatement" : "ForOfStatement")
    };

    // Parse a list of variable declarations.

    pp$1.parseVar = function(node, isFor, kind) {
      node.declarations = [];
      node.kind = kind;
      for (;;) {
        var decl = this.startNode();
        this.parseVarId(decl, kind);
        if (this.eat(types.eq)) {
          decl.init = this.parseMaybeAssign(isFor);
        } else if (kind === "const" && !(this.type === types._in || (this.options.ecmaVersion >= 6 && this.isContextual("of")))) {
          this.unexpected();
        } else if (decl.id.type !== "Identifier" && !(isFor && (this.type === types._in || this.isContextual("of")))) {
          this.raise(this.lastTokEnd, "Complex binding patterns require an initialization value");
        } else {
          decl.init = null;
        }
        node.declarations.push(this.finishNode(decl, "VariableDeclarator"));
        if (!this.eat(types.comma)) { break }
      }
      return node
    };

    pp$1.parseVarId = function(decl, kind) {
      decl.id = this.parseBindingAtom();
      this.checkLVal(decl.id, kind === "var" ? BIND_VAR : BIND_LEXICAL, false);
    };

    var FUNC_STATEMENT = 1, FUNC_HANGING_STATEMENT = 2, FUNC_NULLABLE_ID = 4;

    // Parse a function declaration or literal (depending on the
    // `statement & FUNC_STATEMENT`).

    // Remove `allowExpressionBody` for 7.0.0, as it is only called with false
    pp$1.parseFunction = function(node, statement, allowExpressionBody, isAsync) {
      this.initFunction(node);
      if (this.options.ecmaVersion >= 9 || this.options.ecmaVersion >= 6 && !isAsync) {
        if (this.type === types.star && (statement & FUNC_HANGING_STATEMENT))
          { this.unexpected(); }
        node.generator = this.eat(types.star);
      }
      if (this.options.ecmaVersion >= 8)
        { node.async = !!isAsync; }

      if (statement & FUNC_STATEMENT) {
        node.id = (statement & FUNC_NULLABLE_ID) && this.type !== types.name ? null : this.parseIdent();
        if (node.id && !(statement & FUNC_HANGING_STATEMENT))
          // If it is a regular function declaration in sloppy mode, then it is
          // subject to Annex B semantics (BIND_FUNCTION). Otherwise, the binding
          // mode depends on properties of the current scope (see
          // treatFunctionsAsVar).
          { this.checkLVal(node.id, (this.strict || node.generator || node.async) ? this.treatFunctionsAsVar ? BIND_VAR : BIND_LEXICAL : BIND_FUNCTION); }
      }

      var oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
      this.yieldPos = 0;
      this.awaitPos = 0;
      this.awaitIdentPos = 0;
      this.enterScope(functionFlags(node.async, node.generator));

      if (!(statement & FUNC_STATEMENT))
        { node.id = this.type === types.name ? this.parseIdent() : null; }

      this.parseFunctionParams(node);
      this.parseFunctionBody(node, allowExpressionBody, false);

      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      this.awaitIdentPos = oldAwaitIdentPos;
      return this.finishNode(node, (statement & FUNC_STATEMENT) ? "FunctionDeclaration" : "FunctionExpression")
    };

    pp$1.parseFunctionParams = function(node) {
      this.expect(types.parenL);
      node.params = this.parseBindingList(types.parenR, false, this.options.ecmaVersion >= 8);
      this.checkYieldAwaitInDefaultParams();
    };

    // Parse a class declaration or literal (depending on the
    // `isStatement` parameter).

    pp$1.parseClass = function(node, isStatement) {
      this.next();

      // ecma-262 14.6 Class Definitions
      // A class definition is always strict mode code.
      var oldStrict = this.strict;
      this.strict = true;

      this.parseClassId(node, isStatement);
      this.parseClassSuper(node);
      var classBody = this.startNode();
      var hadConstructor = false;
      classBody.body = [];
      this.expect(types.braceL);
      while (!this.eat(types.braceR)) {
        var element = this.parseClassElement(node.superClass !== null);
        if (element) {
          classBody.body.push(element);
          if (element.type === "MethodDefinition" && element.kind === "constructor") {
            if (hadConstructor) { this.raise(element.start, "Duplicate constructor in the same class"); }
            hadConstructor = true;
          }
        }
      }
      node.body = this.finishNode(classBody, "ClassBody");
      this.strict = oldStrict;
      return this.finishNode(node, isStatement ? "ClassDeclaration" : "ClassExpression")
    };

    pp$1.parseClassElement = function(constructorAllowsSuper) {
      var this$1 = this;

      if (this.eat(types.semi)) { return null }

      var method = this.startNode();
      var tryContextual = function (k, noLineBreak) {
        if ( noLineBreak === void 0 ) noLineBreak = false;

        var start = this$1.start, startLoc = this$1.startLoc;
        if (!this$1.eatContextual(k)) { return false }
        if (this$1.type !== types.parenL && (!noLineBreak || !this$1.canInsertSemicolon())) { return true }
        if (method.key) { this$1.unexpected(); }
        method.computed = false;
        method.key = this$1.startNodeAt(start, startLoc);
        method.key.name = k;
        this$1.finishNode(method.key, "Identifier");
        return false
      };

      method.kind = "method";
      method.static = tryContextual("static");
      var isGenerator = this.eat(types.star);
      var isAsync = false;
      if (!isGenerator) {
        if (this.options.ecmaVersion >= 8 && tryContextual("async", true)) {
          isAsync = true;
          isGenerator = this.options.ecmaVersion >= 9 && this.eat(types.star);
        } else if (tryContextual("get")) {
          method.kind = "get";
        } else if (tryContextual("set")) {
          method.kind = "set";
        }
      }
      if (!method.key) { this.parsePropertyName(method); }
      var key = method.key;
      var allowsDirectSuper = false;
      if (!method.computed && !method.static && (key.type === "Identifier" && key.name === "constructor" ||
          key.type === "Literal" && key.value === "constructor")) {
        if (method.kind !== "method") { this.raise(key.start, "Constructor can't have get/set modifier"); }
        if (isGenerator) { this.raise(key.start, "Constructor can't be a generator"); }
        if (isAsync) { this.raise(key.start, "Constructor can't be an async method"); }
        method.kind = "constructor";
        allowsDirectSuper = constructorAllowsSuper;
      } else if (method.static && key.type === "Identifier" && key.name === "prototype") {
        this.raise(key.start, "Classes may not have a static property named prototype");
      }
      this.parseClassMethod(method, isGenerator, isAsync, allowsDirectSuper);
      if (method.kind === "get" && method.value.params.length !== 0)
        { this.raiseRecoverable(method.value.start, "getter should have no params"); }
      if (method.kind === "set" && method.value.params.length !== 1)
        { this.raiseRecoverable(method.value.start, "setter should have exactly one param"); }
      if (method.kind === "set" && method.value.params[0].type === "RestElement")
        { this.raiseRecoverable(method.value.params[0].start, "Setter cannot use rest params"); }
      return method
    };

    pp$1.parseClassMethod = function(method, isGenerator, isAsync, allowsDirectSuper) {
      method.value = this.parseMethod(isGenerator, isAsync, allowsDirectSuper);
      return this.finishNode(method, "MethodDefinition")
    };

    pp$1.parseClassId = function(node, isStatement) {
      if (this.type === types.name) {
        node.id = this.parseIdent();
        if (isStatement)
          { this.checkLVal(node.id, BIND_LEXICAL, false); }
      } else {
        if (isStatement === true)
          { this.unexpected(); }
        node.id = null;
      }
    };

    pp$1.parseClassSuper = function(node) {
      node.superClass = this.eat(types._extends) ? this.parseExprSubscripts() : null;
    };

    // Parses module export declaration.

    pp$1.parseExport = function(node, exports) {
      this.next();
      // export * from '...'
      if (this.eat(types.star)) {
        this.expectContextual("from");
        if (this.type !== types.string) { this.unexpected(); }
        node.source = this.parseExprAtom();
        this.semicolon();
        return this.finishNode(node, "ExportAllDeclaration")
      }
      if (this.eat(types._default)) { // export default ...
        this.checkExport(exports, "default", this.lastTokStart);
        var isAsync;
        if (this.type === types._function || (isAsync = this.isAsyncFunction())) {
          var fNode = this.startNode();
          this.next();
          if (isAsync) { this.next(); }
          node.declaration = this.parseFunction(fNode, FUNC_STATEMENT | FUNC_NULLABLE_ID, false, isAsync);
        } else if (this.type === types._class) {
          var cNode = this.startNode();
          node.declaration = this.parseClass(cNode, "nullableID");
        } else {
          node.declaration = this.parseMaybeAssign();
          this.semicolon();
        }
        return this.finishNode(node, "ExportDefaultDeclaration")
      }
      // export var|const|let|function|class ...
      if (this.shouldParseExportStatement()) {
        node.declaration = this.parseStatement(null);
        if (node.declaration.type === "VariableDeclaration")
          { this.checkVariableExport(exports, node.declaration.declarations); }
        else
          { this.checkExport(exports, node.declaration.id.name, node.declaration.id.start); }
        node.specifiers = [];
        node.source = null;
      } else { // export { x, y as z } [from '...']
        node.declaration = null;
        node.specifiers = this.parseExportSpecifiers(exports);
        if (this.eatContextual("from")) {
          if (this.type !== types.string) { this.unexpected(); }
          node.source = this.parseExprAtom();
        } else {
          for (var i = 0, list = node.specifiers; i < list.length; i += 1) {
            // check for keywords used as local names
            var spec = list[i];

            this.checkUnreserved(spec.local);
            // check if export is defined
            this.checkLocalExport(spec.local);
          }

          node.source = null;
        }
        this.semicolon();
      }
      return this.finishNode(node, "ExportNamedDeclaration")
    };

    pp$1.checkExport = function(exports, name, pos) {
      if (!exports) { return }
      if (has(exports, name))
        { this.raiseRecoverable(pos, "Duplicate export '" + name + "'"); }
      exports[name] = true;
    };

    pp$1.checkPatternExport = function(exports, pat) {
      var type = pat.type;
      if (type === "Identifier")
        { this.checkExport(exports, pat.name, pat.start); }
      else if (type === "ObjectPattern")
        { for (var i = 0, list = pat.properties; i < list.length; i += 1)
          {
            var prop = list[i];

            this.checkPatternExport(exports, prop);
          } }
      else if (type === "ArrayPattern")
        { for (var i$1 = 0, list$1 = pat.elements; i$1 < list$1.length; i$1 += 1) {
          var elt = list$1[i$1];

            if (elt) { this.checkPatternExport(exports, elt); }
        } }
      else if (type === "Property")
        { this.checkPatternExport(exports, pat.value); }
      else if (type === "AssignmentPattern")
        { this.checkPatternExport(exports, pat.left); }
      else if (type === "RestElement")
        { this.checkPatternExport(exports, pat.argument); }
      else if (type === "ParenthesizedExpression")
        { this.checkPatternExport(exports, pat.expression); }
    };

    pp$1.checkVariableExport = function(exports, decls) {
      if (!exports) { return }
      for (var i = 0, list = decls; i < list.length; i += 1)
        {
        var decl = list[i];

        this.checkPatternExport(exports, decl.id);
      }
    };

    pp$1.shouldParseExportStatement = function() {
      return this.type.keyword === "var" ||
        this.type.keyword === "const" ||
        this.type.keyword === "class" ||
        this.type.keyword === "function" ||
        this.isLet() ||
        this.isAsyncFunction()
    };

    // Parses a comma-separated list of module exports.

    pp$1.parseExportSpecifiers = function(exports) {
      var nodes = [], first = true;
      // export { x, y as z } [from '...']
      this.expect(types.braceL);
      while (!this.eat(types.braceR)) {
        if (!first) {
          this.expect(types.comma);
          if (this.afterTrailingComma(types.braceR)) { break }
        } else { first = false; }

        var node = this.startNode();
        node.local = this.parseIdent(true);
        node.exported = this.eatContextual("as") ? this.parseIdent(true) : node.local;
        this.checkExport(exports, node.exported.name, node.exported.start);
        nodes.push(this.finishNode(node, "ExportSpecifier"));
      }
      return nodes
    };

    // Parses import declaration.

    pp$1.parseImport = function(node) {
      this.next();
      // import '...'
      if (this.type === types.string) {
        node.specifiers = empty;
        node.source = this.parseExprAtom();
      } else {
        node.specifiers = this.parseImportSpecifiers();
        this.expectContextual("from");
        node.source = this.type === types.string ? this.parseExprAtom() : this.unexpected();
      }
      this.semicolon();
      return this.finishNode(node, "ImportDeclaration")
    };

    // Parses a comma-separated list of module imports.

    pp$1.parseImportSpecifiers = function() {
      var nodes = [], first = true;
      if (this.type === types.name) {
        // import defaultObj, { x, y as z } from '...'
        var node = this.startNode();
        node.local = this.parseIdent();
        this.checkLVal(node.local, BIND_LEXICAL);
        nodes.push(this.finishNode(node, "ImportDefaultSpecifier"));
        if (!this.eat(types.comma)) { return nodes }
      }
      if (this.type === types.star) {
        var node$1 = this.startNode();
        this.next();
        this.expectContextual("as");
        node$1.local = this.parseIdent();
        this.checkLVal(node$1.local, BIND_LEXICAL);
        nodes.push(this.finishNode(node$1, "ImportNamespaceSpecifier"));
        return nodes
      }
      this.expect(types.braceL);
      while (!this.eat(types.braceR)) {
        if (!first) {
          this.expect(types.comma);
          if (this.afterTrailingComma(types.braceR)) { break }
        } else { first = false; }

        var node$2 = this.startNode();
        node$2.imported = this.parseIdent(true);
        if (this.eatContextual("as")) {
          node$2.local = this.parseIdent();
        } else {
          this.checkUnreserved(node$2.imported);
          node$2.local = node$2.imported;
        }
        this.checkLVal(node$2.local, BIND_LEXICAL);
        nodes.push(this.finishNode(node$2, "ImportSpecifier"));
      }
      return nodes
    };

    // Set `ExpressionStatement#directive` property for directive prologues.
    pp$1.adaptDirectivePrologue = function(statements) {
      for (var i = 0; i < statements.length && this.isDirectiveCandidate(statements[i]); ++i) {
        statements[i].directive = statements[i].expression.raw.slice(1, -1);
      }
    };
    pp$1.isDirectiveCandidate = function(statement) {
      return (
        statement.type === "ExpressionStatement" &&
        statement.expression.type === "Literal" &&
        typeof statement.expression.value === "string" &&
        // Reject parenthesized strings.
        (this.input[statement.start] === "\"" || this.input[statement.start] === "'")
      )
    };

    var pp$2 = Parser.prototype;

    // Convert existing expression atom to assignable pattern
    // if possible.

    pp$2.toAssignable = function(node, isBinding, refDestructuringErrors) {
      if (this.options.ecmaVersion >= 6 && node) {
        switch (node.type) {
        case "Identifier":
          if (this.inAsync && node.name === "await")
            { this.raise(node.start, "Cannot use 'await' as identifier inside an async function"); }
          break

        case "ObjectPattern":
        case "ArrayPattern":
        case "RestElement":
          break

        case "ObjectExpression":
          node.type = "ObjectPattern";
          if (refDestructuringErrors) { this.checkPatternErrors(refDestructuringErrors, true); }
          for (var i = 0, list = node.properties; i < list.length; i += 1) {
            var prop = list[i];

          this.toAssignable(prop, isBinding);
            // Early error:
            //   AssignmentRestProperty[Yield, Await] :
            //     `...` DestructuringAssignmentTarget[Yield, Await]
            //
            //   It is a Syntax Error if |DestructuringAssignmentTarget| is an |ArrayLiteral| or an |ObjectLiteral|.
            if (
              prop.type === "RestElement" &&
              (prop.argument.type === "ArrayPattern" || prop.argument.type === "ObjectPattern")
            ) {
              this.raise(prop.argument.start, "Unexpected token");
            }
          }
          break

        case "Property":
          // AssignmentProperty has type === "Property"
          if (node.kind !== "init") { this.raise(node.key.start, "Object pattern can't contain getter or setter"); }
          this.toAssignable(node.value, isBinding);
          break

        case "ArrayExpression":
          node.type = "ArrayPattern";
          if (refDestructuringErrors) { this.checkPatternErrors(refDestructuringErrors, true); }
          this.toAssignableList(node.elements, isBinding);
          break

        case "SpreadElement":
          node.type = "RestElement";
          this.toAssignable(node.argument, isBinding);
          if (node.argument.type === "AssignmentPattern")
            { this.raise(node.argument.start, "Rest elements cannot have a default value"); }
          break

        case "AssignmentExpression":
          if (node.operator !== "=") { this.raise(node.left.end, "Only '=' operator can be used for specifying default value."); }
          node.type = "AssignmentPattern";
          delete node.operator;
          this.toAssignable(node.left, isBinding);
          // falls through to AssignmentPattern

        case "AssignmentPattern":
          break

        case "ParenthesizedExpression":
          this.toAssignable(node.expression, isBinding, refDestructuringErrors);
          break

        case "MemberExpression":
          if (!isBinding) { break }

        default:
          this.raise(node.start, "Assigning to rvalue");
        }
      } else if (refDestructuringErrors) { this.checkPatternErrors(refDestructuringErrors, true); }
      return node
    };

    // Convert list of expression atoms to binding list.

    pp$2.toAssignableList = function(exprList, isBinding) {
      var end = exprList.length;
      for (var i = 0; i < end; i++) {
        var elt = exprList[i];
        if (elt) { this.toAssignable(elt, isBinding); }
      }
      if (end) {
        var last = exprList[end - 1];
        if (this.options.ecmaVersion === 6 && isBinding && last && last.type === "RestElement" && last.argument.type !== "Identifier")
          { this.unexpected(last.argument.start); }
      }
      return exprList
    };

    // Parses spread element.

    pp$2.parseSpread = function(refDestructuringErrors) {
      var node = this.startNode();
      this.next();
      node.argument = this.parseMaybeAssign(false, refDestructuringErrors);
      return this.finishNode(node, "SpreadElement")
    };

    pp$2.parseRestBinding = function() {
      var node = this.startNode();
      this.next();

      // RestElement inside of a function parameter must be an identifier
      if (this.options.ecmaVersion === 6 && this.type !== types.name)
        { this.unexpected(); }

      node.argument = this.parseBindingAtom();

      return this.finishNode(node, "RestElement")
    };

    // Parses lvalue (assignable) atom.

    pp$2.parseBindingAtom = function() {
      if (this.options.ecmaVersion >= 6) {
        switch (this.type) {
        case types.bracketL:
          var node = this.startNode();
          this.next();
          node.elements = this.parseBindingList(types.bracketR, true, true);
          return this.finishNode(node, "ArrayPattern")

        case types.braceL:
          return this.parseObj(true)
        }
      }
      return this.parseIdent()
    };

    pp$2.parseBindingList = function(close, allowEmpty, allowTrailingComma) {
      var elts = [], first = true;
      while (!this.eat(close)) {
        if (first) { first = false; }
        else { this.expect(types.comma); }
        if (allowEmpty && this.type === types.comma) {
          elts.push(null);
        } else if (allowTrailingComma && this.afterTrailingComma(close)) {
          break
        } else if (this.type === types.ellipsis) {
          var rest = this.parseRestBinding();
          this.parseBindingListItem(rest);
          elts.push(rest);
          if (this.type === types.comma) { this.raise(this.start, "Comma is not permitted after the rest element"); }
          this.expect(close);
          break
        } else {
          var elem = this.parseMaybeDefault(this.start, this.startLoc);
          this.parseBindingListItem(elem);
          elts.push(elem);
        }
      }
      return elts
    };

    pp$2.parseBindingListItem = function(param) {
      return param
    };

    // Parses assignment pattern around given atom if possible.

    pp$2.parseMaybeDefault = function(startPos, startLoc, left) {
      left = left || this.parseBindingAtom();
      if (this.options.ecmaVersion < 6 || !this.eat(types.eq)) { return left }
      var node = this.startNodeAt(startPos, startLoc);
      node.left = left;
      node.right = this.parseMaybeAssign();
      return this.finishNode(node, "AssignmentPattern")
    };

    // Verify that a node is an lval — something that can be assigned
    // to.
    // bindingType can be either:
    // 'var' indicating that the lval creates a 'var' binding
    // 'let' indicating that the lval creates a lexical ('let' or 'const') binding
    // 'none' indicating that the binding should be checked for illegal identifiers, but not for duplicate references

    pp$2.checkLVal = function(expr, bindingType, checkClashes) {
      if ( bindingType === void 0 ) bindingType = BIND_NONE;

      switch (expr.type) {
      case "Identifier":
        if (bindingType === BIND_LEXICAL && expr.name === "let")
          { this.raiseRecoverable(expr.start, "let is disallowed as a lexically bound name"); }
        if (this.strict && this.reservedWordsStrictBind.test(expr.name))
          { this.raiseRecoverable(expr.start, (bindingType ? "Binding " : "Assigning to ") + expr.name + " in strict mode"); }
        if (checkClashes) {
          if (has(checkClashes, expr.name))
            { this.raiseRecoverable(expr.start, "Argument name clash"); }
          checkClashes[expr.name] = true;
        }
        if (bindingType !== BIND_NONE && bindingType !== BIND_OUTSIDE) { this.declareName(expr.name, bindingType, expr.start); }
        break

      case "MemberExpression":
        if (bindingType) { this.raiseRecoverable(expr.start, "Binding member expression"); }
        break

      case "ObjectPattern":
        for (var i = 0, list = expr.properties; i < list.length; i += 1)
          {
        var prop = list[i];

        this.checkLVal(prop, bindingType, checkClashes);
      }
        break

      case "Property":
        // AssignmentProperty has type === "Property"
        this.checkLVal(expr.value, bindingType, checkClashes);
        break

      case "ArrayPattern":
        for (var i$1 = 0, list$1 = expr.elements; i$1 < list$1.length; i$1 += 1) {
          var elem = list$1[i$1];

        if (elem) { this.checkLVal(elem, bindingType, checkClashes); }
        }
        break

      case "AssignmentPattern":
        this.checkLVal(expr.left, bindingType, checkClashes);
        break

      case "RestElement":
        this.checkLVal(expr.argument, bindingType, checkClashes);
        break

      case "ParenthesizedExpression":
        this.checkLVal(expr.expression, bindingType, checkClashes);
        break

      default:
        this.raise(expr.start, (bindingType ? "Binding" : "Assigning to") + " rvalue");
      }
    };

    // A recursive descent parser operates by defining functions for all

    var pp$3 = Parser.prototype;

    // Check if property name clashes with already added.
    // Object/class getters and setters are not allowed to clash —
    // either with each other or with an init property — and in
    // strict mode, init properties are also not allowed to be repeated.

    pp$3.checkPropClash = function(prop, propHash, refDestructuringErrors) {
      if (this.options.ecmaVersion >= 9 && prop.type === "SpreadElement")
        { return }
      if (this.options.ecmaVersion >= 6 && (prop.computed || prop.method || prop.shorthand))
        { return }
      var key = prop.key;
      var name;
      switch (key.type) {
      case "Identifier": name = key.name; break
      case "Literal": name = String(key.value); break
      default: return
      }
      var kind = prop.kind;
      if (this.options.ecmaVersion >= 6) {
        if (name === "__proto__" && kind === "init") {
          if (propHash.proto) {
            if (refDestructuringErrors && refDestructuringErrors.doubleProto < 0) { refDestructuringErrors.doubleProto = key.start; }
            // Backwards-compat kludge. Can be removed in version 6.0
            else { this.raiseRecoverable(key.start, "Redefinition of __proto__ property"); }
          }
          propHash.proto = true;
        }
        return
      }
      name = "$" + name;
      var other = propHash[name];
      if (other) {
        var redefinition;
        if (kind === "init") {
          redefinition = this.strict && other.init || other.get || other.set;
        } else {
          redefinition = other.init || other[kind];
        }
        if (redefinition)
          { this.raiseRecoverable(key.start, "Redefinition of property"); }
      } else {
        other = propHash[name] = {
          init: false,
          get: false,
          set: false
        };
      }
      other[kind] = true;
    };

    // ### Expression parsing

    // These nest, from the most general expression type at the top to
    // 'atomic', nondivisible expression types at the bottom. Most of
    // the functions will simply let the function(s) below them parse,
    // and, *if* the syntactic construct they handle is present, wrap
    // the AST node that the inner parser gave them in another node.

    // Parse a full expression. The optional arguments are used to
    // forbid the `in` operator (in for loops initalization expressions)
    // and provide reference for storing '=' operator inside shorthand
    // property assignment in contexts where both object expression
    // and object pattern might appear (so it's possible to raise
    // delayed syntax error at correct position).

    pp$3.parseExpression = function(noIn, refDestructuringErrors) {
      var startPos = this.start, startLoc = this.startLoc;
      var expr = this.parseMaybeAssign(noIn, refDestructuringErrors);
      if (this.type === types.comma) {
        var node = this.startNodeAt(startPos, startLoc);
        node.expressions = [expr];
        while (this.eat(types.comma)) { node.expressions.push(this.parseMaybeAssign(noIn, refDestructuringErrors)); }
        return this.finishNode(node, "SequenceExpression")
      }
      return expr
    };

    // Parse an assignment expression. This includes applications of
    // operators like `+=`.

    pp$3.parseMaybeAssign = function(noIn, refDestructuringErrors, afterLeftParse) {
      if (this.isContextual("yield")) {
        if (this.inGenerator) { return this.parseYield(noIn) }
        // The tokenizer will assume an expression is allowed after
        // `yield`, but this isn't that kind of yield
        else { this.exprAllowed = false; }
      }

      var ownDestructuringErrors = false, oldParenAssign = -1, oldTrailingComma = -1, oldShorthandAssign = -1;
      if (refDestructuringErrors) {
        oldParenAssign = refDestructuringErrors.parenthesizedAssign;
        oldTrailingComma = refDestructuringErrors.trailingComma;
        oldShorthandAssign = refDestructuringErrors.shorthandAssign;
        refDestructuringErrors.parenthesizedAssign = refDestructuringErrors.trailingComma = refDestructuringErrors.shorthandAssign = -1;
      } else {
        refDestructuringErrors = new DestructuringErrors;
        ownDestructuringErrors = true;
      }

      var startPos = this.start, startLoc = this.startLoc;
      if (this.type === types.parenL || this.type === types.name)
        { this.potentialArrowAt = this.start; }
      var left = this.parseMaybeConditional(noIn, refDestructuringErrors);
      if (afterLeftParse) { left = afterLeftParse.call(this, left, startPos, startLoc); }
      if (this.type.isAssign) {
        var node = this.startNodeAt(startPos, startLoc);
        node.operator = this.value;
        node.left = this.type === types.eq ? this.toAssignable(left, false, refDestructuringErrors) : left;
        if (!ownDestructuringErrors) { DestructuringErrors.call(refDestructuringErrors); }
        refDestructuringErrors.shorthandAssign = -1; // reset because shorthand default was used correctly
        this.checkLVal(left);
        this.next();
        node.right = this.parseMaybeAssign(noIn);
        return this.finishNode(node, "AssignmentExpression")
      } else {
        if (ownDestructuringErrors) { this.checkExpressionErrors(refDestructuringErrors, true); }
      }
      if (oldParenAssign > -1) { refDestructuringErrors.parenthesizedAssign = oldParenAssign; }
      if (oldTrailingComma > -1) { refDestructuringErrors.trailingComma = oldTrailingComma; }
      if (oldShorthandAssign > -1) { refDestructuringErrors.shorthandAssign = oldShorthandAssign; }
      return left
    };

    // Parse a ternary conditional (`?:`) operator.

    pp$3.parseMaybeConditional = function(noIn, refDestructuringErrors) {
      var startPos = this.start, startLoc = this.startLoc;
      var expr = this.parseExprOps(noIn, refDestructuringErrors);
      if (this.checkExpressionErrors(refDestructuringErrors)) { return expr }
      if (this.eat(types.question)) {
        var node = this.startNodeAt(startPos, startLoc);
        node.test = expr;
        node.consequent = this.parseMaybeAssign();
        this.expect(types.colon);
        node.alternate = this.parseMaybeAssign(noIn);
        return this.finishNode(node, "ConditionalExpression")
      }
      return expr
    };

    // Start the precedence parser.

    pp$3.parseExprOps = function(noIn, refDestructuringErrors) {
      var startPos = this.start, startLoc = this.startLoc;
      var expr = this.parseMaybeUnary(refDestructuringErrors, false);
      if (this.checkExpressionErrors(refDestructuringErrors)) { return expr }
      return expr.start === startPos && expr.type === "ArrowFunctionExpression" ? expr : this.parseExprOp(expr, startPos, startLoc, -1, noIn)
    };

    // Parse binary operators with the operator precedence parsing
    // algorithm. `left` is the left-hand side of the operator.
    // `minPrec` provides context that allows the function to stop and
    // defer further parser to one of its callers when it encounters an
    // operator that has a lower precedence than the set it is parsing.

    pp$3.parseExprOp = function(left, leftStartPos, leftStartLoc, minPrec, noIn) {
      var prec = this.type.binop;
      if (prec != null && (!noIn || this.type !== types._in)) {
        if (prec > minPrec) {
          var logical = this.type === types.logicalOR || this.type === types.logicalAND;
          var op = this.value;
          this.next();
          var startPos = this.start, startLoc = this.startLoc;
          var right = this.parseExprOp(this.parseMaybeUnary(null, false), startPos, startLoc, prec, noIn);
          var node = this.buildBinary(leftStartPos, leftStartLoc, left, right, op, logical);
          return this.parseExprOp(node, leftStartPos, leftStartLoc, minPrec, noIn)
        }
      }
      return left
    };

    pp$3.buildBinary = function(startPos, startLoc, left, right, op, logical) {
      var node = this.startNodeAt(startPos, startLoc);
      node.left = left;
      node.operator = op;
      node.right = right;
      return this.finishNode(node, logical ? "LogicalExpression" : "BinaryExpression")
    };

    // Parse unary operators, both prefix and postfix.

    pp$3.parseMaybeUnary = function(refDestructuringErrors, sawUnary) {
      var startPos = this.start, startLoc = this.startLoc, expr;
      if (this.isContextual("await") && (this.inAsync || (!this.inFunction && this.options.allowAwaitOutsideFunction))) {
        expr = this.parseAwait();
        sawUnary = true;
      } else if (this.type.prefix) {
        var node = this.startNode(), update = this.type === types.incDec;
        node.operator = this.value;
        node.prefix = true;
        this.next();
        node.argument = this.parseMaybeUnary(null, true);
        this.checkExpressionErrors(refDestructuringErrors, true);
        if (update) { this.checkLVal(node.argument); }
        else if (this.strict && node.operator === "delete" &&
                 node.argument.type === "Identifier")
          { this.raiseRecoverable(node.start, "Deleting local variable in strict mode"); }
        else { sawUnary = true; }
        expr = this.finishNode(node, update ? "UpdateExpression" : "UnaryExpression");
      } else {
        expr = this.parseExprSubscripts(refDestructuringErrors);
        if (this.checkExpressionErrors(refDestructuringErrors)) { return expr }
        while (this.type.postfix && !this.canInsertSemicolon()) {
          var node$1 = this.startNodeAt(startPos, startLoc);
          node$1.operator = this.value;
          node$1.prefix = false;
          node$1.argument = expr;
          this.checkLVal(expr);
          this.next();
          expr = this.finishNode(node$1, "UpdateExpression");
        }
      }

      if (!sawUnary && this.eat(types.starstar))
        { return this.buildBinary(startPos, startLoc, expr, this.parseMaybeUnary(null, false), "**", false) }
      else
        { return expr }
    };

    // Parse call, dot, and `[]`-subscript expressions.

    pp$3.parseExprSubscripts = function(refDestructuringErrors) {
      var startPos = this.start, startLoc = this.startLoc;
      var expr = this.parseExprAtom(refDestructuringErrors);
      var skipArrowSubscripts = expr.type === "ArrowFunctionExpression" && this.input.slice(this.lastTokStart, this.lastTokEnd) !== ")";
      if (this.checkExpressionErrors(refDestructuringErrors) || skipArrowSubscripts) { return expr }
      var result = this.parseSubscripts(expr, startPos, startLoc);
      if (refDestructuringErrors && result.type === "MemberExpression") {
        if (refDestructuringErrors.parenthesizedAssign >= result.start) { refDestructuringErrors.parenthesizedAssign = -1; }
        if (refDestructuringErrors.parenthesizedBind >= result.start) { refDestructuringErrors.parenthesizedBind = -1; }
      }
      return result
    };

    pp$3.parseSubscripts = function(base, startPos, startLoc, noCalls) {
      var maybeAsyncArrow = this.options.ecmaVersion >= 8 && base.type === "Identifier" && base.name === "async" &&
          this.lastTokEnd === base.end && !this.canInsertSemicolon() && this.input.slice(base.start, base.end) === "async";
      while (true) {
        var element = this.parseSubscript(base, startPos, startLoc, noCalls, maybeAsyncArrow);
        if (element === base || element.type === "ArrowFunctionExpression") { return element }
        base = element;
      }
    };

    pp$3.parseSubscript = function(base, startPos, startLoc, noCalls, maybeAsyncArrow) {
      var computed = this.eat(types.bracketL);
      if (computed || this.eat(types.dot)) {
        var node = this.startNodeAt(startPos, startLoc);
        node.object = base;
        node.property = computed ? this.parseExpression() : this.parseIdent(this.options.allowReserved !== "never");
        node.computed = !!computed;
        if (computed) { this.expect(types.bracketR); }
        base = this.finishNode(node, "MemberExpression");
      } else if (!noCalls && this.eat(types.parenL)) {
        var refDestructuringErrors = new DestructuringErrors, oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
        this.yieldPos = 0;
        this.awaitPos = 0;
        this.awaitIdentPos = 0;
        var exprList = this.parseExprList(types.parenR, this.options.ecmaVersion >= 8 && base.type !== "Import", false, refDestructuringErrors);
        if (maybeAsyncArrow && !this.canInsertSemicolon() && this.eat(types.arrow)) {
          this.checkPatternErrors(refDestructuringErrors, false);
          this.checkYieldAwaitInDefaultParams();
          if (this.awaitIdentPos > 0)
            { this.raise(this.awaitIdentPos, "Cannot use 'await' as identifier inside an async function"); }
          this.yieldPos = oldYieldPos;
          this.awaitPos = oldAwaitPos;
          this.awaitIdentPos = oldAwaitIdentPos;
          return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), exprList, true)
        }
        this.checkExpressionErrors(refDestructuringErrors, true);
        this.yieldPos = oldYieldPos || this.yieldPos;
        this.awaitPos = oldAwaitPos || this.awaitPos;
        this.awaitIdentPos = oldAwaitIdentPos || this.awaitIdentPos;
        var node$1 = this.startNodeAt(startPos, startLoc);
        node$1.callee = base;
        node$1.arguments = exprList;
        if (node$1.callee.type === "Import") {
          if (node$1.arguments.length !== 1) {
            this.raise(node$1.start, "import() requires exactly one argument");
          }

          var importArg = node$1.arguments[0];
          if (importArg && importArg.type === "SpreadElement") {
            this.raise(importArg.start, "... is not allowed in import()");
          }
        }
        base = this.finishNode(node$1, "CallExpression");
      } else if (this.type === types.backQuote) {
        var node$2 = this.startNodeAt(startPos, startLoc);
        node$2.tag = base;
        node$2.quasi = this.parseTemplate({isTagged: true});
        base = this.finishNode(node$2, "TaggedTemplateExpression");
      }
      return base
    };

    // Parse an atomic expression — either a single token that is an
    // expression, an expression started by a keyword like `function` or
    // `new`, or an expression wrapped in punctuation like `()`, `[]`,
    // or `{}`.

    pp$3.parseExprAtom = function(refDestructuringErrors) {
      // If a division operator appears in an expression position, the
      // tokenizer got confused, and we force it to read a regexp instead.
      if (this.type === types.slash) { this.readRegexp(); }

      var node, canBeArrow = this.potentialArrowAt === this.start;
      switch (this.type) {
      case types._super:
        if (!this.allowSuper)
          { this.raise(this.start, "'super' keyword outside a method"); }
        node = this.startNode();
        this.next();
        if (this.type === types.parenL && !this.allowDirectSuper)
          { this.raise(node.start, "super() call outside constructor of a subclass"); }
        // The `super` keyword can appear at below:
        // SuperProperty:
        //     super [ Expression ]
        //     super . IdentifierName
        // SuperCall:
        //     super Arguments
        if (this.type !== types.dot && this.type !== types.bracketL && this.type !== types.parenL)
          { this.unexpected(); }
        return this.finishNode(node, "Super")

      case types._this:
        node = this.startNode();
        this.next();
        return this.finishNode(node, "ThisExpression")

      case types.name:
        var startPos = this.start, startLoc = this.startLoc, containsEsc = this.containsEsc;
        var id = this.parseIdent(false);
        if (this.options.ecmaVersion >= 8 && !containsEsc && id.name === "async" && !this.canInsertSemicolon() && this.eat(types._function))
          { return this.parseFunction(this.startNodeAt(startPos, startLoc), 0, false, true) }
        if (canBeArrow && !this.canInsertSemicolon()) {
          if (this.eat(types.arrow))
            { return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), [id], false) }
          if (this.options.ecmaVersion >= 8 && id.name === "async" && this.type === types.name && !containsEsc) {
            id = this.parseIdent(false);
            if (this.canInsertSemicolon() || !this.eat(types.arrow))
              { this.unexpected(); }
            return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), [id], true)
          }
        }
        return id

      case types.regexp:
        var value = this.value;
        node = this.parseLiteral(value.value);
        node.regex = {pattern: value.pattern, flags: value.flags};
        return node

      case types.num: case types.string:
        return this.parseLiteral(this.value)

      case types._null: case types._true: case types._false:
        node = this.startNode();
        node.value = this.type === types._null ? null : this.type === types._true;
        node.raw = this.type.keyword;
        this.next();
        return this.finishNode(node, "Literal")

      case types.parenL:
        var start = this.start, expr = this.parseParenAndDistinguishExpression(canBeArrow);
        if (refDestructuringErrors) {
          if (refDestructuringErrors.parenthesizedAssign < 0 && !this.isSimpleAssignTarget(expr))
            { refDestructuringErrors.parenthesizedAssign = start; }
          if (refDestructuringErrors.parenthesizedBind < 0)
            { refDestructuringErrors.parenthesizedBind = start; }
        }
        return expr

      case types.bracketL:
        node = this.startNode();
        this.next();
        node.elements = this.parseExprList(types.bracketR, true, true, refDestructuringErrors);
        return this.finishNode(node, "ArrayExpression")

      case types.braceL:
        return this.parseObj(false, refDestructuringErrors)

      case types._function:
        node = this.startNode();
        this.next();
        return this.parseFunction(node, 0)

      case types._class:
        return this.parseClass(this.startNode(), false)

      case types._new:
        return this.parseNew()

      case types.backQuote:
        return this.parseTemplate()

      case types._import:
        if (this.options.ecmaVersion > 10) {
          return this.parseDynamicImport()
        } else {
          return this.unexpected()
        }

      default:
        this.unexpected();
      }
    };

    pp$3.parseDynamicImport = function() {
      var node = this.startNode();
      this.next();
      if (this.type !== types.parenL) {
        this.unexpected();
      }
      return this.finishNode(node, "Import")
    };

    pp$3.parseLiteral = function(value) {
      var node = this.startNode();
      node.value = value;
      node.raw = this.input.slice(this.start, this.end);
      if (node.raw.charCodeAt(node.raw.length - 1) === 110) { node.bigint = node.raw.slice(0, -1); }
      this.next();
      return this.finishNode(node, "Literal")
    };

    pp$3.parseParenExpression = function() {
      this.expect(types.parenL);
      var val = this.parseExpression();
      this.expect(types.parenR);
      return val
    };

    pp$3.parseParenAndDistinguishExpression = function(canBeArrow) {
      var startPos = this.start, startLoc = this.startLoc, val, allowTrailingComma = this.options.ecmaVersion >= 8;
      if (this.options.ecmaVersion >= 6) {
        this.next();

        var innerStartPos = this.start, innerStartLoc = this.startLoc;
        var exprList = [], first = true, lastIsComma = false;
        var refDestructuringErrors = new DestructuringErrors, oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, spreadStart;
        this.yieldPos = 0;
        this.awaitPos = 0;
        // Do not save awaitIdentPos to allow checking awaits nested in parameters
        while (this.type !== types.parenR) {
          first ? first = false : this.expect(types.comma);
          if (allowTrailingComma && this.afterTrailingComma(types.parenR, true)) {
            lastIsComma = true;
            break
          } else if (this.type === types.ellipsis) {
            spreadStart = this.start;
            exprList.push(this.parseParenItem(this.parseRestBinding()));
            if (this.type === types.comma) { this.raise(this.start, "Comma is not permitted after the rest element"); }
            break
          } else {
            exprList.push(this.parseMaybeAssign(false, refDestructuringErrors, this.parseParenItem));
          }
        }
        var innerEndPos = this.start, innerEndLoc = this.startLoc;
        this.expect(types.parenR);

        if (canBeArrow && !this.canInsertSemicolon() && this.eat(types.arrow)) {
          this.checkPatternErrors(refDestructuringErrors, false);
          this.checkYieldAwaitInDefaultParams();
          this.yieldPos = oldYieldPos;
          this.awaitPos = oldAwaitPos;
          return this.parseParenArrowList(startPos, startLoc, exprList)
        }

        if (!exprList.length || lastIsComma) { this.unexpected(this.lastTokStart); }
        if (spreadStart) { this.unexpected(spreadStart); }
        this.checkExpressionErrors(refDestructuringErrors, true);
        this.yieldPos = oldYieldPos || this.yieldPos;
        this.awaitPos = oldAwaitPos || this.awaitPos;

        if (exprList.length > 1) {
          val = this.startNodeAt(innerStartPos, innerStartLoc);
          val.expressions = exprList;
          this.finishNodeAt(val, "SequenceExpression", innerEndPos, innerEndLoc);
        } else {
          val = exprList[0];
        }
      } else {
        val = this.parseParenExpression();
      }

      if (this.options.preserveParens) {
        var par = this.startNodeAt(startPos, startLoc);
        par.expression = val;
        return this.finishNode(par, "ParenthesizedExpression")
      } else {
        return val
      }
    };

    pp$3.parseParenItem = function(item) {
      return item
    };

    pp$3.parseParenArrowList = function(startPos, startLoc, exprList) {
      return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), exprList)
    };

    // New's precedence is slightly tricky. It must allow its argument to
    // be a `[]` or dot subscript expression, but not a call — at least,
    // not without wrapping it in parentheses. Thus, it uses the noCalls
    // argument to parseSubscripts to prevent it from consuming the
    // argument list.

    var empty$1 = [];

    pp$3.parseNew = function() {
      var node = this.startNode();
      var meta = this.parseIdent(true);
      if (this.options.ecmaVersion >= 6 && this.eat(types.dot)) {
        node.meta = meta;
        var containsEsc = this.containsEsc;
        node.property = this.parseIdent(true);
        if (node.property.name !== "target" || containsEsc)
          { this.raiseRecoverable(node.property.start, "The only valid meta property for new is new.target"); }
        if (!this.inNonArrowFunction())
          { this.raiseRecoverable(node.start, "new.target can only be used in functions"); }
        return this.finishNode(node, "MetaProperty")
      }
      var startPos = this.start, startLoc = this.startLoc;
      node.callee = this.parseSubscripts(this.parseExprAtom(), startPos, startLoc, true);
      if (this.options.ecmaVersion > 10 && node.callee.type === "Import") {
        this.raise(node.callee.start, "Cannot use new with import(...)");
      }
      if (this.eat(types.parenL)) { node.arguments = this.parseExprList(types.parenR, this.options.ecmaVersion >= 8 && node.callee.type !== "Import", false); }
      else { node.arguments = empty$1; }
      return this.finishNode(node, "NewExpression")
    };

    // Parse template expression.

    pp$3.parseTemplateElement = function(ref) {
      var isTagged = ref.isTagged;

      var elem = this.startNode();
      if (this.type === types.invalidTemplate) {
        if (!isTagged) {
          this.raiseRecoverable(this.start, "Bad escape sequence in untagged template literal");
        }
        elem.value = {
          raw: this.value,
          cooked: null
        };
      } else {
        elem.value = {
          raw: this.input.slice(this.start, this.end).replace(/\r\n?/g, "\n"),
          cooked: this.value
        };
      }
      this.next();
      elem.tail = this.type === types.backQuote;
      return this.finishNode(elem, "TemplateElement")
    };

    pp$3.parseTemplate = function(ref) {
      if ( ref === void 0 ) ref = {};
      var isTagged = ref.isTagged; if ( isTagged === void 0 ) isTagged = false;

      var node = this.startNode();
      this.next();
      node.expressions = [];
      var curElt = this.parseTemplateElement({isTagged: isTagged});
      node.quasis = [curElt];
      while (!curElt.tail) {
        if (this.type === types.eof) { this.raise(this.pos, "Unterminated template literal"); }
        this.expect(types.dollarBraceL);
        node.expressions.push(this.parseExpression());
        this.expect(types.braceR);
        node.quasis.push(curElt = this.parseTemplateElement({isTagged: isTagged}));
      }
      this.next();
      return this.finishNode(node, "TemplateLiteral")
    };

    pp$3.isAsyncProp = function(prop) {
      return !prop.computed && prop.key.type === "Identifier" && prop.key.name === "async" &&
        (this.type === types.name || this.type === types.num || this.type === types.string || this.type === types.bracketL || this.type.keyword || (this.options.ecmaVersion >= 9 && this.type === types.star)) &&
        !lineBreak.test(this.input.slice(this.lastTokEnd, this.start))
    };

    // Parse an object literal or binding pattern.

    pp$3.parseObj = function(isPattern, refDestructuringErrors) {
      var node = this.startNode(), first = true, propHash = {};
      node.properties = [];
      this.next();
      while (!this.eat(types.braceR)) {
        if (!first) {
          this.expect(types.comma);
          if (this.afterTrailingComma(types.braceR)) { break }
        } else { first = false; }

        var prop = this.parseProperty(isPattern, refDestructuringErrors);
        if (!isPattern) { this.checkPropClash(prop, propHash, refDestructuringErrors); }
        node.properties.push(prop);
      }
      return this.finishNode(node, isPattern ? "ObjectPattern" : "ObjectExpression")
    };

    pp$3.parseProperty = function(isPattern, refDestructuringErrors) {
      var prop = this.startNode(), isGenerator, isAsync, startPos, startLoc;
      if (this.options.ecmaVersion >= 9 && this.eat(types.ellipsis)) {
        if (isPattern) {
          prop.argument = this.parseIdent(false);
          if (this.type === types.comma) {
            this.raise(this.start, "Comma is not permitted after the rest element");
          }
          return this.finishNode(prop, "RestElement")
        }
        // To disallow parenthesized identifier via `this.toAssignable()`.
        if (this.type === types.parenL && refDestructuringErrors) {
          if (refDestructuringErrors.parenthesizedAssign < 0) {
            refDestructuringErrors.parenthesizedAssign = this.start;
          }
          if (refDestructuringErrors.parenthesizedBind < 0) {
            refDestructuringErrors.parenthesizedBind = this.start;
          }
        }
        // Parse argument.
        prop.argument = this.parseMaybeAssign(false, refDestructuringErrors);
        // To disallow trailing comma via `this.toAssignable()`.
        if (this.type === types.comma && refDestructuringErrors && refDestructuringErrors.trailingComma < 0) {
          refDestructuringErrors.trailingComma = this.start;
        }
        // Finish
        return this.finishNode(prop, "SpreadElement")
      }
      if (this.options.ecmaVersion >= 6) {
        prop.method = false;
        prop.shorthand = false;
        if (isPattern || refDestructuringErrors) {
          startPos = this.start;
          startLoc = this.startLoc;
        }
        if (!isPattern)
          { isGenerator = this.eat(types.star); }
      }
      var containsEsc = this.containsEsc;
      this.parsePropertyName(prop);
      if (!isPattern && !containsEsc && this.options.ecmaVersion >= 8 && !isGenerator && this.isAsyncProp(prop)) {
        isAsync = true;
        isGenerator = this.options.ecmaVersion >= 9 && this.eat(types.star);
        this.parsePropertyName(prop, refDestructuringErrors);
      } else {
        isAsync = false;
      }
      this.parsePropertyValue(prop, isPattern, isGenerator, isAsync, startPos, startLoc, refDestructuringErrors, containsEsc);
      return this.finishNode(prop, "Property")
    };

    pp$3.parsePropertyValue = function(prop, isPattern, isGenerator, isAsync, startPos, startLoc, refDestructuringErrors, containsEsc) {
      if ((isGenerator || isAsync) && this.type === types.colon)
        { this.unexpected(); }

      if (this.eat(types.colon)) {
        prop.value = isPattern ? this.parseMaybeDefault(this.start, this.startLoc) : this.parseMaybeAssign(false, refDestructuringErrors);
        prop.kind = "init";
      } else if (this.options.ecmaVersion >= 6 && this.type === types.parenL) {
        if (isPattern) { this.unexpected(); }
        prop.kind = "init";
        prop.method = true;
        prop.value = this.parseMethod(isGenerator, isAsync);
      } else if (!isPattern && !containsEsc &&
                 this.options.ecmaVersion >= 5 && !prop.computed && prop.key.type === "Identifier" &&
                 (prop.key.name === "get" || prop.key.name === "set") &&
                 (this.type !== types.comma && this.type !== types.braceR)) {
        if (isGenerator || isAsync) { this.unexpected(); }
        prop.kind = prop.key.name;
        this.parsePropertyName(prop);
        prop.value = this.parseMethod(false);
        var paramCount = prop.kind === "get" ? 0 : 1;
        if (prop.value.params.length !== paramCount) {
          var start = prop.value.start;
          if (prop.kind === "get")
            { this.raiseRecoverable(start, "getter should have no params"); }
          else
            { this.raiseRecoverable(start, "setter should have exactly one param"); }
        } else {
          if (prop.kind === "set" && prop.value.params[0].type === "RestElement")
            { this.raiseRecoverable(prop.value.params[0].start, "Setter cannot use rest params"); }
        }
      } else if (this.options.ecmaVersion >= 6 && !prop.computed && prop.key.type === "Identifier") {
        if (isGenerator || isAsync) { this.unexpected(); }
        this.checkUnreserved(prop.key);
        if (prop.key.name === "await" && !this.awaitIdentPos)
          { this.awaitIdentPos = startPos; }
        prop.kind = "init";
        if (isPattern) {
          prop.value = this.parseMaybeDefault(startPos, startLoc, prop.key);
        } else if (this.type === types.eq && refDestructuringErrors) {
          if (refDestructuringErrors.shorthandAssign < 0)
            { refDestructuringErrors.shorthandAssign = this.start; }
          prop.value = this.parseMaybeDefault(startPos, startLoc, prop.key);
        } else {
          prop.value = prop.key;
        }
        prop.shorthand = true;
      } else { this.unexpected(); }
    };

    pp$3.parsePropertyName = function(prop) {
      if (this.options.ecmaVersion >= 6) {
        if (this.eat(types.bracketL)) {
          prop.computed = true;
          prop.key = this.parseMaybeAssign();
          this.expect(types.bracketR);
          return prop.key
        } else {
          prop.computed = false;
        }
      }
      return prop.key = this.type === types.num || this.type === types.string ? this.parseExprAtom() : this.parseIdent(this.options.allowReserved !== "never")
    };

    // Initialize empty function node.

    pp$3.initFunction = function(node) {
      node.id = null;
      if (this.options.ecmaVersion >= 6) { node.generator = node.expression = false; }
      if (this.options.ecmaVersion >= 8) { node.async = false; }
    };

    // Parse object or class method.

    pp$3.parseMethod = function(isGenerator, isAsync, allowDirectSuper) {
      var node = this.startNode(), oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;

      this.initFunction(node);
      if (this.options.ecmaVersion >= 6)
        { node.generator = isGenerator; }
      if (this.options.ecmaVersion >= 8)
        { node.async = !!isAsync; }

      this.yieldPos = 0;
      this.awaitPos = 0;
      this.awaitIdentPos = 0;
      this.enterScope(functionFlags(isAsync, node.generator) | SCOPE_SUPER | (allowDirectSuper ? SCOPE_DIRECT_SUPER : 0));

      this.expect(types.parenL);
      node.params = this.parseBindingList(types.parenR, false, this.options.ecmaVersion >= 8);
      this.checkYieldAwaitInDefaultParams();
      this.parseFunctionBody(node, false, true);

      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      this.awaitIdentPos = oldAwaitIdentPos;
      return this.finishNode(node, "FunctionExpression")
    };

    // Parse arrow function expression with given parameters.

    pp$3.parseArrowExpression = function(node, params, isAsync) {
      var oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;

      this.enterScope(functionFlags(isAsync, false) | SCOPE_ARROW);
      this.initFunction(node);
      if (this.options.ecmaVersion >= 8) { node.async = !!isAsync; }

      this.yieldPos = 0;
      this.awaitPos = 0;
      this.awaitIdentPos = 0;

      node.params = this.toAssignableList(params, true);
      this.parseFunctionBody(node, true, false);

      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      this.awaitIdentPos = oldAwaitIdentPos;
      return this.finishNode(node, "ArrowFunctionExpression")
    };

    // Parse function body and check parameters.

    pp$3.parseFunctionBody = function(node, isArrowFunction, isMethod) {
      var isExpression = isArrowFunction && this.type !== types.braceL;
      var oldStrict = this.strict, useStrict = false;

      if (isExpression) {
        node.body = this.parseMaybeAssign();
        node.expression = true;
        this.checkParams(node, false);
      } else {
        var nonSimple = this.options.ecmaVersion >= 7 && !this.isSimpleParamList(node.params);
        if (!oldStrict || nonSimple) {
          useStrict = this.strictDirective(this.end);
          // If this is a strict mode function, verify that argument names
          // are not repeated, and it does not try to bind the words `eval`
          // or `arguments`.
          if (useStrict && nonSimple)
            { this.raiseRecoverable(node.start, "Illegal 'use strict' directive in function with non-simple parameter list"); }
        }
        // Start a new scope with regard to labels and the `inFunction`
        // flag (restore them to their old value afterwards).
        var oldLabels = this.labels;
        this.labels = [];
        if (useStrict) { this.strict = true; }

        // Add the params to varDeclaredNames to ensure that an error is thrown
        // if a let/const declaration in the function clashes with one of the params.
        this.checkParams(node, !oldStrict && !useStrict && !isArrowFunction && !isMethod && this.isSimpleParamList(node.params));
        node.body = this.parseBlock(false);
        node.expression = false;
        this.adaptDirectivePrologue(node.body.body);
        this.labels = oldLabels;
      }
      this.exitScope();

      // Ensure the function name isn't a forbidden identifier in strict mode, e.g. 'eval'
      if (this.strict && node.id) { this.checkLVal(node.id, BIND_OUTSIDE); }
      this.strict = oldStrict;
    };

    pp$3.isSimpleParamList = function(params) {
      for (var i = 0, list = params; i < list.length; i += 1)
        {
        var param = list[i];

        if (param.type !== "Identifier") { return false
      } }
      return true
    };

    // Checks function params for various disallowed patterns such as using "eval"
    // or "arguments" and duplicate parameters.

    pp$3.checkParams = function(node, allowDuplicates) {
      var nameHash = {};
      for (var i = 0, list = node.params; i < list.length; i += 1)
        {
        var param = list[i];

        this.checkLVal(param, BIND_VAR, allowDuplicates ? null : nameHash);
      }
    };

    // Parses a comma-separated list of expressions, and returns them as
    // an array. `close` is the token type that ends the list, and
    // `allowEmpty` can be turned on to allow subsequent commas with
    // nothing in between them to be parsed as `null` (which is needed
    // for array literals).

    pp$3.parseExprList = function(close, allowTrailingComma, allowEmpty, refDestructuringErrors) {
      var elts = [], first = true;
      while (!this.eat(close)) {
        if (!first) {
          this.expect(types.comma);
          if (allowTrailingComma && this.afterTrailingComma(close)) { break }
        } else { first = false; }

        var elt = (void 0);
        if (allowEmpty && this.type === types.comma)
          { elt = null; }
        else if (this.type === types.ellipsis) {
          elt = this.parseSpread(refDestructuringErrors);
          if (refDestructuringErrors && this.type === types.comma && refDestructuringErrors.trailingComma < 0)
            { refDestructuringErrors.trailingComma = this.start; }
        } else {
          elt = this.parseMaybeAssign(false, refDestructuringErrors);
        }
        elts.push(elt);
      }
      return elts
    };

    pp$3.checkUnreserved = function(ref) {
      var start = ref.start;
      var end = ref.end;
      var name = ref.name;

      if (this.inGenerator && name === "yield")
        { this.raiseRecoverable(start, "Cannot use 'yield' as identifier inside a generator"); }
      if (this.inAsync && name === "await")
        { this.raiseRecoverable(start, "Cannot use 'await' as identifier inside an async function"); }
      if (this.keywords.test(name))
        { this.raise(start, ("Unexpected keyword '" + name + "'")); }
      if (this.options.ecmaVersion < 6 &&
        this.input.slice(start, end).indexOf("\\") !== -1) { return }
      var re = this.strict ? this.reservedWordsStrict : this.reservedWords;
      if (re.test(name)) {
        if (!this.inAsync && name === "await")
          { this.raiseRecoverable(start, "Cannot use keyword 'await' outside an async function"); }
        this.raiseRecoverable(start, ("The keyword '" + name + "' is reserved"));
      }
    };

    // Parse the next token as an identifier. If `liberal` is true (used
    // when parsing properties), it will also convert keywords into
    // identifiers.

    pp$3.parseIdent = function(liberal, isBinding) {
      var node = this.startNode();
      if (this.type === types.name) {
        node.name = this.value;
      } else if (this.type.keyword) {
        node.name = this.type.keyword;

        // To fix https://github.com/acornjs/acorn/issues/575
        // `class` and `function` keywords push new context into this.context.
        // But there is no chance to pop the context if the keyword is consumed as an identifier such as a property name.
        // If the previous token is a dot, this does not apply because the context-managing code already ignored the keyword
        if ((node.name === "class" || node.name === "function") &&
            (this.lastTokEnd !== this.lastTokStart + 1 || this.input.charCodeAt(this.lastTokStart) !== 46)) {
          this.context.pop();
        }
      } else {
        this.unexpected();
      }
      this.next();
      this.finishNode(node, "Identifier");
      if (!liberal) {
        this.checkUnreserved(node);
        if (node.name === "await" && !this.awaitIdentPos)
          { this.awaitIdentPos = node.start; }
      }
      return node
    };

    // Parses yield expression inside generator.

    pp$3.parseYield = function(noIn) {
      if (!this.yieldPos) { this.yieldPos = this.start; }

      var node = this.startNode();
      this.next();
      if (this.type === types.semi || this.canInsertSemicolon() || (this.type !== types.star && !this.type.startsExpr)) {
        node.delegate = false;
        node.argument = null;
      } else {
        node.delegate = this.eat(types.star);
        node.argument = this.parseMaybeAssign(noIn);
      }
      return this.finishNode(node, "YieldExpression")
    };

    pp$3.parseAwait = function() {
      if (!this.awaitPos) { this.awaitPos = this.start; }

      var node = this.startNode();
      this.next();
      node.argument = this.parseMaybeUnary(null, true);
      return this.finishNode(node, "AwaitExpression")
    };

    var pp$4 = Parser.prototype;

    // This function is used to raise exceptions on parse errors. It
    // takes an offset integer (into the current `input`) to indicate
    // the location of the error, attaches the position to the end
    // of the error message, and then raises a `SyntaxError` with that
    // message.

    pp$4.raise = function(pos, message) {
      var loc = getLineInfo(this.input, pos);
      message += " (" + loc.line + ":" + loc.column + ")";
      var err = new SyntaxError(message);
      err.pos = pos; err.loc = loc; err.raisedAt = this.pos;
      throw err
    };

    pp$4.raiseRecoverable = pp$4.raise;

    pp$4.curPosition = function() {
      if (this.options.locations) {
        return new Position(this.curLine, this.pos - this.lineStart)
      }
    };

    var pp$5 = Parser.prototype;

    var Scope = function Scope(flags) {
      this.flags = flags;
      // A list of var-declared names in the current lexical scope
      this.var = [];
      // A list of lexically-declared names in the current lexical scope
      this.lexical = [];
      // A list of lexically-declared FunctionDeclaration names in the current lexical scope
      this.functions = [];
    };

    // The functions in this module keep track of declared variables in the current scope in order to detect duplicate variable names.

    pp$5.enterScope = function(flags) {
      this.scopeStack.push(new Scope(flags));
    };

    pp$5.exitScope = function() {
      this.scopeStack.pop();
    };

    // The spec says:
    // > At the top level of a function, or script, function declarations are
    // > treated like var declarations rather than like lexical declarations.
    pp$5.treatFunctionsAsVarInScope = function(scope) {
      return (scope.flags & SCOPE_FUNCTION) || !this.inModule && (scope.flags & SCOPE_TOP)
    };

    pp$5.declareName = function(name, bindingType, pos) {
      var redeclared = false;
      if (bindingType === BIND_LEXICAL) {
        var scope = this.currentScope();
        redeclared = scope.lexical.indexOf(name) > -1 || scope.functions.indexOf(name) > -1 || scope.var.indexOf(name) > -1;
        scope.lexical.push(name);
        if (this.inModule && (scope.flags & SCOPE_TOP))
          { delete this.undefinedExports[name]; }
      } else if (bindingType === BIND_SIMPLE_CATCH) {
        var scope$1 = this.currentScope();
        scope$1.lexical.push(name);
      } else if (bindingType === BIND_FUNCTION) {
        var scope$2 = this.currentScope();
        if (this.treatFunctionsAsVar)
          { redeclared = scope$2.lexical.indexOf(name) > -1; }
        else
          { redeclared = scope$2.lexical.indexOf(name) > -1 || scope$2.var.indexOf(name) > -1; }
        scope$2.functions.push(name);
      } else {
        for (var i = this.scopeStack.length - 1; i >= 0; --i) {
          var scope$3 = this.scopeStack[i];
          if (scope$3.lexical.indexOf(name) > -1 && !((scope$3.flags & SCOPE_SIMPLE_CATCH) && scope$3.lexical[0] === name) ||
              !this.treatFunctionsAsVarInScope(scope$3) && scope$3.functions.indexOf(name) > -1) {
            redeclared = true;
            break
          }
          scope$3.var.push(name);
          if (this.inModule && (scope$3.flags & SCOPE_TOP))
            { delete this.undefinedExports[name]; }
          if (scope$3.flags & SCOPE_VAR) { break }
        }
      }
      if (redeclared) { this.raiseRecoverable(pos, ("Identifier '" + name + "' has already been declared")); }
    };

    pp$5.checkLocalExport = function(id) {
      // scope.functions must be empty as Module code is always strict.
      if (this.scopeStack[0].lexical.indexOf(id.name) === -1 &&
          this.scopeStack[0].var.indexOf(id.name) === -1) {
        this.undefinedExports[id.name] = id;
      }
    };

    pp$5.currentScope = function() {
      return this.scopeStack[this.scopeStack.length - 1]
    };

    pp$5.currentVarScope = function() {
      for (var i = this.scopeStack.length - 1;; i--) {
        var scope = this.scopeStack[i];
        if (scope.flags & SCOPE_VAR) { return scope }
      }
    };

    // Could be useful for `this`, `new.target`, `super()`, `super.property`, and `super[property]`.
    pp$5.currentThisScope = function() {
      for (var i = this.scopeStack.length - 1;; i--) {
        var scope = this.scopeStack[i];
        if (scope.flags & SCOPE_VAR && !(scope.flags & SCOPE_ARROW)) { return scope }
      }
    };

    var Node = function Node(parser, pos, loc) {
      this.type = "";
      this.start = pos;
      this.end = 0;
      if (parser.options.locations)
        { this.loc = new SourceLocation(parser, loc); }
      if (parser.options.directSourceFile)
        { this.sourceFile = parser.options.directSourceFile; }
      if (parser.options.ranges)
        { this.range = [pos, 0]; }
    };

    // Start an AST node, attaching a start offset.

    var pp$6 = Parser.prototype;

    pp$6.startNode = function() {
      return new Node(this, this.start, this.startLoc)
    };

    pp$6.startNodeAt = function(pos, loc) {
      return new Node(this, pos, loc)
    };

    // Finish an AST node, adding `type` and `end` properties.

    function finishNodeAt(node, type, pos, loc) {
      node.type = type;
      node.end = pos;
      if (this.options.locations)
        { node.loc.end = loc; }
      if (this.options.ranges)
        { node.range[1] = pos; }
      return node
    }

    pp$6.finishNode = function(node, type) {
      return finishNodeAt.call(this, node, type, this.lastTokEnd, this.lastTokEndLoc)
    };

    // Finish node at given position

    pp$6.finishNodeAt = function(node, type, pos, loc) {
      return finishNodeAt.call(this, node, type, pos, loc)
    };

    // The algorithm used to determine whether a regexp can appear at a

    var TokContext = function TokContext(token, isExpr, preserveSpace, override, generator) {
      this.token = token;
      this.isExpr = !!isExpr;
      this.preserveSpace = !!preserveSpace;
      this.override = override;
      this.generator = !!generator;
    };

    var types$1 = {
      b_stat: new TokContext("{", false),
      b_expr: new TokContext("{", true),
      b_tmpl: new TokContext("${", false),
      p_stat: new TokContext("(", false),
      p_expr: new TokContext("(", true),
      q_tmpl: new TokContext("`", true, true, function (p) { return p.tryReadTemplateToken(); }),
      f_stat: new TokContext("function", false),
      f_expr: new TokContext("function", true),
      f_expr_gen: new TokContext("function", true, false, null, true),
      f_gen: new TokContext("function", false, false, null, true)
    };

    var pp$7 = Parser.prototype;

    pp$7.initialContext = function() {
      return [types$1.b_stat]
    };

    pp$7.braceIsBlock = function(prevType) {
      var parent = this.curContext();
      if (parent === types$1.f_expr || parent === types$1.f_stat)
        { return true }
      if (prevType === types.colon && (parent === types$1.b_stat || parent === types$1.b_expr))
        { return !parent.isExpr }

      // The check for `tt.name && exprAllowed` detects whether we are
      // after a `yield` or `of` construct. See the `updateContext` for
      // `tt.name`.
      if (prevType === types._return || prevType === types.name && this.exprAllowed)
        { return lineBreak.test(this.input.slice(this.lastTokEnd, this.start)) }
      if (prevType === types._else || prevType === types.semi || prevType === types.eof || prevType === types.parenR || prevType === types.arrow)
        { return true }
      if (prevType === types.braceL)
        { return parent === types$1.b_stat }
      if (prevType === types._var || prevType === types._const || prevType === types.name)
        { return false }
      return !this.exprAllowed
    };

    pp$7.inGeneratorContext = function() {
      for (var i = this.context.length - 1; i >= 1; i--) {
        var context = this.context[i];
        if (context.token === "function")
          { return context.generator }
      }
      return false
    };

    pp$7.updateContext = function(prevType) {
      var update, type = this.type;
      if (type.keyword && prevType === types.dot)
        { this.exprAllowed = false; }
      else if (update = type.updateContext)
        { update.call(this, prevType); }
      else
        { this.exprAllowed = type.beforeExpr; }
    };

    // Token-specific context update code

    types.parenR.updateContext = types.braceR.updateContext = function() {
      if (this.context.length === 1) {
        this.exprAllowed = true;
        return
      }
      var out = this.context.pop();
      if (out === types$1.b_stat && this.curContext().token === "function") {
        out = this.context.pop();
      }
      this.exprAllowed = !out.isExpr;
    };

    types.braceL.updateContext = function(prevType) {
      this.context.push(this.braceIsBlock(prevType) ? types$1.b_stat : types$1.b_expr);
      this.exprAllowed = true;
    };

    types.dollarBraceL.updateContext = function() {
      this.context.push(types$1.b_tmpl);
      this.exprAllowed = true;
    };

    types.parenL.updateContext = function(prevType) {
      var statementParens = prevType === types._if || prevType === types._for || prevType === types._with || prevType === types._while;
      this.context.push(statementParens ? types$1.p_stat : types$1.p_expr);
      this.exprAllowed = true;
    };

    types.incDec.updateContext = function() {
      // tokExprAllowed stays unchanged
    };

    types._function.updateContext = types._class.updateContext = function(prevType) {
      if (prevType.beforeExpr && prevType !== types.semi && prevType !== types._else &&
          !(prevType === types._return && lineBreak.test(this.input.slice(this.lastTokEnd, this.start))) &&
          !((prevType === types.colon || prevType === types.braceL) && this.curContext() === types$1.b_stat))
        { this.context.push(types$1.f_expr); }
      else
        { this.context.push(types$1.f_stat); }
      this.exprAllowed = false;
    };

    types.backQuote.updateContext = function() {
      if (this.curContext() === types$1.q_tmpl)
        { this.context.pop(); }
      else
        { this.context.push(types$1.q_tmpl); }
      this.exprAllowed = false;
    };

    types.star.updateContext = function(prevType) {
      if (prevType === types._function) {
        var index = this.context.length - 1;
        if (this.context[index] === types$1.f_expr)
          { this.context[index] = types$1.f_expr_gen; }
        else
          { this.context[index] = types$1.f_gen; }
      }
      this.exprAllowed = true;
    };

    types.name.updateContext = function(prevType) {
      var allowed = false;
      if (this.options.ecmaVersion >= 6 && prevType !== types.dot) {
        if (this.value === "of" && !this.exprAllowed ||
            this.value === "yield" && this.inGeneratorContext())
          { allowed = true; }
      }
      this.exprAllowed = allowed;
    };

    // This file contains Unicode properties extracted from the ECMAScript
    // specification. The lists are extracted like so:
    // $$('#table-binary-unicode-properties > figure > table > tbody > tr > td:nth-child(1) code').map(el => el.innerText)

    // #table-binary-unicode-properties
    var ecma9BinaryProperties = "ASCII ASCII_Hex_Digit AHex Alphabetic Alpha Any Assigned Bidi_Control Bidi_C Bidi_Mirrored Bidi_M Case_Ignorable CI Cased Changes_When_Casefolded CWCF Changes_When_Casemapped CWCM Changes_When_Lowercased CWL Changes_When_NFKC_Casefolded CWKCF Changes_When_Titlecased CWT Changes_When_Uppercased CWU Dash Default_Ignorable_Code_Point DI Deprecated Dep Diacritic Dia Emoji Emoji_Component Emoji_Modifier Emoji_Modifier_Base Emoji_Presentation Extender Ext Grapheme_Base Gr_Base Grapheme_Extend Gr_Ext Hex_Digit Hex IDS_Binary_Operator IDSB IDS_Trinary_Operator IDST ID_Continue IDC ID_Start IDS Ideographic Ideo Join_Control Join_C Logical_Order_Exception LOE Lowercase Lower Math Noncharacter_Code_Point NChar Pattern_Syntax Pat_Syn Pattern_White_Space Pat_WS Quotation_Mark QMark Radical Regional_Indicator RI Sentence_Terminal STerm Soft_Dotted SD Terminal_Punctuation Term Unified_Ideograph UIdeo Uppercase Upper Variation_Selector VS White_Space space XID_Continue XIDC XID_Start XIDS";
    var ecma10BinaryProperties = ecma9BinaryProperties + " Extended_Pictographic";
    var ecma11BinaryProperties = ecma10BinaryProperties;
    var unicodeBinaryProperties = {
      9: ecma9BinaryProperties,
      10: ecma10BinaryProperties,
      11: ecma11BinaryProperties
    };

    // #table-unicode-general-category-values
    var unicodeGeneralCategoryValues = "Cased_Letter LC Close_Punctuation Pe Connector_Punctuation Pc Control Cc cntrl Currency_Symbol Sc Dash_Punctuation Pd Decimal_Number Nd digit Enclosing_Mark Me Final_Punctuation Pf Format Cf Initial_Punctuation Pi Letter L Letter_Number Nl Line_Separator Zl Lowercase_Letter Ll Mark M Combining_Mark Math_Symbol Sm Modifier_Letter Lm Modifier_Symbol Sk Nonspacing_Mark Mn Number N Open_Punctuation Ps Other C Other_Letter Lo Other_Number No Other_Punctuation Po Other_Symbol So Paragraph_Separator Zp Private_Use Co Punctuation P punct Separator Z Space_Separator Zs Spacing_Mark Mc Surrogate Cs Symbol S Titlecase_Letter Lt Unassigned Cn Uppercase_Letter Lu";

    // #table-unicode-script-values
    var ecma9ScriptValues = "Adlam Adlm Ahom Ahom Anatolian_Hieroglyphs Hluw Arabic Arab Armenian Armn Avestan Avst Balinese Bali Bamum Bamu Bassa_Vah Bass Batak Batk Bengali Beng Bhaiksuki Bhks Bopomofo Bopo Brahmi Brah Braille Brai Buginese Bugi Buhid Buhd Canadian_Aboriginal Cans Carian Cari Caucasian_Albanian Aghb Chakma Cakm Cham Cham Cherokee Cher Common Zyyy Coptic Copt Qaac Cuneiform Xsux Cypriot Cprt Cyrillic Cyrl Deseret Dsrt Devanagari Deva Duployan Dupl Egyptian_Hieroglyphs Egyp Elbasan Elba Ethiopic Ethi Georgian Geor Glagolitic Glag Gothic Goth Grantha Gran Greek Grek Gujarati Gujr Gurmukhi Guru Han Hani Hangul Hang Hanunoo Hano Hatran Hatr Hebrew Hebr Hiragana Hira Imperial_Aramaic Armi Inherited Zinh Qaai Inscriptional_Pahlavi Phli Inscriptional_Parthian Prti Javanese Java Kaithi Kthi Kannada Knda Katakana Kana Kayah_Li Kali Kharoshthi Khar Khmer Khmr Khojki Khoj Khudawadi Sind Lao Laoo Latin Latn Lepcha Lepc Limbu Limb Linear_A Lina Linear_B Linb Lisu Lisu Lycian Lyci Lydian Lydi Mahajani Mahj Malayalam Mlym Mandaic Mand Manichaean Mani Marchen Marc Masaram_Gondi Gonm Meetei_Mayek Mtei Mende_Kikakui Mend Meroitic_Cursive Merc Meroitic_Hieroglyphs Mero Miao Plrd Modi Modi Mongolian Mong Mro Mroo Multani Mult Myanmar Mymr Nabataean Nbat New_Tai_Lue Talu Newa Newa Nko Nkoo Nushu Nshu Ogham Ogam Ol_Chiki Olck Old_Hungarian Hung Old_Italic Ital Old_North_Arabian Narb Old_Permic Perm Old_Persian Xpeo Old_South_Arabian Sarb Old_Turkic Orkh Oriya Orya Osage Osge Osmanya Osma Pahawh_Hmong Hmng Palmyrene Palm Pau_Cin_Hau Pauc Phags_Pa Phag Phoenician Phnx Psalter_Pahlavi Phlp Rejang Rjng Runic Runr Samaritan Samr Saurashtra Saur Sharada Shrd Shavian Shaw Siddham Sidd SignWriting Sgnw Sinhala Sinh Sora_Sompeng Sora Soyombo Soyo Sundanese Sund Syloti_Nagri Sylo Syriac Syrc Tagalog Tglg Tagbanwa Tagb Tai_Le Tale Tai_Tham Lana Tai_Viet Tavt Takri Takr Tamil Taml Tangut Tang Telugu Telu Thaana Thaa Thai Thai Tibetan Tibt Tifinagh Tfng Tirhuta Tirh Ugaritic Ugar Vai Vaii Warang_Citi Wara Yi Yiii Zanabazar_Square Zanb";
    var ecma10ScriptValues = ecma9ScriptValues + " Dogra Dogr Gunjala_Gondi Gong Hanifi_Rohingya Rohg Makasar Maka Medefaidrin Medf Old_Sogdian Sogo Sogdian Sogd";
    var ecma11ScriptValues = ecma10ScriptValues + " Elymaic Elym Nandinagari Nand Nyiakeng_Puachue_Hmong Hmnp Wancho Wcho";
    var unicodeScriptValues = {
      9: ecma9ScriptValues,
      10: ecma10ScriptValues,
      11: ecma11ScriptValues
    };

    var data = {};
    function buildUnicodeData(ecmaVersion) {
      var d = data[ecmaVersion] = {
        binary: wordsRegexp(unicodeBinaryProperties[ecmaVersion] + " " + unicodeGeneralCategoryValues),
        nonBinary: {
          General_Category: wordsRegexp(unicodeGeneralCategoryValues),
          Script: wordsRegexp(unicodeScriptValues[ecmaVersion])
        }
      };
      d.nonBinary.Script_Extensions = d.nonBinary.Script;

      d.nonBinary.gc = d.nonBinary.General_Category;
      d.nonBinary.sc = d.nonBinary.Script;
      d.nonBinary.scx = d.nonBinary.Script_Extensions;
    }
    buildUnicodeData(9);
    buildUnicodeData(10);
    buildUnicodeData(11);

    var pp$8 = Parser.prototype;

    var RegExpValidationState = function RegExpValidationState(parser) {
      this.parser = parser;
      this.validFlags = "gim" + (parser.options.ecmaVersion >= 6 ? "uy" : "") + (parser.options.ecmaVersion >= 9 ? "s" : "");
      this.unicodeProperties = data[parser.options.ecmaVersion >= 11 ? 11 : parser.options.ecmaVersion];
      this.source = "";
      this.flags = "";
      this.start = 0;
      this.switchU = false;
      this.switchN = false;
      this.pos = 0;
      this.lastIntValue = 0;
      this.lastStringValue = "";
      this.lastAssertionIsQuantifiable = false;
      this.numCapturingParens = 0;
      this.maxBackReference = 0;
      this.groupNames = [];
      this.backReferenceNames = [];
    };

    RegExpValidationState.prototype.reset = function reset (start, pattern, flags) {
      var unicode = flags.indexOf("u") !== -1;
      this.start = start | 0;
      this.source = pattern + "";
      this.flags = flags;
      this.switchU = unicode && this.parser.options.ecmaVersion >= 6;
      this.switchN = unicode && this.parser.options.ecmaVersion >= 9;
    };

    RegExpValidationState.prototype.raise = function raise (message) {
      this.parser.raiseRecoverable(this.start, ("Invalid regular expression: /" + (this.source) + "/: " + message));
    };

    // If u flag is given, this returns the code point at the index (it combines a surrogate pair).
    // Otherwise, this returns the code unit of the index (can be a part of a surrogate pair).
    RegExpValidationState.prototype.at = function at (i) {
      var s = this.source;
      var l = s.length;
      if (i >= l) {
        return -1
      }
      var c = s.charCodeAt(i);
      if (!this.switchU || c <= 0xD7FF || c >= 0xE000 || i + 1 >= l) {
        return c
      }
      var next = s.charCodeAt(i + 1);
      return next >= 0xDC00 && next <= 0xDFFF ? (c << 10) + next - 0x35FDC00 : c
    };

    RegExpValidationState.prototype.nextIndex = function nextIndex (i) {
      var s = this.source;
      var l = s.length;
      if (i >= l) {
        return l
      }
      var c = s.charCodeAt(i), next;
      if (!this.switchU || c <= 0xD7FF || c >= 0xE000 || i + 1 >= l ||
          (next = s.charCodeAt(i + 1)) < 0xDC00 || next > 0xDFFF) {
        return i + 1
      }
      return i + 2
    };

    RegExpValidationState.prototype.current = function current () {
      return this.at(this.pos)
    };

    RegExpValidationState.prototype.lookahead = function lookahead () {
      return this.at(this.nextIndex(this.pos))
    };

    RegExpValidationState.prototype.advance = function advance () {
      this.pos = this.nextIndex(this.pos);
    };

    RegExpValidationState.prototype.eat = function eat (ch) {
      if (this.current() === ch) {
        this.advance();
        return true
      }
      return false
    };

    function codePointToString(ch) {
      if (ch <= 0xFFFF) { return String.fromCharCode(ch) }
      ch -= 0x10000;
      return String.fromCharCode((ch >> 10) + 0xD800, (ch & 0x03FF) + 0xDC00)
    }

    /**
     * Validate the flags part of a given RegExpLiteral.
     *
     * @param {RegExpValidationState} state The state to validate RegExp.
     * @returns {void}
     */
    pp$8.validateRegExpFlags = function(state) {
      var validFlags = state.validFlags;
      var flags = state.flags;

      for (var i = 0; i < flags.length; i++) {
        var flag = flags.charAt(i);
        if (validFlags.indexOf(flag) === -1) {
          this.raise(state.start, "Invalid regular expression flag");
        }
        if (flags.indexOf(flag, i + 1) > -1) {
          this.raise(state.start, "Duplicate regular expression flag");
        }
      }
    };

    /**
     * Validate the pattern part of a given RegExpLiteral.
     *
     * @param {RegExpValidationState} state The state to validate RegExp.
     * @returns {void}
     */
    pp$8.validateRegExpPattern = function(state) {
      this.regexp_pattern(state);

      // The goal symbol for the parse is |Pattern[~U, ~N]|. If the result of
      // parsing contains a |GroupName|, reparse with the goal symbol
      // |Pattern[~U, +N]| and use this result instead. Throw a *SyntaxError*
      // exception if _P_ did not conform to the grammar, if any elements of _P_
      // were not matched by the parse, or if any Early Error conditions exist.
      if (!state.switchN && this.options.ecmaVersion >= 9 && state.groupNames.length > 0) {
        state.switchN = true;
        this.regexp_pattern(state);
      }
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-Pattern
    pp$8.regexp_pattern = function(state) {
      state.pos = 0;
      state.lastIntValue = 0;
      state.lastStringValue = "";
      state.lastAssertionIsQuantifiable = false;
      state.numCapturingParens = 0;
      state.maxBackReference = 0;
      state.groupNames.length = 0;
      state.backReferenceNames.length = 0;

      this.regexp_disjunction(state);

      if (state.pos !== state.source.length) {
        // Make the same messages as V8.
        if (state.eat(0x29 /* ) */)) {
          state.raise("Unmatched ')'");
        }
        if (state.eat(0x5D /* [ */) || state.eat(0x7D /* } */)) {
          state.raise("Lone quantifier brackets");
        }
      }
      if (state.maxBackReference > state.numCapturingParens) {
        state.raise("Invalid escape");
      }
      for (var i = 0, list = state.backReferenceNames; i < list.length; i += 1) {
        var name = list[i];

        if (state.groupNames.indexOf(name) === -1) {
          state.raise("Invalid named capture referenced");
        }
      }
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-Disjunction
    pp$8.regexp_disjunction = function(state) {
      this.regexp_alternative(state);
      while (state.eat(0x7C /* | */)) {
        this.regexp_alternative(state);
      }

      // Make the same message as V8.
      if (this.regexp_eatQuantifier(state, true)) {
        state.raise("Nothing to repeat");
      }
      if (state.eat(0x7B /* { */)) {
        state.raise("Lone quantifier brackets");
      }
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-Alternative
    pp$8.regexp_alternative = function(state) {
      while (state.pos < state.source.length && this.regexp_eatTerm(state))
        { }
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-Term
    pp$8.regexp_eatTerm = function(state) {
      if (this.regexp_eatAssertion(state)) {
        // Handle `QuantifiableAssertion Quantifier` alternative.
        // `state.lastAssertionIsQuantifiable` is true if the last eaten Assertion
        // is a QuantifiableAssertion.
        if (state.lastAssertionIsQuantifiable && this.regexp_eatQuantifier(state)) {
          // Make the same message as V8.
          if (state.switchU) {
            state.raise("Invalid quantifier");
          }
        }
        return true
      }

      if (state.switchU ? this.regexp_eatAtom(state) : this.regexp_eatExtendedAtom(state)) {
        this.regexp_eatQuantifier(state);
        return true
      }

      return false
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-Assertion
    pp$8.regexp_eatAssertion = function(state) {
      var start = state.pos;
      state.lastAssertionIsQuantifiable = false;

      // ^, $
      if (state.eat(0x5E /* ^ */) || state.eat(0x24 /* $ */)) {
        return true
      }

      // \b \B
      if (state.eat(0x5C /* \ */)) {
        if (state.eat(0x42 /* B */) || state.eat(0x62 /* b */)) {
          return true
        }
        state.pos = start;
      }

      // Lookahead / Lookbehind
      if (state.eat(0x28 /* ( */) && state.eat(0x3F /* ? */)) {
        var lookbehind = false;
        if (this.options.ecmaVersion >= 9) {
          lookbehind = state.eat(0x3C /* < */);
        }
        if (state.eat(0x3D /* = */) || state.eat(0x21 /* ! */)) {
          this.regexp_disjunction(state);
          if (!state.eat(0x29 /* ) */)) {
            state.raise("Unterminated group");
          }
          state.lastAssertionIsQuantifiable = !lookbehind;
          return true
        }
      }

      state.pos = start;
      return false
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-Quantifier
    pp$8.regexp_eatQuantifier = function(state, noError) {
      if ( noError === void 0 ) noError = false;

      if (this.regexp_eatQuantifierPrefix(state, noError)) {
        state.eat(0x3F /* ? */);
        return true
      }
      return false
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-QuantifierPrefix
    pp$8.regexp_eatQuantifierPrefix = function(state, noError) {
      return (
        state.eat(0x2A /* * */) ||
        state.eat(0x2B /* + */) ||
        state.eat(0x3F /* ? */) ||
        this.regexp_eatBracedQuantifier(state, noError)
      )
    };
    pp$8.regexp_eatBracedQuantifier = function(state, noError) {
      var start = state.pos;
      if (state.eat(0x7B /* { */)) {
        var min = 0, max = -1;
        if (this.regexp_eatDecimalDigits(state)) {
          min = state.lastIntValue;
          if (state.eat(0x2C /* , */) && this.regexp_eatDecimalDigits(state)) {
            max = state.lastIntValue;
          }
          if (state.eat(0x7D /* } */)) {
            // SyntaxError in https://www.ecma-international.org/ecma-262/8.0/#sec-term
            if (max !== -1 && max < min && !noError) {
              state.raise("numbers out of order in {} quantifier");
            }
            return true
          }
        }
        if (state.switchU && !noError) {
          state.raise("Incomplete quantifier");
        }
        state.pos = start;
      }
      return false
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-Atom
    pp$8.regexp_eatAtom = function(state) {
      return (
        this.regexp_eatPatternCharacters(state) ||
        state.eat(0x2E /* . */) ||
        this.regexp_eatReverseSolidusAtomEscape(state) ||
        this.regexp_eatCharacterClass(state) ||
        this.regexp_eatUncapturingGroup(state) ||
        this.regexp_eatCapturingGroup(state)
      )
    };
    pp$8.regexp_eatReverseSolidusAtomEscape = function(state) {
      var start = state.pos;
      if (state.eat(0x5C /* \ */)) {
        if (this.regexp_eatAtomEscape(state)) {
          return true
        }
        state.pos = start;
      }
      return false
    };
    pp$8.regexp_eatUncapturingGroup = function(state) {
      var start = state.pos;
      if (state.eat(0x28 /* ( */)) {
        if (state.eat(0x3F /* ? */) && state.eat(0x3A /* : */)) {
          this.regexp_disjunction(state);
          if (state.eat(0x29 /* ) */)) {
            return true
          }
          state.raise("Unterminated group");
        }
        state.pos = start;
      }
      return false
    };
    pp$8.regexp_eatCapturingGroup = function(state) {
      if (state.eat(0x28 /* ( */)) {
        if (this.options.ecmaVersion >= 9) {
          this.regexp_groupSpecifier(state);
        } else if (state.current() === 0x3F /* ? */) {
          state.raise("Invalid group");
        }
        this.regexp_disjunction(state);
        if (state.eat(0x29 /* ) */)) {
          state.numCapturingParens += 1;
          return true
        }
        state.raise("Unterminated group");
      }
      return false
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-ExtendedAtom
    pp$8.regexp_eatExtendedAtom = function(state) {
      return (
        state.eat(0x2E /* . */) ||
        this.regexp_eatReverseSolidusAtomEscape(state) ||
        this.regexp_eatCharacterClass(state) ||
        this.regexp_eatUncapturingGroup(state) ||
        this.regexp_eatCapturingGroup(state) ||
        this.regexp_eatInvalidBracedQuantifier(state) ||
        this.regexp_eatExtendedPatternCharacter(state)
      )
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-InvalidBracedQuantifier
    pp$8.regexp_eatInvalidBracedQuantifier = function(state) {
      if (this.regexp_eatBracedQuantifier(state, true)) {
        state.raise("Nothing to repeat");
      }
      return false
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-SyntaxCharacter
    pp$8.regexp_eatSyntaxCharacter = function(state) {
      var ch = state.current();
      if (isSyntaxCharacter(ch)) {
        state.lastIntValue = ch;
        state.advance();
        return true
      }
      return false
    };
    function isSyntaxCharacter(ch) {
      return (
        ch === 0x24 /* $ */ ||
        ch >= 0x28 /* ( */ && ch <= 0x2B /* + */ ||
        ch === 0x2E /* . */ ||
        ch === 0x3F /* ? */ ||
        ch >= 0x5B /* [ */ && ch <= 0x5E /* ^ */ ||
        ch >= 0x7B /* { */ && ch <= 0x7D /* } */
      )
    }

    // https://www.ecma-international.org/ecma-262/8.0/#prod-PatternCharacter
    // But eat eager.
    pp$8.regexp_eatPatternCharacters = function(state) {
      var start = state.pos;
      var ch = 0;
      while ((ch = state.current()) !== -1 && !isSyntaxCharacter(ch)) {
        state.advance();
      }
      return state.pos !== start
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-ExtendedPatternCharacter
    pp$8.regexp_eatExtendedPatternCharacter = function(state) {
      var ch = state.current();
      if (
        ch !== -1 &&
        ch !== 0x24 /* $ */ &&
        !(ch >= 0x28 /* ( */ && ch <= 0x2B /* + */) &&
        ch !== 0x2E /* . */ &&
        ch !== 0x3F /* ? */ &&
        ch !== 0x5B /* [ */ &&
        ch !== 0x5E /* ^ */ &&
        ch !== 0x7C /* | */
      ) {
        state.advance();
        return true
      }
      return false
    };

    // GroupSpecifier[U] ::
    //   [empty]
    //   `?` GroupName[?U]
    pp$8.regexp_groupSpecifier = function(state) {
      if (state.eat(0x3F /* ? */)) {
        if (this.regexp_eatGroupName(state)) {
          if (state.groupNames.indexOf(state.lastStringValue) !== -1) {
            state.raise("Duplicate capture group name");
          }
          state.groupNames.push(state.lastStringValue);
          return
        }
        state.raise("Invalid group");
      }
    };

    // GroupName[U] ::
    //   `<` RegExpIdentifierName[?U] `>`
    // Note: this updates `state.lastStringValue` property with the eaten name.
    pp$8.regexp_eatGroupName = function(state) {
      state.lastStringValue = "";
      if (state.eat(0x3C /* < */)) {
        if (this.regexp_eatRegExpIdentifierName(state) && state.eat(0x3E /* > */)) {
          return true
        }
        state.raise("Invalid capture group name");
      }
      return false
    };

    // RegExpIdentifierName[U] ::
    //   RegExpIdentifierStart[?U]
    //   RegExpIdentifierName[?U] RegExpIdentifierPart[?U]
    // Note: this updates `state.lastStringValue` property with the eaten name.
    pp$8.regexp_eatRegExpIdentifierName = function(state) {
      state.lastStringValue = "";
      if (this.regexp_eatRegExpIdentifierStart(state)) {
        state.lastStringValue += codePointToString(state.lastIntValue);
        while (this.regexp_eatRegExpIdentifierPart(state)) {
          state.lastStringValue += codePointToString(state.lastIntValue);
        }
        return true
      }
      return false
    };

    // RegExpIdentifierStart[U] ::
    //   UnicodeIDStart
    //   `$`
    //   `_`
    //   `\` RegExpUnicodeEscapeSequence[?U]
    pp$8.regexp_eatRegExpIdentifierStart = function(state) {
      var start = state.pos;
      var ch = state.current();
      state.advance();

      if (ch === 0x5C /* \ */ && this.regexp_eatRegExpUnicodeEscapeSequence(state)) {
        ch = state.lastIntValue;
      }
      if (isRegExpIdentifierStart(ch)) {
        state.lastIntValue = ch;
        return true
      }

      state.pos = start;
      return false
    };
    function isRegExpIdentifierStart(ch) {
      return isIdentifierStart(ch, true) || ch === 0x24 /* $ */ || ch === 0x5F /* _ */
    }

    // RegExpIdentifierPart[U] ::
    //   UnicodeIDContinue
    //   `$`
    //   `_`
    //   `\` RegExpUnicodeEscapeSequence[?U]
    //   <ZWNJ>
    //   <ZWJ>
    pp$8.regexp_eatRegExpIdentifierPart = function(state) {
      var start = state.pos;
      var ch = state.current();
      state.advance();

      if (ch === 0x5C /* \ */ && this.regexp_eatRegExpUnicodeEscapeSequence(state)) {
        ch = state.lastIntValue;
      }
      if (isRegExpIdentifierPart(ch)) {
        state.lastIntValue = ch;
        return true
      }

      state.pos = start;
      return false
    };
    function isRegExpIdentifierPart(ch) {
      return isIdentifierChar(ch, true) || ch === 0x24 /* $ */ || ch === 0x5F /* _ */ || ch === 0x200C /* <ZWNJ> */ || ch === 0x200D /* <ZWJ> */
    }

    // https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-AtomEscape
    pp$8.regexp_eatAtomEscape = function(state) {
      if (
        this.regexp_eatBackReference(state) ||
        this.regexp_eatCharacterClassEscape(state) ||
        this.regexp_eatCharacterEscape(state) ||
        (state.switchN && this.regexp_eatKGroupName(state))
      ) {
        return true
      }
      if (state.switchU) {
        // Make the same message as V8.
        if (state.current() === 0x63 /* c */) {
          state.raise("Invalid unicode escape");
        }
        state.raise("Invalid escape");
      }
      return false
    };
    pp$8.regexp_eatBackReference = function(state) {
      var start = state.pos;
      if (this.regexp_eatDecimalEscape(state)) {
        var n = state.lastIntValue;
        if (state.switchU) {
          // For SyntaxError in https://www.ecma-international.org/ecma-262/8.0/#sec-atomescape
          if (n > state.maxBackReference) {
            state.maxBackReference = n;
          }
          return true
        }
        if (n <= state.numCapturingParens) {
          return true
        }
        state.pos = start;
      }
      return false
    };
    pp$8.regexp_eatKGroupName = function(state) {
      if (state.eat(0x6B /* k */)) {
        if (this.regexp_eatGroupName(state)) {
          state.backReferenceNames.push(state.lastStringValue);
          return true
        }
        state.raise("Invalid named reference");
      }
      return false
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-CharacterEscape
    pp$8.regexp_eatCharacterEscape = function(state) {
      return (
        this.regexp_eatControlEscape(state) ||
        this.regexp_eatCControlLetter(state) ||
        this.regexp_eatZero(state) ||
        this.regexp_eatHexEscapeSequence(state) ||
        this.regexp_eatRegExpUnicodeEscapeSequence(state) ||
        (!state.switchU && this.regexp_eatLegacyOctalEscapeSequence(state)) ||
        this.regexp_eatIdentityEscape(state)
      )
    };
    pp$8.regexp_eatCControlLetter = function(state) {
      var start = state.pos;
      if (state.eat(0x63 /* c */)) {
        if (this.regexp_eatControlLetter(state)) {
          return true
        }
        state.pos = start;
      }
      return false
    };
    pp$8.regexp_eatZero = function(state) {
      if (state.current() === 0x30 /* 0 */ && !isDecimalDigit(state.lookahead())) {
        state.lastIntValue = 0;
        state.advance();
        return true
      }
      return false
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-ControlEscape
    pp$8.regexp_eatControlEscape = function(state) {
      var ch = state.current();
      if (ch === 0x74 /* t */) {
        state.lastIntValue = 0x09; /* \t */
        state.advance();
        return true
      }
      if (ch === 0x6E /* n */) {
        state.lastIntValue = 0x0A; /* \n */
        state.advance();
        return true
      }
      if (ch === 0x76 /* v */) {
        state.lastIntValue = 0x0B; /* \v */
        state.advance();
        return true
      }
      if (ch === 0x66 /* f */) {
        state.lastIntValue = 0x0C; /* \f */
        state.advance();
        return true
      }
      if (ch === 0x72 /* r */) {
        state.lastIntValue = 0x0D; /* \r */
        state.advance();
        return true
      }
      return false
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-ControlLetter
    pp$8.regexp_eatControlLetter = function(state) {
      var ch = state.current();
      if (isControlLetter(ch)) {
        state.lastIntValue = ch % 0x20;
        state.advance();
        return true
      }
      return false
    };
    function isControlLetter(ch) {
      return (
        (ch >= 0x41 /* A */ && ch <= 0x5A /* Z */) ||
        (ch >= 0x61 /* a */ && ch <= 0x7A /* z */)
      )
    }

    // https://www.ecma-international.org/ecma-262/8.0/#prod-RegExpUnicodeEscapeSequence
    pp$8.regexp_eatRegExpUnicodeEscapeSequence = function(state) {
      var start = state.pos;

      if (state.eat(0x75 /* u */)) {
        if (this.regexp_eatFixedHexDigits(state, 4)) {
          var lead = state.lastIntValue;
          if (state.switchU && lead >= 0xD800 && lead <= 0xDBFF) {
            var leadSurrogateEnd = state.pos;
            if (state.eat(0x5C /* \ */) && state.eat(0x75 /* u */) && this.regexp_eatFixedHexDigits(state, 4)) {
              var trail = state.lastIntValue;
              if (trail >= 0xDC00 && trail <= 0xDFFF) {
                state.lastIntValue = (lead - 0xD800) * 0x400 + (trail - 0xDC00) + 0x10000;
                return true
              }
            }
            state.pos = leadSurrogateEnd;
            state.lastIntValue = lead;
          }
          return true
        }
        if (
          state.switchU &&
          state.eat(0x7B /* { */) &&
          this.regexp_eatHexDigits(state) &&
          state.eat(0x7D /* } */) &&
          isValidUnicode(state.lastIntValue)
        ) {
          return true
        }
        if (state.switchU) {
          state.raise("Invalid unicode escape");
        }
        state.pos = start;
      }

      return false
    };
    function isValidUnicode(ch) {
      return ch >= 0 && ch <= 0x10FFFF
    }

    // https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-IdentityEscape
    pp$8.regexp_eatIdentityEscape = function(state) {
      if (state.switchU) {
        if (this.regexp_eatSyntaxCharacter(state)) {
          return true
        }
        if (state.eat(0x2F /* / */)) {
          state.lastIntValue = 0x2F; /* / */
          return true
        }
        return false
      }

      var ch = state.current();
      if (ch !== 0x63 /* c */ && (!state.switchN || ch !== 0x6B /* k */)) {
        state.lastIntValue = ch;
        state.advance();
        return true
      }

      return false
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-DecimalEscape
    pp$8.regexp_eatDecimalEscape = function(state) {
      state.lastIntValue = 0;
      var ch = state.current();
      if (ch >= 0x31 /* 1 */ && ch <= 0x39 /* 9 */) {
        do {
          state.lastIntValue = 10 * state.lastIntValue + (ch - 0x30 /* 0 */);
          state.advance();
        } while ((ch = state.current()) >= 0x30 /* 0 */ && ch <= 0x39 /* 9 */)
        return true
      }
      return false
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-CharacterClassEscape
    pp$8.regexp_eatCharacterClassEscape = function(state) {
      var ch = state.current();

      if (isCharacterClassEscape(ch)) {
        state.lastIntValue = -1;
        state.advance();
        return true
      }

      if (
        state.switchU &&
        this.options.ecmaVersion >= 9 &&
        (ch === 0x50 /* P */ || ch === 0x70 /* p */)
      ) {
        state.lastIntValue = -1;
        state.advance();
        if (
          state.eat(0x7B /* { */) &&
          this.regexp_eatUnicodePropertyValueExpression(state) &&
          state.eat(0x7D /* } */)
        ) {
          return true
        }
        state.raise("Invalid property name");
      }

      return false
    };
    function isCharacterClassEscape(ch) {
      return (
        ch === 0x64 /* d */ ||
        ch === 0x44 /* D */ ||
        ch === 0x73 /* s */ ||
        ch === 0x53 /* S */ ||
        ch === 0x77 /* w */ ||
        ch === 0x57 /* W */
      )
    }

    // UnicodePropertyValueExpression ::
    //   UnicodePropertyName `=` UnicodePropertyValue
    //   LoneUnicodePropertyNameOrValue
    pp$8.regexp_eatUnicodePropertyValueExpression = function(state) {
      var start = state.pos;

      // UnicodePropertyName `=` UnicodePropertyValue
      if (this.regexp_eatUnicodePropertyName(state) && state.eat(0x3D /* = */)) {
        var name = state.lastStringValue;
        if (this.regexp_eatUnicodePropertyValue(state)) {
          var value = state.lastStringValue;
          this.regexp_validateUnicodePropertyNameAndValue(state, name, value);
          return true
        }
      }
      state.pos = start;

      // LoneUnicodePropertyNameOrValue
      if (this.regexp_eatLoneUnicodePropertyNameOrValue(state)) {
        var nameOrValue = state.lastStringValue;
        this.regexp_validateUnicodePropertyNameOrValue(state, nameOrValue);
        return true
      }
      return false
    };
    pp$8.regexp_validateUnicodePropertyNameAndValue = function(state, name, value) {
      if (!has(state.unicodeProperties.nonBinary, name))
        { state.raise("Invalid property name"); }
      if (!state.unicodeProperties.nonBinary[name].test(value))
        { state.raise("Invalid property value"); }
    };
    pp$8.regexp_validateUnicodePropertyNameOrValue = function(state, nameOrValue) {
      if (!state.unicodeProperties.binary.test(nameOrValue))
        { state.raise("Invalid property name"); }
    };

    // UnicodePropertyName ::
    //   UnicodePropertyNameCharacters
    pp$8.regexp_eatUnicodePropertyName = function(state) {
      var ch = 0;
      state.lastStringValue = "";
      while (isUnicodePropertyNameCharacter(ch = state.current())) {
        state.lastStringValue += codePointToString(ch);
        state.advance();
      }
      return state.lastStringValue !== ""
    };
    function isUnicodePropertyNameCharacter(ch) {
      return isControlLetter(ch) || ch === 0x5F /* _ */
    }

    // UnicodePropertyValue ::
    //   UnicodePropertyValueCharacters
    pp$8.regexp_eatUnicodePropertyValue = function(state) {
      var ch = 0;
      state.lastStringValue = "";
      while (isUnicodePropertyValueCharacter(ch = state.current())) {
        state.lastStringValue += codePointToString(ch);
        state.advance();
      }
      return state.lastStringValue !== ""
    };
    function isUnicodePropertyValueCharacter(ch) {
      return isUnicodePropertyNameCharacter(ch) || isDecimalDigit(ch)
    }

    // LoneUnicodePropertyNameOrValue ::
    //   UnicodePropertyValueCharacters
    pp$8.regexp_eatLoneUnicodePropertyNameOrValue = function(state) {
      return this.regexp_eatUnicodePropertyValue(state)
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-CharacterClass
    pp$8.regexp_eatCharacterClass = function(state) {
      if (state.eat(0x5B /* [ */)) {
        state.eat(0x5E /* ^ */);
        this.regexp_classRanges(state);
        if (state.eat(0x5D /* [ */)) {
          return true
        }
        // Unreachable since it threw "unterminated regular expression" error before.
        state.raise("Unterminated character class");
      }
      return false
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-ClassRanges
    // https://www.ecma-international.org/ecma-262/8.0/#prod-NonemptyClassRanges
    // https://www.ecma-international.org/ecma-262/8.0/#prod-NonemptyClassRangesNoDash
    pp$8.regexp_classRanges = function(state) {
      while (this.regexp_eatClassAtom(state)) {
        var left = state.lastIntValue;
        if (state.eat(0x2D /* - */) && this.regexp_eatClassAtom(state)) {
          var right = state.lastIntValue;
          if (state.switchU && (left === -1 || right === -1)) {
            state.raise("Invalid character class");
          }
          if (left !== -1 && right !== -1 && left > right) {
            state.raise("Range out of order in character class");
          }
        }
      }
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-ClassAtom
    // https://www.ecma-international.org/ecma-262/8.0/#prod-ClassAtomNoDash
    pp$8.regexp_eatClassAtom = function(state) {
      var start = state.pos;

      if (state.eat(0x5C /* \ */)) {
        if (this.regexp_eatClassEscape(state)) {
          return true
        }
        if (state.switchU) {
          // Make the same message as V8.
          var ch$1 = state.current();
          if (ch$1 === 0x63 /* c */ || isOctalDigit(ch$1)) {
            state.raise("Invalid class escape");
          }
          state.raise("Invalid escape");
        }
        state.pos = start;
      }

      var ch = state.current();
      if (ch !== 0x5D /* [ */) {
        state.lastIntValue = ch;
        state.advance();
        return true
      }

      return false
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-ClassEscape
    pp$8.regexp_eatClassEscape = function(state) {
      var start = state.pos;

      if (state.eat(0x62 /* b */)) {
        state.lastIntValue = 0x08; /* <BS> */
        return true
      }

      if (state.switchU && state.eat(0x2D /* - */)) {
        state.lastIntValue = 0x2D; /* - */
        return true
      }

      if (!state.switchU && state.eat(0x63 /* c */)) {
        if (this.regexp_eatClassControlLetter(state)) {
          return true
        }
        state.pos = start;
      }

      return (
        this.regexp_eatCharacterClassEscape(state) ||
        this.regexp_eatCharacterEscape(state)
      )
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-ClassControlLetter
    pp$8.regexp_eatClassControlLetter = function(state) {
      var ch = state.current();
      if (isDecimalDigit(ch) || ch === 0x5F /* _ */) {
        state.lastIntValue = ch % 0x20;
        state.advance();
        return true
      }
      return false
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-HexEscapeSequence
    pp$8.regexp_eatHexEscapeSequence = function(state) {
      var start = state.pos;
      if (state.eat(0x78 /* x */)) {
        if (this.regexp_eatFixedHexDigits(state, 2)) {
          return true
        }
        if (state.switchU) {
          state.raise("Invalid escape");
        }
        state.pos = start;
      }
      return false
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-DecimalDigits
    pp$8.regexp_eatDecimalDigits = function(state) {
      var start = state.pos;
      var ch = 0;
      state.lastIntValue = 0;
      while (isDecimalDigit(ch = state.current())) {
        state.lastIntValue = 10 * state.lastIntValue + (ch - 0x30 /* 0 */);
        state.advance();
      }
      return state.pos !== start
    };
    function isDecimalDigit(ch) {
      return ch >= 0x30 /* 0 */ && ch <= 0x39 /* 9 */
    }

    // https://www.ecma-international.org/ecma-262/8.0/#prod-HexDigits
    pp$8.regexp_eatHexDigits = function(state) {
      var start = state.pos;
      var ch = 0;
      state.lastIntValue = 0;
      while (isHexDigit(ch = state.current())) {
        state.lastIntValue = 16 * state.lastIntValue + hexToInt(ch);
        state.advance();
      }
      return state.pos !== start
    };
    function isHexDigit(ch) {
      return (
        (ch >= 0x30 /* 0 */ && ch <= 0x39 /* 9 */) ||
        (ch >= 0x41 /* A */ && ch <= 0x46 /* F */) ||
        (ch >= 0x61 /* a */ && ch <= 0x66 /* f */)
      )
    }
    function hexToInt(ch) {
      if (ch >= 0x41 /* A */ && ch <= 0x46 /* F */) {
        return 10 + (ch - 0x41 /* A */)
      }
      if (ch >= 0x61 /* a */ && ch <= 0x66 /* f */) {
        return 10 + (ch - 0x61 /* a */)
      }
      return ch - 0x30 /* 0 */
    }

    // https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-LegacyOctalEscapeSequence
    // Allows only 0-377(octal) i.e. 0-255(decimal).
    pp$8.regexp_eatLegacyOctalEscapeSequence = function(state) {
      if (this.regexp_eatOctalDigit(state)) {
        var n1 = state.lastIntValue;
        if (this.regexp_eatOctalDigit(state)) {
          var n2 = state.lastIntValue;
          if (n1 <= 3 && this.regexp_eatOctalDigit(state)) {
            state.lastIntValue = n1 * 64 + n2 * 8 + state.lastIntValue;
          } else {
            state.lastIntValue = n1 * 8 + n2;
          }
        } else {
          state.lastIntValue = n1;
        }
        return true
      }
      return false
    };

    // https://www.ecma-international.org/ecma-262/8.0/#prod-OctalDigit
    pp$8.regexp_eatOctalDigit = function(state) {
      var ch = state.current();
      if (isOctalDigit(ch)) {
        state.lastIntValue = ch - 0x30; /* 0 */
        state.advance();
        return true
      }
      state.lastIntValue = 0;
      return false
    };
    function isOctalDigit(ch) {
      return ch >= 0x30 /* 0 */ && ch <= 0x37 /* 7 */
    }

    // https://www.ecma-international.org/ecma-262/8.0/#prod-Hex4Digits
    // https://www.ecma-international.org/ecma-262/8.0/#prod-HexDigit
    // And HexDigit HexDigit in https://www.ecma-international.org/ecma-262/8.0/#prod-HexEscapeSequence
    pp$8.regexp_eatFixedHexDigits = function(state, length) {
      var start = state.pos;
      state.lastIntValue = 0;
      for (var i = 0; i < length; ++i) {
        var ch = state.current();
        if (!isHexDigit(ch)) {
          state.pos = start;
          return false
        }
        state.lastIntValue = 16 * state.lastIntValue + hexToInt(ch);
        state.advance();
      }
      return true
    };

    // Object type used to represent tokens. Note that normally, tokens
    // simply exist as properties on the parser object. This is only
    // used for the onToken callback and the external tokenizer.

    var Token = function Token(p) {
      this.type = p.type;
      this.value = p.value;
      this.start = p.start;
      this.end = p.end;
      if (p.options.locations)
        { this.loc = new SourceLocation(p, p.startLoc, p.endLoc); }
      if (p.options.ranges)
        { this.range = [p.start, p.end]; }
    };

    // ## Tokenizer

    var pp$9 = Parser.prototype;

    // Move to the next token

    pp$9.next = function() {
      if (this.options.onToken)
        { this.options.onToken(new Token(this)); }

      this.lastTokEnd = this.end;
      this.lastTokStart = this.start;
      this.lastTokEndLoc = this.endLoc;
      this.lastTokStartLoc = this.startLoc;
      this.nextToken();
    };

    pp$9.getToken = function() {
      this.next();
      return new Token(this)
    };

    // If we're in an ES6 environment, make parsers iterable
    if (typeof Symbol !== "undefined")
      { pp$9[Symbol.iterator] = function() {
        var this$1 = this;

        return {
          next: function () {
            var token = this$1.getToken();
            return {
              done: token.type === types.eof,
              value: token
            }
          }
        }
      }; }

    // Toggle strict mode. Re-reads the next number or string to please
    // pedantic tests (`"use strict"; 010;` should fail).

    pp$9.curContext = function() {
      return this.context[this.context.length - 1]
    };

    // Read a single token, updating the parser object's token-related
    // properties.

    pp$9.nextToken = function() {
      var curContext = this.curContext();
      if (!curContext || !curContext.preserveSpace) { this.skipSpace(); }

      this.start = this.pos;
      if (this.options.locations) { this.startLoc = this.curPosition(); }
      if (this.pos >= this.input.length) { return this.finishToken(types.eof) }

      if (curContext.override) { return curContext.override(this) }
      else { this.readToken(this.fullCharCodeAtPos()); }
    };

    pp$9.readToken = function(code) {
      // Identifier or keyword. '\uXXXX' sequences are allowed in
      // identifiers, so '\' also dispatches to that.
      if (isIdentifierStart(code, this.options.ecmaVersion >= 6) || code === 92 /* '\' */)
        { return this.readWord() }

      return this.getTokenFromCode(code)
    };

    pp$9.fullCharCodeAtPos = function() {
      var code = this.input.charCodeAt(this.pos);
      if (code <= 0xd7ff || code >= 0xe000) { return code }
      var next = this.input.charCodeAt(this.pos + 1);
      return (code << 10) + next - 0x35fdc00
    };

    pp$9.skipBlockComment = function() {
      var startLoc = this.options.onComment && this.curPosition();
      var start = this.pos, end = this.input.indexOf("*/", this.pos += 2);
      if (end === -1) { this.raise(this.pos - 2, "Unterminated comment"); }
      this.pos = end + 2;
      if (this.options.locations) {
        lineBreakG.lastIndex = start;
        var match;
        while ((match = lineBreakG.exec(this.input)) && match.index < this.pos) {
          ++this.curLine;
          this.lineStart = match.index + match[0].length;
        }
      }
      if (this.options.onComment)
        { this.options.onComment(true, this.input.slice(start + 2, end), start, this.pos,
                               startLoc, this.curPosition()); }
    };

    pp$9.skipLineComment = function(startSkip) {
      var start = this.pos;
      var startLoc = this.options.onComment && this.curPosition();
      var ch = this.input.charCodeAt(this.pos += startSkip);
      while (this.pos < this.input.length && !isNewLine(ch)) {
        ch = this.input.charCodeAt(++this.pos);
      }
      if (this.options.onComment)
        { this.options.onComment(false, this.input.slice(start + startSkip, this.pos), start, this.pos,
                               startLoc, this.curPosition()); }
    };

    // Called at the start of the parse and after every token. Skips
    // whitespace and comments, and.

    pp$9.skipSpace = function() {
      loop: while (this.pos < this.input.length) {
        var ch = this.input.charCodeAt(this.pos);
        switch (ch) {
        case 32: case 160: // ' '
          ++this.pos;
          break
        case 13:
          if (this.input.charCodeAt(this.pos + 1) === 10) {
            ++this.pos;
          }
        case 10: case 8232: case 8233:
          ++this.pos;
          if (this.options.locations) {
            ++this.curLine;
            this.lineStart = this.pos;
          }
          break
        case 47: // '/'
          switch (this.input.charCodeAt(this.pos + 1)) {
          case 42: // '*'
            this.skipBlockComment();
            break
          case 47:
            this.skipLineComment(2);
            break
          default:
            break loop
          }
          break
        default:
          if (ch > 8 && ch < 14 || ch >= 5760 && nonASCIIwhitespace.test(String.fromCharCode(ch))) {
            ++this.pos;
          } else {
            break loop
          }
        }
      }
    };

    // Called at the end of every token. Sets `end`, `val`, and
    // maintains `context` and `exprAllowed`, and skips the space after
    // the token, so that the next one's `start` will point at the
    // right position.

    pp$9.finishToken = function(type, val) {
      this.end = this.pos;
      if (this.options.locations) { this.endLoc = this.curPosition(); }
      var prevType = this.type;
      this.type = type;
      this.value = val;

      this.updateContext(prevType);
    };

    // ### Token reading

    // This is the function that is called to fetch the next token. It
    // is somewhat obscure, because it works in character codes rather
    // than characters, and because operator parsing has been inlined
    // into it.
    //
    // All in the name of speed.
    //
    pp$9.readToken_dot = function() {
      var next = this.input.charCodeAt(this.pos + 1);
      if (next >= 48 && next <= 57) { return this.readNumber(true) }
      var next2 = this.input.charCodeAt(this.pos + 2);
      if (this.options.ecmaVersion >= 6 && next === 46 && next2 === 46) { // 46 = dot '.'
        this.pos += 3;
        return this.finishToken(types.ellipsis)
      } else {
        ++this.pos;
        return this.finishToken(types.dot)
      }
    };

    pp$9.readToken_slash = function() { // '/'
      var next = this.input.charCodeAt(this.pos + 1);
      if (this.exprAllowed) { ++this.pos; return this.readRegexp() }
      if (next === 61) { return this.finishOp(types.assign, 2) }
      return this.finishOp(types.slash, 1)
    };

    pp$9.readToken_mult_modulo_exp = function(code) { // '%*'
      var next = this.input.charCodeAt(this.pos + 1);
      var size = 1;
      var tokentype = code === 42 ? types.star : types.modulo;

      // exponentiation operator ** and **=
      if (this.options.ecmaVersion >= 7 && code === 42 && next === 42) {
        ++size;
        tokentype = types.starstar;
        next = this.input.charCodeAt(this.pos + 2);
      }

      if (next === 61) { return this.finishOp(types.assign, size + 1) }
      return this.finishOp(tokentype, size)
    };

    pp$9.readToken_pipe_amp = function(code) { // '|&'
      var next = this.input.charCodeAt(this.pos + 1);
      if (next === code) { return this.finishOp(code === 124 ? types.logicalOR : types.logicalAND, 2) }
      if (next === 61) { return this.finishOp(types.assign, 2) }
      return this.finishOp(code === 124 ? types.bitwiseOR : types.bitwiseAND, 1)
    };

    pp$9.readToken_caret = function() { // '^'
      var next = this.input.charCodeAt(this.pos + 1);
      if (next === 61) { return this.finishOp(types.assign, 2) }
      return this.finishOp(types.bitwiseXOR, 1)
    };

    pp$9.readToken_plus_min = function(code) { // '+-'
      var next = this.input.charCodeAt(this.pos + 1);
      if (next === code) {
        if (next === 45 && !this.inModule && this.input.charCodeAt(this.pos + 2) === 62 &&
            (this.lastTokEnd === 0 || lineBreak.test(this.input.slice(this.lastTokEnd, this.pos)))) {
          // A `-->` line comment
          this.skipLineComment(3);
          this.skipSpace();
          return this.nextToken()
        }
        return this.finishOp(types.incDec, 2)
      }
      if (next === 61) { return this.finishOp(types.assign, 2) }
      return this.finishOp(types.plusMin, 1)
    };

    pp$9.readToken_lt_gt = function(code) { // '<>'
      var next = this.input.charCodeAt(this.pos + 1);
      var size = 1;
      if (next === code) {
        size = code === 62 && this.input.charCodeAt(this.pos + 2) === 62 ? 3 : 2;
        if (this.input.charCodeAt(this.pos + size) === 61) { return this.finishOp(types.assign, size + 1) }
        return this.finishOp(types.bitShift, size)
      }
      if (next === 33 && code === 60 && !this.inModule && this.input.charCodeAt(this.pos + 2) === 45 &&
          this.input.charCodeAt(this.pos + 3) === 45) {
        // `<!--`, an XML-style comment that should be interpreted as a line comment
        this.skipLineComment(4);
        this.skipSpace();
        return this.nextToken()
      }
      if (next === 61) { size = 2; }
      return this.finishOp(types.relational, size)
    };

    pp$9.readToken_eq_excl = function(code) { // '=!'
      var next = this.input.charCodeAt(this.pos + 1);
      if (next === 61) { return this.finishOp(types.equality, this.input.charCodeAt(this.pos + 2) === 61 ? 3 : 2) }
      if (code === 61 && next === 62 && this.options.ecmaVersion >= 6) { // '=>'
        this.pos += 2;
        return this.finishToken(types.arrow)
      }
      return this.finishOp(code === 61 ? types.eq : types.prefix, 1)
    };

    pp$9.getTokenFromCode = function(code) {
      switch (code) {
      // The interpretation of a dot depends on whether it is followed
      // by a digit or another two dots.
      case 46: // '.'
        return this.readToken_dot()

      // Punctuation tokens.
      case 40: ++this.pos; return this.finishToken(types.parenL)
      case 41: ++this.pos; return this.finishToken(types.parenR)
      case 59: ++this.pos; return this.finishToken(types.semi)
      case 44: ++this.pos; return this.finishToken(types.comma)
      case 91: ++this.pos; return this.finishToken(types.bracketL)
      case 93: ++this.pos; return this.finishToken(types.bracketR)
      case 123: ++this.pos; return this.finishToken(types.braceL)
      case 125: ++this.pos; return this.finishToken(types.braceR)
      case 58: ++this.pos; return this.finishToken(types.colon)
      case 63: ++this.pos; return this.finishToken(types.question)

      case 96: // '`'
        if (this.options.ecmaVersion < 6) { break }
        ++this.pos;
        return this.finishToken(types.backQuote)

      case 48: // '0'
        var next = this.input.charCodeAt(this.pos + 1);
        if (next === 120 || next === 88) { return this.readRadixNumber(16) } // '0x', '0X' - hex number
        if (this.options.ecmaVersion >= 6) {
          if (next === 111 || next === 79) { return this.readRadixNumber(8) } // '0o', '0O' - octal number
          if (next === 98 || next === 66) { return this.readRadixNumber(2) } // '0b', '0B' - binary number
        }

      // Anything else beginning with a digit is an integer, octal
      // number, or float.
      case 49: case 50: case 51: case 52: case 53: case 54: case 55: case 56: case 57: // 1-9
        return this.readNumber(false)

      // Quotes produce strings.
      case 34: case 39: // '"', "'"
        return this.readString(code)

      // Operators are parsed inline in tiny state machines. '=' (61) is
      // often referred to. `finishOp` simply skips the amount of
      // characters it is given as second argument, and returns a token
      // of the type given by its first argument.

      case 47: // '/'
        return this.readToken_slash()

      case 37: case 42: // '%*'
        return this.readToken_mult_modulo_exp(code)

      case 124: case 38: // '|&'
        return this.readToken_pipe_amp(code)

      case 94: // '^'
        return this.readToken_caret()

      case 43: case 45: // '+-'
        return this.readToken_plus_min(code)

      case 60: case 62: // '<>'
        return this.readToken_lt_gt(code)

      case 61: case 33: // '=!'
        return this.readToken_eq_excl(code)

      case 126: // '~'
        return this.finishOp(types.prefix, 1)
      }

      this.raise(this.pos, "Unexpected character '" + codePointToString$1(code) + "'");
    };

    pp$9.finishOp = function(type, size) {
      var str = this.input.slice(this.pos, this.pos + size);
      this.pos += size;
      return this.finishToken(type, str)
    };

    pp$9.readRegexp = function() {
      var escaped, inClass, start = this.pos;
      for (;;) {
        if (this.pos >= this.input.length) { this.raise(start, "Unterminated regular expression"); }
        var ch = this.input.charAt(this.pos);
        if (lineBreak.test(ch)) { this.raise(start, "Unterminated regular expression"); }
        if (!escaped) {
          if (ch === "[") { inClass = true; }
          else if (ch === "]" && inClass) { inClass = false; }
          else if (ch === "/" && !inClass) { break }
          escaped = ch === "\\";
        } else { escaped = false; }
        ++this.pos;
      }
      var pattern = this.input.slice(start, this.pos);
      ++this.pos;
      var flagsStart = this.pos;
      var flags = this.readWord1();
      if (this.containsEsc) { this.unexpected(flagsStart); }

      // Validate pattern
      var state = this.regexpState || (this.regexpState = new RegExpValidationState(this));
      state.reset(start, pattern, flags);
      this.validateRegExpFlags(state);
      this.validateRegExpPattern(state);

      // Create Literal#value property value.
      var value = null;
      try {
        value = new RegExp(pattern, flags);
      } catch (e) {
        // ESTree requires null if it failed to instantiate RegExp object.
        // https://github.com/estree/estree/blob/a27003adf4fd7bfad44de9cef372a2eacd527b1c/es5.md#regexpliteral
      }

      return this.finishToken(types.regexp, {pattern: pattern, flags: flags, value: value})
    };

    // Read an integer in the given radix. Return null if zero digits
    // were read, the integer value otherwise. When `len` is given, this
    // will return `null` unless the integer has exactly `len` digits.

    pp$9.readInt = function(radix, len) {
      var start = this.pos, total = 0;
      for (var i = 0, e = len == null ? Infinity : len; i < e; ++i) {
        var code = this.input.charCodeAt(this.pos), val = (void 0);
        if (code >= 97) { val = code - 97 + 10; } // a
        else if (code >= 65) { val = code - 65 + 10; } // A
        else if (code >= 48 && code <= 57) { val = code - 48; } // 0-9
        else { val = Infinity; }
        if (val >= radix) { break }
        ++this.pos;
        total = total * radix + val;
      }
      if (this.pos === start || len != null && this.pos - start !== len) { return null }

      return total
    };

    pp$9.readRadixNumber = function(radix) {
      var start = this.pos;
      this.pos += 2; // 0x
      var val = this.readInt(radix);
      if (val == null) { this.raise(this.start + 2, "Expected number in radix " + radix); }
      if (this.options.ecmaVersion >= 11 && this.input.charCodeAt(this.pos) === 110) {
        val = typeof BigInt !== "undefined" ? BigInt(this.input.slice(start, this.pos)) : null;
        ++this.pos;
      } else if (isIdentifierStart(this.fullCharCodeAtPos())) { this.raise(this.pos, "Identifier directly after number"); }
      return this.finishToken(types.num, val)
    };

    // Read an integer, octal integer, or floating-point number.

    pp$9.readNumber = function(startsWithDot) {
      var start = this.pos;
      if (!startsWithDot && this.readInt(10) === null) { this.raise(start, "Invalid number"); }
      var octal = this.pos - start >= 2 && this.input.charCodeAt(start) === 48;
      if (octal && this.strict) { this.raise(start, "Invalid number"); }
      if (octal && /[89]/.test(this.input.slice(start, this.pos))) { octal = false; }
      var next = this.input.charCodeAt(this.pos);
      if (!octal && !startsWithDot && this.options.ecmaVersion >= 11 && next === 110) {
        var str$1 = this.input.slice(start, this.pos);
        var val$1 = typeof BigInt !== "undefined" ? BigInt(str$1) : null;
        ++this.pos;
        if (isIdentifierStart(this.fullCharCodeAtPos())) { this.raise(this.pos, "Identifier directly after number"); }
        return this.finishToken(types.num, val$1)
      }
      if (next === 46 && !octal) { // '.'
        ++this.pos;
        this.readInt(10);
        next = this.input.charCodeAt(this.pos);
      }
      if ((next === 69 || next === 101) && !octal) { // 'eE'
        next = this.input.charCodeAt(++this.pos);
        if (next === 43 || next === 45) { ++this.pos; } // '+-'
        if (this.readInt(10) === null) { this.raise(start, "Invalid number"); }
      }
      if (isIdentifierStart(this.fullCharCodeAtPos())) { this.raise(this.pos, "Identifier directly after number"); }

      var str = this.input.slice(start, this.pos);
      var val = octal ? parseInt(str, 8) : parseFloat(str);
      return this.finishToken(types.num, val)
    };

    // Read a string value, interpreting backslash-escapes.

    pp$9.readCodePoint = function() {
      var ch = this.input.charCodeAt(this.pos), code;

      if (ch === 123) { // '{'
        if (this.options.ecmaVersion < 6) { this.unexpected(); }
        var codePos = ++this.pos;
        code = this.readHexChar(this.input.indexOf("}", this.pos) - this.pos);
        ++this.pos;
        if (code > 0x10FFFF) { this.invalidStringToken(codePos, "Code point out of bounds"); }
      } else {
        code = this.readHexChar(4);
      }
      return code
    };

    function codePointToString$1(code) {
      // UTF-16 Decoding
      if (code <= 0xFFFF) { return String.fromCharCode(code) }
      code -= 0x10000;
      return String.fromCharCode((code >> 10) + 0xD800, (code & 1023) + 0xDC00)
    }

    pp$9.readString = function(quote) {
      var out = "", chunkStart = ++this.pos;
      for (;;) {
        if (this.pos >= this.input.length) { this.raise(this.start, "Unterminated string constant"); }
        var ch = this.input.charCodeAt(this.pos);
        if (ch === quote) { break }
        if (ch === 92) { // '\'
          out += this.input.slice(chunkStart, this.pos);
          out += this.readEscapedChar(false);
          chunkStart = this.pos;
        } else {
          if (isNewLine(ch, this.options.ecmaVersion >= 10)) { this.raise(this.start, "Unterminated string constant"); }
          ++this.pos;
        }
      }
      out += this.input.slice(chunkStart, this.pos++);
      return this.finishToken(types.string, out)
    };

    // Reads template string tokens.

    var INVALID_TEMPLATE_ESCAPE_ERROR = {};

    pp$9.tryReadTemplateToken = function() {
      this.inTemplateElement = true;
      try {
        this.readTmplToken();
      } catch (err) {
        if (err === INVALID_TEMPLATE_ESCAPE_ERROR) {
          this.readInvalidTemplateToken();
        } else {
          throw err
        }
      }

      this.inTemplateElement = false;
    };

    pp$9.invalidStringToken = function(position, message) {
      if (this.inTemplateElement && this.options.ecmaVersion >= 9) {
        throw INVALID_TEMPLATE_ESCAPE_ERROR
      } else {
        this.raise(position, message);
      }
    };

    pp$9.readTmplToken = function() {
      var out = "", chunkStart = this.pos;
      for (;;) {
        if (this.pos >= this.input.length) { this.raise(this.start, "Unterminated template"); }
        var ch = this.input.charCodeAt(this.pos);
        if (ch === 96 || ch === 36 && this.input.charCodeAt(this.pos + 1) === 123) { // '`', '${'
          if (this.pos === this.start && (this.type === types.template || this.type === types.invalidTemplate)) {
            if (ch === 36) {
              this.pos += 2;
              return this.finishToken(types.dollarBraceL)
            } else {
              ++this.pos;
              return this.finishToken(types.backQuote)
            }
          }
          out += this.input.slice(chunkStart, this.pos);
          return this.finishToken(types.template, out)
        }
        if (ch === 92) { // '\'
          out += this.input.slice(chunkStart, this.pos);
          out += this.readEscapedChar(true);
          chunkStart = this.pos;
        } else if (isNewLine(ch)) {
          out += this.input.slice(chunkStart, this.pos);
          ++this.pos;
          switch (ch) {
          case 13:
            if (this.input.charCodeAt(this.pos) === 10) { ++this.pos; }
          case 10:
            out += "\n";
            break
          default:
            out += String.fromCharCode(ch);
            break
          }
          if (this.options.locations) {
            ++this.curLine;
            this.lineStart = this.pos;
          }
          chunkStart = this.pos;
        } else {
          ++this.pos;
        }
      }
    };

    // Reads a template token to search for the end, without validating any escape sequences
    pp$9.readInvalidTemplateToken = function() {
      for (; this.pos < this.input.length; this.pos++) {
        switch (this.input[this.pos]) {
        case "\\":
          ++this.pos;
          break

        case "$":
          if (this.input[this.pos + 1] !== "{") {
            break
          }
        // falls through

        case "`":
          return this.finishToken(types.invalidTemplate, this.input.slice(this.start, this.pos))

        // no default
        }
      }
      this.raise(this.start, "Unterminated template");
    };

    // Used to read escaped characters

    pp$9.readEscapedChar = function(inTemplate) {
      var ch = this.input.charCodeAt(++this.pos);
      ++this.pos;
      switch (ch) {
      case 110: return "\n" // 'n' -> '\n'
      case 114: return "\r" // 'r' -> '\r'
      case 120: return String.fromCharCode(this.readHexChar(2)) // 'x'
      case 117: return codePointToString$1(this.readCodePoint()) // 'u'
      case 116: return "\t" // 't' -> '\t'
      case 98: return "\b" // 'b' -> '\b'
      case 118: return "\u000b" // 'v' -> '\u000b'
      case 102: return "\f" // 'f' -> '\f'
      case 13: if (this.input.charCodeAt(this.pos) === 10) { ++this.pos; } // '\r\n'
      case 10: // ' \n'
        if (this.options.locations) { this.lineStart = this.pos; ++this.curLine; }
        return ""
      default:
        if (ch >= 48 && ch <= 55) {
          var octalStr = this.input.substr(this.pos - 1, 3).match(/^[0-7]+/)[0];
          var octal = parseInt(octalStr, 8);
          if (octal > 255) {
            octalStr = octalStr.slice(0, -1);
            octal = parseInt(octalStr, 8);
          }
          this.pos += octalStr.length - 1;
          ch = this.input.charCodeAt(this.pos);
          if ((octalStr !== "0" || ch === 56 || ch === 57) && (this.strict || inTemplate)) {
            this.invalidStringToken(
              this.pos - 1 - octalStr.length,
              inTemplate
                ? "Octal literal in template string"
                : "Octal literal in strict mode"
            );
          }
          return String.fromCharCode(octal)
        }
        if (isNewLine(ch)) {
          // Unicode new line characters after \ get removed from output in both
          // template literals and strings
          return ""
        }
        return String.fromCharCode(ch)
      }
    };

    // Used to read character escape sequences ('\x', '\u', '\U').

    pp$9.readHexChar = function(len) {
      var codePos = this.pos;
      var n = this.readInt(16, len);
      if (n === null) { this.invalidStringToken(codePos, "Bad character escape sequence"); }
      return n
    };

    // Read an identifier, and return it as a string. Sets `this.containsEsc`
    // to whether the word contained a '\u' escape.
    //
    // Incrementally adds only escaped chars, adding other chunks as-is
    // as a micro-optimization.

    pp$9.readWord1 = function() {
      this.containsEsc = false;
      var word = "", first = true, chunkStart = this.pos;
      var astral = this.options.ecmaVersion >= 6;
      while (this.pos < this.input.length) {
        var ch = this.fullCharCodeAtPos();
        if (isIdentifierChar(ch, astral)) {
          this.pos += ch <= 0xffff ? 1 : 2;
        } else if (ch === 92) { // "\"
          this.containsEsc = true;
          word += this.input.slice(chunkStart, this.pos);
          var escStart = this.pos;
          if (this.input.charCodeAt(++this.pos) !== 117) // "u"
            { this.invalidStringToken(this.pos, "Expecting Unicode escape sequence \\uXXXX"); }
          ++this.pos;
          var esc = this.readCodePoint();
          if (!(first ? isIdentifierStart : isIdentifierChar)(esc, astral))
            { this.invalidStringToken(escStart, "Invalid Unicode escape"); }
          word += codePointToString$1(esc);
          chunkStart = this.pos;
        } else {
          break
        }
        first = false;
      }
      return word + this.input.slice(chunkStart, this.pos)
    };

    // Read an identifier or keyword token. Will check for reserved
    // words when necessary.

    pp$9.readWord = function() {
      var word = this.readWord1();
      var type = types.name;
      if (this.keywords.test(word)) {
        if (this.containsEsc) { this.raiseRecoverable(this.start, "Escape sequence in keyword " + word); }
        type = keywords$1[word];
      }
      return this.finishToken(type, word)
    };

    // Acorn is a tiny, fast JavaScript parser written in JavaScript.

    var version = "6.4.2";

    Parser.acorn = {
      Parser: Parser,
      version: version,
      defaultOptions: defaultOptions,
      Position: Position,
      SourceLocation: SourceLocation,
      getLineInfo: getLineInfo,
      Node: Node,
      TokenType: TokenType,
      tokTypes: types,
      keywordTypes: keywords$1,
      TokContext: TokContext,
      tokContexts: types$1,
      isIdentifierChar: isIdentifierChar,
      isIdentifierStart: isIdentifierStart,
      Token: Token,
      isNewLine: isNewLine,
      lineBreak: lineBreak,
      lineBreakG: lineBreakG,
      nonASCIIwhitespace: nonASCIIwhitespace
    };

    // The main exported interface (under `self.acorn` when in the
    // browser) is a `parse` function that takes a code string and
    // returns an abstract syntax tree as specified by [Mozilla parser
    // API][api].
    //
    // [api]: https://developer.mozilla.org/en-US/docs/SpiderMonkey/Parser_API

    function parse(input, options) {
      return Parser.parse(input, options)
    }

    // This function tries to parse a single expression at a given
    // offset in a string. Useful for parsing mixed-language formats
    // that embed JavaScript expressions.

    function parseExpressionAt(input, pos, options) {
      return Parser.parseExpressionAt(input, pos, options)
    }

    // Acorn is organized as a tokenizer and a recursive-descent parser.
    // The `tokenizer` export provides an interface to the tokenizer.

    function tokenizer(input, options) {
      return Parser.tokenizer(input, options)
    }

    exports.Node = Node;
    exports.Parser = Parser;
    exports.Position = Position;
    exports.SourceLocation = SourceLocation;
    exports.TokContext = TokContext;
    exports.Token = Token;
    exports.TokenType = TokenType;
    exports.defaultOptions = defaultOptions;
    exports.getLineInfo = getLineInfo;
    exports.isIdentifierChar = isIdentifierChar;
    exports.isIdentifierStart = isIdentifierStart;
    exports.isNewLine = isNewLine;
    exports.keywordTypes = keywords$1;
    exports.lineBreak = lineBreak;
    exports.lineBreakG = lineBreakG;
    exports.nonASCIIwhitespace = nonASCIIwhitespace;
    exports.parse = parse;
    exports.parseExpressionAt = parseExpressionAt;
    exports.tokContexts = types$1;
    exports.tokTypes = types;
    exports.tokenizer = tokenizer;
    exports.version = version;

    Object.defineProperty(exports, '__esModule', { value: true });

  })));

  },{}],5:[function(require,module,exports){
  'use strict';

  var copy             = require('es5-ext/object/copy')
    , normalizeOptions = require('es5-ext/object/normalize-options')
    , ensureCallable   = require('es5-ext/object/valid-callable')
    , map              = require('es5-ext/object/map')
    , callable         = require('es5-ext/object/valid-callable')
    , validValue       = require('es5-ext/object/valid-value')

    , bind = Function.prototype.bind, defineProperty = Object.defineProperty
    , hasOwnProperty = Object.prototype.hasOwnProperty
    , define;

  define = function (name, desc, options) {
    var value = validValue(desc) && callable(desc.value), dgs;
    dgs = copy(desc);
    delete dgs.writable;
    delete dgs.value;
    dgs.get = function () {
      if (!options.overwriteDefinition && hasOwnProperty.call(this, name)) return value;
      desc.value = bind.call(value, options.resolveContext ? options.resolveContext(this) : this);
      defineProperty(this, name, desc);
      return this[name];
    };
    return dgs;
  };

  module.exports = function (props/*, options*/) {
    var options = normalizeOptions(arguments[1]);
    if (options.resolveContext != null) ensureCallable(options.resolveContext);
    return map(props, function (desc, name) { return define(name, desc, options); });
  };

  },{"es5-ext/object/copy":27,"es5-ext/object/map":36,"es5-ext/object/normalize-options":37,"es5-ext/object/valid-callable":42,"es5-ext/object/valid-value":44}],6:[function(require,module,exports){
  'use strict';

  var assign        = require('es5-ext/object/assign')
    , normalizeOpts = require('es5-ext/object/normalize-options')
    , isCallable    = require('es5-ext/object/is-callable')
    , contains      = require('es5-ext/string/#/contains')

    , d;

  d = module.exports = function (dscr, value/*, options*/) {
    var c, e, w, options, desc;
    if ((arguments.length < 2) || (typeof dscr !== 'string')) {
      options = value;
      value = dscr;
      dscr = null;
    } else {
      options = arguments[2];
    }
    if (dscr == null) {
      c = w = true;
      e = false;
    } else {
      c = contains.call(dscr, 'c');
      e = contains.call(dscr, 'e');
      w = contains.call(dscr, 'w');
    }

    desc = { value: value, configurable: c, enumerable: e, writable: w };
    return !options ? desc : assign(normalizeOpts(options), desc);
  };

  d.gs = function (dscr, get, set/*, options*/) {
    var c, e, options, desc;
    if (typeof dscr !== 'string') {
      options = set;
      set = get;
      get = dscr;
      dscr = null;
    } else {
      options = arguments[3];
    }
    if (get == null) {
      get = undefined;
    } else if (!isCallable(get)) {
      options = get;
      get = set = undefined;
    } else if (set == null) {
      set = undefined;
    } else if (!isCallable(set)) {
      options = set;
      set = undefined;
    }
    if (dscr == null) {
      c = true;
      e = false;
    } else {
      c = contains.call(dscr, 'c');
      e = contains.call(dscr, 'e');
    }

    desc = { get: get, set: set, configurable: c, enumerable: e };
    return !options ? desc : assign(normalizeOpts(options), desc);
  };

  },{"es5-ext/object/assign":24,"es5-ext/object/is-callable":30,"es5-ext/object/normalize-options":37,"es5-ext/string/#/contains":45}],7:[function(require,module,exports){
  // Inspired by Google Closure:
  // http://closure-library.googlecode.com/svn/docs/
  // closure_goog_array_array.js.html#goog.array.clear

  "use strict";

  var value = require("../../object/valid-value");

  module.exports = function () {
    value(this).length = 0;
    return this;
  };

  },{"../../object/valid-value":44}],8:[function(require,module,exports){
  "use strict";

  var numberIsNaN       = require("../../number/is-nan")
    , toPosInt          = require("../../number/to-pos-integer")
    , value             = require("../../object/valid-value")
    , indexOf           = Array.prototype.indexOf
    , objHasOwnProperty = Object.prototype.hasOwnProperty
    , abs               = Math.abs
    , floor             = Math.floor;

  module.exports = function (searchElement /*, fromIndex*/) {
    var i, length, fromIndex, val;
    if (!numberIsNaN(searchElement)) return indexOf.apply(this, arguments);

    length = toPosInt(value(this).length);
    fromIndex = arguments[1];
    if (isNaN(fromIndex)) fromIndex = 0;
    else if (fromIndex >= 0) fromIndex = floor(fromIndex);
    else fromIndex = toPosInt(this.length) - floor(abs(fromIndex));

    for (i = fromIndex; i < length; ++i) {
      if (objHasOwnProperty.call(this, i)) {
        val = this[i];
        if (numberIsNaN(val)) return i; // Jslint: ignore
      }
    }
    return -1;
  };

  },{"../../number/is-nan":18,"../../number/to-pos-integer":22,"../../object/valid-value":44}],9:[function(require,module,exports){
  "use strict";

  module.exports = require("./is-implemented")()
    ? Array.from
    : require("./shim");

  },{"./is-implemented":10,"./shim":11}],10:[function(require,module,exports){
  "use strict";

  module.exports = function () {
    var from = Array.from, arr, result;
    if (typeof from !== "function") return false;
    arr = ["raz", "dwa"];
    result = from(arr);
    return Boolean(result && (result !== arr) && (result[1] === "dwa"));
  };

  },{}],11:[function(require,module,exports){
  "use strict";

  var iteratorSymbol = require("es6-symbol").iterator
    , isArguments    = require("../../function/is-arguments")
    , isFunction     = require("../../function/is-function")
    , toPosInt       = require("../../number/to-pos-integer")
    , callable       = require("../../object/valid-callable")
    , validValue     = require("../../object/valid-value")
    , isValue        = require("../../object/is-value")
    , isString       = require("../../string/is-string")
    , isArray        = Array.isArray
    , call           = Function.prototype.call
    , desc           = { configurable: true, enumerable: true, writable: true, value: null }
    , defineProperty = Object.defineProperty;

  // eslint-disable-next-line complexity
  module.exports = function (arrayLike /*, mapFn, thisArg*/) {
    var mapFn = arguments[1]
      , thisArg = arguments[2]
      , Context
      , i
      , j
      , arr
      , length
      , code
      , iterator
      , result
      , getIterator
      , value;

    arrayLike = Object(validValue(arrayLike));

    if (isValue(mapFn)) callable(mapFn);
    if (!this || this === Array || !isFunction(this)) {
      // Result: Plain array
      if (!mapFn) {
        if (isArguments(arrayLike)) {
          // Source: Arguments
          length = arrayLike.length;
          if (length !== 1) return Array.apply(null, arrayLike);
          arr = new Array(1);
          arr[0] = arrayLike[0];
          return arr;
        }
        if (isArray(arrayLike)) {
          // Source: Array
          arr = new Array(length = arrayLike.length);
          for (i = 0; i < length; ++i) arr[i] = arrayLike[i];
          return arr;
        }
      }
      arr = [];
    } else {
      // Result: Non plain array
      Context = this;
    }

    if (!isArray(arrayLike)) {
      if ((getIterator = arrayLike[iteratorSymbol]) !== undefined) {
        // Source: Iterator
        iterator = callable(getIterator).call(arrayLike);
        if (Context) arr = new Context();
        result = iterator.next();
        i = 0;
        while (!result.done) {
          value = mapFn ? call.call(mapFn, thisArg, result.value, i) : result.value;
          if (Context) {
            desc.value = value;
            defineProperty(arr, i, desc);
          } else {
            arr[i] = value;
          }
          result = iterator.next();
          ++i;
        }
        length = i;
      } else if (isString(arrayLike)) {
        // Source: String
        length = arrayLike.length;
        if (Context) arr = new Context();
        for (i = 0, j = 0; i < length; ++i) {
          value = arrayLike[i];
          if (i + 1 < length) {
            code = value.charCodeAt(0);
            // eslint-disable-next-line max-depth
            if (code >= 0xd800 && code <= 0xdbff) value += arrayLike[++i];
          }
          value = mapFn ? call.call(mapFn, thisArg, value, j) : value;
          if (Context) {
            desc.value = value;
            defineProperty(arr, j, desc);
          } else {
            arr[j] = value;
          }
          ++j;
        }
        length = j;
      }
    }
    if (length === undefined) {
      // Source: array or array-like
      length = toPosInt(arrayLike.length);
      if (Context) arr = new Context(length);
      for (i = 0; i < length; ++i) {
        value = mapFn ? call.call(mapFn, thisArg, arrayLike[i], i) : arrayLike[i];
        if (Context) {
          desc.value = value;
          defineProperty(arr, i, desc);
        } else {
          arr[i] = value;
        }
      }
    }
    if (Context) {
      desc.value = null;
      arr.length = length;
    }
    return arr;
  };

  },{"../../function/is-arguments":12,"../../function/is-function":13,"../../number/to-pos-integer":22,"../../object/is-value":32,"../../object/valid-callable":42,"../../object/valid-value":44,"../../string/is-string":48,"es6-symbol":63}],12:[function(require,module,exports){
  "use strict";

  var objToString = Object.prototype.toString
    , id = objToString.call(
    (function () {
      return arguments;
    })()
  );

  module.exports = function (value) {
    return objToString.call(value) === id;
  };

  },{}],13:[function(require,module,exports){
  "use strict";

  var objToString = Object.prototype.toString, id = objToString.call(require("./noop"));

  module.exports = function (value) {
    return typeof value === "function" && objToString.call(value) === id;
  };

  },{"./noop":14}],14:[function(require,module,exports){
  "use strict";

  // eslint-disable-next-line no-empty-function
  module.exports = function () {};

  },{}],15:[function(require,module,exports){
  "use strict";

  module.exports = require("./is-implemented")()
    ? Math.sign
    : require("./shim");

  },{"./is-implemented":16,"./shim":17}],16:[function(require,module,exports){
  "use strict";

  module.exports = function () {
    var sign = Math.sign;
    if (typeof sign !== "function") return false;
    return (sign(10) === 1) && (sign(-20) === -1);
  };

  },{}],17:[function(require,module,exports){
  "use strict";

  module.exports = function (value) {
    value = Number(value);
    if (isNaN(value) || (value === 0)) return value;
    return value > 0 ? 1 : -1;
  };

  },{}],18:[function(require,module,exports){
  "use strict";

  module.exports = require("./is-implemented")()
    ? Number.isNaN
    : require("./shim");

  },{"./is-implemented":19,"./shim":20}],19:[function(require,module,exports){
  "use strict";

  module.exports = function () {
    var numberIsNaN = Number.isNaN;
    if (typeof numberIsNaN !== "function") return false;
    return !numberIsNaN({}) && numberIsNaN(NaN) && !numberIsNaN(34);
  };

  },{}],20:[function(require,module,exports){
  "use strict";

  module.exports = function (value) {
    // eslint-disable-next-line no-self-compare
    return value !== value;
  };

  },{}],21:[function(require,module,exports){
  "use strict";

  var sign = require("../math/sign")

    , abs = Math.abs, floor = Math.floor;

  module.exports = function (value) {
    if (isNaN(value)) return 0;
    value = Number(value);
    if ((value === 0) || !isFinite(value)) return value;
    return sign(value) * floor(abs(value));
  };

  },{"../math/sign":15}],22:[function(require,module,exports){
  "use strict";

  var toInteger = require("./to-integer")

    , max = Math.max;

  module.exports = function (value) {
   return max(0, toInteger(value));
  };

  },{"./to-integer":21}],23:[function(require,module,exports){
  // Internal method, used by iteration functions.
  // Calls a function for each key-value pair found in object
  // Optionally takes compareFn to iterate object in specific order

  "use strict";

  var callable                = require("./valid-callable")
    , value                   = require("./valid-value")
    , bind                    = Function.prototype.bind
    , call                    = Function.prototype.call
    , keys                    = Object.keys
    , objPropertyIsEnumerable = Object.prototype.propertyIsEnumerable;

  module.exports = function (method, defVal) {
    return function (obj, cb /*, thisArg, compareFn*/) {
      var list, thisArg = arguments[2], compareFn = arguments[3];
      obj = Object(value(obj));
      callable(cb);

      list = keys(obj);
      if (compareFn) {
        list.sort(typeof compareFn === "function" ? bind.call(compareFn, obj) : undefined);
      }
      if (typeof method !== "function") method = list[method];
      return call.call(method, list, function (key, index) {
        if (!objPropertyIsEnumerable.call(obj, key)) return defVal;
        return call.call(cb, thisArg, obj[key], key, obj, index);
      });
    };
  };

  },{"./valid-callable":42,"./valid-value":44}],24:[function(require,module,exports){
  "use strict";

  module.exports = require("./is-implemented")()
    ? Object.assign
    : require("./shim");

  },{"./is-implemented":25,"./shim":26}],25:[function(require,module,exports){
  "use strict";

  module.exports = function () {
    var assign = Object.assign, obj;
    if (typeof assign !== "function") return false;
    obj = { foo: "raz" };
    assign(obj, { bar: "dwa" }, { trzy: "trzy" });
    return (obj.foo + obj.bar + obj.trzy) === "razdwatrzy";
  };

  },{}],26:[function(require,module,exports){
  "use strict";

  var keys  = require("../keys")
    , value = require("../valid-value")
    , max   = Math.max;

  module.exports = function (dest, src /*, …srcn*/) {
    var error, i, length = max(arguments.length, 2), assign;
    dest = Object(value(dest));
    assign = function (key) {
      try {
        dest[key] = src[key];
      } catch (e) {
        if (!error) error = e;
      }
    };
    for (i = 1; i < length; ++i) {
      src = arguments[i];
      keys(src).forEach(assign);
    }
    if (error !== undefined) throw error;
    return dest;
  };

  },{"../keys":33,"../valid-value":44}],27:[function(require,module,exports){
  "use strict";

  var aFrom  = require("../array/from")
    , assign = require("./assign")
    , value  = require("./valid-value");

  module.exports = function (obj/*, propertyNames, options*/) {
    var copy = Object(value(obj)), propertyNames = arguments[1], options = Object(arguments[2]);
    if (copy !== obj && !propertyNames) return copy;
    var result = {};
    if (propertyNames) {
      aFrom(propertyNames, function (propertyName) {
        if (options.ensure || propertyName in obj) result[propertyName] = obj[propertyName];
      });
    } else {
      assign(result, obj);
    }
    return result;
  };

  },{"../array/from":9,"./assign":24,"./valid-value":44}],28:[function(require,module,exports){
  // Workaround for http://code.google.com/p/v8/issues/detail?id=2804

  "use strict";

  var create = Object.create, shim;

  if (!require("./set-prototype-of/is-implemented")()) {
    shim = require("./set-prototype-of/shim");
  }

  module.exports = (function () {
    var nullObject, polyProps, desc;
    if (!shim) return create;
    if (shim.level !== 1) return create;

    nullObject = {};
    polyProps = {};
    desc = {
      configurable: false,
      enumerable: false,
      writable: true,
      value: undefined
    };
    Object.getOwnPropertyNames(Object.prototype).forEach(function (name) {
      if (name === "__proto__") {
        polyProps[name] = {
          configurable: true,
          enumerable: false,
          writable: true,
          value: undefined
        };
        return;
      }
      polyProps[name] = desc;
    });
    Object.defineProperties(nullObject, polyProps);

    Object.defineProperty(shim, "nullPolyfill", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: nullObject
    });

    return function (prototype, props) {
      return create(prototype === null ? nullObject : prototype, props);
    };
  }());

  },{"./set-prototype-of/is-implemented":40,"./set-prototype-of/shim":41}],29:[function(require,module,exports){
  "use strict";

  module.exports = require("./_iterate")("forEach");

  },{"./_iterate":23}],30:[function(require,module,exports){
  // Deprecated

  "use strict";

  module.exports = function (obj) {
   return typeof obj === "function";
  };

  },{}],31:[function(require,module,exports){
  "use strict";

  var isValue = require("./is-value");

  var map = { function: true, object: true };

  module.exports = function (value) {
    return (isValue(value) && map[typeof value]) || false;
  };

  },{"./is-value":32}],32:[function(require,module,exports){
  "use strict";

  var _undefined = require("../function/noop")(); // Support ES3 engines

  module.exports = function (val) {
   return (val !== _undefined) && (val !== null);
  };

  },{"../function/noop":14}],33:[function(require,module,exports){
  "use strict";

  module.exports = require("./is-implemented")() ? Object.keys : require("./shim");

  },{"./is-implemented":34,"./shim":35}],34:[function(require,module,exports){
  "use strict";

  module.exports = function () {
    try {
      Object.keys("primitive");
      return true;
    } catch (e) {
      return false;
    }
  };

  },{}],35:[function(require,module,exports){
  "use strict";

  var isValue = require("../is-value");

  var keys = Object.keys;

  module.exports = function (object) { return keys(isValue(object) ? Object(object) : object); };

  },{"../is-value":32}],36:[function(require,module,exports){
  "use strict";

  var callable = require("./valid-callable")
    , forEach  = require("./for-each")
    , call     = Function.prototype.call;

  module.exports = function (obj, cb /*, thisArg*/) {
    var result = {}, thisArg = arguments[2];
    callable(cb);
    forEach(obj, function (value, key, targetObj, index) {
      result[key] = call.call(cb, thisArg, value, key, targetObj, index);
    });
    return result;
  };

  },{"./for-each":29,"./valid-callable":42}],37:[function(require,module,exports){
  "use strict";

  var isValue = require("./is-value");

  var forEach = Array.prototype.forEach, create = Object.create;

  var process = function (src, obj) {
    var key;
    for (key in src) obj[key] = src[key];
  };

  // eslint-disable-next-line no-unused-vars
  module.exports = function (opts1 /*, …options*/) {
    var result = create(null);
    forEach.call(arguments, function (options) {
      if (!isValue(options)) return;
      process(Object(options), result);
    });
    return result;
  };

  },{"./is-value":32}],38:[function(require,module,exports){
  "use strict";

  var forEach = Array.prototype.forEach, create = Object.create;

  // eslint-disable-next-line no-unused-vars
  module.exports = function (arg /*, …args*/) {
    var set = create(null);
    forEach.call(arguments, function (name) {
      set[name] = true;
    });
    return set;
  };

  },{}],39:[function(require,module,exports){
  "use strict";

  module.exports = require("./is-implemented")()
    ? Object.setPrototypeOf
    : require("./shim");

  },{"./is-implemented":40,"./shim":41}],40:[function(require,module,exports){
  "use strict";

  var create = Object.create, getPrototypeOf = Object.getPrototypeOf, plainObject = {};

  module.exports = function (/* CustomCreate*/) {
    var setPrototypeOf = Object.setPrototypeOf, customCreate = arguments[0] || create;
    if (typeof setPrototypeOf !== "function") return false;
    return getPrototypeOf(setPrototypeOf(customCreate(null), plainObject)) === plainObject;
  };

  },{}],41:[function(require,module,exports){
  /* eslint no-proto: "off" */

  // Big thanks to @WebReflection for sorting this out
  // https://gist.github.com/WebReflection/5593554

  "use strict";

  var isObject        = require("../is-object")
    , value           = require("../valid-value")
    , objIsPrototypeOf = Object.prototype.isPrototypeOf
    , defineProperty  = Object.defineProperty
    , nullDesc        = {
    configurable: true,
    enumerable: false,
    writable: true,
    value: undefined
  }
    , validate;

  validate = function (obj, prototype) {
    value(obj);
    if (prototype === null || isObject(prototype)) return obj;
    throw new TypeError("Prototype must be null or an object");
  };

  module.exports = (function (status) {
    var fn, set;
    if (!status) return null;
    if (status.level === 2) {
      if (status.set) {
        set = status.set;
        fn = function (obj, prototype) {
          set.call(validate(obj, prototype), prototype);
          return obj;
        };
      } else {
        fn = function (obj, prototype) {
          validate(obj, prototype).__proto__ = prototype;
          return obj;
        };
      }
    } else {
      fn = function self(obj, prototype) {
        var isNullBase;
        validate(obj, prototype);
        isNullBase = objIsPrototypeOf.call(self.nullPolyfill, obj);
        if (isNullBase) delete self.nullPolyfill.__proto__;
        if (prototype === null) prototype = self.nullPolyfill;
        obj.__proto__ = prototype;
        if (isNullBase) defineProperty(self.nullPolyfill, "__proto__", nullDesc);
        return obj;
      };
    }
    return Object.defineProperty(fn, "level", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: status.level
    });
  }(
    (function () {
      var tmpObj1 = Object.create(null)
        , tmpObj2 = {}
        , set
        , desc = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__");

      if (desc) {
        try {
          set = desc.set; // Opera crashes at this point
          set.call(tmpObj1, tmpObj2);
        } catch (ignore) {}
        if (Object.getPrototypeOf(tmpObj1) === tmpObj2) return { set: set, level: 2 };
      }

      tmpObj1.__proto__ = tmpObj2;
      if (Object.getPrototypeOf(tmpObj1) === tmpObj2) return { level: 2 };

      tmpObj1 = {};
      tmpObj1.__proto__ = tmpObj2;
      if (Object.getPrototypeOf(tmpObj1) === tmpObj2) return { level: 1 };

      return false;
    })()
  ));

  require("../create");

  },{"../create":28,"../is-object":31,"../valid-value":44}],42:[function(require,module,exports){
  "use strict";

  module.exports = function (fn) {
    if (typeof fn !== "function") throw new TypeError(fn + " is not a function");
    return fn;
  };

  },{}],43:[function(require,module,exports){
  "use strict";

  var isObject = require("./is-object");

  module.exports = function (value) {
    if (!isObject(value)) throw new TypeError(value + " is not an Object");
    return value;
  };

  },{"./is-object":31}],44:[function(require,module,exports){
  "use strict";

  var isValue = require("./is-value");

  module.exports = function (value) {
    if (!isValue(value)) throw new TypeError("Cannot use null or undefined");
    return value;
  };

  },{"./is-value":32}],45:[function(require,module,exports){
  "use strict";

  module.exports = require("./is-implemented")()
    ? String.prototype.contains
    : require("./shim");

  },{"./is-implemented":46,"./shim":47}],46:[function(require,module,exports){
  "use strict";

  var str = "razdwatrzy";

  module.exports = function () {
    if (typeof str.contains !== "function") return false;
    return (str.contains("dwa") === true) && (str.contains("foo") === false);
  };

  },{}],47:[function(require,module,exports){
  "use strict";

  var indexOf = String.prototype.indexOf;

  module.exports = function (searchString/*, position*/) {
    return indexOf.call(this, searchString, arguments[1]) > -1;
  };

  },{}],48:[function(require,module,exports){
  "use strict";

  var objToString = Object.prototype.toString, id = objToString.call("");

  module.exports = function (value) {
    return (
      typeof value === "string" ||
      (value &&
        typeof value === "object" &&
        (value instanceof String || objToString.call(value) === id)) ||
      false
    );
  };

  },{}],49:[function(require,module,exports){
  "use strict";

  var generated = Object.create(null), random = Math.random;

  module.exports = function () {
    var str;
    do {
      str = random()
        .toString(36)
        .slice(2);
    } while (generated[str]);
    return str;
  };

  },{}],50:[function(require,module,exports){
  "use strict";

  var setPrototypeOf = require("es5-ext/object/set-prototype-of")
    , contains       = require("es5-ext/string/#/contains")
    , d              = require("d")
    , Symbol         = require("es6-symbol")
    , Iterator       = require("./");

  var defineProperty = Object.defineProperty, ArrayIterator;

  ArrayIterator = module.exports = function (arr, kind) {
    if (!(this instanceof ArrayIterator)) throw new TypeError("Constructor requires 'new'");
    Iterator.call(this, arr);
    if (!kind) kind = "value";
    else if (contains.call(kind, "key+value")) kind = "key+value";
    else if (contains.call(kind, "key")) kind = "key";
    else kind = "value";
    defineProperty(this, "__kind__", d("", kind));
  };
  if (setPrototypeOf) setPrototypeOf(ArrayIterator, Iterator);

  // Internal %ArrayIteratorPrototype% doesn't expose its constructor
  delete ArrayIterator.prototype.constructor;

  ArrayIterator.prototype = Object.create(Iterator.prototype, {
    _resolve: d(function (i) {
      if (this.__kind__ === "value") return this.__list__[i];
      if (this.__kind__ === "key+value") return [i, this.__list__[i]];
      return i;
    })
  });
  defineProperty(ArrayIterator.prototype, Symbol.toStringTag, d("c", "Array Iterator"));

  },{"./":53,"d":6,"es5-ext/object/set-prototype-of":39,"es5-ext/string/#/contains":45,"es6-symbol":63}],51:[function(require,module,exports){
  "use strict";

  var isArguments = require("es5-ext/function/is-arguments")
    , callable    = require("es5-ext/object/valid-callable")
    , isString    = require("es5-ext/string/is-string")
    , get         = require("./get");

  var isArray = Array.isArray, call = Function.prototype.call, some = Array.prototype.some;

  module.exports = function (iterable, cb /*, thisArg*/) {
    var mode, thisArg = arguments[2], result, doBreak, broken, i, length, char, code;
    if (isArray(iterable) || isArguments(iterable)) mode = "array";
    else if (isString(iterable)) mode = "string";
    else iterable = get(iterable);

    callable(cb);
    doBreak = function () {
      broken = true;
    };
    if (mode === "array") {
      some.call(iterable, function (value) {
        call.call(cb, thisArg, value, doBreak);
        return broken;
      });
      return;
    }
    if (mode === "string") {
      length = iterable.length;
      for (i = 0; i < length; ++i) {
        char = iterable[i];
        if (i + 1 < length) {
          code = char.charCodeAt(0);
          if (code >= 0xd800 && code <= 0xdbff) char += iterable[++i];
        }
        call.call(cb, thisArg, char, doBreak);
        if (broken) break;
      }
      return;
    }
    result = iterable.next();

    while (!result.done) {
      call.call(cb, thisArg, result.value, doBreak);
      if (broken) return;
      result = iterable.next();
    }
  };

  },{"./get":52,"es5-ext/function/is-arguments":12,"es5-ext/object/valid-callable":42,"es5-ext/string/is-string":48}],52:[function(require,module,exports){
  "use strict";

  var isArguments    = require("es5-ext/function/is-arguments")
    , isString       = require("es5-ext/string/is-string")
    , ArrayIterator  = require("./array")
    , StringIterator = require("./string")
    , iterable       = require("./valid-iterable")
    , iteratorSymbol = require("es6-symbol").iterator;

  module.exports = function (obj) {
    if (typeof iterable(obj)[iteratorSymbol] === "function") return obj[iteratorSymbol]();
    if (isArguments(obj)) return new ArrayIterator(obj);
    if (isString(obj)) return new StringIterator(obj);
    return new ArrayIterator(obj);
  };

  },{"./array":50,"./string":55,"./valid-iterable":56,"es5-ext/function/is-arguments":12,"es5-ext/string/is-string":48,"es6-symbol":63}],53:[function(require,module,exports){
  "use strict";

  var clear    = require("es5-ext/array/#/clear")
    , assign   = require("es5-ext/object/assign")
    , callable = require("es5-ext/object/valid-callable")
    , value    = require("es5-ext/object/valid-value")
    , d        = require("d")
    , autoBind = require("d/auto-bind")
    , Symbol   = require("es6-symbol");

  var defineProperty = Object.defineProperty, defineProperties = Object.defineProperties, Iterator;

  module.exports = Iterator = function (list, context) {
    if (!(this instanceof Iterator)) throw new TypeError("Constructor requires 'new'");
    defineProperties(this, {
      __list__: d("w", value(list)),
      __context__: d("w", context),
      __nextIndex__: d("w", 0)
    });
    if (!context) return;
    callable(context.on);
    context.on("_add", this._onAdd);
    context.on("_delete", this._onDelete);
    context.on("_clear", this._onClear);
  };

  // Internal %IteratorPrototype% doesn't expose its constructor
  delete Iterator.prototype.constructor;

  defineProperties(
    Iterator.prototype,
    assign(
      {
        _next: d(function () {
          var i;
          if (!this.__list__) return undefined;
          if (this.__redo__) {
            i = this.__redo__.shift();
            if (i !== undefined) return i;
          }
          if (this.__nextIndex__ < this.__list__.length) return this.__nextIndex__++;
          this._unBind();
          return undefined;
        }),
        next: d(function () {
          return this._createResult(this._next());
        }),
        _createResult: d(function (i) {
          if (i === undefined) return { done: true, value: undefined };
          return { done: false, value: this._resolve(i) };
        }),
        _resolve: d(function (i) {
          return this.__list__[i];
        }),
        _unBind: d(function () {
          this.__list__ = null;
          delete this.__redo__;
          if (!this.__context__) return;
          this.__context__.off("_add", this._onAdd);
          this.__context__.off("_delete", this._onDelete);
          this.__context__.off("_clear", this._onClear);
          this.__context__ = null;
        }),
        toString: d(function () {
          return "[object " + (this[Symbol.toStringTag] || "Object") + "]";
        })
      },
      autoBind({
        _onAdd: d(function (index) {
          if (index >= this.__nextIndex__) return;
          ++this.__nextIndex__;
          if (!this.__redo__) {
            defineProperty(this, "__redo__", d("c", [index]));
            return;
          }
          this.__redo__.forEach(function (redo, i) {
            if (redo >= index) this.__redo__[i] = ++redo;
          }, this);
          this.__redo__.push(index);
        }),
        _onDelete: d(function (index) {
          var i;
          if (index >= this.__nextIndex__) return;
          --this.__nextIndex__;
          if (!this.__redo__) return;
          i = this.__redo__.indexOf(index);
          if (i !== -1) this.__redo__.splice(i, 1);
          this.__redo__.forEach(function (redo, j) {
            if (redo > index) this.__redo__[j] = --redo;
          }, this);
        }),
        _onClear: d(function () {
          if (this.__redo__) clear.call(this.__redo__);
          this.__nextIndex__ = 0;
        })
      })
    )
  );

  defineProperty(
    Iterator.prototype,
    Symbol.iterator,
    d(function () {
      return this;
    })
  );

  },{"d":6,"d/auto-bind":5,"es5-ext/array/#/clear":7,"es5-ext/object/assign":24,"es5-ext/object/valid-callable":42,"es5-ext/object/valid-value":44,"es6-symbol":63}],54:[function(require,module,exports){
  "use strict";

  var isArguments = require("es5-ext/function/is-arguments")
    , isValue     = require("es5-ext/object/is-value")
    , isString    = require("es5-ext/string/is-string");

  var iteratorSymbol = require("es6-symbol").iterator
    , isArray        = Array.isArray;

  module.exports = function (value) {
    if (!isValue(value)) return false;
    if (isArray(value)) return true;
    if (isString(value)) return true;
    if (isArguments(value)) return true;
    return typeof value[iteratorSymbol] === "function";
  };

  },{"es5-ext/function/is-arguments":12,"es5-ext/object/is-value":32,"es5-ext/string/is-string":48,"es6-symbol":63}],55:[function(require,module,exports){
  // Thanks @mathiasbynens
  // http://mathiasbynens.be/notes/javascript-unicode#iterating-over-symbols

  "use strict";

  var setPrototypeOf = require("es5-ext/object/set-prototype-of")
    , d              = require("d")
    , Symbol         = require("es6-symbol")
    , Iterator       = require("./");

  var defineProperty = Object.defineProperty, StringIterator;

  StringIterator = module.exports = function (str) {
    if (!(this instanceof StringIterator)) throw new TypeError("Constructor requires 'new'");
    str = String(str);
    Iterator.call(this, str);
    defineProperty(this, "__length__", d("", str.length));
  };
  if (setPrototypeOf) setPrototypeOf(StringIterator, Iterator);

  // Internal %ArrayIteratorPrototype% doesn't expose its constructor
  delete StringIterator.prototype.constructor;

  StringIterator.prototype = Object.create(Iterator.prototype, {
    _next: d(function () {
      if (!this.__list__) return undefined;
      if (this.__nextIndex__ < this.__length__) return this.__nextIndex__++;
      this._unBind();
      return undefined;
    }),
    _resolve: d(function (i) {
      var char = this.__list__[i], code;
      if (this.__nextIndex__ === this.__length__) return char;
      code = char.charCodeAt(0);
      if (code >= 0xd800 && code <= 0xdbff) return char + this.__list__[this.__nextIndex__++];
      return char;
    })
  });
  defineProperty(StringIterator.prototype, Symbol.toStringTag, d("c", "String Iterator"));

  },{"./":53,"d":6,"es5-ext/object/set-prototype-of":39,"es6-symbol":63}],56:[function(require,module,exports){
  "use strict";

  var isIterable = require("./is-iterable");

  module.exports = function (value) {
    if (!isIterable(value)) throw new TypeError(value + " is not iterable");
    return value;
  };

  },{"./is-iterable":54}],57:[function(require,module,exports){
  'use strict';

  module.exports = require('./is-implemented')() ? Map : require('./polyfill');

  },{"./is-implemented":58,"./polyfill":62}],58:[function(require,module,exports){
  'use strict';

  module.exports = function () {
    var map, iterator, result;
    if (typeof Map !== 'function') return false;
    try {
      // WebKit doesn't support arguments and crashes
      map = new Map([['raz', 'one'], ['dwa', 'two'], ['trzy', 'three']]);
    } catch (e) {
      return false;
    }
    if (String(map) !== '[object Map]') return false;
    if (map.size !== 3) return false;
    if (typeof map.clear !== 'function') return false;
    if (typeof map.delete !== 'function') return false;
    if (typeof map.entries !== 'function') return false;
    if (typeof map.forEach !== 'function') return false;
    if (typeof map.get !== 'function') return false;
    if (typeof map.has !== 'function') return false;
    if (typeof map.keys !== 'function') return false;
    if (typeof map.set !== 'function') return false;
    if (typeof map.values !== 'function') return false;

    iterator = map.entries();
    result = iterator.next();
    if (result.done !== false) return false;
    if (!result.value) return false;
    if (result.value[0] !== 'raz') return false;
    if (result.value[1] !== 'one') return false;

    return true;
  };

  },{}],59:[function(require,module,exports){
  // Exports true if environment provides native `Map` implementation,
  // whatever that is.

  'use strict';

  module.exports = (function () {
    if (typeof Map === 'undefined') return false;
    return (Object.prototype.toString.call(new Map()) === '[object Map]');
  }());

  },{}],60:[function(require,module,exports){
  'use strict';

  module.exports = require('es5-ext/object/primitive-set')('key',
    'value', 'key+value');

  },{"es5-ext/object/primitive-set":38}],61:[function(require,module,exports){
  'use strict';

  var setPrototypeOf    = require('es5-ext/object/set-prototype-of')
    , d                 = require('d')
    , Iterator          = require('es6-iterator')
    , toStringTagSymbol = require('es6-symbol').toStringTag
    , kinds             = require('./iterator-kinds')

    , defineProperties = Object.defineProperties
    , unBind = Iterator.prototype._unBind
    , MapIterator;

  MapIterator = module.exports = function (map, kind) {
    if (!(this instanceof MapIterator)) return new MapIterator(map, kind);
    Iterator.call(this, map.__mapKeysData__, map);
    if (!kind || !kinds[kind]) kind = 'key+value';
    defineProperties(this, {
      __kind__: d('', kind),
      __values__: d('w', map.__mapValuesData__)
    });
  };
  if (setPrototypeOf) setPrototypeOf(MapIterator, Iterator);

  MapIterator.prototype = Object.create(Iterator.prototype, {
    constructor: d(MapIterator),
    _resolve: d(function (i) {
      if (this.__kind__ === 'value') return this.__values__[i];
      if (this.__kind__ === 'key') return this.__list__[i];
      return [this.__list__[i], this.__values__[i]];
    }),
    _unBind: d(function () {
      this.__values__ = null;
      unBind.call(this);
    }),
    toString: d(function () { return '[object Map Iterator]'; })
  });
  Object.defineProperty(MapIterator.prototype, toStringTagSymbol,
    d('c', 'Map Iterator'));

  },{"./iterator-kinds":60,"d":6,"es5-ext/object/set-prototype-of":39,"es6-iterator":53,"es6-symbol":63}],62:[function(require,module,exports){
  'use strict';

  var clear          = require('es5-ext/array/#/clear')
    , eIndexOf       = require('es5-ext/array/#/e-index-of')
    , setPrototypeOf = require('es5-ext/object/set-prototype-of')
    , callable       = require('es5-ext/object/valid-callable')
    , validValue     = require('es5-ext/object/valid-value')
    , d              = require('d')
    , ee             = require('event-emitter')
    , Symbol         = require('es6-symbol')
    , iterator       = require('es6-iterator/valid-iterable')
    , forOf          = require('es6-iterator/for-of')
    , Iterator       = require('./lib/iterator')
    , isNative       = require('./is-native-implemented')

    , call = Function.prototype.call
    , defineProperties = Object.defineProperties, getPrototypeOf = Object.getPrototypeOf
    , MapPoly;

  module.exports = MapPoly = function (/*iterable*/) {
    var iterable = arguments[0], keys, values, self;
    if (!(this instanceof MapPoly)) throw new TypeError('Constructor requires \'new\'');
    if (isNative && setPrototypeOf && (Map !== MapPoly)) {
      self = setPrototypeOf(new Map(), getPrototypeOf(this));
    } else {
      self = this;
    }
    if (iterable != null) iterator(iterable);
    defineProperties(self, {
      __mapKeysData__: d('c', keys = []),
      __mapValuesData__: d('c', values = [])
    });
    if (!iterable) return self;
    forOf(iterable, function (value) {
      var key = validValue(value)[0];
      value = value[1];
      if (eIndexOf.call(keys, key) !== -1) return;
      keys.push(key);
      values.push(value);
    }, self);
    return self;
  };

  if (isNative) {
    if (setPrototypeOf) setPrototypeOf(MapPoly, Map);
    MapPoly.prototype = Object.create(Map.prototype, {
      constructor: d(MapPoly)
    });
  }

  ee(defineProperties(MapPoly.prototype, {
    clear: d(function () {
      if (!this.__mapKeysData__.length) return;
      clear.call(this.__mapKeysData__);
      clear.call(this.__mapValuesData__);
      this.emit('_clear');
    }),
    delete: d(function (key) {
      var index = eIndexOf.call(this.__mapKeysData__, key);
      if (index === -1) return false;
      this.__mapKeysData__.splice(index, 1);
      this.__mapValuesData__.splice(index, 1);
      this.emit('_delete', index, key);
      return true;
    }),
    entries: d(function () { return new Iterator(this, 'key+value'); }),
    forEach: d(function (cb/*, thisArg*/) {
      var thisArg = arguments[1], iterator, result;
      callable(cb);
      iterator = this.entries();
      result = iterator._next();
      while (result !== undefined) {
        call.call(cb, thisArg, this.__mapValuesData__[result],
          this.__mapKeysData__[result], this);
        result = iterator._next();
      }
    }),
    get: d(function (key) {
      var index = eIndexOf.call(this.__mapKeysData__, key);
      if (index === -1) return;
      return this.__mapValuesData__[index];
    }),
    has: d(function (key) {
      return (eIndexOf.call(this.__mapKeysData__, key) !== -1);
    }),
    keys: d(function () { return new Iterator(this, 'key'); }),
    set: d(function (key, value) {
      var index = eIndexOf.call(this.__mapKeysData__, key), emit;
      if (index === -1) {
        index = this.__mapKeysData__.push(key) - 1;
        emit = true;
      }
      this.__mapValuesData__[index] = value;
      if (emit) this.emit('_add', index, key);
      return this;
    }),
    size: d.gs(function () { return this.__mapKeysData__.length; }),
    values: d(function () { return new Iterator(this, 'value'); }),
    toString: d(function () { return '[object Map]'; })
  }));
  Object.defineProperty(MapPoly.prototype, Symbol.iterator, d(function () {
    return this.entries();
  }));
  Object.defineProperty(MapPoly.prototype, Symbol.toStringTag, d('c', 'Map'));

  },{"./is-native-implemented":59,"./lib/iterator":61,"d":6,"es5-ext/array/#/clear":7,"es5-ext/array/#/e-index-of":8,"es5-ext/object/set-prototype-of":39,"es5-ext/object/valid-callable":42,"es5-ext/object/valid-value":44,"es6-iterator/for-of":51,"es6-iterator/valid-iterable":56,"es6-symbol":63,"event-emitter":99}],63:[function(require,module,exports){
  'use strict';

  module.exports = require('./is-implemented')() ? Symbol : require('./polyfill');

  },{"./is-implemented":64,"./polyfill":66}],64:[function(require,module,exports){
  'use strict';

  var validTypes = { object: true, symbol: true };

  module.exports = function () {
    var symbol;
    if (typeof Symbol !== 'function') return false;
    symbol = Symbol('test symbol');
    try { String(symbol); } catch (e) { return false; }

    // Return 'true' also for polyfills
    if (!validTypes[typeof Symbol.iterator]) return false;
    if (!validTypes[typeof Symbol.toPrimitive]) return false;
    if (!validTypes[typeof Symbol.toStringTag]) return false;

    return true;
  };

  },{}],65:[function(require,module,exports){
  'use strict';

  module.exports = function (x) {
    if (!x) return false;
    if (typeof x === 'symbol') return true;
    if (!x.constructor) return false;
    if (x.constructor.name !== 'Symbol') return false;
    return (x[x.constructor.toStringTag] === 'Symbol');
  };

  },{}],66:[function(require,module,exports){
  // ES2015 Symbol polyfill for environments that do not (or partially) support it

  'use strict';

  var d              = require('d')
    , validateSymbol = require('./validate-symbol')

    , create = Object.create, defineProperties = Object.defineProperties
    , defineProperty = Object.defineProperty, objPrototype = Object.prototype
    , NativeSymbol, SymbolPolyfill, HiddenSymbol, globalSymbols = create(null)
    , isNativeSafe;

  if (typeof Symbol === 'function') {
    NativeSymbol = Symbol;
    try {
      String(NativeSymbol());
      isNativeSafe = true;
    } catch (ignore) {}
  }

  var generateName = (function () {
    var created = create(null);
    return function (desc) {
      var postfix = 0, name, ie11BugWorkaround;
      while (created[desc + (postfix || '')]) ++postfix;
      desc += (postfix || '');
      created[desc] = true;
      name = '@@' + desc;
      defineProperty(objPrototype, name, d.gs(null, function (value) {
        // For IE11 issue see:
        // https://connect.microsoft.com/IE/feedbackdetail/view/1928508/
        //    ie11-broken-getters-on-dom-objects
        // https://github.com/medikoo/es6-symbol/issues/12
        if (ie11BugWorkaround) return;
        ie11BugWorkaround = true;
        defineProperty(this, name, d(value));
        ie11BugWorkaround = false;
      }));
      return name;
    };
  }());

  // Internal constructor (not one exposed) for creating Symbol instances.
  // This one is used to ensure that `someSymbol instanceof Symbol` always return false
  HiddenSymbol = function Symbol(description) {
    if (this instanceof HiddenSymbol) throw new TypeError('Symbol is not a constructor');
    return SymbolPolyfill(description);
  };

  // Exposed `Symbol` constructor
  // (returns instances of HiddenSymbol)
  module.exports = SymbolPolyfill = function Symbol(description) {
    var symbol;
    if (this instanceof Symbol) throw new TypeError('Symbol is not a constructor');
    if (isNativeSafe) return NativeSymbol(description);
    symbol = create(HiddenSymbol.prototype);
    description = (description === undefined ? '' : String(description));
    return defineProperties(symbol, {
      __description__: d('', description),
      __name__: d('', generateName(description))
    });
  };
  defineProperties(SymbolPolyfill, {
    for: d(function (key) {
      if (globalSymbols[key]) return globalSymbols[key];
      return (globalSymbols[key] = SymbolPolyfill(String(key)));
    }),
    keyFor: d(function (s) {
      var key;
      validateSymbol(s);
      for (key in globalSymbols) if (globalSymbols[key] === s) return key;
    }),

    // To ensure proper interoperability with other native functions (e.g. Array.from)
    // fallback to eventual native implementation of given symbol
    hasInstance: d('', (NativeSymbol && NativeSymbol.hasInstance) || SymbolPolyfill('hasInstance')),
    isConcatSpreadable: d('', (NativeSymbol && NativeSymbol.isConcatSpreadable) ||
      SymbolPolyfill('isConcatSpreadable')),
    iterator: d('', (NativeSymbol && NativeSymbol.iterator) || SymbolPolyfill('iterator')),
    match: d('', (NativeSymbol && NativeSymbol.match) || SymbolPolyfill('match')),
    replace: d('', (NativeSymbol && NativeSymbol.replace) || SymbolPolyfill('replace')),
    search: d('', (NativeSymbol && NativeSymbol.search) || SymbolPolyfill('search')),
    species: d('', (NativeSymbol && NativeSymbol.species) || SymbolPolyfill('species')),
    split: d('', (NativeSymbol && NativeSymbol.split) || SymbolPolyfill('split')),
    toPrimitive: d('', (NativeSymbol && NativeSymbol.toPrimitive) || SymbolPolyfill('toPrimitive')),
    toStringTag: d('', (NativeSymbol && NativeSymbol.toStringTag) || SymbolPolyfill('toStringTag')),
    unscopables: d('', (NativeSymbol && NativeSymbol.unscopables) || SymbolPolyfill('unscopables'))
  });

  // Internal tweaks for real symbol producer
  defineProperties(HiddenSymbol.prototype, {
    constructor: d(SymbolPolyfill),
    toString: d('', function () { return this.__name__; })
  });

  // Proper implementation of methods exposed on Symbol.prototype
  // They won't be accessible on produced symbol instances as they derive from HiddenSymbol.prototype
  defineProperties(SymbolPolyfill.prototype, {
    toString: d(function () { return 'Symbol (' + validateSymbol(this).__description__ + ')'; }),
    valueOf: d(function () { return validateSymbol(this); })
  });
  defineProperty(SymbolPolyfill.prototype, SymbolPolyfill.toPrimitive, d('', function () {
    var symbol = validateSymbol(this);
    if (typeof symbol === 'symbol') return symbol;
    return symbol.toString();
  }));
  defineProperty(SymbolPolyfill.prototype, SymbolPolyfill.toStringTag, d('c', 'Symbol'));

  // Proper implementaton of toPrimitive and toStringTag for returned symbol instances
  defineProperty(HiddenSymbol.prototype, SymbolPolyfill.toStringTag,
    d('c', SymbolPolyfill.prototype[SymbolPolyfill.toStringTag]));

  // Note: It's important to define `toPrimitive` as last one, as some implementations
  // implement `toPrimitive` natively without implementing `toStringTag` (or other specified symbols)
  // And that may invoke error in definition flow:
  // See: https://github.com/medikoo/es6-symbol/issues/13#issuecomment-164146149
  defineProperty(HiddenSymbol.prototype, SymbolPolyfill.toPrimitive,
    d('c', SymbolPolyfill.prototype[SymbolPolyfill.toPrimitive]));

  },{"./validate-symbol":67,"d":6}],67:[function(require,module,exports){
  'use strict';

  var isSymbol = require('./is-symbol');

  module.exports = function (value) {
    if (!isSymbol(value)) throw new TypeError(value + " is not a symbol");
    return value;
  };

  },{"./is-symbol":65}],68:[function(require,module,exports){
  'use strict';

  module.exports = require('./is-implemented')() ? WeakMap : require('./polyfill');

  },{"./is-implemented":69,"./polyfill":71}],69:[function(require,module,exports){
  'use strict';

  module.exports = function () {
    var weakMap, x;
    if (typeof WeakMap !== 'function') return false;
    try {
      // WebKit doesn't support arguments and crashes
      weakMap = new WeakMap([[x = {}, 'one'], [{}, 'two'], [{}, 'three']]);
    } catch (e) {
      return false;
    }
    if (String(weakMap) !== '[object WeakMap]') return false;
    if (typeof weakMap.set !== 'function') return false;
    if (weakMap.set({}, 1) !== weakMap) return false;
    if (typeof weakMap.delete !== 'function') return false;
    if (typeof weakMap.has !== 'function') return false;
    if (weakMap.get(x) !== 'one') return false;

    return true;
  };

  },{}],70:[function(require,module,exports){
  // Exports true if environment provides native `WeakMap` implementation, whatever that is.

  'use strict';

  module.exports = (function () {
    if (typeof WeakMap !== 'function') return false;
    return (Object.prototype.toString.call(new WeakMap()) === '[object WeakMap]');
  }());

  },{}],71:[function(require,module,exports){
  'use strict';

  var setPrototypeOf    = require('es5-ext/object/set-prototype-of')
    , object            = require('es5-ext/object/valid-object')
    , value             = require('es5-ext/object/valid-value')
    , randomUniq        = require('es5-ext/string/random-uniq')
    , d                 = require('d')
    , getIterator       = require('es6-iterator/get')
    , forOf             = require('es6-iterator/for-of')
    , toStringTagSymbol = require('es6-symbol').toStringTag
    , isNative          = require('./is-native-implemented')

    , isArray = Array.isArray, defineProperty = Object.defineProperty
    , hasOwnProperty = Object.prototype.hasOwnProperty, getPrototypeOf = Object.getPrototypeOf
    , WeakMapPoly;

  module.exports = WeakMapPoly = function (/*iterable*/) {
    var iterable = arguments[0], self;
    if (!(this instanceof WeakMapPoly)) throw new TypeError('Constructor requires \'new\'');
    if (isNative && setPrototypeOf && (WeakMap !== WeakMapPoly)) {
      self = setPrototypeOf(new WeakMap(), getPrototypeOf(this));
    } else {
      self = this;
    }
    if (iterable != null) {
      if (!isArray(iterable)) iterable = getIterator(iterable);
    }
    defineProperty(self, '__weakMapData__', d('c', '$weakMap$' + randomUniq()));
    if (!iterable) return self;
    forOf(iterable, function (val) {
      value(val);
      self.set(val[0], val[1]);
    });
    return self;
  };

  if (isNative) {
    if (setPrototypeOf) setPrototypeOf(WeakMapPoly, WeakMap);
    WeakMapPoly.prototype = Object.create(WeakMap.prototype, {
      constructor: d(WeakMapPoly)
    });
  }

  Object.defineProperties(WeakMapPoly.prototype, {
    delete: d(function (key) {
      if (hasOwnProperty.call(object(key), this.__weakMapData__)) {
        delete key[this.__weakMapData__];
        return true;
      }
      return false;
    }),
    get: d(function (key) {
      if (hasOwnProperty.call(object(key), this.__weakMapData__)) {
        return key[this.__weakMapData__];
      }
    }),
    has: d(function (key) {
      return hasOwnProperty.call(object(key), this.__weakMapData__);
    }),
    set: d(function (key, value) {
      defineProperty(object(key), this.__weakMapData__, d('c', value));
      return this;
    }),
    toString: d(function () { return '[object WeakMap]'; })
  });
  defineProperty(WeakMapPoly.prototype, toStringTagSymbol, d('c', 'WeakMap'));

  },{"./is-native-implemented":70,"d":6,"es5-ext/object/set-prototype-of":39,"es5-ext/object/valid-object":43,"es5-ext/object/valid-value":44,"es5-ext/string/random-uniq":49,"es6-iterator/for-of":51,"es6-iterator/get":52,"es6-symbol":63}],72:[function(require,module,exports){
  (function (global){
  /*
    Copyright (C) 2012-2014 Yusuke Suzuki <utatane.tea@gmail.com>
    Copyright (C) 2015 Ingvar Stepanyan <me@rreverser.com>
    Copyright (C) 2014 Ivan Nikulin <ifaaan@gmail.com>
    Copyright (C) 2012-2013 Michael Ficarra <escodegen.copyright@michael.ficarra.me>
    Copyright (C) 2012-2013 Mathias Bynens <mathias@qiwi.be>
    Copyright (C) 2013 Irakli Gozalishvili <rfobic@gmail.com>
    Copyright (C) 2012 Robert Gust-Bardon <donate@robert.gust-bardon.org>
    Copyright (C) 2012 John Freeman <jfreeman08@gmail.com>
    Copyright (C) 2011-2012 Ariya Hidayat <ariya.hidayat@gmail.com>
    Copyright (C) 2012 Joost-Wim Boekesteijn <joost-wim@boekesteijn.nl>
    Copyright (C) 2012 Kris Kowal <kris.kowal@cixar.com>
    Copyright (C) 2012 Arpad Borsos <arpad.borsos@googlemail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are met:

      * Redistributions of source code must retain the above copyright
        notice, this list of conditions and the following disclaimer.
      * Redistributions in binary form must reproduce the above copyright
        notice, this list of conditions and the following disclaimer in the
        documentation and/or other materials provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
    DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
    (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
    LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
    ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
    THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
  */

  /*global exports:true, require:true, global:true*/
  (function () {
      'use strict';

      var Syntax,
          Precedence,
          BinaryPrecedence,
          SourceNode,
          estraverse,
          esutils,
          base,
          indent,
          json,
          renumber,
          hexadecimal,
          quotes,
          escapeless,
          newline,
          space,
          parentheses,
          semicolons,
          safeConcatenation,
          directive,
          extra,
          parse,
          sourceMap,
          sourceCode,
          preserveBlankLines,
          FORMAT_MINIFY,
          FORMAT_DEFAULTS;

      estraverse = require('estraverse');
      esutils = require('esutils');

      Syntax = estraverse.Syntax;

      // Generation is done by generateExpression.
      function isExpression(node) {
          return CodeGenerator.Expression.hasOwnProperty(node.type);
      }

      // Generation is done by generateStatement.
      function isStatement(node) {
          return CodeGenerator.Statement.hasOwnProperty(node.type);
      }

      Precedence = {
          Sequence: 0,
          Yield: 1,
          Assignment: 1,
          Conditional: 2,
          ArrowFunction: 2,
          LogicalOR: 3,
          LogicalAND: 4,
          BitwiseOR: 5,
          BitwiseXOR: 6,
          BitwiseAND: 7,
          Equality: 8,
          Relational: 9,
          BitwiseSHIFT: 10,
          Additive: 11,
          Multiplicative: 12,
          Exponentiation: 13,
          Await: 14,
          Unary: 14,
          Postfix: 15,
          Call: 16,
          New: 17,
          TaggedTemplate: 18,
          Member: 19,
          Primary: 20
      };

      BinaryPrecedence = {
          '||': Precedence.LogicalOR,
          '&&': Precedence.LogicalAND,
          '|': Precedence.BitwiseOR,
          '^': Precedence.BitwiseXOR,
          '&': Precedence.BitwiseAND,
          '==': Precedence.Equality,
          '!=': Precedence.Equality,
          '===': Precedence.Equality,
          '!==': Precedence.Equality,
          'is': Precedence.Equality,
          'isnt': Precedence.Equality,
          '<': Precedence.Relational,
          '>': Precedence.Relational,
          '<=': Precedence.Relational,
          '>=': Precedence.Relational,
          'in': Precedence.Relational,
          'instanceof': Precedence.Relational,
          '<<': Precedence.BitwiseSHIFT,
          '>>': Precedence.BitwiseSHIFT,
          '>>>': Precedence.BitwiseSHIFT,
          '+': Precedence.Additive,
          '-': Precedence.Additive,
          '*': Precedence.Multiplicative,
          '%': Precedence.Multiplicative,
          '/': Precedence.Multiplicative,
          '**': Precedence.Exponentiation
      };

      //Flags
      var F_ALLOW_IN = 1,
          F_ALLOW_CALL = 1 << 1,
          F_ALLOW_UNPARATH_NEW = 1 << 2,
          F_FUNC_BODY = 1 << 3,
          F_DIRECTIVE_CTX = 1 << 4,
          F_SEMICOLON_OPT = 1 << 5;

      //Expression flag sets
      //NOTE: Flag order:
      // F_ALLOW_IN
      // F_ALLOW_CALL
      // F_ALLOW_UNPARATH_NEW
      var E_FTT = F_ALLOW_CALL | F_ALLOW_UNPARATH_NEW,
          E_TTF = F_ALLOW_IN | F_ALLOW_CALL,
          E_TTT = F_ALLOW_IN | F_ALLOW_CALL | F_ALLOW_UNPARATH_NEW,
          E_TFF = F_ALLOW_IN,
          E_FFT = F_ALLOW_UNPARATH_NEW,
          E_TFT = F_ALLOW_IN | F_ALLOW_UNPARATH_NEW;

      //Statement flag sets
      //NOTE: Flag order:
      // F_ALLOW_IN
      // F_FUNC_BODY
      // F_DIRECTIVE_CTX
      // F_SEMICOLON_OPT
      var S_TFFF = F_ALLOW_IN,
          S_TFFT = F_ALLOW_IN | F_SEMICOLON_OPT,
          S_FFFF = 0x00,
          S_TFTF = F_ALLOW_IN | F_DIRECTIVE_CTX,
          S_TTFF = F_ALLOW_IN | F_FUNC_BODY;

      function getDefaultOptions() {
          // default options
          return {
              indent: null,
              base: null,
              parse: null,
              comment: false,
              format: {
                  indent: {
                      style: '    ',
                      base: 0,
                      adjustMultilineComment: false
                  },
                  newline: '\n',
                  space: ' ',
                  json: false,
                  renumber: false,
                  hexadecimal: false,
                  quotes: 'single',
                  escapeless: false,
                  compact: false,
                  parentheses: true,
                  semicolons: true,
                  safeConcatenation: false,
                  preserveBlankLines: false
              },
              moz: {
                  comprehensionExpressionStartsWithAssignment: false,
                  starlessGenerator: false
              },
              sourceMap: null,
              sourceMapRoot: null,
              sourceMapWithCode: false,
              directive: false,
              raw: true,
              verbatim: null,
              sourceCode: null
          };
      }

      function stringRepeat(str, num) {
          var result = '';

          for (num |= 0; num > 0; num >>>= 1, str += str) {
              if (num & 1) {
                  result += str;
              }
          }

          return result;
      }

      function hasLineTerminator(str) {
          return (/[\r\n]/g).test(str);
      }

      function endsWithLineTerminator(str) {
          var len = str.length;
          return len && esutils.code.isLineTerminator(str.charCodeAt(len - 1));
      }

      function merge(target, override) {
          var key;
          for (key in override) {
              if (override.hasOwnProperty(key)) {
                  target[key] = override[key];
              }
          }
          return target;
      }

      function updateDeeply(target, override) {
          var key, val;

          function isHashObject(target) {
              return typeof target === 'object' && target instanceof Object && !(target instanceof RegExp);
          }

          for (key in override) {
              if (override.hasOwnProperty(key)) {
                  val = override[key];
                  if (isHashObject(val)) {
                      if (isHashObject(target[key])) {
                          updateDeeply(target[key], val);
                      } else {
                          target[key] = updateDeeply({}, val);
                      }
                  } else {
                      target[key] = val;
                  }
              }
          }
          return target;
      }

      function generateNumber(value) {
          var result, point, temp, exponent, pos;

          if (value !== value) {
              throw new Error('Numeric literal whose value is NaN');
          }
          if (value < 0 || (value === 0 && 1 / value < 0)) {
              throw new Error('Numeric literal whose value is negative');
          }

          if (value === 1 / 0) {
              return json ? 'null' : renumber ? '1e400' : '1e+400';
          }

          result = '' + value;
          if (!renumber || result.length < 3) {
              return result;
          }

          point = result.indexOf('.');
          if (!json && result.charCodeAt(0) === 0x30  /* 0 */ && point === 1) {
              point = 0;
              result = result.slice(1);
          }
          temp = result;
          result = result.replace('e+', 'e');
          exponent = 0;
          if ((pos = temp.indexOf('e')) > 0) {
              exponent = +temp.slice(pos + 1);
              temp = temp.slice(0, pos);
          }
          if (point >= 0) {
              exponent -= temp.length - point - 1;
              temp = +(temp.slice(0, point) + temp.slice(point + 1)) + '';
          }
          pos = 0;
          while (temp.charCodeAt(temp.length + pos - 1) === 0x30  /* 0 */) {
              --pos;
          }
          if (pos !== 0) {
              exponent -= pos;
              temp = temp.slice(0, pos);
          }
          if (exponent !== 0) {
              temp += 'e' + exponent;
          }
          if ((temp.length < result.length ||
                      (hexadecimal && value > 1e12 && Math.floor(value) === value && (temp = '0x' + value.toString(16)).length < result.length)) &&
                  +temp === value) {
              result = temp;
          }

          return result;
      }

      // Generate valid RegExp expression.
      // This function is based on https://github.com/Constellation/iv Engine

      function escapeRegExpCharacter(ch, previousIsBackslash) {
          // not handling '\' and handling \u2028 or \u2029 to unicode escape sequence
          if ((ch & ~1) === 0x2028) {
              return (previousIsBackslash ? 'u' : '\\u') + ((ch === 0x2028) ? '2028' : '2029');
          } else if (ch === 10 || ch === 13) {  // \n, \r
              return (previousIsBackslash ? '' : '\\') + ((ch === 10) ? 'n' : 'r');
          }
          return String.fromCharCode(ch);
      }

      function generateRegExp(reg) {
          var match, result, flags, i, iz, ch, characterInBrack, previousIsBackslash;

          result = reg.toString();

          if (reg.source) {
              // extract flag from toString result
              match = result.match(/\/([^/]*)$/);
              if (!match) {
                  return result;
              }

              flags = match[1];
              result = '';

              characterInBrack = false;
              previousIsBackslash = false;
              for (i = 0, iz = reg.source.length; i < iz; ++i) {
                  ch = reg.source.charCodeAt(i);

                  if (!previousIsBackslash) {
                      if (characterInBrack) {
                          if (ch === 93) {  // ]
                              characterInBrack = false;
                          }
                      } else {
                          if (ch === 47) {  // /
                              result += '\\';
                          } else if (ch === 91) {  // [
                              characterInBrack = true;
                          }
                      }
                      result += escapeRegExpCharacter(ch, previousIsBackslash);
                      previousIsBackslash = ch === 92;  // \
                  } else {
                      // if new RegExp("\\\n') is provided, create /\n/
                      result += escapeRegExpCharacter(ch, previousIsBackslash);
                      // prevent like /\\[/]/
                      previousIsBackslash = false;
                  }
              }

              return '/' + result + '/' + flags;
          }

          return result;
      }

      function escapeAllowedCharacter(code, next) {
          var hex;

          if (code === 0x08  /* \b */) {
              return '\\b';
          }

          if (code === 0x0C  /* \f */) {
              return '\\f';
          }

          if (code === 0x09  /* \t */) {
              return '\\t';
          }

          hex = code.toString(16).toUpperCase();
          if (json || code > 0xFF) {
              return '\\u' + '0000'.slice(hex.length) + hex;
          } else if (code === 0x0000 && !esutils.code.isDecimalDigit(next)) {
              return '\\0';
          } else if (code === 0x000B  /* \v */) { // '\v'
              return '\\x0B';
          } else {
              return '\\x' + '00'.slice(hex.length) + hex;
          }
      }

      function escapeDisallowedCharacter(code) {
          if (code === 0x5C  /* \ */) {
              return '\\\\';
          }

          if (code === 0x0A  /* \n */) {
              return '\\n';
          }

          if (code === 0x0D  /* \r */) {
              return '\\r';
          }

          if (code === 0x2028) {
              return '\\u2028';
          }

          if (code === 0x2029) {
              return '\\u2029';
          }

          throw new Error('Incorrectly classified character');
      }

      function escapeDirective(str) {
          var i, iz, code, quote;

          quote = quotes === 'double' ? '"' : '\'';
          for (i = 0, iz = str.length; i < iz; ++i) {
              code = str.charCodeAt(i);
              if (code === 0x27  /* ' */) {
                  quote = '"';
                  break;
              } else if (code === 0x22  /* " */) {
                  quote = '\'';
                  break;
              } else if (code === 0x5C  /* \ */) {
                  ++i;
              }
          }

          return quote + str + quote;
      }

      function escapeString(str) {
          var result = '', i, len, code, singleQuotes = 0, doubleQuotes = 0, single, quote;

          for (i = 0, len = str.length; i < len; ++i) {
              code = str.charCodeAt(i);
              if (code === 0x27  /* ' */) {
                  ++singleQuotes;
              } else if (code === 0x22  /* " */) {
                  ++doubleQuotes;
              } else if (code === 0x2F  /* / */ && json) {
                  result += '\\';
              } else if (esutils.code.isLineTerminator(code) || code === 0x5C  /* \ */) {
                  result += escapeDisallowedCharacter(code);
                  continue;
              } else if (!esutils.code.isIdentifierPartES5(code) && (json && code < 0x20  /* SP */ || !json && !escapeless && (code < 0x20  /* SP */ || code > 0x7E  /* ~ */))) {
                  result += escapeAllowedCharacter(code, str.charCodeAt(i + 1));
                  continue;
              }
              result += String.fromCharCode(code);
          }

          single = !(quotes === 'double' || (quotes === 'auto' && doubleQuotes < singleQuotes));
          quote = single ? '\'' : '"';

          if (!(single ? singleQuotes : doubleQuotes)) {
              return quote + result + quote;
          }

          str = result;
          result = quote;

          for (i = 0, len = str.length; i < len; ++i) {
              code = str.charCodeAt(i);
              if ((code === 0x27  /* ' */ && single) || (code === 0x22  /* " */ && !single)) {
                  result += '\\';
              }
              result += String.fromCharCode(code);
          }

          return result + quote;
      }

      /**
       * flatten an array to a string, where the array can contain
       * either strings or nested arrays
       */
      function flattenToString(arr) {
          var i, iz, elem, result = '';
          for (i = 0, iz = arr.length; i < iz; ++i) {
              elem = arr[i];
              result += Array.isArray(elem) ? flattenToString(elem) : elem;
          }
          return result;
      }

      /**
       * convert generated to a SourceNode when source maps are enabled.
       */
      function toSourceNodeWhenNeeded(generated, node) {
          if (!sourceMap) {
              // with no source maps, generated is either an
              // array or a string.  if an array, flatten it.
              // if a string, just return it
              if (Array.isArray(generated)) {
                  return flattenToString(generated);
              } else {
                  return generated;
              }
          }
          if (node == null) {
              if (generated instanceof SourceNode) {
                  return generated;
              } else {
                  node = {};
              }
          }
          if (node.loc == null) {
              return new SourceNode(null, null, sourceMap, generated, node.name || null);
          }
          return new SourceNode(node.loc.start.line, node.loc.start.column, (sourceMap === true ? node.loc.source || null : sourceMap), generated, node.name || null);
      }

      function noEmptySpace() {
          return (space) ? space : ' ';
      }

      function join(left, right) {
          var leftSource,
              rightSource,
              leftCharCode,
              rightCharCode;

          leftSource = toSourceNodeWhenNeeded(left).toString();
          if (leftSource.length === 0) {
              return [right];
          }

          rightSource = toSourceNodeWhenNeeded(right).toString();
          if (rightSource.length === 0) {
              return [left];
          }

          leftCharCode = leftSource.charCodeAt(leftSource.length - 1);
          rightCharCode = rightSource.charCodeAt(0);

          if ((leftCharCode === 0x2B  /* + */ || leftCharCode === 0x2D  /* - */) && leftCharCode === rightCharCode ||
              esutils.code.isIdentifierPartES5(leftCharCode) && esutils.code.isIdentifierPartES5(rightCharCode) ||
              leftCharCode === 0x2F  /* / */ && rightCharCode === 0x69  /* i */) { // infix word operators all start with `i`
              return [left, noEmptySpace(), right];
          } else if (esutils.code.isWhiteSpace(leftCharCode) || esutils.code.isLineTerminator(leftCharCode) ||
                  esutils.code.isWhiteSpace(rightCharCode) || esutils.code.isLineTerminator(rightCharCode)) {
              return [left, right];
          }
          return [left, space, right];
      }

      function addIndent(stmt) {
          return [base, stmt];
      }

      function withIndent(fn) {
          var previousBase;
          previousBase = base;
          base += indent;
          fn(base);
          base = previousBase;
      }

      function calculateSpaces(str) {
          var i;
          for (i = str.length - 1; i >= 0; --i) {
              if (esutils.code.isLineTerminator(str.charCodeAt(i))) {
                  break;
              }
          }
          return (str.length - 1) - i;
      }

      function adjustMultilineComment(value, specialBase) {
          var array, i, len, line, j, spaces, previousBase, sn;

          array = value.split(/\r\n|[\r\n]/);
          spaces = Number.MAX_VALUE;

          // first line doesn't have indentation
          for (i = 1, len = array.length; i < len; ++i) {
              line = array[i];
              j = 0;
              while (j < line.length && esutils.code.isWhiteSpace(line.charCodeAt(j))) {
                  ++j;
              }
              if (spaces > j) {
                  spaces = j;
              }
          }

          if (typeof specialBase !== 'undefined') {
              // pattern like
              // {
              //   var t = 20;  /*
              //                 * this is comment
              //                 */
              // }
              previousBase = base;
              if (array[1][spaces] === '*') {
                  specialBase += ' ';
              }
              base = specialBase;
          } else {
              if (spaces & 1) {
                  // /*
                  //  *
                  //  */
                  // If spaces are odd number, above pattern is considered.
                  // We waste 1 space.
                  --spaces;
              }
              previousBase = base;
          }

          for (i = 1, len = array.length; i < len; ++i) {
              sn = toSourceNodeWhenNeeded(addIndent(array[i].slice(spaces)));
              array[i] = sourceMap ? sn.join('') : sn;
          }

          base = previousBase;

          return array.join('\n');
      }

      function generateComment(comment, specialBase) {
          if (comment.type === 'Line') {
              if (endsWithLineTerminator(comment.value)) {
                  return '//' + comment.value;
              } else {
                  // Always use LineTerminator
                  var result = '//' + comment.value;
                  if (!preserveBlankLines) {
                      result += '\n';
                  }
                  return result;
              }
          }
          if (extra.format.indent.adjustMultilineComment && /[\n\r]/.test(comment.value)) {
              return adjustMultilineComment('/*' + comment.value + '*/', specialBase);
          }
          return '/*' + comment.value + '*/';
      }

      function addComments(stmt, result) {
          var i, len, comment, save, tailingToStatement, specialBase, fragment,
              extRange, range, prevRange, prefix, infix, suffix, count;

          if (stmt.leadingComments && stmt.leadingComments.length > 0) {
              save = result;

              if (preserveBlankLines) {
                  comment = stmt.leadingComments[0];
                  result = [];

                  extRange = comment.extendedRange;
                  range = comment.range;

                  prefix = sourceCode.substring(extRange[0], range[0]);
                  count = (prefix.match(/\n/g) || []).length;
                  if (count > 0) {
                      result.push(stringRepeat('\n', count));
                      result.push(addIndent(generateComment(comment)));
                  } else {
                      result.push(prefix);
                      result.push(generateComment(comment));
                  }

                  prevRange = range;

                  for (i = 1, len = stmt.leadingComments.length; i < len; i++) {
                      comment = stmt.leadingComments[i];
                      range = comment.range;

                      infix = sourceCode.substring(prevRange[1], range[0]);
                      count = (infix.match(/\n/g) || []).length;
                      result.push(stringRepeat('\n', count));
                      result.push(addIndent(generateComment(comment)));

                      prevRange = range;
                  }

                  suffix = sourceCode.substring(range[1], extRange[1]);
                  count = (suffix.match(/\n/g) || []).length;
                  result.push(stringRepeat('\n', count));
              } else {
                  comment = stmt.leadingComments[0];
                  result = [];
                  if (safeConcatenation && stmt.type === Syntax.Program && stmt.body.length === 0) {
                      result.push('\n');
                  }
                  result.push(generateComment(comment));
                  if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                      result.push('\n');
                  }

                  for (i = 1, len = stmt.leadingComments.length; i < len; ++i) {
                      comment = stmt.leadingComments[i];
                      fragment = [generateComment(comment)];
                      if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                          fragment.push('\n');
                      }
                      result.push(addIndent(fragment));
                  }
              }

              result.push(addIndent(save));
          }

          if (stmt.trailingComments) {

              if (preserveBlankLines) {
                  comment = stmt.trailingComments[0];
                  extRange = comment.extendedRange;
                  range = comment.range;

                  prefix = sourceCode.substring(extRange[0], range[0]);
                  count = (prefix.match(/\n/g) || []).length;

                  if (count > 0) {
                      result.push(stringRepeat('\n', count));
                      result.push(addIndent(generateComment(comment)));
                  } else {
                      result.push(prefix);
                      result.push(generateComment(comment));
                  }
              } else {
                  tailingToStatement = !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString());
                  specialBase = stringRepeat(' ', calculateSpaces(toSourceNodeWhenNeeded([base, result, indent]).toString()));
                  for (i = 0, len = stmt.trailingComments.length; i < len; ++i) {
                      comment = stmt.trailingComments[i];
                      if (tailingToStatement) {
                          // We assume target like following script
                          //
                          // var t = 20;  /**
                          //               * This is comment of t
                          //               */
                          if (i === 0) {
                              // first case
                              result = [result, indent];
                          } else {
                              result = [result, specialBase];
                          }
                          result.push(generateComment(comment, specialBase));
                      } else {
                          result = [result, addIndent(generateComment(comment))];
                      }
                      if (i !== len - 1 && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                          result = [result, '\n'];
                      }
                  }
              }
          }

          return result;
      }

      function generateBlankLines(start, end, result) {
          var j, newlineCount = 0;

          for (j = start; j < end; j++) {
              if (sourceCode[j] === '\n') {
                  newlineCount++;
              }
          }

          for (j = 1; j < newlineCount; j++) {
              result.push(newline);
          }
      }

      function parenthesize(text, current, should) {
          if (current < should) {
              return ['(', text, ')'];
          }
          return text;
      }

      function generateVerbatimString(string) {
          var i, iz, result;
          result = string.split(/\r\n|\n/);
          for (i = 1, iz = result.length; i < iz; i++) {
              result[i] = newline + base + result[i];
          }
          return result;
      }

      function generateVerbatim(expr, precedence) {
          var verbatim, result, prec;
          verbatim = expr[extra.verbatim];

          if (typeof verbatim === 'string') {
              result = parenthesize(generateVerbatimString(verbatim), Precedence.Sequence, precedence);
          } else {
              // verbatim is object
              result = generateVerbatimString(verbatim.content);
              prec = (verbatim.precedence != null) ? verbatim.precedence : Precedence.Sequence;
              result = parenthesize(result, prec, precedence);
          }

          return toSourceNodeWhenNeeded(result, expr);
      }

      function CodeGenerator() {
      }

      // Helpers.

      CodeGenerator.prototype.maybeBlock = function(stmt, flags) {
          var result, noLeadingComment, that = this;

          noLeadingComment = !extra.comment || !stmt.leadingComments;

          if (stmt.type === Syntax.BlockStatement && noLeadingComment) {
              return [space, this.generateStatement(stmt, flags)];
          }

          if (stmt.type === Syntax.EmptyStatement && noLeadingComment) {
              return ';';
          }

          withIndent(function () {
              result = [
                  newline,
                  addIndent(that.generateStatement(stmt, flags))
              ];
          });

          return result;
      };

      CodeGenerator.prototype.maybeBlockSuffix = function (stmt, result) {
          var ends = endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString());
          if (stmt.type === Syntax.BlockStatement && (!extra.comment || !stmt.leadingComments) && !ends) {
              return [result, space];
          }
          if (ends) {
              return [result, base];
          }
          return [result, newline, base];
      };

      function generateIdentifier(node) {
          return toSourceNodeWhenNeeded(node.name, node);
      }

      function generateAsyncPrefix(node, spaceRequired) {
          return node.async ? 'async' + (spaceRequired ? noEmptySpace() : space) : '';
      }

      function generateStarSuffix(node) {
          var isGenerator = node.generator && !extra.moz.starlessGenerator;
          return isGenerator ? '*' + space : '';
      }

      function generateMethodPrefix(prop) {
          var func = prop.value, prefix = '';
          if (func.async) {
              prefix += generateAsyncPrefix(func, !prop.computed);
          }
          if (func.generator) {
              // avoid space before method name
              prefix += generateStarSuffix(func) ? '*' : '';
          }
          return prefix;
      }

      CodeGenerator.prototype.generatePattern = function (node, precedence, flags) {
          if (node.type === Syntax.Identifier) {
              return generateIdentifier(node);
          }
          return this.generateExpression(node, precedence, flags);
      };

      CodeGenerator.prototype.generateFunctionParams = function (node) {
          var i, iz, result, hasDefault;

          hasDefault = false;

          if (node.type === Syntax.ArrowFunctionExpression &&
                  !node.rest && (!node.defaults || node.defaults.length === 0) &&
                  node.params.length === 1 && node.params[0].type === Syntax.Identifier) {
              // arg => { } case
              result = [generateAsyncPrefix(node, true), generateIdentifier(node.params[0])];
          } else {
              result = node.type === Syntax.ArrowFunctionExpression ? [generateAsyncPrefix(node, false)] : [];
              result.push('(');
              if (node.defaults) {
                  hasDefault = true;
              }
              for (i = 0, iz = node.params.length; i < iz; ++i) {
                  if (hasDefault && node.defaults[i]) {
                      // Handle default values.
                      result.push(this.generateAssignment(node.params[i], node.defaults[i], '=', Precedence.Assignment, E_TTT));
                  } else {
                      result.push(this.generatePattern(node.params[i], Precedence.Assignment, E_TTT));
                  }
                  if (i + 1 < iz) {
                      result.push(',' + space);
                  }
              }

              if (node.rest) {
                  if (node.params.length) {
                      result.push(',' + space);
                  }
                  result.push('...');
                  result.push(generateIdentifier(node.rest));
              }

              result.push(')');
          }

          return result;
      };

      CodeGenerator.prototype.generateFunctionBody = function (node) {
          var result, expr;

          result = this.generateFunctionParams(node);

          if (node.type === Syntax.ArrowFunctionExpression) {
              result.push(space);
              result.push('=>');
          }

          if (node.expression) {
              result.push(space);
              expr = this.generateExpression(node.body, Precedence.Assignment, E_TTT);
              if (expr.toString().charAt(0) === '{') {
                  expr = ['(', expr, ')'];
              }
              result.push(expr);
          } else {
              result.push(this.maybeBlock(node.body, S_TTFF));
          }

          return result;
      };

      CodeGenerator.prototype.generateIterationForStatement = function (operator, stmt, flags) {
          var result = ['for' + (stmt.await ? noEmptySpace() + 'await' : '') + space + '('], that = this;
          withIndent(function () {
              if (stmt.left.type === Syntax.VariableDeclaration) {
                  withIndent(function () {
                      result.push(stmt.left.kind + noEmptySpace());
                      result.push(that.generateStatement(stmt.left.declarations[0], S_FFFF));
                  });
              } else {
                  result.push(that.generateExpression(stmt.left, Precedence.Call, E_TTT));
              }

              result = join(result, operator);
              result = [join(
                  result,
                  that.generateExpression(stmt.right, Precedence.Assignment, E_TTT)
              ), ')'];
          });
          result.push(this.maybeBlock(stmt.body, flags));
          return result;
      };

      CodeGenerator.prototype.generatePropertyKey = function (expr, computed) {
          var result = [];

          if (computed) {
              result.push('[');
          }

          result.push(this.generateExpression(expr, Precedence.Assignment, E_TTT));

          if (computed) {
              result.push(']');
          }

          return result;
      };

      CodeGenerator.prototype.generateAssignment = function (left, right, operator, precedence, flags) {
          if (Precedence.Assignment < precedence) {
              flags |= F_ALLOW_IN;
          }

          return parenthesize(
              [
                  this.generateExpression(left, Precedence.Call, flags),
                  space + operator + space,
                  this.generateExpression(right, Precedence.Assignment, flags)
              ],
              Precedence.Assignment,
              precedence
          );
      };

      CodeGenerator.prototype.semicolon = function (flags) {
          if (!semicolons && flags & F_SEMICOLON_OPT) {
              return '';
          }
          return ';';
      };

      // Statements.

      CodeGenerator.Statement = {

          BlockStatement: function (stmt, flags) {
              var range, content, result = ['{', newline], that = this;

              withIndent(function () {
                  // handle functions without any code
                  if (stmt.body.length === 0 && preserveBlankLines) {
                      range = stmt.range;
                      if (range[1] - range[0] > 2) {
                          content = sourceCode.substring(range[0] + 1, range[1] - 1);
                          if (content[0] === '\n') {
                              result = ['{'];
                          }
                          result.push(content);
                      }
                  }

                  var i, iz, fragment, bodyFlags;
                  bodyFlags = S_TFFF;
                  if (flags & F_FUNC_BODY) {
                      bodyFlags |= F_DIRECTIVE_CTX;
                  }

                  for (i = 0, iz = stmt.body.length; i < iz; ++i) {
                      if (preserveBlankLines) {
                          // handle spaces before the first line
                          if (i === 0) {
                              if (stmt.body[0].leadingComments) {
                                  range = stmt.body[0].leadingComments[0].extendedRange;
                                  content = sourceCode.substring(range[0], range[1]);
                                  if (content[0] === '\n') {
                                      result = ['{'];
                                  }
                              }
                              if (!stmt.body[0].leadingComments) {
                                  generateBlankLines(stmt.range[0], stmt.body[0].range[0], result);
                              }
                          }

                          // handle spaces between lines
                          if (i > 0) {
                              if (!stmt.body[i - 1].trailingComments  && !stmt.body[i].leadingComments) {
                                  generateBlankLines(stmt.body[i - 1].range[1], stmt.body[i].range[0], result);
                              }
                          }
                      }

                      if (i === iz - 1) {
                          bodyFlags |= F_SEMICOLON_OPT;
                      }

                      if (stmt.body[i].leadingComments && preserveBlankLines) {
                          fragment = that.generateStatement(stmt.body[i], bodyFlags);
                      } else {
                          fragment = addIndent(that.generateStatement(stmt.body[i], bodyFlags));
                      }

                      result.push(fragment);
                      if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                          if (preserveBlankLines && i < iz - 1) {
                              // don't add a new line if there are leading coments
                              // in the next statement
                              if (!stmt.body[i + 1].leadingComments) {
                                  result.push(newline);
                              }
                          } else {
                              result.push(newline);
                          }
                      }

                      if (preserveBlankLines) {
                          // handle spaces after the last line
                          if (i === iz - 1) {
                              if (!stmt.body[i].trailingComments) {
                                  generateBlankLines(stmt.body[i].range[1], stmt.range[1], result);
                              }
                          }
                      }
                  }
              });

              result.push(addIndent('}'));
              return result;
          },

          BreakStatement: function (stmt, flags) {
              if (stmt.label) {
                  return 'break ' + stmt.label.name + this.semicolon(flags);
              }
              return 'break' + this.semicolon(flags);
          },

          ContinueStatement: function (stmt, flags) {
              if (stmt.label) {
                  return 'continue ' + stmt.label.name + this.semicolon(flags);
              }
              return 'continue' + this.semicolon(flags);
          },

          ClassBody: function (stmt, flags) {
              var result = [ '{', newline], that = this;

              withIndent(function (indent) {
                  var i, iz;

                  for (i = 0, iz = stmt.body.length; i < iz; ++i) {
                      result.push(indent);
                      result.push(that.generateExpression(stmt.body[i], Precedence.Sequence, E_TTT));
                      if (i + 1 < iz) {
                          result.push(newline);
                      }
                  }
              });

              if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                  result.push(newline);
              }
              result.push(base);
              result.push('}');
              return result;
          },

          ClassDeclaration: function (stmt, flags) {
              var result, fragment;
              result  = ['class'];
              if (stmt.id) {
                  result = join(result, this.generateExpression(stmt.id, Precedence.Sequence, E_TTT));
              }
              if (stmt.superClass) {
                  fragment = join('extends', this.generateExpression(stmt.superClass, Precedence.Unary, E_TTT));
                  result = join(result, fragment);
              }
              result.push(space);
              result.push(this.generateStatement(stmt.body, S_TFFT));
              return result;
          },

          DirectiveStatement: function (stmt, flags) {
              if (extra.raw && stmt.raw) {
                  return stmt.raw + this.semicolon(flags);
              }
              return escapeDirective(stmt.directive) + this.semicolon(flags);
          },

          DoWhileStatement: function (stmt, flags) {
              // Because `do 42 while (cond)` is Syntax Error. We need semicolon.
              var result = join('do', this.maybeBlock(stmt.body, S_TFFF));
              result = this.maybeBlockSuffix(stmt.body, result);
              return join(result, [
                  'while' + space + '(',
                  this.generateExpression(stmt.test, Precedence.Sequence, E_TTT),
                  ')' + this.semicolon(flags)
              ]);
          },

          CatchClause: function (stmt, flags) {
              var result, that = this;
              withIndent(function () {
                  var guard;

                  if (stmt.param) {
                      result = [
                          'catch' + space + '(',
                          that.generateExpression(stmt.param, Precedence.Sequence, E_TTT),
                          ')'
                      ];

                      if (stmt.guard) {
                          guard = that.generateExpression(stmt.guard, Precedence.Sequence, E_TTT);
                          result.splice(2, 0, ' if ', guard);
                      }
                  } else {
                      result = ['catch'];
                  }
              });
              result.push(this.maybeBlock(stmt.body, S_TFFF));
              return result;
          },

          DebuggerStatement: function (stmt, flags) {
              return 'debugger' + this.semicolon(flags);
          },

          EmptyStatement: function (stmt, flags) {
              return ';';
          },

          ExportDefaultDeclaration: function (stmt, flags) {
              var result = [ 'export' ], bodyFlags;

              bodyFlags = (flags & F_SEMICOLON_OPT) ? S_TFFT : S_TFFF;

              // export default HoistableDeclaration[Default]
              // export default AssignmentExpression[In] ;
              result = join(result, 'default');
              if (isStatement(stmt.declaration)) {
                  result = join(result, this.generateStatement(stmt.declaration, bodyFlags));
              } else {
                  result = join(result, this.generateExpression(stmt.declaration, Precedence.Assignment, E_TTT) + this.semicolon(flags));
              }
              return result;
          },

          ExportNamedDeclaration: function (stmt, flags) {
              var result = [ 'export' ], bodyFlags, that = this;

              bodyFlags = (flags & F_SEMICOLON_OPT) ? S_TFFT : S_TFFF;

              // export VariableStatement
              // export Declaration[Default]
              if (stmt.declaration) {
                  return join(result, this.generateStatement(stmt.declaration, bodyFlags));
              }

              // export ExportClause[NoReference] FromClause ;
              // export ExportClause ;
              if (stmt.specifiers) {
                  if (stmt.specifiers.length === 0) {
                      result = join(result, '{' + space + '}');
                  } else if (stmt.specifiers[0].type === Syntax.ExportBatchSpecifier) {
                      result = join(result, this.generateExpression(stmt.specifiers[0], Precedence.Sequence, E_TTT));
                  } else {
                      result = join(result, '{');
                      withIndent(function (indent) {
                          var i, iz;
                          result.push(newline);
                          for (i = 0, iz = stmt.specifiers.length; i < iz; ++i) {
                              result.push(indent);
                              result.push(that.generateExpression(stmt.specifiers[i], Precedence.Sequence, E_TTT));
                              if (i + 1 < iz) {
                                  result.push(',' + newline);
                              }
                          }
                      });
                      if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                          result.push(newline);
                      }
                      result.push(base + '}');
                  }

                  if (stmt.source) {
                      result = join(result, [
                          'from' + space,
                          // ModuleSpecifier
                          this.generateExpression(stmt.source, Precedence.Sequence, E_TTT),
                          this.semicolon(flags)
                      ]);
                  } else {
                      result.push(this.semicolon(flags));
                  }
              }
              return result;
          },

          ExportAllDeclaration: function (stmt, flags) {
              // export * FromClause ;
              return [
                  'export' + space,
                  '*' + space,
                  'from' + space,
                  // ModuleSpecifier
                  this.generateExpression(stmt.source, Precedence.Sequence, E_TTT),
                  this.semicolon(flags)
              ];
          },

          ExpressionStatement: function (stmt, flags) {
              var result, fragment;

              function isClassPrefixed(fragment) {
                  var code;
                  if (fragment.slice(0, 5) !== 'class') {
                      return false;
                  }
                  code = fragment.charCodeAt(5);
                  return code === 0x7B  /* '{' */ || esutils.code.isWhiteSpace(code) || esutils.code.isLineTerminator(code);
              }

              function isFunctionPrefixed(fragment) {
                  var code;
                  if (fragment.slice(0, 8) !== 'function') {
                      return false;
                  }
                  code = fragment.charCodeAt(8);
                  return code === 0x28 /* '(' */ || esutils.code.isWhiteSpace(code) || code === 0x2A  /* '*' */ || esutils.code.isLineTerminator(code);
              }

              function isAsyncPrefixed(fragment) {
                  var code, i, iz;
                  if (fragment.slice(0, 5) !== 'async') {
                      return false;
                  }
                  if (!esutils.code.isWhiteSpace(fragment.charCodeAt(5))) {
                      return false;
                  }
                  for (i = 6, iz = fragment.length; i < iz; ++i) {
                      if (!esutils.code.isWhiteSpace(fragment.charCodeAt(i))) {
                          break;
                      }
                  }
                  if (i === iz) {
                      return false;
                  }
                  if (fragment.slice(i, i + 8) !== 'function') {
                      return false;
                  }
                  code = fragment.charCodeAt(i + 8);
                  return code === 0x28 /* '(' */ || esutils.code.isWhiteSpace(code) || code === 0x2A  /* '*' */ || esutils.code.isLineTerminator(code);
              }

              result = [this.generateExpression(stmt.expression, Precedence.Sequence, E_TTT)];
              // 12.4 '{', 'function', 'class' is not allowed in this position.
              // wrap expression with parentheses
              fragment = toSourceNodeWhenNeeded(result).toString();
              if (fragment.charCodeAt(0) === 0x7B  /* '{' */ ||  // ObjectExpression
                      isClassPrefixed(fragment) ||
                      isFunctionPrefixed(fragment) ||
                      isAsyncPrefixed(fragment) ||
                      (directive && (flags & F_DIRECTIVE_CTX) && stmt.expression.type === Syntax.Literal && typeof stmt.expression.value === 'string')) {
                  result = ['(', result, ')' + this.semicolon(flags)];
              } else {
                  result.push(this.semicolon(flags));
              }
              return result;
          },

          ImportDeclaration: function (stmt, flags) {
              // ES6: 15.2.1 valid import declarations:
              //     - import ImportClause FromClause ;
              //     - import ModuleSpecifier ;
              var result, cursor, that = this;

              // If no ImportClause is present,
              // this should be `import ModuleSpecifier` so skip `from`
              // ModuleSpecifier is StringLiteral.
              if (stmt.specifiers.length === 0) {
                  // import ModuleSpecifier ;
                  return [
                      'import',
                      space,
                      // ModuleSpecifier
                      this.generateExpression(stmt.source, Precedence.Sequence, E_TTT),
                      this.semicolon(flags)
                  ];
              }

              // import ImportClause FromClause ;
              result = [
                  'import'
              ];
              cursor = 0;

              // ImportedBinding
              if (stmt.specifiers[cursor].type === Syntax.ImportDefaultSpecifier) {
                  result = join(result, [
                          this.generateExpression(stmt.specifiers[cursor], Precedence.Sequence, E_TTT)
                  ]);
                  ++cursor;
              }

              if (stmt.specifiers[cursor]) {
                  if (cursor !== 0) {
                      result.push(',');
                  }

                  if (stmt.specifiers[cursor].type === Syntax.ImportNamespaceSpecifier) {
                      // NameSpaceImport
                      result = join(result, [
                              space,
                              this.generateExpression(stmt.specifiers[cursor], Precedence.Sequence, E_TTT)
                      ]);
                  } else {
                      // NamedImports
                      result.push(space + '{');

                      if ((stmt.specifiers.length - cursor) === 1) {
                          // import { ... } from "...";
                          result.push(space);
                          result.push(this.generateExpression(stmt.specifiers[cursor], Precedence.Sequence, E_TTT));
                          result.push(space + '}' + space);
                      } else {
                          // import {
                          //    ...,
                          //    ...,
                          // } from "...";
                          withIndent(function (indent) {
                              var i, iz;
                              result.push(newline);
                              for (i = cursor, iz = stmt.specifiers.length; i < iz; ++i) {
                                  result.push(indent);
                                  result.push(that.generateExpression(stmt.specifiers[i], Precedence.Sequence, E_TTT));
                                  if (i + 1 < iz) {
                                      result.push(',' + newline);
                                  }
                              }
                          });
                          if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                              result.push(newline);
                          }
                          result.push(base + '}' + space);
                      }
                  }
              }

              result = join(result, [
                  'from' + space,
                  // ModuleSpecifier
                  this.generateExpression(stmt.source, Precedence.Sequence, E_TTT),
                  this.semicolon(flags)
              ]);
              return result;
          },

          VariableDeclarator: function (stmt, flags) {
              var itemFlags = (flags & F_ALLOW_IN) ? E_TTT : E_FTT;
              if (stmt.init) {
                  return [
                      this.generateExpression(stmt.id, Precedence.Assignment, itemFlags),
                      space,
                      '=',
                      space,
                      this.generateExpression(stmt.init, Precedence.Assignment, itemFlags)
                  ];
              }
              return this.generatePattern(stmt.id, Precedence.Assignment, itemFlags);
          },

          VariableDeclaration: function (stmt, flags) {
              // VariableDeclarator is typed as Statement,
              // but joined with comma (not LineTerminator).
              // So if comment is attached to target node, we should specialize.
              var result, i, iz, node, bodyFlags, that = this;

              result = [ stmt.kind ];

              bodyFlags = (flags & F_ALLOW_IN) ? S_TFFF : S_FFFF;

              function block() {
                  node = stmt.declarations[0];
                  if (extra.comment && node.leadingComments) {
                      result.push('\n');
                      result.push(addIndent(that.generateStatement(node, bodyFlags)));
                  } else {
                      result.push(noEmptySpace());
                      result.push(that.generateStatement(node, bodyFlags));
                  }

                  for (i = 1, iz = stmt.declarations.length; i < iz; ++i) {
                      node = stmt.declarations[i];
                      if (extra.comment && node.leadingComments) {
                          result.push(',' + newline);
                          result.push(addIndent(that.generateStatement(node, bodyFlags)));
                      } else {
                          result.push(',' + space);
                          result.push(that.generateStatement(node, bodyFlags));
                      }
                  }
              }

              if (stmt.declarations.length > 1) {
                  withIndent(block);
              } else {
                  block();
              }

              result.push(this.semicolon(flags));

              return result;
          },

          ThrowStatement: function (stmt, flags) {
              return [join(
                  'throw',
                  this.generateExpression(stmt.argument, Precedence.Sequence, E_TTT)
              ), this.semicolon(flags)];
          },

          TryStatement: function (stmt, flags) {
              var result, i, iz, guardedHandlers;

              result = ['try', this.maybeBlock(stmt.block, S_TFFF)];
              result = this.maybeBlockSuffix(stmt.block, result);

              if (stmt.handlers) {
                  // old interface
                  for (i = 0, iz = stmt.handlers.length; i < iz; ++i) {
                      result = join(result, this.generateStatement(stmt.handlers[i], S_TFFF));
                      if (stmt.finalizer || i + 1 !== iz) {
                          result = this.maybeBlockSuffix(stmt.handlers[i].body, result);
                      }
                  }
              } else {
                  guardedHandlers = stmt.guardedHandlers || [];

                  for (i = 0, iz = guardedHandlers.length; i < iz; ++i) {
                      result = join(result, this.generateStatement(guardedHandlers[i], S_TFFF));
                      if (stmt.finalizer || i + 1 !== iz) {
                          result = this.maybeBlockSuffix(guardedHandlers[i].body, result);
                      }
                  }

                  // new interface
                  if (stmt.handler) {
                      if (Array.isArray(stmt.handler)) {
                          for (i = 0, iz = stmt.handler.length; i < iz; ++i) {
                              result = join(result, this.generateStatement(stmt.handler[i], S_TFFF));
                              if (stmt.finalizer || i + 1 !== iz) {
                                  result = this.maybeBlockSuffix(stmt.handler[i].body, result);
                              }
                          }
                      } else {
                          result = join(result, this.generateStatement(stmt.handler, S_TFFF));
                          if (stmt.finalizer) {
                              result = this.maybeBlockSuffix(stmt.handler.body, result);
                          }
                      }
                  }
              }
              if (stmt.finalizer) {
                  result = join(result, ['finally', this.maybeBlock(stmt.finalizer, S_TFFF)]);
              }
              return result;
          },

          SwitchStatement: function (stmt, flags) {
              var result, fragment, i, iz, bodyFlags, that = this;
              withIndent(function () {
                  result = [
                      'switch' + space + '(',
                      that.generateExpression(stmt.discriminant, Precedence.Sequence, E_TTT),
                      ')' + space + '{' + newline
                  ];
              });
              if (stmt.cases) {
                  bodyFlags = S_TFFF;
                  for (i = 0, iz = stmt.cases.length; i < iz; ++i) {
                      if (i === iz - 1) {
                          bodyFlags |= F_SEMICOLON_OPT;
                      }
                      fragment = addIndent(this.generateStatement(stmt.cases[i], bodyFlags));
                      result.push(fragment);
                      if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                          result.push(newline);
                      }
                  }
              }
              result.push(addIndent('}'));
              return result;
          },

          SwitchCase: function (stmt, flags) {
              var result, fragment, i, iz, bodyFlags, that = this;
              withIndent(function () {
                  if (stmt.test) {
                      result = [
                          join('case', that.generateExpression(stmt.test, Precedence.Sequence, E_TTT)),
                          ':'
                      ];
                  } else {
                      result = ['default:'];
                  }

                  i = 0;
                  iz = stmt.consequent.length;
                  if (iz && stmt.consequent[0].type === Syntax.BlockStatement) {
                      fragment = that.maybeBlock(stmt.consequent[0], S_TFFF);
                      result.push(fragment);
                      i = 1;
                  }

                  if (i !== iz && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                      result.push(newline);
                  }

                  bodyFlags = S_TFFF;
                  for (; i < iz; ++i) {
                      if (i === iz - 1 && flags & F_SEMICOLON_OPT) {
                          bodyFlags |= F_SEMICOLON_OPT;
                      }
                      fragment = addIndent(that.generateStatement(stmt.consequent[i], bodyFlags));
                      result.push(fragment);
                      if (i + 1 !== iz && !endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                          result.push(newline);
                      }
                  }
              });
              return result;
          },

          IfStatement: function (stmt, flags) {
              var result, bodyFlags, semicolonOptional, that = this;
              withIndent(function () {
                  result = [
                      'if' + space + '(',
                      that.generateExpression(stmt.test, Precedence.Sequence, E_TTT),
                      ')'
                  ];
              });
              semicolonOptional = flags & F_SEMICOLON_OPT;
              bodyFlags = S_TFFF;
              if (semicolonOptional) {
                  bodyFlags |= F_SEMICOLON_OPT;
              }
              if (stmt.alternate) {
                  result.push(this.maybeBlock(stmt.consequent, S_TFFF));
                  result = this.maybeBlockSuffix(stmt.consequent, result);
                  if (stmt.alternate.type === Syntax.IfStatement) {
                      result = join(result, ['else ', this.generateStatement(stmt.alternate, bodyFlags)]);
                  } else {
                      result = join(result, join('else', this.maybeBlock(stmt.alternate, bodyFlags)));
                  }
              } else {
                  result.push(this.maybeBlock(stmt.consequent, bodyFlags));
              }
              return result;
          },

          ForStatement: function (stmt, flags) {
              var result, that = this;
              withIndent(function () {
                  result = ['for' + space + '('];
                  if (stmt.init) {
                      if (stmt.init.type === Syntax.VariableDeclaration) {
                          result.push(that.generateStatement(stmt.init, S_FFFF));
                      } else {
                          // F_ALLOW_IN becomes false.
                          result.push(that.generateExpression(stmt.init, Precedence.Sequence, E_FTT));
                          result.push(';');
                      }
                  } else {
                      result.push(';');
                  }

                  if (stmt.test) {
                      result.push(space);
                      result.push(that.generateExpression(stmt.test, Precedence.Sequence, E_TTT));
                      result.push(';');
                  } else {
                      result.push(';');
                  }

                  if (stmt.update) {
                      result.push(space);
                      result.push(that.generateExpression(stmt.update, Precedence.Sequence, E_TTT));
                      result.push(')');
                  } else {
                      result.push(')');
                  }
              });

              result.push(this.maybeBlock(stmt.body, flags & F_SEMICOLON_OPT ? S_TFFT : S_TFFF));
              return result;
          },

          ForInStatement: function (stmt, flags) {
              return this.generateIterationForStatement('in', stmt, flags & F_SEMICOLON_OPT ? S_TFFT : S_TFFF);
          },

          ForOfStatement: function (stmt, flags) {
              return this.generateIterationForStatement('of', stmt, flags & F_SEMICOLON_OPT ? S_TFFT : S_TFFF);
          },

          LabeledStatement: function (stmt, flags) {
              return [stmt.label.name + ':', this.maybeBlock(stmt.body, flags & F_SEMICOLON_OPT ? S_TFFT : S_TFFF)];
          },

          Program: function (stmt, flags) {
              var result, fragment, i, iz, bodyFlags;
              iz = stmt.body.length;
              result = [safeConcatenation && iz > 0 ? '\n' : ''];
              bodyFlags = S_TFTF;
              for (i = 0; i < iz; ++i) {
                  if (!safeConcatenation && i === iz - 1) {
                      bodyFlags |= F_SEMICOLON_OPT;
                  }

                  if (preserveBlankLines) {
                      // handle spaces before the first line
                      if (i === 0) {
                          if (!stmt.body[0].leadingComments) {
                              generateBlankLines(stmt.range[0], stmt.body[i].range[0], result);
                          }
                      }

                      // handle spaces between lines
                      if (i > 0) {
                          if (!stmt.body[i - 1].trailingComments && !stmt.body[i].leadingComments) {
                              generateBlankLines(stmt.body[i - 1].range[1], stmt.body[i].range[0], result);
                          }
                      }
                  }

                  fragment = addIndent(this.generateStatement(stmt.body[i], bodyFlags));
                  result.push(fragment);
                  if (i + 1 < iz && !endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                      if (preserveBlankLines) {
                          if (!stmt.body[i + 1].leadingComments) {
                              result.push(newline);
                          }
                      } else {
                          result.push(newline);
                      }
                  }

                  if (preserveBlankLines) {
                      // handle spaces after the last line
                      if (i === iz - 1) {
                          if (!stmt.body[i].trailingComments) {
                              generateBlankLines(stmt.body[i].range[1], stmt.range[1], result);
                          }
                      }
                  }
              }
              return result;
          },

          FunctionDeclaration: function (stmt, flags) {
              return [
                  generateAsyncPrefix(stmt, true),
                  'function',
                  generateStarSuffix(stmt) || noEmptySpace(),
                  stmt.id ? generateIdentifier(stmt.id) : '',
                  this.generateFunctionBody(stmt)
              ];
          },

          ReturnStatement: function (stmt, flags) {
              if (stmt.argument) {
                  return [join(
                      'return',
                      this.generateExpression(stmt.argument, Precedence.Sequence, E_TTT)
                  ), this.semicolon(flags)];
              }
              return ['return' + this.semicolon(flags)];
          },

          WhileStatement: function (stmt, flags) {
              var result, that = this;
              withIndent(function () {
                  result = [
                      'while' + space + '(',
                      that.generateExpression(stmt.test, Precedence.Sequence, E_TTT),
                      ')'
                  ];
              });
              result.push(this.maybeBlock(stmt.body, flags & F_SEMICOLON_OPT ? S_TFFT : S_TFFF));
              return result;
          },

          WithStatement: function (stmt, flags) {
              var result, that = this;
              withIndent(function () {
                  result = [
                      'with' + space + '(',
                      that.generateExpression(stmt.object, Precedence.Sequence, E_TTT),
                      ')'
                  ];
              });
              result.push(this.maybeBlock(stmt.body, flags & F_SEMICOLON_OPT ? S_TFFT : S_TFFF));
              return result;
          }

      };

      merge(CodeGenerator.prototype, CodeGenerator.Statement);

      // Expressions.

      CodeGenerator.Expression = {

          SequenceExpression: function (expr, precedence, flags) {
              var result, i, iz;
              if (Precedence.Sequence < precedence) {
                  flags |= F_ALLOW_IN;
              }
              result = [];
              for (i = 0, iz = expr.expressions.length; i < iz; ++i) {
                  result.push(this.generateExpression(expr.expressions[i], Precedence.Assignment, flags));
                  if (i + 1 < iz) {
                      result.push(',' + space);
                  }
              }
              return parenthesize(result, Precedence.Sequence, precedence);
          },

          AssignmentExpression: function (expr, precedence, flags) {
              return this.generateAssignment(expr.left, expr.right, expr.operator, precedence, flags);
          },

          ArrowFunctionExpression: function (expr, precedence, flags) {
              return parenthesize(this.generateFunctionBody(expr), Precedence.ArrowFunction, precedence);
          },

          ConditionalExpression: function (expr, precedence, flags) {
              if (Precedence.Conditional < precedence) {
                  flags |= F_ALLOW_IN;
              }
              return parenthesize(
                  [
                      this.generateExpression(expr.test, Precedence.LogicalOR, flags),
                      space + '?' + space,
                      this.generateExpression(expr.consequent, Precedence.Assignment, flags),
                      space + ':' + space,
                      this.generateExpression(expr.alternate, Precedence.Assignment, flags)
                  ],
                  Precedence.Conditional,
                  precedence
              );
          },

          LogicalExpression: function (expr, precedence, flags) {
              return this.BinaryExpression(expr, precedence, flags);
          },

          BinaryExpression: function (expr, precedence, flags) {
              var result, leftPrecedence, rightPrecedence, currentPrecedence, fragment, leftSource;
              currentPrecedence = BinaryPrecedence[expr.operator];
              leftPrecedence = expr.operator === '**' ? Precedence.Postfix : currentPrecedence;
              rightPrecedence = expr.operator === '**' ? currentPrecedence : currentPrecedence + 1;

              if (currentPrecedence < precedence) {
                  flags |= F_ALLOW_IN;
              }

              fragment = this.generateExpression(expr.left, leftPrecedence, flags);

              leftSource = fragment.toString();

              if (leftSource.charCodeAt(leftSource.length - 1) === 0x2F /* / */ && esutils.code.isIdentifierPartES5(expr.operator.charCodeAt(0))) {
                  result = [fragment, noEmptySpace(), expr.operator];
              } else {
                  result = join(fragment, expr.operator);
              }

              fragment = this.generateExpression(expr.right, rightPrecedence, flags);

              if (expr.operator === '/' && fragment.toString().charAt(0) === '/' ||
              expr.operator.slice(-1) === '<' && fragment.toString().slice(0, 3) === '!--') {
                  // If '/' concats with '/' or `<` concats with `!--`, it is interpreted as comment start
                  result.push(noEmptySpace());
                  result.push(fragment);
              } else {
                  result = join(result, fragment);
              }

              if (expr.operator === 'in' && !(flags & F_ALLOW_IN)) {
                  return ['(', result, ')'];
              }
              return parenthesize(result, currentPrecedence, precedence);
          },

          CallExpression: function (expr, precedence, flags) {
              var result, i, iz;
              // F_ALLOW_UNPARATH_NEW becomes false.
              result = [this.generateExpression(expr.callee, Precedence.Call, E_TTF)];
              result.push('(');
              for (i = 0, iz = expr['arguments'].length; i < iz; ++i) {
                  result.push(this.generateExpression(expr['arguments'][i], Precedence.Assignment, E_TTT));
                  if (i + 1 < iz) {
                      result.push(',' + space);
                  }
              }
              result.push(')');

              if (!(flags & F_ALLOW_CALL)) {
                  return ['(', result, ')'];
              }
              return parenthesize(result, Precedence.Call, precedence);
          },

          NewExpression: function (expr, precedence, flags) {
              var result, length, i, iz, itemFlags;
              length = expr['arguments'].length;

              // F_ALLOW_CALL becomes false.
              // F_ALLOW_UNPARATH_NEW may become false.
              itemFlags = (flags & F_ALLOW_UNPARATH_NEW && !parentheses && length === 0) ? E_TFT : E_TFF;

              result = join(
                  'new',
                  this.generateExpression(expr.callee, Precedence.New, itemFlags)
              );

              if (!(flags & F_ALLOW_UNPARATH_NEW) || parentheses || length > 0) {
                  result.push('(');
                  for (i = 0, iz = length; i < iz; ++i) {
                      result.push(this.generateExpression(expr['arguments'][i], Precedence.Assignment, E_TTT));
                      if (i + 1 < iz) {
                          result.push(',' + space);
                      }
                  }
                  result.push(')');
              }

              return parenthesize(result, Precedence.New, precedence);
          },

          MemberExpression: function (expr, precedence, flags) {
              var result, fragment;

              // F_ALLOW_UNPARATH_NEW becomes false.
              result = [this.generateExpression(expr.object, Precedence.Call, (flags & F_ALLOW_CALL) ? E_TTF : E_TFF)];

              if (expr.computed) {
                  result.push('[');
                  result.push(this.generateExpression(expr.property, Precedence.Sequence, flags & F_ALLOW_CALL ? E_TTT : E_TFT));
                  result.push(']');
              } else {
                  if (expr.object.type === Syntax.Literal && typeof expr.object.value === 'number') {
                      fragment = toSourceNodeWhenNeeded(result).toString();
                      // When the following conditions are all true,
                      //   1. No floating point
                      //   2. Don't have exponents
                      //   3. The last character is a decimal digit
                      //   4. Not hexadecimal OR octal number literal
                      // we should add a floating point.
                      if (
                              fragment.indexOf('.') < 0 &&
                              !/[eExX]/.test(fragment) &&
                              esutils.code.isDecimalDigit(fragment.charCodeAt(fragment.length - 1)) &&
                              !(fragment.length >= 2 && fragment.charCodeAt(0) === 48)  // '0'
                              ) {
                          result.push(' ');
                      }
                  }
                  result.push('.');
                  result.push(generateIdentifier(expr.property));
              }

              return parenthesize(result, Precedence.Member, precedence);
          },

          MetaProperty: function (expr, precedence, flags) {
              var result;
              result = [];
              result.push(typeof expr.meta === "string" ? expr.meta : generateIdentifier(expr.meta));
              result.push('.');
              result.push(typeof expr.property === "string" ? expr.property : generateIdentifier(expr.property));
              return parenthesize(result, Precedence.Member, precedence);
          },

          UnaryExpression: function (expr, precedence, flags) {
              var result, fragment, rightCharCode, leftSource, leftCharCode;
              fragment = this.generateExpression(expr.argument, Precedence.Unary, E_TTT);

              if (space === '') {
                  result = join(expr.operator, fragment);
              } else {
                  result = [expr.operator];
                  if (expr.operator.length > 2) {
                      // delete, void, typeof
                      // get `typeof []`, not `typeof[]`
                      result = join(result, fragment);
                  } else {
                      // Prevent inserting spaces between operator and argument if it is unnecessary
                      // like, `!cond`
                      leftSource = toSourceNodeWhenNeeded(result).toString();
                      leftCharCode = leftSource.charCodeAt(leftSource.length - 1);
                      rightCharCode = fragment.toString().charCodeAt(0);

                      if (((leftCharCode === 0x2B  /* + */ || leftCharCode === 0x2D  /* - */) && leftCharCode === rightCharCode) ||
                              (esutils.code.isIdentifierPartES5(leftCharCode) && esutils.code.isIdentifierPartES5(rightCharCode))) {
                          result.push(noEmptySpace());
                          result.push(fragment);
                      } else {
                          result.push(fragment);
                      }
                  }
              }
              return parenthesize(result, Precedence.Unary, precedence);
          },

          YieldExpression: function (expr, precedence, flags) {
              var result;
              if (expr.delegate) {
                  result = 'yield*';
              } else {
                  result = 'yield';
              }
              if (expr.argument) {
                  result = join(
                      result,
                      this.generateExpression(expr.argument, Precedence.Yield, E_TTT)
                  );
              }
              return parenthesize(result, Precedence.Yield, precedence);
          },

          AwaitExpression: function (expr, precedence, flags) {
              var result = join(
                  expr.all ? 'await*' : 'await',
                  this.generateExpression(expr.argument, Precedence.Await, E_TTT)
              );
              return parenthesize(result, Precedence.Await, precedence);
          },

          UpdateExpression: function (expr, precedence, flags) {
              if (expr.prefix) {
                  return parenthesize(
                      [
                          expr.operator,
                          this.generateExpression(expr.argument, Precedence.Unary, E_TTT)
                      ],
                      Precedence.Unary,
                      precedence
                  );
              }
              return parenthesize(
                  [
                      this.generateExpression(expr.argument, Precedence.Postfix, E_TTT),
                      expr.operator
                  ],
                  Precedence.Postfix,
                  precedence
              );
          },

          FunctionExpression: function (expr, precedence, flags) {
              var result = [
                  generateAsyncPrefix(expr, true),
                  'function'
              ];
              if (expr.id) {
                  result.push(generateStarSuffix(expr) || noEmptySpace());
                  result.push(generateIdentifier(expr.id));
              } else {
                  result.push(generateStarSuffix(expr) || space);
              }
              result.push(this.generateFunctionBody(expr));
              return result;
          },

          ArrayPattern: function (expr, precedence, flags) {
              return this.ArrayExpression(expr, precedence, flags, true);
          },

          ArrayExpression: function (expr, precedence, flags, isPattern) {
              var result, multiline, that = this;
              if (!expr.elements.length) {
                  return '[]';
              }
              multiline = isPattern ? false : expr.elements.length > 1;
              result = ['[', multiline ? newline : ''];
              withIndent(function (indent) {
                  var i, iz;
                  for (i = 0, iz = expr.elements.length; i < iz; ++i) {
                      if (!expr.elements[i]) {
                          if (multiline) {
                              result.push(indent);
                          }
                          if (i + 1 === iz) {
                              result.push(',');
                          }
                      } else {
                          result.push(multiline ? indent : '');
                          result.push(that.generateExpression(expr.elements[i], Precedence.Assignment, E_TTT));
                      }
                      if (i + 1 < iz) {
                          result.push(',' + (multiline ? newline : space));
                      }
                  }
              });
              if (multiline && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                  result.push(newline);
              }
              result.push(multiline ? base : '');
              result.push(']');
              return result;
          },

          RestElement: function(expr, precedence, flags) {
              return '...' + this.generatePattern(expr.argument);
          },

          ClassExpression: function (expr, precedence, flags) {
              var result, fragment;
              result = ['class'];
              if (expr.id) {
                  result = join(result, this.generateExpression(expr.id, Precedence.Sequence, E_TTT));
              }
              if (expr.superClass) {
                  fragment = join('extends', this.generateExpression(expr.superClass, Precedence.Unary, E_TTT));
                  result = join(result, fragment);
              }
              result.push(space);
              result.push(this.generateStatement(expr.body, S_TFFT));
              return result;
          },

          MethodDefinition: function (expr, precedence, flags) {
              var result, fragment;
              if (expr['static']) {
                  result = ['static' + space];
              } else {
                  result = [];
              }
              if (expr.kind === 'get' || expr.kind === 'set') {
                  fragment = [
                      join(expr.kind, this.generatePropertyKey(expr.key, expr.computed)),
                      this.generateFunctionBody(expr.value)
                  ];
              } else {
                  fragment = [
                      generateMethodPrefix(expr),
                      this.generatePropertyKey(expr.key, expr.computed),
                      this.generateFunctionBody(expr.value)
                  ];
              }
              return join(result, fragment);
          },

          Property: function (expr, precedence, flags) {
              if (expr.kind === 'get' || expr.kind === 'set') {
                  return [
                      expr.kind, noEmptySpace(),
                      this.generatePropertyKey(expr.key, expr.computed),
                      this.generateFunctionBody(expr.value)
                  ];
              }

              if (expr.shorthand) {
                  if (expr.value.type === "AssignmentPattern") {
                      return this.AssignmentPattern(expr.value, Precedence.Sequence, E_TTT);
                  }
                  return this.generatePropertyKey(expr.key, expr.computed);
              }

              if (expr.method) {
                  return [
                      generateMethodPrefix(expr),
                      this.generatePropertyKey(expr.key, expr.computed),
                      this.generateFunctionBody(expr.value)
                  ];
              }

              return [
                  this.generatePropertyKey(expr.key, expr.computed),
                  ':' + space,
                  this.generateExpression(expr.value, Precedence.Assignment, E_TTT)
              ];
          },

          ObjectExpression: function (expr, precedence, flags) {
              var multiline, result, fragment, that = this;

              if (!expr.properties.length) {
                  return '{}';
              }
              multiline = expr.properties.length > 1;

              withIndent(function () {
                  fragment = that.generateExpression(expr.properties[0], Precedence.Sequence, E_TTT);
              });

              if (!multiline) {
                  // issues 4
                  // Do not transform from
                  //   dejavu.Class.declare({
                  //       method2: function () {}
                  //   });
                  // to
                  //   dejavu.Class.declare({method2: function () {
                  //       }});
                  if (!hasLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                      return [ '{', space, fragment, space, '}' ];
                  }
              }

              withIndent(function (indent) {
                  var i, iz;
                  result = [ '{', newline, indent, fragment ];

                  if (multiline) {
                      result.push(',' + newline);
                      for (i = 1, iz = expr.properties.length; i < iz; ++i) {
                          result.push(indent);
                          result.push(that.generateExpression(expr.properties[i], Precedence.Sequence, E_TTT));
                          if (i + 1 < iz) {
                              result.push(',' + newline);
                          }
                      }
                  }
              });

              if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                  result.push(newline);
              }
              result.push(base);
              result.push('}');
              return result;
          },

          AssignmentPattern: function(expr, precedence, flags) {
              return this.generateAssignment(expr.left, expr.right, '=', precedence, flags);
          },

          ObjectPattern: function (expr, precedence, flags) {
              var result, i, iz, multiline, property, that = this;
              if (!expr.properties.length) {
                  return '{}';
              }

              multiline = false;
              if (expr.properties.length === 1) {
                  property = expr.properties[0];
                  if (
                      property.type === Syntax.Property
                      && property.value.type !== Syntax.Identifier
                  ) {
                      multiline = true;
                  }
              } else {
                  for (i = 0, iz = expr.properties.length; i < iz; ++i) {
                      property = expr.properties[i];
                      if (
                          property.type === Syntax.Property
                          && !property.shorthand
                      ) {
                          multiline = true;
                          break;
                      }
                  }
              }
              result = ['{', multiline ? newline : '' ];

              withIndent(function (indent) {
                  var i, iz;
                  for (i = 0, iz = expr.properties.length; i < iz; ++i) {
                      result.push(multiline ? indent : '');
                      result.push(that.generateExpression(expr.properties[i], Precedence.Sequence, E_TTT));
                      if (i + 1 < iz) {
                          result.push(',' + (multiline ? newline : space));
                      }
                  }
              });

              if (multiline && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                  result.push(newline);
              }
              result.push(multiline ? base : '');
              result.push('}');
              return result;
          },

          ThisExpression: function (expr, precedence, flags) {
              return 'this';
          },

          Super: function (expr, precedence, flags) {
              return 'super';
          },

          Identifier: function (expr, precedence, flags) {
              return generateIdentifier(expr);
          },

          ImportDefaultSpecifier: function (expr, precedence, flags) {
              return generateIdentifier(expr.id || expr.local);
          },

          ImportNamespaceSpecifier: function (expr, precedence, flags) {
              var result = ['*'];
              var id = expr.id || expr.local;
              if (id) {
                  result.push(space + 'as' + noEmptySpace() + generateIdentifier(id));
              }
              return result;
          },

          ImportSpecifier: function (expr, precedence, flags) {
              var imported = expr.imported;
              var result = [ imported.name ];
              var local = expr.local;
              if (local && local.name !== imported.name) {
                  result.push(noEmptySpace() + 'as' + noEmptySpace() + generateIdentifier(local));
              }
              return result;
          },

          ExportSpecifier: function (expr, precedence, flags) {
              var local = expr.local;
              var result = [ local.name ];
              var exported = expr.exported;
              if (exported && exported.name !== local.name) {
                  result.push(noEmptySpace() + 'as' + noEmptySpace() + generateIdentifier(exported));
              }
              return result;
          },

          Literal: function (expr, precedence, flags) {
              var raw;
              if (expr.hasOwnProperty('raw') && parse && extra.raw) {
                  try {
                      raw = parse(expr.raw).body[0].expression;
                      if (raw.type === Syntax.Literal) {
                          if (raw.value === expr.value) {
                              return expr.raw;
                          }
                      }
                  } catch (e) {
                      // not use raw property
                  }
              }

              if (expr.regex) {
                return '/' + expr.regex.pattern + '/' + expr.regex.flags;
              }

              if (expr.value === null) {
                  return 'null';
              }

              if (typeof expr.value === 'string') {
                  return escapeString(expr.value);
              }

              if (typeof expr.value === 'number') {
                  return generateNumber(expr.value);
              }

              if (typeof expr.value === 'boolean') {
                  return expr.value ? 'true' : 'false';
              }

              return generateRegExp(expr.value);
          },

          GeneratorExpression: function (expr, precedence, flags) {
              return this.ComprehensionExpression(expr, precedence, flags);
          },

          ComprehensionExpression: function (expr, precedence, flags) {
              // GeneratorExpression should be parenthesized with (...), ComprehensionExpression with [...]
              // Due to https://bugzilla.mozilla.org/show_bug.cgi?id=883468 position of expr.body can differ in Spidermonkey and ES6

              var result, i, iz, fragment, that = this;
              result = (expr.type === Syntax.GeneratorExpression) ? ['('] : ['['];

              if (extra.moz.comprehensionExpressionStartsWithAssignment) {
                  fragment = this.generateExpression(expr.body, Precedence.Assignment, E_TTT);
                  result.push(fragment);
              }

              if (expr.blocks) {
                  withIndent(function () {
                      for (i = 0, iz = expr.blocks.length; i < iz; ++i) {
                          fragment = that.generateExpression(expr.blocks[i], Precedence.Sequence, E_TTT);
                          if (i > 0 || extra.moz.comprehensionExpressionStartsWithAssignment) {
                              result = join(result, fragment);
                          } else {
                              result.push(fragment);
                          }
                      }
                  });
              }

              if (expr.filter) {
                  result = join(result, 'if' + space);
                  fragment = this.generateExpression(expr.filter, Precedence.Sequence, E_TTT);
                  result = join(result, [ '(', fragment, ')' ]);
              }

              if (!extra.moz.comprehensionExpressionStartsWithAssignment) {
                  fragment = this.generateExpression(expr.body, Precedence.Assignment, E_TTT);

                  result = join(result, fragment);
              }

              result.push((expr.type === Syntax.GeneratorExpression) ? ')' : ']');
              return result;
          },

          ComprehensionBlock: function (expr, precedence, flags) {
              var fragment;
              if (expr.left.type === Syntax.VariableDeclaration) {
                  fragment = [
                      expr.left.kind, noEmptySpace(),
                      this.generateStatement(expr.left.declarations[0], S_FFFF)
                  ];
              } else {
                  fragment = this.generateExpression(expr.left, Precedence.Call, E_TTT);
              }

              fragment = join(fragment, expr.of ? 'of' : 'in');
              fragment = join(fragment, this.generateExpression(expr.right, Precedence.Sequence, E_TTT));

              return [ 'for' + space + '(', fragment, ')' ];
          },

          SpreadElement: function (expr, precedence, flags) {
              return [
                  '...',
                  this.generateExpression(expr.argument, Precedence.Assignment, E_TTT)
              ];
          },

          TaggedTemplateExpression: function (expr, precedence, flags) {
              var itemFlags = E_TTF;
              if (!(flags & F_ALLOW_CALL)) {
                  itemFlags = E_TFF;
              }
              var result = [
                  this.generateExpression(expr.tag, Precedence.Call, itemFlags),
                  this.generateExpression(expr.quasi, Precedence.Primary, E_FFT)
              ];
              return parenthesize(result, Precedence.TaggedTemplate, precedence);
          },

          TemplateElement: function (expr, precedence, flags) {
              // Don't use "cooked". Since tagged template can use raw template
              // representation. So if we do so, it breaks the script semantics.
              return expr.value.raw;
          },

          TemplateLiteral: function (expr, precedence, flags) {
              var result, i, iz;
              result = [ '`' ];
              for (i = 0, iz = expr.quasis.length; i < iz; ++i) {
                  result.push(this.generateExpression(expr.quasis[i], Precedence.Primary, E_TTT));
                  if (i + 1 < iz) {
                      result.push('${' + space);
                      result.push(this.generateExpression(expr.expressions[i], Precedence.Sequence, E_TTT));
                      result.push(space + '}');
                  }
              }
              result.push('`');
              return result;
          },

          ModuleSpecifier: function (expr, precedence, flags) {
              return this.Literal(expr, precedence, flags);
          },

          ImportExpression: function(expr, precedence, flag) {
              return parenthesize([
                  'import(',
                  this.generateExpression(expr.source, Precedence.Assignment, E_TTT),
                  ')'
              ], Precedence.Call, precedence);
          },

      };

      merge(CodeGenerator.prototype, CodeGenerator.Expression);

      CodeGenerator.prototype.generateExpression = function (expr, precedence, flags) {
          var result, type;

          type = expr.type || Syntax.Property;

          if (extra.verbatim && expr.hasOwnProperty(extra.verbatim)) {
              return generateVerbatim(expr, precedence);
          }

          result = this[type](expr, precedence, flags);


          if (extra.comment) {
              result = addComments(expr, result);
          }
          return toSourceNodeWhenNeeded(result, expr);
      };

      CodeGenerator.prototype.generateStatement = function (stmt, flags) {
          var result,
              fragment;

          result = this[stmt.type](stmt, flags);

          // Attach comments

          if (extra.comment) {
              result = addComments(stmt, result);
          }

          fragment = toSourceNodeWhenNeeded(result).toString();
          if (stmt.type === Syntax.Program && !safeConcatenation && newline === '' &&  fragment.charAt(fragment.length - 1) === '\n') {
              result = sourceMap ? toSourceNodeWhenNeeded(result).replaceRight(/\s+$/, '') : fragment.replace(/\s+$/, '');
          }

          return toSourceNodeWhenNeeded(result, stmt);
      };

      function generateInternal(node) {
          var codegen;

          codegen = new CodeGenerator();
          if (isStatement(node)) {
              return codegen.generateStatement(node, S_TFFF);
          }

          if (isExpression(node)) {
              return codegen.generateExpression(node, Precedence.Sequence, E_TTT);
          }

          throw new Error('Unknown node type: ' + node.type);
      }

      function generate(node, options) {
          var defaultOptions = getDefaultOptions(), result, pair;

          if (options != null) {
              // Obsolete options
              //
              //   `options.indent`
              //   `options.base`
              //
              // Instead of them, we can use `option.format.indent`.
              if (typeof options.indent === 'string') {
                  defaultOptions.format.indent.style = options.indent;
              }
              if (typeof options.base === 'number') {
                  defaultOptions.format.indent.base = options.base;
              }
              options = updateDeeply(defaultOptions, options);
              indent = options.format.indent.style;
              if (typeof options.base === 'string') {
                  base = options.base;
              } else {
                  base = stringRepeat(indent, options.format.indent.base);
              }
          } else {
              options = defaultOptions;
              indent = options.format.indent.style;
              base = stringRepeat(indent, options.format.indent.base);
          }
          json = options.format.json;
          renumber = options.format.renumber;
          hexadecimal = json ? false : options.format.hexadecimal;
          quotes = json ? 'double' : options.format.quotes;
          escapeless = options.format.escapeless;
          newline = options.format.newline;
          space = options.format.space;
          if (options.format.compact) {
              newline = space = indent = base = '';
          }
          parentheses = options.format.parentheses;
          semicolons = options.format.semicolons;
          safeConcatenation = options.format.safeConcatenation;
          directive = options.directive;
          parse = json ? null : options.parse;
          sourceMap = options.sourceMap;
          sourceCode = options.sourceCode;
          preserveBlankLines = options.format.preserveBlankLines && sourceCode !== null;
          extra = options;

          if (sourceMap) {
              if (!exports.browser) {
                  // We assume environment is node.js
                  // And prevent from including source-map by browserify
                  SourceNode = require('source-map').SourceNode;
              } else {
                  SourceNode = global.sourceMap.SourceNode;
              }
          }

          result = generateInternal(node);

          if (!sourceMap) {
              pair = {code: result.toString(), map: null};
              return options.sourceMapWithCode ? pair : pair.code;
          }


          pair = result.toStringWithSourceMap({
              file: options.file,
              sourceRoot: options.sourceMapRoot
          });

          if (options.sourceContent) {
              pair.map.setSourceContent(options.sourceMap,
                                        options.sourceContent);
          }

          if (options.sourceMapWithCode) {
              return pair;
          }

          return pair.map.toString();
      }

      FORMAT_MINIFY = {
          indent: {
              style: '',
              base: 0
          },
          renumber: true,
          hexadecimal: true,
          quotes: 'auto',
          escapeless: true,
          compact: true,
          parentheses: false,
          semicolons: false
      };

      FORMAT_DEFAULTS = getDefaultOptions().format;

      exports.version = require('./package.json').version;
      exports.generate = generate;
      exports.attachComments = estraverse.attachComments;
      exports.Precedence = updateDeeply({}, Precedence);
      exports.browser = false;
      exports.FORMAT_MINIFY = FORMAT_MINIFY;
      exports.FORMAT_DEFAULTS = FORMAT_DEFAULTS;
  }());
  /* vim: set sw=4 ts=4 et tw=80 : */

  }).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
  },{"./package.json":73,"estraverse":93,"esutils":98,"source-map":110}],73:[function(require,module,exports){
  module.exports={
    "_from": "escodegen@1.14.3",
    "_id": "escodegen@1.14.3",
    "_inBundle": false,
    "_integrity": "sha512-qFcX0XJkdg+PB3xjZZG/wKSuT1PnQWx57+TVSjIMmILd2yC/6ByYElPwJnslDsuWuSAp4AwJGumarAAmJch5Kw==",
    "_location": "/escodegen",
    "_phantomChildren": {},
    "_requested": {
      "type": "version",
      "registry": true,
      "raw": "escodegen@1.14.3",
      "name": "escodegen",
      "escapedName": "escodegen",
      "rawSpec": "1.14.3",
      "saveSpec": null,
      "fetchSpec": "1.14.3"
    },
    "_requiredBy": [
      "#USER",
      "/"
    ],
    "_resolved": "https://registry.npmjs.org/escodegen/-/escodegen-1.14.3.tgz",
    "_shasum": "4e7b81fba61581dc97582ed78cab7f0e8d63f503",
    "_spec": "escodegen@1.14.3",
    "_where": "/Users/gferreir/workspaces/nodejs-permsys-wrap-require-rewrite",
    "bin": {
      "esgenerate": "bin/esgenerate.js",
      "escodegen": "bin/escodegen.js"
    },
    "bugs": {
      "url": "https://github.com/estools/escodegen/issues"
    },
    "bundleDependencies": false,
    "dependencies": {
      "esprima": "^4.0.1",
      "estraverse": "^4.2.0",
      "esutils": "^2.0.2",
      "optionator": "^0.8.1",
      "source-map": "~0.6.1"
    },
    "deprecated": false,
    "description": "ECMAScript code generator",
    "devDependencies": {
      "acorn": "^7.1.0",
      "bluebird": "^3.4.7",
      "bower-registry-client": "^1.0.0",
      "chai": "^3.5.0",
      "commonjs-everywhere": "^0.9.7",
      "gulp": "^3.8.10",
      "gulp-eslint": "^3.0.1",
      "gulp-mocha": "^3.0.1",
      "semver": "^5.1.0"
    },
    "engines": {
      "node": ">=4.0"
    },
    "files": [
      "LICENSE.BSD",
      "README.md",
      "bin",
      "escodegen.js",
      "package.json"
    ],
    "homepage": "http://github.com/estools/escodegen",
    "license": "BSD-2-Clause",
    "main": "escodegen.js",
    "maintainers": [
      {
        "name": "Yusuke Suzuki",
        "email": "utatane.tea@gmail.com",
        "url": "http://github.com/Constellation"
      }
    ],
    "name": "escodegen",
    "optionalDependencies": {
      "source-map": "~0.6.1"
    },
    "repository": {
      "type": "git",
      "url": "git+ssh://git@github.com/estools/escodegen.git"
    },
    "scripts": {
      "build": "cjsify -a path: tools/entry-point.js > escodegen.browser.js",
      "build-min": "cjsify -ma path: tools/entry-point.js > escodegen.browser.min.js",
      "lint": "gulp lint",
      "release": "node tools/release.js",
      "test": "gulp travis",
      "unit-test": "gulp test"
    },
    "version": "1.14.3"
  }

  },{}],74:[function(require,module,exports){
  'use strict';

  Object.defineProperty(exports, "__esModule", {
    value: true
  });
  exports.Definition = exports.ParameterDefinition = undefined;

  var _variable = require('./variable');

  var _variable2 = _interopRequireDefault(_variable);

  function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

  function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

  function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

  function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } } /*
                                                                                                                                                              Copyright (C) 2015 Yusuke Suzuki <utatane.tea@gmail.com>

                                                                                                                                                              Redistribution and use in source and binary forms, with or without
                                                                                                                                                              modification, are permitted provided that the following conditions are met:

                                                                                                                                                                * Redistributions of source code must retain the above copyright
                                                                                                                                                                  notice, this list of conditions and the following disclaimer.
                                                                                                                                                                * Redistributions in binary form must reproduce the above copyright
                                                                                                                                                                  notice, this list of conditions and the following disclaimer in the
                                                                                                                                                                  documentation and/or other materials provided with the distribution.

                                                                                                                                                              THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
                                                                                                                                                              AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
                                                                                                                                                              IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
                                                                                                                                                              ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
                                                                                                                                                              DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
                                                                                                                                                              (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
                                                                                                                                                              LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
                                                                                                                                                              ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
                                                                                                                                                              (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
                                                                                                                                                              THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
                                                                                                                                                            */

  /**
   * @class Definition
   */

  var Definition = function Definition(type, name, node, parent, index, kind) {
    _classCallCheck(this, Definition);

    /**
     * @member {String} Definition#type - type of the occurrence (e.g. "Parameter", "Variable", ...).
     */
    this.type = type;
    /**
     * @member {esprima.Identifier} Definition#name - the identifier AST node of the occurrence.
     */
    this.name = name;
    /**
     * @member {esprima.Node} Definition#node - the enclosing node of the identifier.
     */
    this.node = node;
    /**
     * @member {esprima.Node?} Definition#parent - the enclosing statement node of the identifier.
     */
    this.parent = parent;
    /**
     * @member {Number?} Definition#index - the index in the declaration statement.
     */
    this.index = index;
    /**
     * @member {String?} Definition#kind - the kind of the declaration statement.
     */
    this.kind = kind;
  };

  /**
   * @class ParameterDefinition
   */


  exports.default = Definition;

  var ParameterDefinition = function (_Definition) {
    _inherits(ParameterDefinition, _Definition);

    function ParameterDefinition(name, node, index, rest) {
      _classCallCheck(this, ParameterDefinition);

      /**
       * Whether the parameter definition is a part of a rest parameter.
       * @member {boolean} ParameterDefinition#rest
       */

      var _this = _possibleConstructorReturn(this, Object.getPrototypeOf(ParameterDefinition).call(this, _variable2.default.Parameter, name, node, null, index, null));

      _this.rest = rest;
      return _this;
    }

    return ParameterDefinition;
  }(Definition);

  exports.ParameterDefinition = ParameterDefinition;
  exports.Definition = Definition;

  /* vim: set sw=4 ts=4 et tw=80 : */


  },{"./variable":81}],75:[function(require,module,exports){
  'use strict';

  Object.defineProperty(exports, "__esModule", {
      value: true
  });
  exports.ScopeManager = exports.Scope = exports.Variable = exports.Reference = exports.version = undefined;

  var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol ? "symbol" : typeof obj; }; /*
                                                                                                                                                                                                                                                      Copyright (C) 2012-2014 Yusuke Suzuki <utatane.tea@gmail.com>
                                                                                                                                                                                                                                                      Copyright (C) 2013 Alex Seville <hi@alexanderseville.com>
                                                                                                                                                                                                                                                      Copyright (C) 2014 Thiago de Arruda <tpadilha84@gmail.com>

                                                                                                                                                                                                                                                      Redistribution and use in source and binary forms, with or without
                                                                                                                                                                                                                                                      modification, are permitted provided that the following conditions are met:

                                                                                                                                                                                                                                                        * Redistributions of source code must retain the above copyright
                                                                                                                                                                                                                                                          notice, this list of conditions and the following disclaimer.
                                                                                                                                                                                                                                                        * Redistributions in binary form must reproduce the above copyright
                                                                                                                                                                                                                                                          notice, this list of conditions and the following disclaimer in the
                                                                                                                                                                                                                                                          documentation and/or other materials provided with the distribution.

                                                                                                                                                                                                                                                      THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
                                                                                                                                                                                                                                                      AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
                                                                                                                                                                                                                                                      IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
                                                                                                                                                                                                                                                      ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
                                                                                                                                                                                                                                                      DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
                                                                                                                                                                                                                                                      (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
                                                                                                                                                                                                                                                      LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
                                                                                                                                                                                                                                                      ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
                                                                                                                                                                                                                                                      (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
                                                                                                                                                                                                                                                      THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
                                                                                                                                                                                                                                                    */

  /**
   * Escope (<a href="http://github.com/estools/escope">escope</a>) is an <a
   * href="http://www.ecma-international.org/publications/standards/Ecma-262.htm">ECMAScript</a>
   * scope analyzer extracted from the <a
   * href="http://github.com/estools/esmangle">esmangle project</a/>.
   * <p>
   * <em>escope</em> finds lexical scopes in a source program, i.e. areas of that
   * program where different occurrences of the same identifier refer to the same
   * variable. With each scope the contained variables are collected, and each
   * identifier reference in code is linked to its corresponding variable (if
   * possible).
   * <p>
   * <em>escope</em> works on a syntax tree of the parsed source code which has
   * to adhere to the <a
   * href="https://developer.mozilla.org/en-US/docs/SpiderMonkey/Parser_API">
   * Mozilla Parser API</a>. E.g. <a href="http://esprima.org">esprima</a> is a parser
   * that produces such syntax trees.
   * <p>
   * The main interface is the {@link analyze} function.
   * @module escope
   */

  /*jslint bitwise:true */

  exports.analyze = analyze;

  var _assert = require('assert');

  var _assert2 = _interopRequireDefault(_assert);

  var _scopeManager = require('./scope-manager');

  var _scopeManager2 = _interopRequireDefault(_scopeManager);

  var _referencer = require('./referencer');

  var _referencer2 = _interopRequireDefault(_referencer);

  var _reference = require('./reference');

  var _reference2 = _interopRequireDefault(_reference);

  var _variable = require('./variable');

  var _variable2 = _interopRequireDefault(_variable);

  var _scope = require('./scope');

  var _scope2 = _interopRequireDefault(_scope);

  var _package = require('../package.json');

  function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

  function defaultOptions() {
      return {
          optimistic: false,
          directive: false,
          nodejsScope: false,
          impliedStrict: false,
          sourceType: 'script', // one of ['script', 'module']
          ecmaVersion: 5,
          childVisitorKeys: null,
          fallback: 'iteration'
      };
  }

  function updateDeeply(target, override) {
      var key, val;

      function isHashObject(target) {
          return (typeof target === 'undefined' ? 'undefined' : _typeof(target)) === 'object' && target instanceof Object && !(target instanceof Array) && !(target instanceof RegExp);
      }

      for (key in override) {
          if (override.hasOwnProperty(key)) {
              val = override[key];
              if (isHashObject(val)) {
                  if (isHashObject(target[key])) {
                      updateDeeply(target[key], val);
                  } else {
                      target[key] = updateDeeply({}, val);
                  }
              } else {
                  target[key] = val;
              }
          }
      }
      return target;
  }

  /**
   * Main interface function. Takes an Esprima syntax tree and returns the
   * analyzed scopes.
   * @function analyze
   * @param {esprima.Tree} tree
   * @param {Object} providedOptions - Options that tailor the scope analysis
   * @param {boolean} [providedOptions.optimistic=false] - the optimistic flag
   * @param {boolean} [providedOptions.directive=false]- the directive flag
   * @param {boolean} [providedOptions.ignoreEval=false]- whether to check 'eval()' calls
   * @param {boolean} [providedOptions.nodejsScope=false]- whether the whole
   * script is executed under node.js environment. When enabled, escope adds
   * a function scope immediately following the global scope.
   * @param {boolean} [providedOptions.impliedStrict=false]- implied strict mode
   * (if ecmaVersion >= 5).
   * @param {string} [providedOptions.sourceType='script']- the source type of the script. one of 'script' and 'module'
   * @param {number} [providedOptions.ecmaVersion=5]- which ECMAScript version is considered
   * @param {Object} [providedOptions.childVisitorKeys=null] - Additional known visitor keys. See [esrecurse](https://github.com/estools/esrecurse)'s the `childVisitorKeys` option.
   * @param {string} [providedOptions.fallback='iteration'] - A kind of the fallback in order to encounter with unknown node. See [esrecurse](https://github.com/estools/esrecurse)'s the `fallback` option.
   * @return {ScopeManager}
   */
  function analyze(tree, providedOptions) {
      var scopeManager, referencer, options;

      options = updateDeeply(defaultOptions(), providedOptions);

      scopeManager = new _scopeManager2.default(options);

      referencer = new _referencer2.default(options, scopeManager);
      referencer.visit(tree);

      (0, _assert2.default)(scopeManager.__currentScope === null, 'currentScope should be null.');

      return scopeManager;
  }

  exports.
  /** @name module:escope.version */
  version = _package.version;
  exports.
  /** @name module:escope.Reference */
  Reference = _reference2.default;
  exports.
  /** @name module:escope.Variable */
  Variable = _variable2.default;
  exports.
  /** @name module:escope.Scope */
  Scope = _scope2.default;
  exports.
  /** @name module:escope.ScopeManager */
  ScopeManager = _scopeManager2.default;

  /* vim: set sw=4 ts=4 et tw=80 : */


  },{"../package.json":82,"./reference":77,"./referencer":78,"./scope":80,"./scope-manager":79,"./variable":81,"assert":112}],76:[function(require,module,exports){
  'use strict';

  Object.defineProperty(exports, "__esModule", {
      value: true
  });

  var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

  var _estraverse = require('estraverse');

  var _esrecurse = require('esrecurse');

  var _esrecurse2 = _interopRequireDefault(_esrecurse);

  function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

  function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

  function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

  function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; } /*
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   Copyright (C) 2015 Yusuke Suzuki <utatane.tea@gmail.com>

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   Redistribution and use in source and binary forms, with or without
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   modification, are permitted provided that the following conditions are met:

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     * Redistributions of source code must retain the above copyright
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       notice, this list of conditions and the following disclaimer.
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     * Redistributions in binary form must reproduce the above copyright
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       notice, this list of conditions and the following disclaimer in the
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       documentation and/or other materials provided with the distribution.

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 */

  function getLast(xs) {
      return xs[xs.length - 1] || null;
  }

  var PatternVisitor = function (_esrecurse$Visitor) {
      _inherits(PatternVisitor, _esrecurse$Visitor);

      _createClass(PatternVisitor, null, [{
          key: 'isPattern',
          value: function isPattern(node) {
              var nodeType = node.type;
              return nodeType === _estraverse.Syntax.Identifier || nodeType === _estraverse.Syntax.ObjectPattern || nodeType === _estraverse.Syntax.ArrayPattern || nodeType === _estraverse.Syntax.SpreadElement || nodeType === _estraverse.Syntax.RestElement || nodeType === _estraverse.Syntax.AssignmentPattern;
          }
      }]);

      function PatternVisitor(options, rootPattern, callback) {
          _classCallCheck(this, PatternVisitor);

          var _this = _possibleConstructorReturn(this, Object.getPrototypeOf(PatternVisitor).call(this, null, options));

          _this.rootPattern = rootPattern;
          _this.callback = callback;
          _this.assignments = [];
          _this.rightHandNodes = [];
          _this.restElements = [];
          return _this;
      }

      _createClass(PatternVisitor, [{
          key: 'Identifier',
          value: function Identifier(pattern) {
              var lastRestElement = getLast(this.restElements);
              this.callback(pattern, {
                  topLevel: pattern === this.rootPattern,
                  rest: lastRestElement != null && lastRestElement.argument === pattern,
                  assignments: this.assignments
              });
          }
      }, {
          key: 'Property',
          value: function Property(property) {
              // Computed property's key is a right hand node.
              if (property.computed) {
                  this.rightHandNodes.push(property.key);
              }

              // If it's shorthand, its key is same as its value.
              // If it's shorthand and has its default value, its key is same as its value.left (the value is AssignmentPattern).
              // If it's not shorthand, the name of new variable is its value's.
              this.visit(property.value);
          }
      }, {
          key: 'ArrayPattern',
          value: function ArrayPattern(pattern) {
              var i, iz, element;
              for (i = 0, iz = pattern.elements.length; i < iz; ++i) {
                  element = pattern.elements[i];
                  this.visit(element);
              }
          }
      }, {
          key: 'AssignmentPattern',
          value: function AssignmentPattern(pattern) {
              this.assignments.push(pattern);
              this.visit(pattern.left);
              this.rightHandNodes.push(pattern.right);
              this.assignments.pop();
          }
      }, {
          key: 'RestElement',
          value: function RestElement(pattern) {
              this.restElements.push(pattern);
              this.visit(pattern.argument);
              this.restElements.pop();
          }
      }, {
          key: 'MemberExpression',
          value: function MemberExpression(node) {
              // Computed property's key is a right hand node.
              if (node.computed) {
                  this.rightHandNodes.push(node.property);
              }
              // the object is only read, write to its property.
              this.rightHandNodes.push(node.object);
          }

          //
          // ForInStatement.left and AssignmentExpression.left are LeftHandSideExpression.
          // By spec, LeftHandSideExpression is Pattern or MemberExpression.
          //   (see also: https://github.com/estree/estree/pull/20#issuecomment-74584758)
          // But espree 2.0 and esprima 2.0 parse to ArrayExpression, ObjectExpression, etc...
          //

      }, {
          key: 'SpreadElement',
          value: function SpreadElement(node) {
              this.visit(node.argument);
          }
      }, {
          key: 'ArrayExpression',
          value: function ArrayExpression(node) {
              node.elements.forEach(this.visit, this);
          }
      }, {
          key: 'AssignmentExpression',
          value: function AssignmentExpression(node) {
              this.assignments.push(node);
              this.visit(node.left);
              this.rightHandNodes.push(node.right);
              this.assignments.pop();
          }
      }, {
          key: 'CallExpression',
          value: function CallExpression(node) {
              var _this2 = this;

              // arguments are right hand nodes.
              node.arguments.forEach(function (a) {
                  _this2.rightHandNodes.push(a);
              });
              this.visit(node.callee);
          }
      }]);

      return PatternVisitor;
  }(_esrecurse2.default.Visitor);

  /* vim: set sw=4 ts=4 et tw=80 : */


  exports.default = PatternVisitor;


  },{"esrecurse":91,"estraverse":93}],77:[function(require,module,exports){
  "use strict";

  Object.defineProperty(exports, "__esModule", {
    value: true
  });

  var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

  function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

  /*
    Copyright (C) 2015 Yusuke Suzuki <utatane.tea@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are met:

      * Redistributions of source code must retain the above copyright
        notice, this list of conditions and the following disclaimer.
      * Redistributions in binary form must reproduce the above copyright
        notice, this list of conditions and the following disclaimer in the
        documentation and/or other materials provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
    DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
    (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
    LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
    ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
    THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
  */

  var READ = 0x1;
  var WRITE = 0x2;
  var RW = READ | WRITE;

  /**
   * A Reference represents a single occurrence of an identifier in code.
   * @class Reference
   */

  var Reference = function () {
    function Reference(ident, scope, flag, writeExpr, maybeImplicitGlobal, partial, init) {
      _classCallCheck(this, Reference);

      /**
       * Identifier syntax node.
       * @member {esprima#Identifier} Reference#identifier
       */
      this.identifier = ident;
      /**
       * Reference to the enclosing Scope.
       * @member {Scope} Reference#from
       */
      this.from = scope;
      /**
       * Whether the reference comes from a dynamic scope (such as 'eval',
       * 'with', etc.), and may be trapped by dynamic scopes.
       * @member {boolean} Reference#tainted
       */
      this.tainted = false;
      /**
       * The variable this reference is resolved with.
       * @member {Variable} Reference#resolved
       */
      this.resolved = null;
      /**
       * The read-write mode of the reference. (Value is one of {@link
       * Reference.READ}, {@link Reference.RW}, {@link Reference.WRITE}).
       * @member {number} Reference#flag
       * @private
       */
      this.flag = flag;
      if (this.isWrite()) {
        /**
         * If reference is writeable, this is the tree being written to it.
         * @member {esprima#Node} Reference#writeExpr
         */
        this.writeExpr = writeExpr;
        /**
         * Whether the Reference might refer to a partial value of writeExpr.
         * @member {boolean} Reference#partial
         */
        this.partial = partial;
        /**
         * Whether the Reference is to write of initialization.
         * @member {boolean} Reference#init
         */
        this.init = init;
      }
      this.__maybeImplicitGlobal = maybeImplicitGlobal;
    }

    /**
     * Whether the reference is static.
     * @method Reference#isStatic
     * @return {boolean}
     */


    _createClass(Reference, [{
      key: "isStatic",
      value: function isStatic() {
        return !this.tainted && this.resolved && this.resolved.scope.isStatic();
      }

      /**
       * Whether the reference is writeable.
       * @method Reference#isWrite
       * @return {boolean}
       */

    }, {
      key: "isWrite",
      value: function isWrite() {
        return !!(this.flag & Reference.WRITE);
      }

      /**
       * Whether the reference is readable.
       * @method Reference#isRead
       * @return {boolean}
       */

    }, {
      key: "isRead",
      value: function isRead() {
        return !!(this.flag & Reference.READ);
      }

      /**
       * Whether the reference is read-only.
       * @method Reference#isReadOnly
       * @return {boolean}
       */

    }, {
      key: "isReadOnly",
      value: function isReadOnly() {
        return this.flag === Reference.READ;
      }

      /**
       * Whether the reference is write-only.
       * @method Reference#isWriteOnly
       * @return {boolean}
       */

    }, {
      key: "isWriteOnly",
      value: function isWriteOnly() {
        return this.flag === Reference.WRITE;
      }

      /**
       * Whether the reference is read-write.
       * @method Reference#isReadWrite
       * @return {boolean}
       */

    }, {
      key: "isReadWrite",
      value: function isReadWrite() {
        return this.flag === Reference.RW;
      }
    }]);

    return Reference;
  }();

  /**
   * @constant Reference.READ
   * @private
   */


  exports.default = Reference;
  Reference.READ = READ;
  /**
   * @constant Reference.WRITE
   * @private
   */
  Reference.WRITE = WRITE;
  /**
   * @constant Reference.RW
   * @private
   */
  Reference.RW = RW;

  /* vim: set sw=4 ts=4 et tw=80 : */


  },{}],78:[function(require,module,exports){
  'use strict';

  Object.defineProperty(exports, "__esModule", {
      value: true
  });

  var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

  var _estraverse = require('estraverse');

  var _esrecurse = require('esrecurse');

  var _esrecurse2 = _interopRequireDefault(_esrecurse);

  var _reference = require('./reference');

  var _reference2 = _interopRequireDefault(_reference);

  var _variable = require('./variable');

  var _variable2 = _interopRequireDefault(_variable);

  var _patternVisitor = require('./pattern-visitor');

  var _patternVisitor2 = _interopRequireDefault(_patternVisitor);

  var _definition = require('./definition');

  var _assert = require('assert');

  var _assert2 = _interopRequireDefault(_assert);

  function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

  function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

  function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

  function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; } /*
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   Copyright (C) 2015 Yusuke Suzuki <utatane.tea@gmail.com>

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   Redistribution and use in source and binary forms, with or without
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   modification, are permitted provided that the following conditions are met:

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     * Redistributions of source code must retain the above copyright
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       notice, this list of conditions and the following disclaimer.
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     * Redistributions in binary form must reproduce the above copyright
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       notice, this list of conditions and the following disclaimer in the
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       documentation and/or other materials provided with the distribution.

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 */


  function traverseIdentifierInPattern(options, rootPattern, referencer, callback) {
      // Call the callback at left hand identifier nodes, and Collect right hand nodes.
      var visitor = new _patternVisitor2.default(options, rootPattern, callback);
      visitor.visit(rootPattern);

      // Process the right hand nodes recursively.
      if (referencer != null) {
          visitor.rightHandNodes.forEach(referencer.visit, referencer);
      }
  }

  // Importing ImportDeclaration.
  // http://people.mozilla.org/~jorendorff/es6-draft.html#sec-moduledeclarationinstantiation
  // https://github.com/estree/estree/blob/master/es6.md#importdeclaration
  // FIXME: Now, we don't create module environment, because the context is
  // implementation dependent.

  var Importer = function (_esrecurse$Visitor) {
      _inherits(Importer, _esrecurse$Visitor);

      function Importer(declaration, referencer) {
          _classCallCheck(this, Importer);

          var _this = _possibleConstructorReturn(this, Object.getPrototypeOf(Importer).call(this, null, referencer.options));

          _this.declaration = declaration;
          _this.referencer = referencer;
          return _this;
      }

      _createClass(Importer, [{
          key: 'visitImport',
          value: function visitImport(id, specifier) {
              var _this2 = this;

              this.referencer.visitPattern(id, function (pattern) {
                  _this2.referencer.currentScope().__define(pattern, new _definition.Definition(_variable2.default.ImportBinding, pattern, specifier, _this2.declaration, null, null));
              });
          }
      }, {
          key: 'ImportNamespaceSpecifier',
          value: function ImportNamespaceSpecifier(node) {
              var local = node.local || node.id;
              if (local) {
                  this.visitImport(local, node);
              }
          }
      }, {
          key: 'ImportDefaultSpecifier',
          value: function ImportDefaultSpecifier(node) {
              var local = node.local || node.id;
              this.visitImport(local, node);
          }
      }, {
          key: 'ImportSpecifier',
          value: function ImportSpecifier(node) {
              var local = node.local || node.id;
              if (node.name) {
                  this.visitImport(node.name, node);
              } else {
                  this.visitImport(local, node);
              }
          }
      }]);

      return Importer;
  }(_esrecurse2.default.Visitor);

  // Referencing variables and creating bindings.


  var Referencer = function (_esrecurse$Visitor2) {
      _inherits(Referencer, _esrecurse$Visitor2);

      function Referencer(options, scopeManager) {
          _classCallCheck(this, Referencer);

          var _this3 = _possibleConstructorReturn(this, Object.getPrototypeOf(Referencer).call(this, null, options));

          _this3.options = options;
          _this3.scopeManager = scopeManager;
          _this3.parent = null;
          _this3.isInnerMethodDefinition = false;
          return _this3;
      }

      _createClass(Referencer, [{
          key: 'currentScope',
          value: function currentScope() {
              return this.scopeManager.__currentScope;
          }
      }, {
          key: 'close',
          value: function close(node) {
              while (this.currentScope() && node === this.currentScope().block) {
                  this.scopeManager.__currentScope = this.currentScope().__close(this.scopeManager);
              }
          }
      }, {
          key: 'pushInnerMethodDefinition',
          value: function pushInnerMethodDefinition(isInnerMethodDefinition) {
              var previous = this.isInnerMethodDefinition;
              this.isInnerMethodDefinition = isInnerMethodDefinition;
              return previous;
          }
      }, {
          key: 'popInnerMethodDefinition',
          value: function popInnerMethodDefinition(isInnerMethodDefinition) {
              this.isInnerMethodDefinition = isInnerMethodDefinition;
          }
      }, {
          key: 'materializeTDZScope',
          value: function materializeTDZScope(node, iterationNode) {
              // http://people.mozilla.org/~jorendorff/es6-draft.html#sec-runtime-semantics-forin-div-ofexpressionevaluation-abstract-operation
              // TDZ scope hides the declaration's names.
              this.scopeManager.__nestTDZScope(node, iterationNode);
              this.visitVariableDeclaration(this.currentScope(), _variable2.default.TDZ, iterationNode.left, 0, true);
          }
      }, {
          key: 'materializeIterationScope',
          value: function materializeIterationScope(node) {
              var _this4 = this;

              // Generate iteration scope for upper ForIn/ForOf Statements.
              var letOrConstDecl;
              this.scopeManager.__nestForScope(node);
              letOrConstDecl = node.left;
              this.visitVariableDeclaration(this.currentScope(), _variable2.default.Variable, letOrConstDecl, 0);
              this.visitPattern(letOrConstDecl.declarations[0].id, function (pattern) {
                  _this4.currentScope().__referencing(pattern, _reference2.default.WRITE, node.right, null, true, true);
              });
          }
      }, {
          key: 'referencingDefaultValue',
          value: function referencingDefaultValue(pattern, assignments, maybeImplicitGlobal, init) {
              var scope = this.currentScope();
              assignments.forEach(function (assignment) {
                  scope.__referencing(pattern, _reference2.default.WRITE, assignment.right, maybeImplicitGlobal, pattern !== assignment.left, init);
              });
          }
      }, {
          key: 'visitPattern',
          value: function visitPattern(node, options, callback) {
              if (typeof options === 'function') {
                  callback = options;
                  options = { processRightHandNodes: false };
              }
              traverseIdentifierInPattern(this.options, node, options.processRightHandNodes ? this : null, callback);
          }
      }, {
          key: 'visitFunction',
          value: function visitFunction(node) {
              var _this5 = this;

              var i, iz;
              // FunctionDeclaration name is defined in upper scope
              // NOTE: Not referring variableScope. It is intended.
              // Since
              //  in ES5, FunctionDeclaration should be in FunctionBody.
              //  in ES6, FunctionDeclaration should be block scoped.
              if (node.type === _estraverse.Syntax.FunctionDeclaration) {
                  // id is defined in upper scope
                  this.currentScope().__define(node.id, new _definition.Definition(_variable2.default.FunctionName, node.id, node, null, null, null));
              }

              // FunctionExpression with name creates its special scope;
              // FunctionExpressionNameScope.
              if (node.type === _estraverse.Syntax.FunctionExpression && node.id) {
                  this.scopeManager.__nestFunctionExpressionNameScope(node);
              }

              // Consider this function is in the MethodDefinition.
              this.scopeManager.__nestFunctionScope(node, this.isInnerMethodDefinition);

              // Process parameter declarations.
              for (i = 0, iz = node.params.length; i < iz; ++i) {
                  this.visitPattern(node.params[i], { processRightHandNodes: true }, function (pattern, info) {
                      _this5.currentScope().__define(pattern, new _definition.ParameterDefinition(pattern, node, i, info.rest));

                      _this5.referencingDefaultValue(pattern, info.assignments, null, true);
                  });
              }

              // if there's a rest argument, add that
              if (node.rest) {
                  this.visitPattern({
                      type: 'RestElement',
                      argument: node.rest
                  }, function (pattern) {
                      _this5.currentScope().__define(pattern, new _definition.ParameterDefinition(pattern, node, node.params.length, true));
                  });
              }

              // Skip BlockStatement to prevent creating BlockStatement scope.
              if (node.body.type === _estraverse.Syntax.BlockStatement) {
                  this.visitChildren(node.body);
              } else {
                  this.visit(node.body);
              }

              this.close(node);
          }
      }, {
          key: 'visitClass',
          value: function visitClass(node) {
              if (node.type === _estraverse.Syntax.ClassDeclaration) {
                  this.currentScope().__define(node.id, new _definition.Definition(_variable2.default.ClassName, node.id, node, null, null, null));
              }

              // FIXME: Maybe consider TDZ.
              this.visit(node.superClass);

              this.scopeManager.__nestClassScope(node);

              if (node.id) {
                  this.currentScope().__define(node.id, new _definition.Definition(_variable2.default.ClassName, node.id, node));
              }
              this.visit(node.body);

              this.close(node);
          }
      }, {
          key: 'visitProperty',
          value: function visitProperty(node) {
              var previous, isMethodDefinition;
              if (node.computed) {
                  this.visit(node.key);
              }

              isMethodDefinition = node.type === _estraverse.Syntax.MethodDefinition;
              if (isMethodDefinition) {
                  previous = this.pushInnerMethodDefinition(true);
              }
              this.visit(node.value);
              if (isMethodDefinition) {
                  this.popInnerMethodDefinition(previous);
              }
          }
      }, {
          key: 'visitForIn',
          value: function visitForIn(node) {
              var _this6 = this;

              if (node.left.type === _estraverse.Syntax.VariableDeclaration && node.left.kind !== 'var') {
                  this.materializeTDZScope(node.right, node);
                  this.visit(node.right);
                  this.close(node.right);

                  this.materializeIterationScope(node);
                  this.visit(node.body);
                  this.close(node);
              } else {
                  if (node.left.type === _estraverse.Syntax.VariableDeclaration) {
                      this.visit(node.left);
                      this.visitPattern(node.left.declarations[0].id, function (pattern) {
                          _this6.currentScope().__referencing(pattern, _reference2.default.WRITE, node.right, null, true, true);
                      });
                  } else {
                      this.visitPattern(node.left, { processRightHandNodes: true }, function (pattern, info) {
                          var maybeImplicitGlobal = null;
                          if (!_this6.currentScope().isStrict) {
                              maybeImplicitGlobal = {
                                  pattern: pattern,
                                  node: node
                              };
                          }
                          _this6.referencingDefaultValue(pattern, info.assignments, maybeImplicitGlobal, false);
                          _this6.currentScope().__referencing(pattern, _reference2.default.WRITE, node.right, maybeImplicitGlobal, true, false);
                      });
                  }
                  this.visit(node.right);
                  this.visit(node.body);
              }
          }
      }, {
          key: 'visitVariableDeclaration',
          value: function visitVariableDeclaration(variableTargetScope, type, node, index, fromTDZ) {
              var _this7 = this;

              // If this was called to initialize a TDZ scope, this needs to make definitions, but doesn't make references.
              var decl, init;

              decl = node.declarations[index];
              init = decl.init;
              this.visitPattern(decl.id, { processRightHandNodes: !fromTDZ }, function (pattern, info) {
                  variableTargetScope.__define(pattern, new _definition.Definition(type, pattern, decl, node, index, node.kind));

                  if (!fromTDZ) {
                      _this7.referencingDefaultValue(pattern, info.assignments, null, true);
                  }
                  if (init) {
                      _this7.currentScope().__referencing(pattern, _reference2.default.WRITE, init, null, !info.topLevel, true);
                  }
              });
          }
      }, {
          key: 'AssignmentExpression',
          value: function AssignmentExpression(node) {
              var _this8 = this;

              if (_patternVisitor2.default.isPattern(node.left)) {
                  if (node.operator === '=') {
                      this.visitPattern(node.left, { processRightHandNodes: true }, function (pattern, info) {
                          var maybeImplicitGlobal = null;
                          if (!_this8.currentScope().isStrict) {
                              maybeImplicitGlobal = {
                                  pattern: pattern,
                                  node: node
                              };
                          }
                          _this8.referencingDefaultValue(pattern, info.assignments, maybeImplicitGlobal, false);
                          _this8.currentScope().__referencing(pattern, _reference2.default.WRITE, node.right, maybeImplicitGlobal, !info.topLevel, false);
                      });
                  } else {
                      this.currentScope().__referencing(node.left, _reference2.default.RW, node.right);
                  }
              } else {
                  this.visit(node.left);
              }
              this.visit(node.right);
          }
      }, {
          key: 'CatchClause',
          value: function CatchClause(node) {
              var _this9 = this;

              this.scopeManager.__nestCatchScope(node);

              this.visitPattern(node.param, { processRightHandNodes: true }, function (pattern, info) {
                  _this9.currentScope().__define(pattern, new _definition.Definition(_variable2.default.CatchClause, node.param, node, null, null, null));
                  _this9.referencingDefaultValue(pattern, info.assignments, null, true);
              });
              this.visit(node.body);

              this.close(node);
          }
      }, {
          key: 'Program',
          value: function Program(node) {
              this.scopeManager.__nestGlobalScope(node);

              if (this.scopeManager.__isNodejsScope()) {
                  // Force strictness of GlobalScope to false when using node.js scope.
                  this.currentScope().isStrict = false;
                  this.scopeManager.__nestFunctionScope(node, false);
              }

              if (this.scopeManager.__isES6() && this.scopeManager.isModule()) {
                  this.scopeManager.__nestModuleScope(node);
              }

              if (this.scopeManager.isStrictModeSupported() && this.scopeManager.isImpliedStrict()) {
                  this.currentScope().isStrict = true;
              }

              this.visitChildren(node);
              this.close(node);
          }
      }, {
          key: 'Identifier',
          value: function Identifier(node) {
              this.currentScope().__referencing(node);
          }
      }, {
          key: 'UpdateExpression',
          value: function UpdateExpression(node) {
              if (_patternVisitor2.default.isPattern(node.argument)) {
                  this.currentScope().__referencing(node.argument, _reference2.default.RW, null);
              } else {
                  this.visitChildren(node);
              }
          }
      }, {
          key: 'MemberExpression',
          value: function MemberExpression(node) {
              this.visit(node.object);
              if (node.computed) {
                  this.visit(node.property);
              }
          }
      }, {
          key: 'Property',
          value: function Property(node) {
              this.visitProperty(node);
          }
      }, {
          key: 'MethodDefinition',
          value: function MethodDefinition(node) {
              this.visitProperty(node);
          }
      }, {
          key: 'BreakStatement',
          value: function BreakStatement() {}
      }, {
          key: 'ContinueStatement',
          value: function ContinueStatement() {}
      }, {
          key: 'LabeledStatement',
          value: function LabeledStatement(node) {
              this.visit(node.body);
          }
      }, {
          key: 'ForStatement',
          value: function ForStatement(node) {
              // Create ForStatement declaration.
              // NOTE: In ES6, ForStatement dynamically generates
              // per iteration environment. However, escope is
              // a static analyzer, we only generate one scope for ForStatement.
              if (node.init && node.init.type === _estraverse.Syntax.VariableDeclaration && node.init.kind !== 'var') {
                  this.scopeManager.__nestForScope(node);
              }

              this.visitChildren(node);

              this.close(node);
          }
      }, {
          key: 'ClassExpression',
          value: function ClassExpression(node) {
              this.visitClass(node);
          }
      }, {
          key: 'ClassDeclaration',
          value: function ClassDeclaration(node) {
              this.visitClass(node);
          }
      }, {
          key: 'CallExpression',
          value: function CallExpression(node) {
              // Check this is direct call to eval
              if (!this.scopeManager.__ignoreEval() && node.callee.type === _estraverse.Syntax.Identifier && node.callee.name === 'eval') {
                  // NOTE: This should be `variableScope`. Since direct eval call always creates Lexical environment and
                  // let / const should be enclosed into it. Only VariableDeclaration affects on the caller's environment.
                  this.currentScope().variableScope.__detectEval();
              }
              this.visitChildren(node);
          }
      }, {
          key: 'BlockStatement',
          value: function BlockStatement(node) {
              if (this.scopeManager.__isES6()) {
                  this.scopeManager.__nestBlockScope(node);
              }

              this.visitChildren(node);

              this.close(node);
          }
      }, {
          key: 'ThisExpression',
          value: function ThisExpression() {
              this.currentScope().variableScope.__detectThis();
          }
      }, {
          key: 'WithStatement',
          value: function WithStatement(node) {
              this.visit(node.object);
              // Then nest scope for WithStatement.
              this.scopeManager.__nestWithScope(node);

              this.visit(node.body);

              this.close(node);
          }
      }, {
          key: 'VariableDeclaration',
          value: function VariableDeclaration(node) {
              var variableTargetScope, i, iz, decl;
              variableTargetScope = node.kind === 'var' ? this.currentScope().variableScope : this.currentScope();
              for (i = 0, iz = node.declarations.length; i < iz; ++i) {
                  decl = node.declarations[i];
                  this.visitVariableDeclaration(variableTargetScope, _variable2.default.Variable, node, i);
                  if (decl.init) {
                      this.visit(decl.init);
                  }
              }
          }

          // sec 13.11.8

      }, {
          key: 'SwitchStatement',
          value: function SwitchStatement(node) {
              var i, iz;

              this.visit(node.discriminant);

              if (this.scopeManager.__isES6()) {
                  this.scopeManager.__nestSwitchScope(node);
              }

              for (i = 0, iz = node.cases.length; i < iz; ++i) {
                  this.visit(node.cases[i]);
              }

              this.close(node);
          }
      }, {
          key: 'FunctionDeclaration',
          value: function FunctionDeclaration(node) {
              this.visitFunction(node);
          }
      }, {
          key: 'FunctionExpression',
          value: function FunctionExpression(node) {
              this.visitFunction(node);
          }
      }, {
          key: 'ForOfStatement',
          value: function ForOfStatement(node) {
              this.visitForIn(node);
          }
      }, {
          key: 'ForInStatement',
          value: function ForInStatement(node) {
              this.visitForIn(node);
          }
      }, {
          key: 'ArrowFunctionExpression',
          value: function ArrowFunctionExpression(node) {
              this.visitFunction(node);
          }
      }, {
          key: 'ImportDeclaration',
          value: function ImportDeclaration(node) {
              var importer;

              (0, _assert2.default)(this.scopeManager.__isES6() && this.scopeManager.isModule(), 'ImportDeclaration should appear when the mode is ES6 and in the module context.');

              importer = new Importer(node, this);
              importer.visit(node);
          }
      }, {
          key: 'visitExportDeclaration',
          value: function visitExportDeclaration(node) {
              if (node.source) {
                  return;
              }
              if (node.declaration) {
                  this.visit(node.declaration);
                  return;
              }

              this.visitChildren(node);
          }
      }, {
          key: 'ExportDeclaration',
          value: function ExportDeclaration(node) {
              this.visitExportDeclaration(node);
          }
      }, {
          key: 'ExportNamedDeclaration',
          value: function ExportNamedDeclaration(node) {
              this.visitExportDeclaration(node);
          }
      }, {
          key: 'ExportSpecifier',
          value: function ExportSpecifier(node) {
              var local = node.id || node.local;
              this.visit(local);
          }
      }, {
          key: 'MetaProperty',
          value: function MetaProperty() {
              // do nothing.
          }
      }]);

      return Referencer;
  }(_esrecurse2.default.Visitor);

  /* vim: set sw=4 ts=4 et tw=80 : */


  exports.default = Referencer;


  },{"./definition":74,"./pattern-visitor":76,"./reference":77,"./variable":81,"assert":112,"esrecurse":91,"estraverse":93}],79:[function(require,module,exports){
  'use strict';

  Object.defineProperty(exports, "__esModule", {
      value: true
  });

  var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }(); /*
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         Copyright (C) 2015 Yusuke Suzuki <utatane.tea@gmail.com>

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         Redistribution and use in source and binary forms, with or without
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         modification, are permitted provided that the following conditions are met:

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           * Redistributions of source code must retain the above copyright
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             notice, this list of conditions and the following disclaimer.
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           * Redistributions in binary form must reproduce the above copyright
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             notice, this list of conditions and the following disclaimer in the
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             documentation and/or other materials provided with the distribution.

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       */

  var _es6WeakMap = require('es6-weak-map');

  var _es6WeakMap2 = _interopRequireDefault(_es6WeakMap);

  var _scope = require('./scope');

  var _scope2 = _interopRequireDefault(_scope);

  var _assert = require('assert');

  var _assert2 = _interopRequireDefault(_assert);

  function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

  function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

  /**
   * @class ScopeManager
   */

  var ScopeManager = function () {
      function ScopeManager(options) {
          _classCallCheck(this, ScopeManager);

          this.scopes = [];
          this.globalScope = null;
          this.__nodeToScope = new _es6WeakMap2.default();
          this.__currentScope = null;
          this.__options = options;
          this.__declaredVariables = new _es6WeakMap2.default();
      }

      _createClass(ScopeManager, [{
          key: '__useDirective',
          value: function __useDirective() {
              return this.__options.directive;
          }
      }, {
          key: '__isOptimistic',
          value: function __isOptimistic() {
              return this.__options.optimistic;
          }
      }, {
          key: '__ignoreEval',
          value: function __ignoreEval() {
              return this.__options.ignoreEval;
          }
      }, {
          key: '__isNodejsScope',
          value: function __isNodejsScope() {
              return this.__options.nodejsScope;
          }
      }, {
          key: 'isModule',
          value: function isModule() {
              return this.__options.sourceType === 'module';
          }
      }, {
          key: 'isImpliedStrict',
          value: function isImpliedStrict() {
              return this.__options.impliedStrict;
          }
      }, {
          key: 'isStrictModeSupported',
          value: function isStrictModeSupported() {
              return this.__options.ecmaVersion >= 5;
          }

          // Returns appropriate scope for this node.

      }, {
          key: '__get',
          value: function __get(node) {
              return this.__nodeToScope.get(node);
          }

          /**
           * Get variables that are declared by the node.
           *
           * "are declared by the node" means the node is same as `Variable.defs[].node` or `Variable.defs[].parent`.
           * If the node declares nothing, this method returns an empty array.
           * CAUTION: This API is experimental. See https://github.com/estools/escope/pull/69 for more details.
           *
           * @param {Esprima.Node} node - a node to get.
           * @returns {Variable[]} variables that declared by the node.
           */

      }, {
          key: 'getDeclaredVariables',
          value: function getDeclaredVariables(node) {
              return this.__declaredVariables.get(node) || [];
          }

          /**
           * acquire scope from node.
           * @method ScopeManager#acquire
           * @param {Esprima.Node} node - node for the acquired scope.
           * @param {boolean=} inner - look up the most inner scope, default value is false.
           * @return {Scope?}
           */

      }, {
          key: 'acquire',
          value: function acquire(node, inner) {
              var scopes, scope, i, iz;

              function predicate(scope) {
                  if (scope.type === 'function' && scope.functionExpressionScope) {
                      return false;
                  }
                  if (scope.type === 'TDZ') {
                      return false;
                  }
                  return true;
              }

              scopes = this.__get(node);
              if (!scopes || scopes.length === 0) {
                  return null;
              }

              // Heuristic selection from all scopes.
              // If you would like to get all scopes, please use ScopeManager#acquireAll.
              if (scopes.length === 1) {
                  return scopes[0];
              }

              if (inner) {
                  for (i = scopes.length - 1; i >= 0; --i) {
                      scope = scopes[i];
                      if (predicate(scope)) {
                          return scope;
                      }
                  }
              } else {
                  for (i = 0, iz = scopes.length; i < iz; ++i) {
                      scope = scopes[i];
                      if (predicate(scope)) {
                          return scope;
                      }
                  }
              }

              return null;
          }

          /**
           * acquire all scopes from node.
           * @method ScopeManager#acquireAll
           * @param {Esprima.Node} node - node for the acquired scope.
           * @return {Scope[]?}
           */

      }, {
          key: 'acquireAll',
          value: function acquireAll(node) {
              return this.__get(node);
          }

          /**
           * release the node.
           * @method ScopeManager#release
           * @param {Esprima.Node} node - releasing node.
           * @param {boolean=} inner - look up the most inner scope, default value is false.
           * @return {Scope?} upper scope for the node.
           */

      }, {
          key: 'release',
          value: function release(node, inner) {
              var scopes, scope;
              scopes = this.__get(node);
              if (scopes && scopes.length) {
                  scope = scopes[0].upper;
                  if (!scope) {
                      return null;
                  }
                  return this.acquire(scope.block, inner);
              }
              return null;
          }
      }, {
          key: 'attach',
          value: function attach() {}
      }, {
          key: 'detach',
          value: function detach() {}
      }, {
          key: '__nestScope',
          value: function __nestScope(scope) {
              if (scope instanceof _scope.GlobalScope) {
                  (0, _assert2.default)(this.__currentScope === null);
                  this.globalScope = scope;
              }
              this.__currentScope = scope;
              return scope;
          }
      }, {
          key: '__nestGlobalScope',
          value: function __nestGlobalScope(node) {
              return this.__nestScope(new _scope.GlobalScope(this, node));
          }
      }, {
          key: '__nestBlockScope',
          value: function __nestBlockScope(node, isMethodDefinition) {
              return this.__nestScope(new _scope.BlockScope(this, this.__currentScope, node));
          }
      }, {
          key: '__nestFunctionScope',
          value: function __nestFunctionScope(node, isMethodDefinition) {
              return this.__nestScope(new _scope.FunctionScope(this, this.__currentScope, node, isMethodDefinition));
          }
      }, {
          key: '__nestForScope',
          value: function __nestForScope(node) {
              return this.__nestScope(new _scope.ForScope(this, this.__currentScope, node));
          }
      }, {
          key: '__nestCatchScope',
          value: function __nestCatchScope(node) {
              return this.__nestScope(new _scope.CatchScope(this, this.__currentScope, node));
          }
      }, {
          key: '__nestWithScope',
          value: function __nestWithScope(node) {
              return this.__nestScope(new _scope.WithScope(this, this.__currentScope, node));
          }
      }, {
          key: '__nestClassScope',
          value: function __nestClassScope(node) {
              return this.__nestScope(new _scope.ClassScope(this, this.__currentScope, node));
          }
      }, {
          key: '__nestSwitchScope',
          value: function __nestSwitchScope(node) {
              return this.__nestScope(new _scope.SwitchScope(this, this.__currentScope, node));
          }
      }, {
          key: '__nestModuleScope',
          value: function __nestModuleScope(node) {
              return this.__nestScope(new _scope.ModuleScope(this, this.__currentScope, node));
          }
      }, {
          key: '__nestTDZScope',
          value: function __nestTDZScope(node) {
              return this.__nestScope(new _scope.TDZScope(this, this.__currentScope, node));
          }
      }, {
          key: '__nestFunctionExpressionNameScope',
          value: function __nestFunctionExpressionNameScope(node) {
              return this.__nestScope(new _scope.FunctionExpressionNameScope(this, this.__currentScope, node));
          }
      }, {
          key: '__isES6',
          value: function __isES6() {
              return this.__options.ecmaVersion >= 6;
          }
      }]);

      return ScopeManager;
  }();

  /* vim: set sw=4 ts=4 et tw=80 : */


  exports.default = ScopeManager;


  },{"./scope":80,"assert":112,"es6-weak-map":68}],80:[function(require,module,exports){
  'use strict';

  Object.defineProperty(exports, "__esModule", {
      value: true
  });
  exports.ClassScope = exports.ForScope = exports.FunctionScope = exports.SwitchScope = exports.BlockScope = exports.TDZScope = exports.WithScope = exports.CatchScope = exports.FunctionExpressionNameScope = exports.ModuleScope = exports.GlobalScope = undefined;

  var _get = function get(object, property, receiver) { if (object === null) object = Function.prototype; var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { return get(parent, property, receiver); } } else if ("value" in desc) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } };

  var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }(); /*
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         Copyright (C) 2015 Yusuke Suzuki <utatane.tea@gmail.com>

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         Redistribution and use in source and binary forms, with or without
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         modification, are permitted provided that the following conditions are met:

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           * Redistributions of source code must retain the above copyright
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             notice, this list of conditions and the following disclaimer.
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           * Redistributions in binary form must reproduce the above copyright
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             notice, this list of conditions and the following disclaimer in the
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             documentation and/or other materials provided with the distribution.

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       */

  var _estraverse = require('estraverse');

  var _es6Map = require('es6-map');

  var _es6Map2 = _interopRequireDefault(_es6Map);

  var _reference = require('./reference');

  var _reference2 = _interopRequireDefault(_reference);

  var _variable = require('./variable');

  var _variable2 = _interopRequireDefault(_variable);

  var _definition = require('./definition');

  var _definition2 = _interopRequireDefault(_definition);

  var _assert = require('assert');

  var _assert2 = _interopRequireDefault(_assert);

  function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

  function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

  function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

  function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

  function isStrictScope(scope, block, isMethodDefinition, useDirective) {
      var body, i, iz, stmt, expr;

      // When upper scope is exists and strict, inner scope is also strict.
      if (scope.upper && scope.upper.isStrict) {
          return true;
      }

      // ArrowFunctionExpression's scope is always strict scope.
      if (block.type === _estraverse.Syntax.ArrowFunctionExpression) {
          return true;
      }

      if (isMethodDefinition) {
          return true;
      }

      if (scope.type === 'class' || scope.type === 'module') {
          return true;
      }

      if (scope.type === 'block' || scope.type === 'switch') {
          return false;
      }

      if (scope.type === 'function') {
          if (block.type === _estraverse.Syntax.Program) {
              body = block;
          } else {
              body = block.body;
          }
      } else if (scope.type === 'global') {
          body = block;
      } else {
          return false;
      }

      // Search 'use strict' directive.
      if (useDirective) {
          for (i = 0, iz = body.body.length; i < iz; ++i) {
              stmt = body.body[i];
              if (stmt.type !== _estraverse.Syntax.DirectiveStatement) {
                  break;
              }
              if (stmt.raw === '"use strict"' || stmt.raw === '\'use strict\'') {
                  return true;
              }
          }
      } else {
          for (i = 0, iz = body.body.length; i < iz; ++i) {
              stmt = body.body[i];
              if (stmt.type !== _estraverse.Syntax.ExpressionStatement) {
                  break;
              }
              expr = stmt.expression;
              if (expr.type !== _estraverse.Syntax.Literal || typeof expr.value !== 'string') {
                  break;
              }
              if (expr.raw != null) {
                  if (expr.raw === '"use strict"' || expr.raw === '\'use strict\'') {
                      return true;
                  }
              } else {
                  if (expr.value === 'use strict') {
                      return true;
                  }
              }
          }
      }
      return false;
  }

  function registerScope(scopeManager, scope) {
      var scopes;

      scopeManager.scopes.push(scope);

      scopes = scopeManager.__nodeToScope.get(scope.block);
      if (scopes) {
          scopes.push(scope);
      } else {
          scopeManager.__nodeToScope.set(scope.block, [scope]);
      }
  }

  function shouldBeStatically(def) {
      return def.type === _variable2.default.ClassName || def.type === _variable2.default.Variable && def.parent.kind !== 'var';
  }

  /**
   * @class Scope
   */

  var Scope = function () {
      function Scope(scopeManager, type, upperScope, block, isMethodDefinition) {
          _classCallCheck(this, Scope);

          /**
           * One of 'TDZ', 'module', 'block', 'switch', 'function', 'catch', 'with', 'function', 'class', 'global'.
           * @member {String} Scope#type
           */
          this.type = type;
          /**
          * The scoped {@link Variable}s of this scope, as <code>{ Variable.name
          * : Variable }</code>.
          * @member {Map} Scope#set
          */
          this.set = new _es6Map2.default();
          /**
           * The tainted variables of this scope, as <code>{ Variable.name :
           * boolean }</code>.
           * @member {Map} Scope#taints */
          this.taints = new _es6Map2.default();
          /**
           * Generally, through the lexical scoping of JS you can always know
           * which variable an identifier in the source code refers to. There are
           * a few exceptions to this rule. With 'global' and 'with' scopes you
           * can only decide at runtime which variable a reference refers to.
           * Moreover, if 'eval()' is used in a scope, it might introduce new
           * bindings in this or its parent scopes.
           * All those scopes are considered 'dynamic'.
           * @member {boolean} Scope#dynamic
           */
          this.dynamic = this.type === 'global' || this.type === 'with';
          /**
           * A reference to the scope-defining syntax node.
           * @member {esprima.Node} Scope#block
           */
          this.block = block;
          /**
          * The {@link Reference|references} that are not resolved with this scope.
          * @member {Reference[]} Scope#through
          */
          this.through = [];
          /**
          * The scoped {@link Variable}s of this scope. In the case of a
          * 'function' scope this includes the automatic argument <em>arguments</em> as
          * its first element, as well as all further formal arguments.
          * @member {Variable[]} Scope#variables
          */
          this.variables = [];
          /**
          * Any variable {@link Reference|reference} found in this scope. This
          * includes occurrences of local variables as well as variables from
          * parent scopes (including the global scope). For local variables
          * this also includes defining occurrences (like in a 'var' statement).
          * In a 'function' scope this does not include the occurrences of the
          * formal parameter in the parameter list.
          * @member {Reference[]} Scope#references
          */
          this.references = [];

          /**
          * For 'global' and 'function' scopes, this is a self-reference. For
          * other scope types this is the <em>variableScope</em> value of the
          * parent scope.
          * @member {Scope} Scope#variableScope
          */
          this.variableScope = this.type === 'global' || this.type === 'function' || this.type === 'module' ? this : upperScope.variableScope;
          /**
          * Whether this scope is created by a FunctionExpression.
          * @member {boolean} Scope#functionExpressionScope
          */
          this.functionExpressionScope = false;
          /**
          * Whether this is a scope that contains an 'eval()' invocation.
          * @member {boolean} Scope#directCallToEvalScope
          */
          this.directCallToEvalScope = false;
          /**
          * @member {boolean} Scope#thisFound
          */
          this.thisFound = false;

          this.__left = [];

          /**
          * Reference to the parent {@link Scope|scope}.
          * @member {Scope} Scope#upper
          */
          this.upper = upperScope;
          /**
          * Whether 'use strict' is in effect in this scope.
          * @member {boolean} Scope#isStrict
          */
          this.isStrict = isStrictScope(this, block, isMethodDefinition, scopeManager.__useDirective());

          /**
          * List of nested {@link Scope}s.
          * @member {Scope[]} Scope#childScopes
          */
          this.childScopes = [];
          if (this.upper) {
              this.upper.childScopes.push(this);
          }

          this.__declaredVariables = scopeManager.__declaredVariables;

          registerScope(scopeManager, this);
      }

      _createClass(Scope, [{
          key: '__shouldStaticallyClose',
          value: function __shouldStaticallyClose(scopeManager) {
              return !this.dynamic || scopeManager.__isOptimistic();
          }
      }, {
          key: '__shouldStaticallyCloseForGlobal',
          value: function __shouldStaticallyCloseForGlobal(ref) {
              // On global scope, let/const/class declarations should be resolved statically.
              var name = ref.identifier.name;
              if (!this.set.has(name)) {
                  return false;
              }

              var variable = this.set.get(name);
              var defs = variable.defs;
              return defs.length > 0 && defs.every(shouldBeStatically);
          }
      }, {
          key: '__staticCloseRef',
          value: function __staticCloseRef(ref) {
              if (!this.__resolve(ref)) {
                  this.__delegateToUpperScope(ref);
              }
          }
      }, {
          key: '__dynamicCloseRef',
          value: function __dynamicCloseRef(ref) {
              // notify all names are through to global
              var current = this;
              do {
                  current.through.push(ref);
                  current = current.upper;
              } while (current);
          }
      }, {
          key: '__globalCloseRef',
          value: function __globalCloseRef(ref) {
              // let/const/class declarations should be resolved statically.
              // others should be resolved dynamically.
              if (this.__shouldStaticallyCloseForGlobal(ref)) {
                  this.__staticCloseRef(ref);
              } else {
                  this.__dynamicCloseRef(ref);
              }
          }
      }, {
          key: '__close',
          value: function __close(scopeManager) {
              var closeRef;
              if (this.__shouldStaticallyClose(scopeManager)) {
                  closeRef = this.__staticCloseRef;
              } else if (this.type !== 'global') {
                  closeRef = this.__dynamicCloseRef;
              } else {
                  closeRef = this.__globalCloseRef;
              }

              // Try Resolving all references in this scope.
              for (var i = 0, iz = this.__left.length; i < iz; ++i) {
                  var ref = this.__left[i];
                  closeRef.call(this, ref);
              }
              this.__left = null;

              return this.upper;
          }
      }, {
          key: '__resolve',
          value: function __resolve(ref) {
              var variable, name;
              name = ref.identifier.name;
              if (this.set.has(name)) {
                  variable = this.set.get(name);
                  variable.references.push(ref);
                  variable.stack = variable.stack && ref.from.variableScope === this.variableScope;
                  if (ref.tainted) {
                      variable.tainted = true;
                      this.taints.set(variable.name, true);
                  }
                  ref.resolved = variable;
                  return true;
              }
              return false;
          }
      }, {
          key: '__delegateToUpperScope',
          value: function __delegateToUpperScope(ref) {
              if (this.upper) {
                  this.upper.__left.push(ref);
              }
              this.through.push(ref);
          }
      }, {
          key: '__addDeclaredVariablesOfNode',
          value: function __addDeclaredVariablesOfNode(variable, node) {
              if (node == null) {
                  return;
              }

              var variables = this.__declaredVariables.get(node);
              if (variables == null) {
                  variables = [];
                  this.__declaredVariables.set(node, variables);
              }
              if (variables.indexOf(variable) === -1) {
                  variables.push(variable);
              }
          }
      }, {
          key: '__defineGeneric',
          value: function __defineGeneric(name, set, variables, node, def) {
              var variable;

              variable = set.get(name);
              if (!variable) {
                  variable = new _variable2.default(name, this);
                  set.set(name, variable);
                  variables.push(variable);
              }

              if (def) {
                  variable.defs.push(def);
                  if (def.type !== _variable2.default.TDZ) {
                      this.__addDeclaredVariablesOfNode(variable, def.node);
                      this.__addDeclaredVariablesOfNode(variable, def.parent);
                  }
              }
              if (node) {
                  variable.identifiers.push(node);
              }
          }
      }, {
          key: '__define',
          value: function __define(node, def) {
              if (node && node.type === _estraverse.Syntax.Identifier) {
                  this.__defineGeneric(node.name, this.set, this.variables, node, def);
              }
          }
      }, {
          key: '__referencing',
          value: function __referencing(node, assign, writeExpr, maybeImplicitGlobal, partial, init) {
              // because Array element may be null
              if (!node || node.type !== _estraverse.Syntax.Identifier) {
                  return;
              }

              // Specially handle like `this`.
              if (node.name === 'super') {
                  return;
              }

              var ref = new _reference2.default(node, this, assign || _reference2.default.READ, writeExpr, maybeImplicitGlobal, !!partial, !!init);
              this.references.push(ref);
              this.__left.push(ref);
          }
      }, {
          key: '__detectEval',
          value: function __detectEval() {
              var current;
              current = this;
              this.directCallToEvalScope = true;
              do {
                  current.dynamic = true;
                  current = current.upper;
              } while (current);
          }
      }, {
          key: '__detectThis',
          value: function __detectThis() {
              this.thisFound = true;
          }
      }, {
          key: '__isClosed',
          value: function __isClosed() {
              return this.__left === null;
          }

          /**
           * returns resolved {Reference}
           * @method Scope#resolve
           * @param {Esprima.Identifier} ident - identifier to be resolved.
           * @return {Reference}
           */

      }, {
          key: 'resolve',
          value: function resolve(ident) {
              var ref, i, iz;
              (0, _assert2.default)(this.__isClosed(), 'Scope should be closed.');
              (0, _assert2.default)(ident.type === _estraverse.Syntax.Identifier, 'Target should be identifier.');
              for (i = 0, iz = this.references.length; i < iz; ++i) {
                  ref = this.references[i];
                  if (ref.identifier === ident) {
                      return ref;
                  }
              }
              return null;
          }

          /**
           * returns this scope is static
           * @method Scope#isStatic
           * @return {boolean}
           */

      }, {
          key: 'isStatic',
          value: function isStatic() {
              return !this.dynamic;
          }

          /**
           * returns this scope has materialized arguments
           * @method Scope#isArgumentsMaterialized
           * @return {boolean}
           */

      }, {
          key: 'isArgumentsMaterialized',
          value: function isArgumentsMaterialized() {
              return true;
          }

          /**
           * returns this scope has materialized `this` reference
           * @method Scope#isThisMaterialized
           * @return {boolean}
           */

      }, {
          key: 'isThisMaterialized',
          value: function isThisMaterialized() {
              return true;
          }
      }, {
          key: 'isUsedName',
          value: function isUsedName(name) {
              if (this.set.has(name)) {
                  return true;
              }
              for (var i = 0, iz = this.through.length; i < iz; ++i) {
                  if (this.through[i].identifier.name === name) {
                      return true;
                  }
              }
              return false;
          }
      }]);

      return Scope;
  }();

  exports.default = Scope;

  var GlobalScope = exports.GlobalScope = function (_Scope) {
      _inherits(GlobalScope, _Scope);

      function GlobalScope(scopeManager, block) {
          _classCallCheck(this, GlobalScope);

          var _this = _possibleConstructorReturn(this, Object.getPrototypeOf(GlobalScope).call(this, scopeManager, 'global', null, block, false));

          _this.implicit = {
              set: new _es6Map2.default(),
              variables: [],
              /**
              * List of {@link Reference}s that are left to be resolved (i.e. which
              * need to be linked to the variable they refer to).
              * @member {Reference[]} Scope#implicit#left
              */
              left: []
          };
          return _this;
      }

      _createClass(GlobalScope, [{
          key: '__close',
          value: function __close(scopeManager) {
              var implicit = [];
              for (var i = 0, iz = this.__left.length; i < iz; ++i) {
                  var ref = this.__left[i];
                  if (ref.__maybeImplicitGlobal && !this.set.has(ref.identifier.name)) {
                      implicit.push(ref.__maybeImplicitGlobal);
                  }
              }

              // create an implicit global variable from assignment expression
              for (var _i = 0, _iz = implicit.length; _i < _iz; ++_i) {
                  var info = implicit[_i];
                  this.__defineImplicit(info.pattern, new _definition2.default(_variable2.default.ImplicitGlobalVariable, info.pattern, info.node, null, null, null));
              }

              this.implicit.left = this.__left;

              return _get(Object.getPrototypeOf(GlobalScope.prototype), '__close', this).call(this, scopeManager);
          }
      }, {
          key: '__defineImplicit',
          value: function __defineImplicit(node, def) {
              if (node && node.type === _estraverse.Syntax.Identifier) {
                  this.__defineGeneric(node.name, this.implicit.set, this.implicit.variables, node, def);
              }
          }
      }]);

      return GlobalScope;
  }(Scope);

  var ModuleScope = exports.ModuleScope = function (_Scope2) {
      _inherits(ModuleScope, _Scope2);

      function ModuleScope(scopeManager, upperScope, block) {
          _classCallCheck(this, ModuleScope);

          return _possibleConstructorReturn(this, Object.getPrototypeOf(ModuleScope).call(this, scopeManager, 'module', upperScope, block, false));
      }

      return ModuleScope;
  }(Scope);

  var FunctionExpressionNameScope = exports.FunctionExpressionNameScope = function (_Scope3) {
      _inherits(FunctionExpressionNameScope, _Scope3);

      function FunctionExpressionNameScope(scopeManager, upperScope, block) {
          _classCallCheck(this, FunctionExpressionNameScope);

          var _this3 = _possibleConstructorReturn(this, Object.getPrototypeOf(FunctionExpressionNameScope).call(this, scopeManager, 'function-expression-name', upperScope, block, false));

          _this3.__define(block.id, new _definition2.default(_variable2.default.FunctionName, block.id, block, null, null, null));
          _this3.functionExpressionScope = true;
          return _this3;
      }

      return FunctionExpressionNameScope;
  }(Scope);

  var CatchScope = exports.CatchScope = function (_Scope4) {
      _inherits(CatchScope, _Scope4);

      function CatchScope(scopeManager, upperScope, block) {
          _classCallCheck(this, CatchScope);

          return _possibleConstructorReturn(this, Object.getPrototypeOf(CatchScope).call(this, scopeManager, 'catch', upperScope, block, false));
      }

      return CatchScope;
  }(Scope);

  var WithScope = exports.WithScope = function (_Scope5) {
      _inherits(WithScope, _Scope5);

      function WithScope(scopeManager, upperScope, block) {
          _classCallCheck(this, WithScope);

          return _possibleConstructorReturn(this, Object.getPrototypeOf(WithScope).call(this, scopeManager, 'with', upperScope, block, false));
      }

      _createClass(WithScope, [{
          key: '__close',
          value: function __close(scopeManager) {
              if (this.__shouldStaticallyClose(scopeManager)) {
                  return _get(Object.getPrototypeOf(WithScope.prototype), '__close', this).call(this, scopeManager);
              }

              for (var i = 0, iz = this.__left.length; i < iz; ++i) {
                  var ref = this.__left[i];
                  ref.tainted = true;
                  this.__delegateToUpperScope(ref);
              }
              this.__left = null;

              return this.upper;
          }
      }]);

      return WithScope;
  }(Scope);

  var TDZScope = exports.TDZScope = function (_Scope6) {
      _inherits(TDZScope, _Scope6);

      function TDZScope(scopeManager, upperScope, block) {
          _classCallCheck(this, TDZScope);

          return _possibleConstructorReturn(this, Object.getPrototypeOf(TDZScope).call(this, scopeManager, 'TDZ', upperScope, block, false));
      }

      return TDZScope;
  }(Scope);

  var BlockScope = exports.BlockScope = function (_Scope7) {
      _inherits(BlockScope, _Scope7);

      function BlockScope(scopeManager, upperScope, block) {
          _classCallCheck(this, BlockScope);

          return _possibleConstructorReturn(this, Object.getPrototypeOf(BlockScope).call(this, scopeManager, 'block', upperScope, block, false));
      }

      return BlockScope;
  }(Scope);

  var SwitchScope = exports.SwitchScope = function (_Scope8) {
      _inherits(SwitchScope, _Scope8);

      function SwitchScope(scopeManager, upperScope, block) {
          _classCallCheck(this, SwitchScope);

          return _possibleConstructorReturn(this, Object.getPrototypeOf(SwitchScope).call(this, scopeManager, 'switch', upperScope, block, false));
      }

      return SwitchScope;
  }(Scope);

  var FunctionScope = exports.FunctionScope = function (_Scope9) {
      _inherits(FunctionScope, _Scope9);

      function FunctionScope(scopeManager, upperScope, block, isMethodDefinition) {
          _classCallCheck(this, FunctionScope);

          // section 9.2.13, FunctionDeclarationInstantiation.
          // NOTE Arrow functions never have an arguments objects.

          var _this9 = _possibleConstructorReturn(this, Object.getPrototypeOf(FunctionScope).call(this, scopeManager, 'function', upperScope, block, isMethodDefinition));

          if (_this9.block.type !== _estraverse.Syntax.ArrowFunctionExpression) {
              _this9.__defineArguments();
          }
          return _this9;
      }

      _createClass(FunctionScope, [{
          key: 'isArgumentsMaterialized',
          value: function isArgumentsMaterialized() {
              // TODO(Constellation)
              // We can more aggressive on this condition like this.
              //
              // function t() {
              //     // arguments of t is always hidden.
              //     function arguments() {
              //     }
              // }
              if (this.block.type === _estraverse.Syntax.ArrowFunctionExpression) {
                  return false;
              }

              if (!this.isStatic()) {
                  return true;
              }

              var variable = this.set.get('arguments');
              (0, _assert2.default)(variable, 'Always have arguments variable.');
              return variable.tainted || variable.references.length !== 0;
          }
      }, {
          key: 'isThisMaterialized',
          value: function isThisMaterialized() {
              if (!this.isStatic()) {
                  return true;
              }
              return this.thisFound;
          }
      }, {
          key: '__defineArguments',
          value: function __defineArguments() {
              this.__defineGeneric('arguments', this.set, this.variables, null, null);
              this.taints.set('arguments', true);
          }
      }]);

      return FunctionScope;
  }(Scope);

  var ForScope = exports.ForScope = function (_Scope10) {
      _inherits(ForScope, _Scope10);

      function ForScope(scopeManager, upperScope, block) {
          _classCallCheck(this, ForScope);

          return _possibleConstructorReturn(this, Object.getPrototypeOf(ForScope).call(this, scopeManager, 'for', upperScope, block, false));
      }

      return ForScope;
  }(Scope);

  var ClassScope = exports.ClassScope = function (_Scope11) {
      _inherits(ClassScope, _Scope11);

      function ClassScope(scopeManager, upperScope, block) {
          _classCallCheck(this, ClassScope);

          return _possibleConstructorReturn(this, Object.getPrototypeOf(ClassScope).call(this, scopeManager, 'class', upperScope, block, false));
      }

      return ClassScope;
  }(Scope);

  /* vim: set sw=4 ts=4 et tw=80 : */


  },{"./definition":74,"./reference":77,"./variable":81,"assert":112,"es6-map":57,"estraverse":93}],81:[function(require,module,exports){
  'use strict';

  Object.defineProperty(exports, "__esModule", {
    value: true
  });

  function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

  /*
    Copyright (C) 2015 Yusuke Suzuki <utatane.tea@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are met:

      * Redistributions of source code must retain the above copyright
        notice, this list of conditions and the following disclaimer.
      * Redistributions in binary form must reproduce the above copyright
        notice, this list of conditions and the following disclaimer in the
        documentation and/or other materials provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
    DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
    (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
    LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
    ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
    THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
  */

  /**
   * A Variable represents a locally scoped identifier. These include arguments to
   * functions.
   * @class Variable
   */

  var Variable = function Variable(name, scope) {
    _classCallCheck(this, Variable);

    /**
     * The variable name, as given in the source code.
     * @member {String} Variable#name
     */
    this.name = name;
    /**
     * List of defining occurrences of this variable (like in 'var ...'
     * statements or as parameter), as AST nodes.
     * @member {esprima.Identifier[]} Variable#identifiers
     */
    this.identifiers = [];
    /**
     * List of {@link Reference|references} of this variable (excluding parameter entries)
     * in its defining scope and all nested scopes. For defining
     * occurrences only see {@link Variable#defs}.
     * @member {Reference[]} Variable#references
     */
    this.references = [];

    /**
     * List of defining occurrences of this variable (like in 'var ...'
     * statements or as parameter), as custom objects.
     * @member {Definition[]} Variable#defs
     */
    this.defs = [];

    this.tainted = false;
    /**
     * Whether this is a stack variable.
     * @member {boolean} Variable#stack
     */
    this.stack = true;
    /**
     * Reference to the enclosing Scope.
     * @member {Scope} Variable#scope
     */
    this.scope = scope;
  };

  exports.default = Variable;


  Variable.CatchClause = 'CatchClause';
  Variable.Parameter = 'Parameter';
  Variable.FunctionName = 'FunctionName';
  Variable.ClassName = 'ClassName';
  Variable.Variable = 'Variable';
  Variable.ImportBinding = 'ImportBinding';
  Variable.TDZ = 'TDZ';
  Variable.ImplicitGlobalVariable = 'ImplicitGlobalVariable';

  /* vim: set sw=4 ts=4 et tw=80 : */


  },{}],82:[function(require,module,exports){
  module.exports={
    "_from": "escope",
    "_id": "escope@3.6.0",
    "_inBundle": false,
    "_integrity": "sha1-4Bl16BJ4GhY6ba392AOY3GTIicM=",
    "_location": "/escope",
    "_phantomChildren": {},
    "_requested": {
      "type": "tag",
      "registry": true,
      "raw": "escope",
      "name": "escope",
      "escapedName": "escope",
      "rawSpec": "",
      "saveSpec": null,
      "fetchSpec": "latest"
    },
    "_requiredBy": [
      "#USER",
      "/"
    ],
    "_resolved": "https://registry.npmjs.org/escope/-/escope-3.6.0.tgz",
    "_shasum": "e01975e812781a163a6dadfdd80398dc64c889c3",
    "_spec": "escope",
    "_where": "/Users/gferreir/workspaces/npm-scope-analysis-eval-global",
    "bugs": {
      "url": "https://github.com/estools/escope/issues"
    },
    "bundleDependencies": false,
    "dependencies": {
      "es6-map": "^0.1.3",
      "es6-weak-map": "^2.0.1",
      "esrecurse": "^4.1.0",
      "estraverse": "^4.1.1"
    },
    "deprecated": false,
    "description": "ECMAScript scope analyzer",
    "devDependencies": {
      "babel": "^6.3.26",
      "babel-preset-es2015": "^6.3.13",
      "babel-register": "^6.3.13",
      "browserify": "^13.0.0",
      "chai": "^3.4.1",
      "espree": "^3.1.1",
      "esprima": "^2.7.1",
      "gulp": "^3.9.0",
      "gulp-babel": "^6.1.1",
      "gulp-bump": "^1.0.0",
      "gulp-eslint": "^1.1.1",
      "gulp-espower": "^1.0.2",
      "gulp-filter": "^3.0.1",
      "gulp-git": "^1.6.1",
      "gulp-mocha": "^2.2.0",
      "gulp-plumber": "^1.0.1",
      "gulp-sourcemaps": "^1.6.0",
      "gulp-tag-version": "^1.3.0",
      "jsdoc": "^3.4.0",
      "lazypipe": "^1.0.1",
      "vinyl-source-stream": "^1.1.0"
    },
    "engines": {
      "node": ">=0.4.0"
    },
    "homepage": "http://github.com/estools/escope",
    "license": "BSD-2-Clause",
    "main": "lib/index.js",
    "maintainers": [
      {
        "name": "Yusuke Suzuki",
        "email": "utatane.tea@gmail.com",
        "url": "http://github.com/Constellation"
      }
    ],
    "name": "escope",
    "repository": {
      "type": "git",
      "url": "git+https://github.com/estools/escope.git"
    },
    "scripts": {
      "jsdoc": "jsdoc src/*.js README.md",
      "lint": "gulp lint",
      "test": "gulp travis",
      "unit-test": "gulp test"
    },
    "version": "3.6.0"
  }

  },{}],83:[function(require,module,exports){
  /**
   * @author Toru Nagashima <https://github.com/mysticatea>
   * See LICENSE file in root directory for full license.
   */
  "use strict";

  const KEYS = require("./visitor-keys.json");

  // Types.
  const NODE_TYPES = Object.freeze(Object.keys(KEYS));

  // Freeze the keys.
  for (const type of NODE_TYPES) {
      Object.freeze(KEYS[type]);
  }
  Object.freeze(KEYS);

  // List to ignore keys.
  const KEY_BLACKLIST = new Set([
      "parent",
      "leadingComments",
      "trailingComments"
  ]);

  /**
   * Check whether a given key should be used or not.
   * @param {string} key The key to check.
   * @returns {boolean} `true` if the key should be used.
   */
  function filterKey(key) {
      return !KEY_BLACKLIST.has(key) && key[0] !== "_";
  }

  //------------------------------------------------------------------------------
  // Public interfaces
  //------------------------------------------------------------------------------

  module.exports = Object.freeze({

      /**
       * Visitor keys.
       * @type {{ [type: string]: string[] | undefined }}
       */
      KEYS,

      /**
       * Get visitor keys of a given node.
       * @param {Object} node The AST node to get keys.
       * @returns {string[]} Visitor keys of the node.
       */
      getKeys(node) {
          return Object.keys(node).filter(filterKey);
      },

      // Disable valid-jsdoc rule because it reports syntax error on the type of @returns.
      // eslint-disable-next-line valid-jsdoc
      /**
       * Make the union set with `KEYS` and given keys.
       * @param {Object} additionalKeys The additional keys.
       * @returns {{ [type: string]: string[] | undefined }} The union set.
       */
      unionWith(additionalKeys) {
          const retv = Object.assign({}, KEYS);

          for (const type of Object.keys(additionalKeys)) {
              if (retv.hasOwnProperty(type)) {
                  const keys = new Set(additionalKeys[type]);

                  for (const key of retv[type]) {
                      keys.add(key);
                  }

                  retv[type] = Object.freeze(Array.from(keys));
              } else {
                  retv[type] = Object.freeze(Array.from(additionalKeys[type]));
              }
          }

          return Object.freeze(retv);
      }
  });

  },{"./visitor-keys.json":84}],84:[function(require,module,exports){
  module.exports={
      "AssignmentExpression": [
          "left",
          "right"
      ],
      "AssignmentPattern": [
          "left",
          "right"
      ],
      "ArrayExpression": [
          "elements"
      ],
      "ArrayPattern": [
          "elements"
      ],
      "ArrowFunctionExpression": [
          "params",
          "body"
      ],
      "AwaitExpression": [
          "argument"
      ],
      "BlockStatement": [
          "body"
      ],
      "BinaryExpression": [
          "left",
          "right"
      ],
      "BreakStatement": [
          "label"
      ],
      "CallExpression": [
          "callee",
          "arguments"
      ],
      "CatchClause": [
          "param",
          "body"
      ],
      "ClassBody": [
          "body"
      ],
      "ClassDeclaration": [
          "id",
          "superClass",
          "body"
      ],
      "ClassExpression": [
          "id",
          "superClass",
          "body"
      ],
      "ConditionalExpression": [
          "test",
          "consequent",
          "alternate"
      ],
      "ContinueStatement": [
          "label"
      ],
      "DebuggerStatement": [],
      "DoWhileStatement": [
          "body",
          "test"
      ],
      "EmptyStatement": [],
      "ExportAllDeclaration": [
          "source"
      ],
      "ExportDefaultDeclaration": [
          "declaration"
      ],
      "ExportNamedDeclaration": [
          "declaration",
          "specifiers",
          "source"
      ],
      "ExportSpecifier": [
          "exported",
          "local"
      ],
      "ExpressionStatement": [
          "expression"
      ],
      "ExperimentalRestProperty": [
          "argument"
      ],
      "ExperimentalSpreadProperty": [
          "argument"
      ],
      "ForStatement": [
          "init",
          "test",
          "update",
          "body"
      ],
      "ForInStatement": [
          "left",
          "right",
          "body"
      ],
      "ForOfStatement": [
          "left",
          "right",
          "body"
      ],
      "FunctionDeclaration": [
          "id",
          "params",
          "body"
      ],
      "FunctionExpression": [
          "id",
          "params",
          "body"
      ],
      "Identifier": [],
      "IfStatement": [
          "test",
          "consequent",
          "alternate"
      ],
      "ImportDeclaration": [
          "specifiers",
          "source"
      ],
      "ImportDefaultSpecifier": [
          "local"
      ],
      "ImportNamespaceSpecifier": [
          "local"
      ],
      "ImportSpecifier": [
          "imported",
          "local"
      ],
      "JSXAttribute": [
          "name",
          "value"
      ],
      "JSXClosingElement": [
          "name"
      ],
      "JSXElement": [
          "openingElement",
          "children",
          "closingElement"
      ],
      "JSXEmptyExpression": [],
      "JSXExpressionContainer": [
          "expression"
      ],
      "JSXIdentifier": [],
      "JSXMemberExpression": [
          "object",
          "property"
      ],
      "JSXNamespacedName": [
          "namespace",
          "name"
      ],
      "JSXOpeningElement": [
          "name",
          "attributes"
      ],
      "JSXSpreadAttribute": [
          "argument"
      ],
      "JSXText": [],
      "JSXFragment": [
          "openingFragment",
          "children",
          "closingFragment"
      ],
      "Literal": [],
      "LabeledStatement": [
          "label",
          "body"
      ],
      "LogicalExpression": [
          "left",
          "right"
      ],
      "MemberExpression": [
          "object",
          "property"
      ],
      "MetaProperty": [
          "meta",
          "property"
      ],
      "MethodDefinition": [
          "key",
          "value"
      ],
      "NewExpression": [
          "callee",
          "arguments"
      ],
      "ObjectExpression": [
          "properties"
      ],
      "ObjectPattern": [
          "properties"
      ],
      "Program": [
          "body"
      ],
      "Property": [
          "key",
          "value"
      ],
      "RestElement": [
          "argument"
      ],
      "ReturnStatement": [
          "argument"
      ],
      "SequenceExpression": [
          "expressions"
      ],
      "SpreadElement": [
          "argument"
      ],
      "Super": [],
      "SwitchStatement": [
          "discriminant",
          "cases"
      ],
      "SwitchCase": [
          "test",
          "consequent"
      ],
      "TaggedTemplateExpression": [
          "tag",
          "quasi"
      ],
      "TemplateElement": [],
      "TemplateLiteral": [
          "quasis",
          "expressions"
      ],
      "ThisExpression": [],
      "ThrowStatement": [
          "argument"
      ],
      "TryStatement": [
          "block",
          "handler",
          "finalizer"
      ],
      "UnaryExpression": [
          "argument"
      ],
      "UpdateExpression": [
          "argument"
      ],
      "VariableDeclaration": [
          "declarations"
      ],
      "VariableDeclarator": [
          "id",
          "init"
      ],
      "WhileStatement": [
          "test",
          "body"
      ],
      "WithStatement": [
          "object",
          "body"
      ],
      "YieldExpression": [
          "argument"
      ]
  }

  },{}],85:[function(require,module,exports){
  /**
   * @fileoverview Main Espree file that converts Acorn into Esprima output.
   *
   * This file contains code from the following MIT-licensed projects:
   * 1. Acorn
   * 2. Babylon
   * 3. Babel-ESLint
   *
   * This file also contains code from Esprima, which is BSD licensed.
   *
   * Acorn is Copyright 2012-2015 Acorn Contributors (https://github.com/marijnh/acorn/blob/master/AUTHORS)
   * Babylon is Copyright 2014-2015 various contributors (https://github.com/babel/babel/blob/master/packages/babylon/AUTHORS)
   * Babel-ESLint is Copyright 2014-2015 Sebastian McKenzie <sebmck@gmail.com>
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * * Redistributions of source code must retain the above copyright
   *   notice, this list of conditions and the following disclaimer.
   * * Redistributions in binary form must reproduce the above copyright
   *   notice, this list of conditions and the following disclaimer in the
   *   documentation and/or other materials provided with the distribution.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
   * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
   * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
   * ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
   * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
   * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
   * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
   * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
   * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
   * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   *
   * Esprima is Copyright (c) jQuery Foundation, Inc. and Contributors, All Rights Reserved.
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   *   * Redistributions of source code must retain the above copyright
   *     notice, this list of conditions and the following disclaimer.
   *   * Redistributions in binary form must reproduce the above copyright
   *     notice, this list of conditions and the following disclaimer in the
   *     documentation and/or other materials provided with the distribution.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
   * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
   * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
   * ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
   * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
   * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
   * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
   * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
   * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
   * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
  /* eslint no-undefined:0, no-use-before-define: 0 */

  "use strict";

  const acorn = require("acorn");
  const jsx = require("acorn-jsx");
  const astNodeTypes = require("./lib/ast-node-types");
  const espree = require("./lib/espree");

  // To initialize lazily.
  const parsers = {
      _regular: null,
      _jsx: null,

      get regular() {
          if (this._regular === null) {
              this._regular = acorn.Parser.extend(espree());
          }
          return this._regular;
      },

      get jsx() {
          if (this._jsx === null) {
              this._jsx = acorn.Parser.extend(jsx(), espree());
          }
          return this._jsx;
      },

      get(options) {
          const useJsx = Boolean(
              options &&
              options.ecmaFeatures &&
              options.ecmaFeatures.jsx
          );
          return useJsx ? this.jsx : this.regular;
      }
  };

  //------------------------------------------------------------------------------
  // Tokenizer
  //------------------------------------------------------------------------------

  /**
   * Tokenizes the given code.
   * @param {string} code The code to tokenize.
   * @param {Object} options Options defining how to tokenize.
   * @returns {Token[]} An array of tokens.
   * @throws {SyntaxError} If the input code is invalid.
   * @private
   */
  function tokenize(code, options) {
      const Parser = parsers.get(options);

      // Ensure to collect tokens.
      if (!options || options.tokens !== true) {
          options = Object.assign({}, options, { tokens: true });
      }

      return new Parser(options, code).tokenize();
  }

  //------------------------------------------------------------------------------
  // Parser
  //------------------------------------------------------------------------------

  /**
   * Parses the given code.
   * @param {string} code The code to tokenize.
   * @param {Object} options Options defining how to tokenize.
   * @returns {ASTNode} The "Program" AST node.
   * @throws {SyntaxError} If the input code is invalid.
   */
  function parse(code, options) {
      const Parser = parsers.get(options);
      return new Parser(options, code).parse();
  }

  //------------------------------------------------------------------------------
  // Public
  //------------------------------------------------------------------------------

  exports.version = require("./package.json").version;

  exports.tokenize = tokenize;

  exports.parse = parse;

  // Deep copy.
  /* istanbul ignore next */
  exports.Syntax = (function() {
      var name, types = {};

      if (typeof Object.create === "function") {
          types = Object.create(null);
      }

      for (name in astNodeTypes) {
          if (astNodeTypes.hasOwnProperty(name)) {
              types[name] = astNodeTypes[name];
          }
      }

      if (typeof Object.freeze === "function") {
          Object.freeze(types);
      }

      return types;
  }());

  /* istanbul ignore next */
  exports.VisitorKeys = (function() {
      return require("eslint-visitor-keys").KEYS;
  }());

  },{"./lib/ast-node-types":86,"./lib/espree":88,"./package.json":90,"acorn":4,"acorn-jsx":2,"eslint-visitor-keys":83}],86:[function(require,module,exports){
  /**
   * @fileoverview The AST node types produced by the parser.
   * @author Nicholas C. Zakas
   */

  "use strict";

  //------------------------------------------------------------------------------
  // Requirements
  //------------------------------------------------------------------------------

  // None!

  //------------------------------------------------------------------------------
  // Public
  //------------------------------------------------------------------------------

  module.exports = {
      AssignmentExpression: "AssignmentExpression",
      AssignmentPattern: "AssignmentPattern",
      ArrayExpression: "ArrayExpression",
      ArrayPattern: "ArrayPattern",
      ArrowFunctionExpression: "ArrowFunctionExpression",
      AwaitExpression: "AwaitExpression",
      BlockStatement: "BlockStatement",
      BinaryExpression: "BinaryExpression",
      BreakStatement: "BreakStatement",
      CallExpression: "CallExpression",
      CatchClause: "CatchClause",
      ClassBody: "ClassBody",
      ClassDeclaration: "ClassDeclaration",
      ClassExpression: "ClassExpression",
      ConditionalExpression: "ConditionalExpression",
      ContinueStatement: "ContinueStatement",
      DoWhileStatement: "DoWhileStatement",
      DebuggerStatement: "DebuggerStatement",
      EmptyStatement: "EmptyStatement",
      ExpressionStatement: "ExpressionStatement",
      ForStatement: "ForStatement",
      ForInStatement: "ForInStatement",
      ForOfStatement: "ForOfStatement",
      FunctionDeclaration: "FunctionDeclaration",
      FunctionExpression: "FunctionExpression",
      Identifier: "Identifier",
      IfStatement: "IfStatement",
      Literal: "Literal",
      LabeledStatement: "LabeledStatement",
      LogicalExpression: "LogicalExpression",
      MemberExpression: "MemberExpression",
      MetaProperty: "MetaProperty",
      MethodDefinition: "MethodDefinition",
      NewExpression: "NewExpression",
      ObjectExpression: "ObjectExpression",
      ObjectPattern: "ObjectPattern",
      Program: "Program",
      Property: "Property",
      RestElement: "RestElement",
      ReturnStatement: "ReturnStatement",
      SequenceExpression: "SequenceExpression",
      SpreadElement: "SpreadElement",
      Super: "Super",
      SwitchCase: "SwitchCase",
      SwitchStatement: "SwitchStatement",
      TaggedTemplateExpression: "TaggedTemplateExpression",
      TemplateElement: "TemplateElement",
      TemplateLiteral: "TemplateLiteral",
      ThisExpression: "ThisExpression",
      ThrowStatement: "ThrowStatement",
      TryStatement: "TryStatement",
      UnaryExpression: "UnaryExpression",
      UpdateExpression: "UpdateExpression",
      VariableDeclaration: "VariableDeclaration",
      VariableDeclarator: "VariableDeclarator",
      WhileStatement: "WhileStatement",
      WithStatement: "WithStatement",
      YieldExpression: "YieldExpression",
      JSXIdentifier: "JSXIdentifier",
      JSXNamespacedName: "JSXNamespacedName",
      JSXMemberExpression: "JSXMemberExpression",
      JSXEmptyExpression: "JSXEmptyExpression",
      JSXExpressionContainer: "JSXExpressionContainer",
      JSXElement: "JSXElement",
      JSXClosingElement: "JSXClosingElement",
      JSXOpeningElement: "JSXOpeningElement",
      JSXAttribute: "JSXAttribute",
      JSXSpreadAttribute: "JSXSpreadAttribute",
      JSXText: "JSXText",
      ExportDefaultDeclaration: "ExportDefaultDeclaration",
      ExportNamedDeclaration: "ExportNamedDeclaration",
      ExportAllDeclaration: "ExportAllDeclaration",
      ExportSpecifier: "ExportSpecifier",
      ImportDeclaration: "ImportDeclaration",
      ImportSpecifier: "ImportSpecifier",
      ImportDefaultSpecifier: "ImportDefaultSpecifier",
      ImportNamespaceSpecifier: "ImportNamespaceSpecifier"
  };

  },{}],87:[function(require,module,exports){
  /**
   * @fileoverview Attaches comments to the AST.
   * @author Nicholas C. Zakas
   */

  "use strict";

  //------------------------------------------------------------------------------
  // Requirements
  //------------------------------------------------------------------------------

  var astNodeTypes = require("./ast-node-types");

  //------------------------------------------------------------------------------
  // Private
  //------------------------------------------------------------------------------

  var extra = {
      trailingComments: [],
      leadingComments: [],
      bottomRightStack: [],
      previousNode: null
  };

  //------------------------------------------------------------------------------
  // Public
  //------------------------------------------------------------------------------

  module.exports = {

      reset: function() {
          extra.trailingComments = [];
          extra.leadingComments = [];
          extra.bottomRightStack = [];
          extra.previousNode = null;
      },

      addComment: function(comment) {
          extra.trailingComments.push(comment);
          extra.leadingComments.push(comment);
      },

      processComment: function(node) {
          var lastChild,
              trailingComments,
              i,
              j;

          if (node.type === astNodeTypes.Program) {
              if (node.body.length > 0) {
                  return;
              }
          }

          if (extra.trailingComments.length > 0) {

              /*
               * If the first comment in trailingComments comes after the
               * current node, then we're good - all comments in the array will
               * come after the node and so it's safe to add then as official
               * trailingComments.
               */
              if (extra.trailingComments[0].range[0] >= node.range[1]) {
                  trailingComments = extra.trailingComments;
                  extra.trailingComments = [];
              } else {

                  /*
                   * Otherwise, if the first comment doesn't come after the
                   * current node, that means we have a mix of leading and trailing
                   * comments in the array and that leadingComments contains the
                   * same items as trailingComments. Reset trailingComments to
                   * zero items and we'll handle this by evaluating leadingComments
                   * later.
                   */
                  extra.trailingComments.length = 0;
              }
          } else {
              if (extra.bottomRightStack.length > 0 &&
                      extra.bottomRightStack[extra.bottomRightStack.length - 1].trailingComments &&
                      extra.bottomRightStack[extra.bottomRightStack.length - 1].trailingComments[0].range[0] >= node.range[1]) {
                  trailingComments = extra.bottomRightStack[extra.bottomRightStack.length - 1].trailingComments;
                  delete extra.bottomRightStack[extra.bottomRightStack.length - 1].trailingComments;
              }
          }

          // Eating the stack.
          while (extra.bottomRightStack.length > 0 && extra.bottomRightStack[extra.bottomRightStack.length - 1].range[0] >= node.range[0]) {
              lastChild = extra.bottomRightStack.pop();
          }

          if (lastChild) {
              if (lastChild.leadingComments) {
                  if (lastChild.leadingComments[lastChild.leadingComments.length - 1].range[1] <= node.range[0]) {
                      node.leadingComments = lastChild.leadingComments;
                      delete lastChild.leadingComments;
                  } else {
                      // A leading comment for an anonymous class had been stolen by its first MethodDefinition,
                      // so this takes back the leading comment.
                      // See Also: https://github.com/eslint/espree/issues/158
                      for (i = lastChild.leadingComments.length - 2; i >= 0; --i) {
                          if (lastChild.leadingComments[i].range[1] <= node.range[0]) {
                              node.leadingComments = lastChild.leadingComments.splice(0, i + 1);
                              break;
                          }
                      }
                  }
              }
          } else if (extra.leadingComments.length > 0) {
              if (extra.leadingComments[extra.leadingComments.length - 1].range[1] <= node.range[0]) {
                  if (extra.previousNode) {
                      for (j = 0; j < extra.leadingComments.length; j++) {
                          if (extra.leadingComments[j].end < extra.previousNode.end) {
                              extra.leadingComments.splice(j, 1);
                              j--;
                          }
                      }
                  }
                  if (extra.leadingComments.length > 0) {
                      node.leadingComments = extra.leadingComments;
                      extra.leadingComments = [];
                  }
              } else {

                  // https://github.com/eslint/espree/issues/2

                  /*
                   * In special cases, such as return (without a value) and
                   * debugger, all comments will end up as leadingComments and
                   * will otherwise be eliminated. This extra step runs when the
                   * bottomRightStack is empty and there are comments left
                   * in leadingComments.
                   *
                   * This loop figures out the stopping point between the actual
                   * leading and trailing comments by finding the location of the
                   * first comment that comes after the given node.
                   */
                  for (i = 0; i < extra.leadingComments.length; i++) {
                      if (extra.leadingComments[i].range[1] > node.range[0]) {
                          break;
                      }
                  }

                  /*
                   * Split the array based on the location of the first comment
                   * that comes after the node. Keep in mind that this could
                   * result in an empty array, and if so, the array must be
                   * deleted.
                   */
                  node.leadingComments = extra.leadingComments.slice(0, i);
                  if (node.leadingComments.length === 0) {
                      delete node.leadingComments;
                  }

                  /*
                   * Similarly, trailing comments are attached later. The variable
                   * must be reset to null if there are no trailing comments.
                   */
                  trailingComments = extra.leadingComments.slice(i);
                  if (trailingComments.length === 0) {
                      trailingComments = null;
                  }
              }
          }

          extra.previousNode = node;

          if (trailingComments) {
              node.trailingComments = trailingComments;
          }

          extra.bottomRightStack.push(node);
      }

  };

  },{"./ast-node-types":86}],88:[function(require,module,exports){
  "use strict";

  const acorn = require("acorn");
  const jsx = require("acorn-jsx");
  const commentAttachment = require("./comment-attachment");
  const TokenTranslator = require("./token-translator");

  const DEFAULT_ECMA_VERSION = 5;
  const STATE = Symbol("espree's internal state");
  const ESPRIMA_FINISH_NODE = Symbol("espree's esprimaFinishNode");
  const tokTypes = Object.assign({}, acorn.tokTypes, jsx.tokTypes);

  /**
   * Normalize ECMAScript version from the initial config
   * @param {number} ecmaVersion ECMAScript version from the initial config
   * @returns {number} normalized ECMAScript version
   */
  function normalizeEcmaVersion(ecmaVersion) {
      if (typeof ecmaVersion === "number") {
          let version = ecmaVersion;

          // Calculate ECMAScript edition number from official year version starting with
          // ES2015, which corresponds with ES6 (or a difference of 2009).
          if (version >= 2015) {
              version -= 2009;
          }

          switch (version) {
              case 3:
              case 5:
              case 6:
              case 7:
              case 8:
              case 9:
              case 10:
                  return version;

              default:
                  throw new Error("Invalid ecmaVersion.");
          }
      } else {
          return DEFAULT_ECMA_VERSION;
      }
  }

  /**
   * Converts an Acorn comment to a Esprima comment.
   * @param {boolean} block True if it's a block comment, false if not.
   * @param {string} text The text of the comment.
   * @param {int} start The index at which the comment starts.
   * @param {int} end The index at which the comment ends.
   * @param {Location} startLoc The location at which the comment starts.
   * @param {Location} endLoc The location at which the comment ends.
   * @returns {Object} The comment object.
   * @private
   */
  function convertAcornCommentToEsprimaComment(block, text, start, end, startLoc, endLoc) {
      const comment = {
          type: block ? "Block" : "Line",
          value: text
      };

      if (typeof start === "number") {
          comment.start = start;
          comment.end = end;
          comment.range = [start, end];
      }

      if (typeof startLoc === "object") {
          comment.loc = {
              start: startLoc,
              end: endLoc
          };
      }

      return comment;
  }

  module.exports = () => Parser => class Espree extends Parser {
      constructor(options, code) {
          if (typeof options !== "object" || options === null) {
              options = {};
          }
          if (typeof code !== "string" && !(code instanceof String)) {
              code = String(code);
          }

          const ecmaFeatures = options.ecmaFeatures || {};
          const ecmaVersion = normalizeEcmaVersion(options.ecmaVersion);
          const isModule = options.sourceType === "module";
          const tokenTranslator =
              options.tokens === true ?
                  new TokenTranslator(tokTypes, code) :
                  null;

          // Initialize acorn parser.
          super({
              ecmaVersion: isModule ? Math.max(6, ecmaVersion) : ecmaVersion,
              sourceType: isModule ? "module" : "script",
              ranges: options.range === true || options.attachComment === true,
              locations: options.loc === true,

              // Truthy value is true for backward compatibility.
              allowReturnOutsideFunction: Boolean(ecmaFeatures.globalReturn),

              // Collect tokens
              onToken: (token) => {
                  if (tokenTranslator) {
                      // Use `tokens`, `ecmaVersion`, and `jsxAttrValueToken` in the state.
                      tokenTranslator.onToken(token, this[STATE]);
                  }
                  if (token.type !== tokTypes.eof) {
                      this[STATE].lastToken = token;
                  }
              },

              // Collect comments
              onComment: (block, text, start, end, startLoc, endLoc) => {
                  if (this[STATE].comments) {
                      const comment = convertAcornCommentToEsprimaComment(block, text, start, end, startLoc, endLoc);
                      this[STATE].comments.push(comment);

                      if (options.attachComment === true) {
                          commentAttachment.addComment(comment);
                      }
                  }
              }
          }, code);

          // TODO: remove global state.
          commentAttachment.reset();

          // Initialize internal state.
          this[STATE] = {
              tokens: tokenTranslator ? [] : null,
              comments: options.comment === true || options.attachComment === true ? [] : null,
              attachComment: options.attachComment === true,
              impliedStrict: ecmaFeatures.impliedStrict === true && this.options.ecmaVersion >= 5,
              ecmaVersion: this.options.ecmaVersion,
              jsxAttrValueToken: false,
              lastToken: null
          };
      }

      tokenize() {
          do {
              this.next();
          } while (this.type !== tokTypes.eof);

          const extra = this[STATE];
          const tokens = extra.tokens;

          if (extra.comments) {
              tokens.comments = extra.comments;
          }

          return tokens;
      }

      finishNode(...args) {
          const result = super.finishNode(...args);
          return this[ESPRIMA_FINISH_NODE](result);
      }

      finishNodeAt(...args) {
          const result = super.finishNodeAt(...args);
          return this[ESPRIMA_FINISH_NODE](result);
      }

      parse() {
          const extra = this[STATE];
          const program = super.parse();

          program.sourceType = this.options.sourceType;

          if (extra.comments) {
              program.comments = extra.comments;
          }
          if (extra.tokens) {
              program.tokens = extra.tokens;
          }

          /*
           * Adjust opening and closing position of program to match Esprima.
           * Acorn always starts programs at range 0 whereas Esprima starts at the
           * first AST node's start (the only real difference is when there's leading
           * whitespace or leading comments). Acorn also counts trailing whitespace
           * as part of the program whereas Esprima only counts up to the last token.
           */
          if (program.range) {
              program.range[0] = program.body.length ? program.body[0].range[0] : program.range[0];
              program.range[1] = extra.lastToken ? extra.lastToken.range[1] : program.range[1];
          }
          if (program.loc) {
              program.loc.start = program.body.length ? program.body[0].loc.start : program.loc.start;
              program.loc.end = extra.lastToken ? extra.lastToken.loc.end : program.loc.end;
          }

          return program;
      }

      parseTopLevel(node) {
          if (this[STATE].impliedStrict) {
              this.strict = true;
          }
          return super.parseTopLevel(node);
      }

      /**
       * Overwrites the default raise method to throw Esprima-style errors.
       * @param {int} pos The position of the error.
       * @param {string} message The error message.
       * @throws {SyntaxError} A syntax error.
       * @returns {void}
       */
      raise(pos, message) {
          const loc = acorn.getLineInfo(this.input, pos);
          const err = new SyntaxError(message);
          err.index = pos;
          err.lineNumber = loc.line;
          err.column = loc.column + 1; // acorn uses 0-based columns
          throw err;
      }

      /**
       * Overwrites the default raise method to throw Esprima-style errors.
       * @param {int} pos The position of the error.
       * @param {string} message The error message.
       * @throws {SyntaxError} A syntax error.
       * @returns {void}
       */
      raiseRecoverable(pos, message) {
          this.raise(pos, message);
      }

      /**
       * Overwrites the default unexpected method to throw Esprima-style errors.
       * @param {int} pos The position of the error.
       * @throws {SyntaxError} A syntax error.
       * @returns {void}
       */
      unexpected(pos) {
          let message = "Unexpected token";

          if (pos !== null && pos !== void 0) {
              this.pos = pos;

              if (this.options.locations) {
                  while (this.pos < this.lineStart) {
                      this.lineStart = this.input.lastIndexOf("\n", this.lineStart - 2) + 1;
                      --this.curLine;
                  }
              }

              this.nextToken();
          }

          if (this.end > this.start) {
              message += " " + this.input.slice(this.start, this.end);
          }

          this.raise(this.start, message);
      }

      /*
       * Esprima-FB represents JSX strings as tokens called "JSXText", but Acorn-JSX
       * uses regular tt.string without any distinction between this and regular JS
       * strings. As such, we intercept an attempt to read a JSX string and set a flag
       * on extra so that when tokens are converted, the next token will be switched
       * to JSXText via onToken.
       */
      jsx_readString(quote) { // eslint-disable-line camelcase
          const result = super.jsx_readString(quote);
          if (this.type === tokTypes.string) {
              this[STATE].jsxAttrValueToken = true;
          }
          return result;
      }

      /**
       * Performs last-minute Esprima-specific compatibility checks and fixes.
       * @param {ASTNode} result The node to check.
       * @returns {ASTNode} The finished node.
       */
      [ESPRIMA_FINISH_NODE](result) {
          // Acorn doesn't count the opening and closing backticks as part of templates
          // so we have to adjust ranges/locations appropriately.
          if (result.type === "TemplateElement") {

              // additional adjustment needed if ${ is the last token
              const terminalDollarBraceL = this.input.slice(result.end, result.end + 2) === "${";

              if (result.range) {
                  result.range[0]--;
                  result.range[1] += (terminalDollarBraceL ? 2 : 1);
              }

              if (result.loc) {
                  result.loc.start.column--;
                  result.loc.end.column += (terminalDollarBraceL ? 2 : 1);
              }
          }

          if (this[STATE].attachComment) {
              commentAttachment.processComment(result);
          }

          if (result.type.indexOf("Function") > -1 && !result.generator) {
              result.generator = false;
          }

          return result;
      }
  };

  },{"./comment-attachment":87,"./token-translator":89,"acorn":4,"acorn-jsx":2}],89:[function(require,module,exports){
  /**
   * @fileoverview Translates tokens between Acorn format and Esprima format.
   * @author Nicholas C. Zakas
   */
  /* eslint no-underscore-dangle: 0 */

  "use strict";

  //------------------------------------------------------------------------------
  // Requirements
  //------------------------------------------------------------------------------

  // none!

  //------------------------------------------------------------------------------
  // Private
  //------------------------------------------------------------------------------


  // Esprima Token Types
  var Token = {
      Boolean: "Boolean",
      EOF: "<end>",
      Identifier: "Identifier",
      Keyword: "Keyword",
      Null: "Null",
      Numeric: "Numeric",
      Punctuator: "Punctuator",
      String: "String",
      RegularExpression: "RegularExpression",
      Template: "Template",
      JSXIdentifier: "JSXIdentifier",
      JSXText: "JSXText"
  };

  /**
   * Converts part of a template into an Esprima token.
   * @param {AcornToken[]} tokens The Acorn tokens representing the template.
   * @param {string} code The source code.
   * @returns {EsprimaToken} The Esprima equivalent of the template token.
   * @private
   */
  function convertTemplatePart(tokens, code) {
      var firstToken = tokens[0],
          lastTemplateToken = tokens[tokens.length - 1];

      var token = {
          type: Token.Template,
          value: code.slice(firstToken.start, lastTemplateToken.end)
      };

      if (firstToken.loc) {
          token.loc = {
              start: firstToken.loc.start,
              end: lastTemplateToken.loc.end
          };
      }

      if (firstToken.range) {
          token.start = firstToken.range[0];
          token.end = lastTemplateToken.range[1];
          token.range = [token.start, token.end];
      }

      return token;
  }

  /**
   * Contains logic to translate Acorn tokens into Esprima tokens.
   * @param {Object} acornTokTypes The Acorn token types.
   * @param {string} code The source code Acorn is parsing. This is necessary
   *      to correct the "value" property of some tokens.
   * @constructor
   */
  function TokenTranslator(acornTokTypes, code) {

      // token types
      this._acornTokTypes = acornTokTypes;

      // token buffer for templates
      this._tokens = [];

      // track the last curly brace
      this._curlyBrace = null;

      // the source code
      this._code = code;

  }

  TokenTranslator.prototype = {
      constructor: TokenTranslator,

      /**
       * Translates a single Esprima token to a single Acorn token. This may be
       * inaccurate due to how templates are handled differently in Esprima and
       * Acorn, but should be accurate for all other tokens.
       * @param {AcornToken} token The Acorn token to translate.
       * @param {Object} extra Espree extra object.
       * @returns {EsprimaToken} The Esprima version of the token.
       */
      translate: function(token, extra) {

          var type = token.type,
              tt = this._acornTokTypes;

          if (type === tt.name) {
              token.type = Token.Identifier;

              // TODO: See if this is an Acorn bug
              if (token.value === "static") {
                  token.type = Token.Keyword;
              }

              if (extra.ecmaVersion > 5 && (token.value === "yield" || token.value === "let")) {
                  token.type = Token.Keyword;
              }

          } else if (type === tt.semi || type === tt.comma ||
                   type === tt.parenL || type === tt.parenR ||
                   type === tt.braceL || type === tt.braceR ||
                   type === tt.dot || type === tt.bracketL ||
                   type === tt.colon || type === tt.question ||
                   type === tt.bracketR || type === tt.ellipsis ||
                   type === tt.arrow || type === tt.jsxTagStart ||
                   type === tt.incDec || type === tt.starstar ||
                   type === tt.jsxTagEnd || type === tt.prefix ||
                   (type.binop && !type.keyword) ||
                   type.isAssign) {

              token.type = Token.Punctuator;
              token.value = this._code.slice(token.start, token.end);
          } else if (type === tt.jsxName) {
              token.type = Token.JSXIdentifier;
          } else if (type.label === "jsxText" || type === tt.jsxAttrValueToken) {
              token.type = Token.JSXText;
          } else if (type.keyword) {
              if (type.keyword === "true" || type.keyword === "false") {
                  token.type = Token.Boolean;
              } else if (type.keyword === "null") {
                  token.type = Token.Null;
              } else {
                  token.type = Token.Keyword;
              }
          } else if (type === tt.num) {
              token.type = Token.Numeric;
              token.value = this._code.slice(token.start, token.end);
          } else if (type === tt.string) {

              if (extra.jsxAttrValueToken) {
                  extra.jsxAttrValueToken = false;
                  token.type = Token.JSXText;
              } else {
                  token.type = Token.String;
              }

              token.value = this._code.slice(token.start, token.end);
          } else if (type === tt.regexp) {
              token.type = Token.RegularExpression;
              var value = token.value;
              token.regex = {
                  flags: value.flags,
                  pattern: value.pattern
              };
              token.value = "/" + value.pattern + "/" + value.flags;
          }

          return token;
      },

      /**
       * Function to call during Acorn's onToken handler.
       * @param {AcornToken} token The Acorn token.
       * @param {Object} extra The Espree extra object.
       * @returns {void}
       */
      onToken: function(token, extra) {

          var that = this,
              tt = this._acornTokTypes,
              tokens = extra.tokens,
              templateTokens = this._tokens;

          /**
           * Flushes the buffered template tokens and resets the template
           * tracking.
           * @returns {void}
           * @private
           */
          function translateTemplateTokens() {
              tokens.push(convertTemplatePart(that._tokens, that._code));
              that._tokens = [];
          }

          if (token.type === tt.eof) {

              // might be one last curlyBrace
              if (this._curlyBrace) {
                  tokens.push(this.translate(this._curlyBrace, extra));
              }

              return;
          }

          if (token.type === tt.backQuote) {

              // if there's already a curly, it's not part of the template
              if (this._curlyBrace) {
                  tokens.push(this.translate(this._curlyBrace, extra));
                  this._curlyBrace = null;
              }

              templateTokens.push(token);

              // it's the end
              if (templateTokens.length > 1) {
                  translateTemplateTokens();
              }

              return;
          } else if (token.type === tt.dollarBraceL) {
              templateTokens.push(token);
              translateTemplateTokens();
              return;
          } else if (token.type === tt.braceR) {

              // if there's already a curly, it's not part of the template
              if (this._curlyBrace) {
                  tokens.push(this.translate(this._curlyBrace, extra));
              }

              // store new curly for later
              this._curlyBrace = token;
              return;
          } else if (token.type === tt.template || token.type === tt.invalidTemplate) {
              if (this._curlyBrace) {
                  templateTokens.push(this._curlyBrace);
                  this._curlyBrace = null;
              }

              templateTokens.push(token);
              return;
          }

          if (this._curlyBrace) {
              tokens.push(this.translate(this._curlyBrace, extra));
              this._curlyBrace = null;
          }

          tokens.push(this.translate(token, extra));
      }
  };

  //------------------------------------------------------------------------------
  // Public
  //------------------------------------------------------------------------------

  module.exports = TokenTranslator;

  },{}],90:[function(require,module,exports){
  module.exports={
    "_from": "espree",
    "_id": "espree@4.1.0",
    "_inBundle": false,
    "_integrity": "sha512-I5BycZW6FCVIub93TeVY1s7vjhP9CY6cXCznIRfiig7nRviKZYdRnj/sHEWC6A7WE9RDWOFq9+7OsWSYz8qv2w==",
    "_location": "/espree",
    "_phantomChildren": {},
    "_requested": {
      "type": "tag",
      "registry": true,
      "raw": "espree",
      "name": "espree",
      "escapedName": "espree",
      "rawSpec": "",
      "saveSpec": null,
      "fetchSpec": "latest"
    },
    "_requiredBy": [
      "#USER",
      "/"
    ],
    "_resolved": "https://registry.npmjs.org/espree/-/espree-4.1.0.tgz",
    "_shasum": "728d5451e0fd156c04384a7ad89ed51ff54eb25f",
    "_spec": "espree",
    "_where": "/Users/gferreir/workspaces/npm-scope-analysis-eval-global",
    "author": {
      "name": "Nicholas C. Zakas",
      "email": "nicholas+npm@nczconsulting.com"
    },
    "bugs": {
      "url": "http://github.com/eslint/espree.git"
    },
    "bundleDependencies": false,
    "dependencies": {
      "acorn": "^6.0.2",
      "acorn-jsx": "^5.0.0",
      "eslint-visitor-keys": "^1.0.0"
    },
    "deprecated": false,
    "description": "An Esprima-compatible JavaScript parser built on Acorn",
    "devDependencies": {
      "browserify": "^7.0.0",
      "chai": "^1.10.0",
      "eslint": "^2.13.1",
      "eslint-config-eslint": "^3.0.0",
      "eslint-release": "^1.0.0",
      "esprima": "latest",
      "esprima-fb": "^8001.2001.0-dev-harmony-fb",
      "json-diff": "~0.3.1",
      "leche": "^1.0.1",
      "mocha": "^2.0.1",
      "nyc": "^13.0.1",
      "regenerate": "~0.5.4",
      "shelljs": "^0.3.0",
      "shelljs-nodecli": "^0.1.1",
      "unicode-6.3.0": "~0.1.0"
    },
    "engines": {
      "node": ">=6.0.0"
    },
    "files": [
      "lib",
      "espree.js"
    ],
    "homepage": "https://github.com/eslint/espree",
    "keywords": [
      "ast",
      "ecmascript",
      "javascript",
      "parser",
      "syntax",
      "acorn"
    ],
    "license": "BSD-2-Clause",
    "main": "espree.js",
    "name": "espree",
    "repository": {
      "type": "git",
      "url": "git+https://github.com/eslint/espree.git"
    },
    "scripts": {
      "browserify": "node Makefile.js browserify",
      "generate-alpharelease": "eslint-generate-prerelease alpha",
      "generate-betarelease": "eslint-generate-prerelease beta",
      "generate-rcrelease": "eslint-generate-prerelease rc",
      "generate-regex": "node tools/generate-identifier-regex.js",
      "generate-release": "eslint-generate-release",
      "lint": "node Makefile.js lint",
      "publish-release": "eslint-publish-release",
      "test": "npm run-script lint && node Makefile.js test"
    },
    "version": "4.1.0"
  }

  },{}],91:[function(require,module,exports){
  /*
    Copyright (C) 2014 Yusuke Suzuki <utatane.tea@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are met:

      * Redistributions of source code must retain the above copyright
        notice, this list of conditions and the following disclaimer.
      * Redistributions in binary form must reproduce the above copyright
        notice, this list of conditions and the following disclaimer in the
        documentation and/or other materials provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
    DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
    (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
    LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
    ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
    THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
  */
  (function () {
      'use strict';

      var estraverse = require('estraverse');

      function isNode(node) {
          if (node == null) {
              return false;
          }
          return typeof node === 'object' && typeof node.type === 'string';
      }

      function isProperty(nodeType, key) {
          return (nodeType === estraverse.Syntax.ObjectExpression || nodeType === estraverse.Syntax.ObjectPattern) && key === 'properties';
      }

      function Visitor(visitor, options) {
          options = options || {};

          this.__visitor = visitor ||  this;
          this.__childVisitorKeys = options.childVisitorKeys
              ? Object.assign({}, estraverse.VisitorKeys, options.childVisitorKeys)
              : estraverse.VisitorKeys;
          if (options.fallback === 'iteration') {
              this.__fallback = Object.keys;
          } else if (typeof options.fallback === 'function') {
              this.__fallback = options.fallback;
          }
      }

      /* Default method for visiting children.
       * When you need to call default visiting operation inside custom visiting
       * operation, you can use it with `this.visitChildren(node)`.
       */
      Visitor.prototype.visitChildren = function (node) {
          var type, children, i, iz, j, jz, child;

          if (node == null) {
              return;
          }

          type = node.type || estraverse.Syntax.Property;

          children = this.__childVisitorKeys[type];
          if (!children) {
              if (this.__fallback) {
                  children = this.__fallback(node);
              } else {
                  throw new Error('Unknown node type ' + type + '.');
              }
          }

          for (i = 0, iz = children.length; i < iz; ++i) {
              child = node[children[i]];
              if (child) {
                  if (Array.isArray(child)) {
                      for (j = 0, jz = child.length; j < jz; ++j) {
                          if (child[j]) {
                              if (isNode(child[j]) || isProperty(type, children[i])) {
                                  this.visit(child[j]);
                              }
                          }
                      }
                  } else if (isNode(child)) {
                      this.visit(child);
                  }
              }
          }
      };

      /* Dispatching node. */
      Visitor.prototype.visit = function (node) {
          var type;

          if (node == null) {
              return;
          }

          type = node.type || estraverse.Syntax.Property;
          if (this.__visitor[type]) {
              this.__visitor[type].call(this, node);
              return;
          }
          this.visitChildren(node);
      };

      exports.version = require('./package.json').version;
      exports.Visitor = Visitor;
      exports.visit = function (node, visitor, options) {
          var v = new Visitor(visitor, options);
          v.visit(node);
      };
  }());
  /* vim: set sw=4 ts=4 et tw=80 : */

  },{"./package.json":92,"estraverse":93}],92:[function(require,module,exports){
  module.exports={
    "_from": "esrecurse@^4.1.0",
    "_id": "esrecurse@4.2.1",
    "_inBundle": false,
    "_integrity": "sha512-64RBB++fIOAXPw3P9cy89qfMlvZEXZkqqJkjqqXIvzP5ezRZjW+lPWjw35UX/3EhUPFYbg5ER4JYgDw4007/DQ==",
    "_location": "/esrecurse",
    "_phantomChildren": {},
    "_requested": {
      "type": "range",
      "registry": true,
      "raw": "esrecurse@^4.1.0",
      "name": "esrecurse",
      "escapedName": "esrecurse",
      "rawSpec": "^4.1.0",
      "saveSpec": null,
      "fetchSpec": "^4.1.0"
    },
    "_requiredBy": [
      "/eslint-scope"
    ],
    "_resolved": "https://registry.npmjs.org/esrecurse/-/esrecurse-4.2.1.tgz",
    "_shasum": "007a3b9fdbc2b3bb87e4879ea19c92fdbd3942cf",
    "_spec": "esrecurse@^4.1.0",
    "_where": "/Users/gferreir/workspaces/npm-scope-analysis-eval-global/node_modules/eslint-scope",
    "babel": {
      "presets": [
        "es2015"
      ]
    },
    "bugs": {
      "url": "https://github.com/estools/esrecurse/issues"
    },
    "bundleDependencies": false,
    "dependencies": {
      "estraverse": "^4.1.0"
    },
    "deprecated": false,
    "description": "ECMAScript AST recursive visitor",
    "devDependencies": {
      "babel-cli": "^6.24.1",
      "babel-eslint": "^7.2.3",
      "babel-preset-es2015": "^6.24.1",
      "babel-register": "^6.24.1",
      "chai": "^4.0.2",
      "esprima": "^4.0.0",
      "gulp": "^3.9.0",
      "gulp-bump": "^2.7.0",
      "gulp-eslint": "^4.0.0",
      "gulp-filter": "^5.0.0",
      "gulp-git": "^2.4.1",
      "gulp-mocha": "^4.3.1",
      "gulp-tag-version": "^1.2.1",
      "jsdoc": "^3.3.0-alpha10",
      "minimist": "^1.1.0"
    },
    "engines": {
      "node": ">=4.0"
    },
    "homepage": "https://github.com/estools/esrecurse",
    "license": "BSD-2-Clause",
    "main": "esrecurse.js",
    "maintainers": [
      {
        "name": "Yusuke Suzuki",
        "email": "utatane.tea@gmail.com",
        "url": "https://github.com/Constellation"
      }
    ],
    "name": "esrecurse",
    "repository": {
      "type": "git",
      "url": "git+https://github.com/estools/esrecurse.git"
    },
    "scripts": {
      "lint": "gulp lint",
      "test": "gulp travis",
      "unit-test": "gulp test"
    },
    "version": "4.2.1"
  }

  },{}],93:[function(require,module,exports){
  /*
    Copyright (C) 2012-2013 Yusuke Suzuki <utatane.tea@gmail.com>
    Copyright (C) 2012 Ariya Hidayat <ariya.hidayat@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are met:

      * Redistributions of source code must retain the above copyright
        notice, this list of conditions and the following disclaimer.
      * Redistributions in binary form must reproduce the above copyright
        notice, this list of conditions and the following disclaimer in the
        documentation and/or other materials provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
    DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
    (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
    LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
    ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
    THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
  */
  /*jslint vars:false, bitwise:true*/
  /*jshint indent:4*/
  /*global exports:true*/
  (function clone(exports) {
      'use strict';

      var Syntax,
          VisitorOption,
          VisitorKeys,
          BREAK,
          SKIP,
          REMOVE;

      function deepCopy(obj) {
          var ret = {}, key, val;
          for (key in obj) {
              if (obj.hasOwnProperty(key)) {
                  val = obj[key];
                  if (typeof val === 'object' && val !== null) {
                      ret[key] = deepCopy(val);
                  } else {
                      ret[key] = val;
                  }
              }
          }
          return ret;
      }

      // based on LLVM libc++ upper_bound / lower_bound
      // MIT License

      function upperBound(array, func) {
          var diff, len, i, current;

          len = array.length;
          i = 0;

          while (len) {
              diff = len >>> 1;
              current = i + diff;
              if (func(array[current])) {
                  len = diff;
              } else {
                  i = current + 1;
                  len -= diff + 1;
              }
          }
          return i;
      }

      Syntax = {
          AssignmentExpression: 'AssignmentExpression',
          AssignmentPattern: 'AssignmentPattern',
          ArrayExpression: 'ArrayExpression',
          ArrayPattern: 'ArrayPattern',
          ArrowFunctionExpression: 'ArrowFunctionExpression',
          AwaitExpression: 'AwaitExpression', // CAUTION: It's deferred to ES7.
          BlockStatement: 'BlockStatement',
          BinaryExpression: 'BinaryExpression',
          BreakStatement: 'BreakStatement',
          CallExpression: 'CallExpression',
          CatchClause: 'CatchClause',
          ClassBody: 'ClassBody',
          ClassDeclaration: 'ClassDeclaration',
          ClassExpression: 'ClassExpression',
          ComprehensionBlock: 'ComprehensionBlock',  // CAUTION: It's deferred to ES7.
          ComprehensionExpression: 'ComprehensionExpression',  // CAUTION: It's deferred to ES7.
          ConditionalExpression: 'ConditionalExpression',
          ContinueStatement: 'ContinueStatement',
          DebuggerStatement: 'DebuggerStatement',
          DirectiveStatement: 'DirectiveStatement',
          DoWhileStatement: 'DoWhileStatement',
          EmptyStatement: 'EmptyStatement',
          ExportAllDeclaration: 'ExportAllDeclaration',
          ExportDefaultDeclaration: 'ExportDefaultDeclaration',
          ExportNamedDeclaration: 'ExportNamedDeclaration',
          ExportSpecifier: 'ExportSpecifier',
          ExpressionStatement: 'ExpressionStatement',
          ForStatement: 'ForStatement',
          ForInStatement: 'ForInStatement',
          ForOfStatement: 'ForOfStatement',
          FunctionDeclaration: 'FunctionDeclaration',
          FunctionExpression: 'FunctionExpression',
          GeneratorExpression: 'GeneratorExpression',  // CAUTION: It's deferred to ES7.
          Identifier: 'Identifier',
          IfStatement: 'IfStatement',
          ImportExpression: 'ImportExpression',
          ImportDeclaration: 'ImportDeclaration',
          ImportDefaultSpecifier: 'ImportDefaultSpecifier',
          ImportNamespaceSpecifier: 'ImportNamespaceSpecifier',
          ImportSpecifier: 'ImportSpecifier',
          Literal: 'Literal',
          LabeledStatement: 'LabeledStatement',
          LogicalExpression: 'LogicalExpression',
          MemberExpression: 'MemberExpression',
          MetaProperty: 'MetaProperty',
          MethodDefinition: 'MethodDefinition',
          ModuleSpecifier: 'ModuleSpecifier',
          NewExpression: 'NewExpression',
          ObjectExpression: 'ObjectExpression',
          ObjectPattern: 'ObjectPattern',
          Program: 'Program',
          Property: 'Property',
          RestElement: 'RestElement',
          ReturnStatement: 'ReturnStatement',
          SequenceExpression: 'SequenceExpression',
          SpreadElement: 'SpreadElement',
          Super: 'Super',
          SwitchStatement: 'SwitchStatement',
          SwitchCase: 'SwitchCase',
          TaggedTemplateExpression: 'TaggedTemplateExpression',
          TemplateElement: 'TemplateElement',
          TemplateLiteral: 'TemplateLiteral',
          ThisExpression: 'ThisExpression',
          ThrowStatement: 'ThrowStatement',
          TryStatement: 'TryStatement',
          UnaryExpression: 'UnaryExpression',
          UpdateExpression: 'UpdateExpression',
          VariableDeclaration: 'VariableDeclaration',
          VariableDeclarator: 'VariableDeclarator',
          WhileStatement: 'WhileStatement',
          WithStatement: 'WithStatement',
          YieldExpression: 'YieldExpression'
      };

      VisitorKeys = {
          AssignmentExpression: ['left', 'right'],
          AssignmentPattern: ['left', 'right'],
          ArrayExpression: ['elements'],
          ArrayPattern: ['elements'],
          ArrowFunctionExpression: ['params', 'body'],
          AwaitExpression: ['argument'], // CAUTION: It's deferred to ES7.
          BlockStatement: ['body'],
          BinaryExpression: ['left', 'right'],
          BreakStatement: ['label'],
          CallExpression: ['callee', 'arguments'],
          CatchClause: ['param', 'body'],
          ClassBody: ['body'],
          ClassDeclaration: ['id', 'superClass', 'body'],
          ClassExpression: ['id', 'superClass', 'body'],
          ComprehensionBlock: ['left', 'right'],  // CAUTION: It's deferred to ES7.
          ComprehensionExpression: ['blocks', 'filter', 'body'],  // CAUTION: It's deferred to ES7.
          ConditionalExpression: ['test', 'consequent', 'alternate'],
          ContinueStatement: ['label'],
          DebuggerStatement: [],
          DirectiveStatement: [],
          DoWhileStatement: ['body', 'test'],
          EmptyStatement: [],
          ExportAllDeclaration: ['source'],
          ExportDefaultDeclaration: ['declaration'],
          ExportNamedDeclaration: ['declaration', 'specifiers', 'source'],
          ExportSpecifier: ['exported', 'local'],
          ExpressionStatement: ['expression'],
          ForStatement: ['init', 'test', 'update', 'body'],
          ForInStatement: ['left', 'right', 'body'],
          ForOfStatement: ['left', 'right', 'body'],
          FunctionDeclaration: ['id', 'params', 'body'],
          FunctionExpression: ['id', 'params', 'body'],
          GeneratorExpression: ['blocks', 'filter', 'body'],  // CAUTION: It's deferred to ES7.
          Identifier: [],
          IfStatement: ['test', 'consequent', 'alternate'],
          ImportExpression: ['source'],
          ImportDeclaration: ['specifiers', 'source'],
          ImportDefaultSpecifier: ['local'],
          ImportNamespaceSpecifier: ['local'],
          ImportSpecifier: ['imported', 'local'],
          Literal: [],
          LabeledStatement: ['label', 'body'],
          LogicalExpression: ['left', 'right'],
          MemberExpression: ['object', 'property'],
          MetaProperty: ['meta', 'property'],
          MethodDefinition: ['key', 'value'],
          ModuleSpecifier: [],
          NewExpression: ['callee', 'arguments'],
          ObjectExpression: ['properties'],
          ObjectPattern: ['properties'],
          Program: ['body'],
          Property: ['key', 'value'],
          RestElement: [ 'argument' ],
          ReturnStatement: ['argument'],
          SequenceExpression: ['expressions'],
          SpreadElement: ['argument'],
          Super: [],
          SwitchStatement: ['discriminant', 'cases'],
          SwitchCase: ['test', 'consequent'],
          TaggedTemplateExpression: ['tag', 'quasi'],
          TemplateElement: [],
          TemplateLiteral: ['quasis', 'expressions'],
          ThisExpression: [],
          ThrowStatement: ['argument'],
          TryStatement: ['block', 'handler', 'finalizer'],
          UnaryExpression: ['argument'],
          UpdateExpression: ['argument'],
          VariableDeclaration: ['declarations'],
          VariableDeclarator: ['id', 'init'],
          WhileStatement: ['test', 'body'],
          WithStatement: ['object', 'body'],
          YieldExpression: ['argument']
      };

      // unique id
      BREAK = {};
      SKIP = {};
      REMOVE = {};

      VisitorOption = {
          Break: BREAK,
          Skip: SKIP,
          Remove: REMOVE
      };

      function Reference(parent, key) {
          this.parent = parent;
          this.key = key;
      }

      Reference.prototype.replace = function replace(node) {
          this.parent[this.key] = node;
      };

      Reference.prototype.remove = function remove() {
          if (Array.isArray(this.parent)) {
              this.parent.splice(this.key, 1);
              return true;
          } else {
              this.replace(null);
              return false;
          }
      };

      function Element(node, path, wrap, ref) {
          this.node = node;
          this.path = path;
          this.wrap = wrap;
          this.ref = ref;
      }

      function Controller() { }

      // API:
      // return property path array from root to current node
      Controller.prototype.path = function path() {
          var i, iz, j, jz, result, element;

          function addToPath(result, path) {
              if (Array.isArray(path)) {
                  for (j = 0, jz = path.length; j < jz; ++j) {
                      result.push(path[j]);
                  }
              } else {
                  result.push(path);
              }
          }

          // root node
          if (!this.__current.path) {
              return null;
          }

          // first node is sentinel, second node is root element
          result = [];
          for (i = 2, iz = this.__leavelist.length; i < iz; ++i) {
              element = this.__leavelist[i];
              addToPath(result, element.path);
          }
          addToPath(result, this.__current.path);
          return result;
      };

      // API:
      // return type of current node
      Controller.prototype.type = function () {
          var node = this.current();
          return node.type || this.__current.wrap;
      };

      // API:
      // return array of parent elements
      Controller.prototype.parents = function parents() {
          var i, iz, result;

          // first node is sentinel
          result = [];
          for (i = 1, iz = this.__leavelist.length; i < iz; ++i) {
              result.push(this.__leavelist[i].node);
          }

          return result;
      };

      // API:
      // return current node
      Controller.prototype.current = function current() {
          return this.__current.node;
      };

      Controller.prototype.__execute = function __execute(callback, element) {
          var previous, result;

          result = undefined;

          previous  = this.__current;
          this.__current = element;
          this.__state = null;
          if (callback) {
              result = callback.call(this, element.node, this.__leavelist[this.__leavelist.length - 1].node);
          }
          this.__current = previous;

          return result;
      };

      // API:
      // notify control skip / break
      Controller.prototype.notify = function notify(flag) {
          this.__state = flag;
      };

      // API:
      // skip child nodes of current node
      Controller.prototype.skip = function () {
          this.notify(SKIP);
      };

      // API:
      // break traversals
      Controller.prototype['break'] = function () {
          this.notify(BREAK);
      };

      // API:
      // remove node
      Controller.prototype.remove = function () {
          this.notify(REMOVE);
      };

      Controller.prototype.__initialize = function(root, visitor) {
          this.visitor = visitor;
          this.root = root;
          this.__worklist = [];
          this.__leavelist = [];
          this.__current = null;
          this.__state = null;
          this.__fallback = null;
          if (visitor.fallback === 'iteration') {
              this.__fallback = Object.keys;
          } else if (typeof visitor.fallback === 'function') {
              this.__fallback = visitor.fallback;
          }

          this.__keys = VisitorKeys;
          if (visitor.keys) {
              this.__keys = Object.assign(Object.create(this.__keys), visitor.keys);
          }
      };

      function isNode(node) {
          if (node == null) {
              return false;
          }
          return typeof node === 'object' && typeof node.type === 'string';
      }

      function isProperty(nodeType, key) {
          return (nodeType === Syntax.ObjectExpression || nodeType === Syntax.ObjectPattern) && 'properties' === key;
      }

      Controller.prototype.traverse = function traverse(root, visitor) {
          var worklist,
              leavelist,
              element,
              node,
              nodeType,
              ret,
              key,
              current,
              current2,
              candidates,
              candidate,
              sentinel;

          this.__initialize(root, visitor);

          sentinel = {};

          // reference
          worklist = this.__worklist;
          leavelist = this.__leavelist;

          // initialize
          worklist.push(new Element(root, null, null, null));
          leavelist.push(new Element(null, null, null, null));

          while (worklist.length) {
              element = worklist.pop();

              if (element === sentinel) {
                  element = leavelist.pop();

                  ret = this.__execute(visitor.leave, element);

                  if (this.__state === BREAK || ret === BREAK) {
                      return;
                  }
                  continue;
              }

              if (element.node) {

                  ret = this.__execute(visitor.enter, element);

                  if (this.__state === BREAK || ret === BREAK) {
                      return;
                  }

                  worklist.push(sentinel);
                  leavelist.push(element);

                  if (this.__state === SKIP || ret === SKIP) {
                      continue;
                  }

                  node = element.node;
                  nodeType = node.type || element.wrap;
                  candidates = this.__keys[nodeType];
                  if (!candidates) {
                      if (this.__fallback) {
                          candidates = this.__fallback(node);
                      } else {
                          throw new Error('Unknown node type ' + nodeType + '.');
                      }
                  }

                  current = candidates.length;
                  while ((current -= 1) >= 0) {
                      key = candidates[current];
                      candidate = node[key];
                      if (!candidate) {
                          continue;
                      }

                      if (Array.isArray(candidate)) {
                          current2 = candidate.length;
                          while ((current2 -= 1) >= 0) {
                              if (!candidate[current2]) {
                                  continue;
                              }
                              if (isProperty(nodeType, candidates[current])) {
                                  element = new Element(candidate[current2], [key, current2], 'Property', null);
                              } else if (isNode(candidate[current2])) {
                                  element = new Element(candidate[current2], [key, current2], null, null);
                              } else {
                                  continue;
                              }
                              worklist.push(element);
                          }
                      } else if (isNode(candidate)) {
                          worklist.push(new Element(candidate, key, null, null));
                      }
                  }
              }
          }
      };

      Controller.prototype.replace = function replace(root, visitor) {
          var worklist,
              leavelist,
              node,
              nodeType,
              target,
              element,
              current,
              current2,
              candidates,
              candidate,
              sentinel,
              outer,
              key;

          function removeElem(element) {
              var i,
                  key,
                  nextElem,
                  parent;

              if (element.ref.remove()) {
                  // When the reference is an element of an array.
                  key = element.ref.key;
                  parent = element.ref.parent;

                  // If removed from array, then decrease following items' keys.
                  i = worklist.length;
                  while (i--) {
                      nextElem = worklist[i];
                      if (nextElem.ref && nextElem.ref.parent === parent) {
                          if  (nextElem.ref.key < key) {
                              break;
                          }
                          --nextElem.ref.key;
                      }
                  }
              }
          }

          this.__initialize(root, visitor);

          sentinel = {};

          // reference
          worklist = this.__worklist;
          leavelist = this.__leavelist;

          // initialize
          outer = {
              root: root
          };
          element = new Element(root, null, null, new Reference(outer, 'root'));
          worklist.push(element);
          leavelist.push(element);

          while (worklist.length) {
              element = worklist.pop();

              if (element === sentinel) {
                  element = leavelist.pop();

                  target = this.__execute(visitor.leave, element);

                  // node may be replaced with null,
                  // so distinguish between undefined and null in this place
                  if (target !== undefined && target !== BREAK && target !== SKIP && target !== REMOVE) {
                      // replace
                      element.ref.replace(target);
                  }

                  if (this.__state === REMOVE || target === REMOVE) {
                      removeElem(element);
                  }

                  if (this.__state === BREAK || target === BREAK) {
                      return outer.root;
                  }
                  continue;
              }

              target = this.__execute(visitor.enter, element);

              // node may be replaced with null,
              // so distinguish between undefined and null in this place
              if (target !== undefined && target !== BREAK && target !== SKIP && target !== REMOVE) {
                  // replace
                  element.ref.replace(target);
                  element.node = target;
              }

              if (this.__state === REMOVE || target === REMOVE) {
                  removeElem(element);
                  element.node = null;
              }

              if (this.__state === BREAK || target === BREAK) {
                  return outer.root;
              }

              // node may be null
              node = element.node;
              if (!node) {
                  continue;
              }

              worklist.push(sentinel);
              leavelist.push(element);

              if (this.__state === SKIP || target === SKIP) {
                  continue;
              }

              nodeType = node.type || element.wrap;
              candidates = this.__keys[nodeType];
              if (!candidates) {
                  if (this.__fallback) {
                      candidates = this.__fallback(node);
                  } else {
                      throw new Error('Unknown node type ' + nodeType + '.');
                  }
              }

              current = candidates.length;
              while ((current -= 1) >= 0) {
                  key = candidates[current];
                  candidate = node[key];
                  if (!candidate) {
                      continue;
                  }

                  if (Array.isArray(candidate)) {
                      current2 = candidate.length;
                      while ((current2 -= 1) >= 0) {
                          if (!candidate[current2]) {
                              continue;
                          }
                          if (isProperty(nodeType, candidates[current])) {
                              element = new Element(candidate[current2], [key, current2], 'Property', new Reference(candidate, current2));
                          } else if (isNode(candidate[current2])) {
                              element = new Element(candidate[current2], [key, current2], null, new Reference(candidate, current2));
                          } else {
                              continue;
                          }
                          worklist.push(element);
                      }
                  } else if (isNode(candidate)) {
                      worklist.push(new Element(candidate, key, null, new Reference(node, key)));
                  }
              }
          }

          return outer.root;
      };

      function traverse(root, visitor) {
          var controller = new Controller();
          return controller.traverse(root, visitor);
      }

      function replace(root, visitor) {
          var controller = new Controller();
          return controller.replace(root, visitor);
      }

      function extendCommentRange(comment, tokens) {
          var target;

          target = upperBound(tokens, function search(token) {
              return token.range[0] > comment.range[0];
          });

          comment.extendedRange = [comment.range[0], comment.range[1]];

          if (target !== tokens.length) {
              comment.extendedRange[1] = tokens[target].range[0];
          }

          target -= 1;
          if (target >= 0) {
              comment.extendedRange[0] = tokens[target].range[1];
          }

          return comment;
      }

      function attachComments(tree, providedComments, tokens) {
          // At first, we should calculate extended comment ranges.
          var comments = [], comment, len, i, cursor;

          if (!tree.range) {
              throw new Error('attachComments needs range information');
          }

          // tokens array is empty, we attach comments to tree as 'leadingComments'
          if (!tokens.length) {
              if (providedComments.length) {
                  for (i = 0, len = providedComments.length; i < len; i += 1) {
                      comment = deepCopy(providedComments[i]);
                      comment.extendedRange = [0, tree.range[0]];
                      comments.push(comment);
                  }
                  tree.leadingComments = comments;
              }
              return tree;
          }

          for (i = 0, len = providedComments.length; i < len; i += 1) {
              comments.push(extendCommentRange(deepCopy(providedComments[i]), tokens));
          }

          // This is based on John Freeman's implementation.
          cursor = 0;
          traverse(tree, {
              enter: function (node) {
                  var comment;

                  while (cursor < comments.length) {
                      comment = comments[cursor];
                      if (comment.extendedRange[1] > node.range[0]) {
                          break;
                      }

                      if (comment.extendedRange[1] === node.range[0]) {
                          if (!node.leadingComments) {
                              node.leadingComments = [];
                          }
                          node.leadingComments.push(comment);
                          comments.splice(cursor, 1);
                      } else {
                          cursor += 1;
                      }
                  }

                  // already out of owned node
                  if (cursor === comments.length) {
                      return VisitorOption.Break;
                  }

                  if (comments[cursor].extendedRange[0] > node.range[1]) {
                      return VisitorOption.Skip;
                  }
              }
          });

          cursor = 0;
          traverse(tree, {
              leave: function (node) {
                  var comment;

                  while (cursor < comments.length) {
                      comment = comments[cursor];
                      if (node.range[1] < comment.extendedRange[0]) {
                          break;
                      }

                      if (node.range[1] === comment.extendedRange[0]) {
                          if (!node.trailingComments) {
                              node.trailingComments = [];
                          }
                          node.trailingComments.push(comment);
                          comments.splice(cursor, 1);
                      } else {
                          cursor += 1;
                      }
                  }

                  // already out of owned node
                  if (cursor === comments.length) {
                      return VisitorOption.Break;
                  }

                  if (comments[cursor].extendedRange[0] > node.range[1]) {
                      return VisitorOption.Skip;
                  }
              }
          });

          return tree;
      }

      exports.version = require('./package.json').version;
      exports.Syntax = Syntax;
      exports.traverse = traverse;
      exports.replace = replace;
      exports.attachComments = attachComments;
      exports.VisitorKeys = VisitorKeys;
      exports.VisitorOption = VisitorOption;
      exports.Controller = Controller;
      exports.cloneEnvironment = function () { return clone({}); };

      return exports;
  }(exports));
  /* vim: set sw=4 ts=4 et tw=80 : */

  },{"./package.json":94}],94:[function(require,module,exports){
  module.exports={
    "_from": "estraverse@4.3.0",
    "_id": "estraverse@4.3.0",
    "_inBundle": false,
    "_integrity": "sha512-39nnKffWz8xN1BU/2c79n9nB9HDzo0niYUqx6xyqUnyoAnQyyWpOTdZEeiCch8BBu515t4wp9ZmgVfVhn9EBpw==",
    "_location": "/estraverse",
    "_phantomChildren": {},
    "_requested": {
      "type": "version",
      "registry": true,
      "raw": "estraverse@4.3.0",
      "name": "estraverse",
      "escapedName": "estraverse",
      "rawSpec": "4.3.0",
      "saveSpec": null,
      "fetchSpec": "4.3.0"
    },
    "_requiredBy": [
      "#USER",
      "/",
      "/escodegen",
      "/escope",
      "/eslint-scope",
      "/esrecurse"
    ],
    "_resolved": "https://registry.npmjs.org/estraverse/-/estraverse-4.3.0.tgz",
    "_shasum": "398ad3f3c5a24948be7725e83d11a7de28cdbd1d",
    "_spec": "estraverse@4.3.0",
    "_where": "/Users/gferreir/workspaces/npm-scope-analysis-eval-global",
    "bugs": {
      "url": "https://github.com/estools/estraverse/issues"
    },
    "bundleDependencies": false,
    "deprecated": false,
    "description": "ECMAScript JS AST traversal functions",
    "devDependencies": {
      "babel-preset-env": "^1.6.1",
      "babel-register": "^6.3.13",
      "chai": "^2.1.1",
      "espree": "^1.11.0",
      "gulp": "^3.8.10",
      "gulp-bump": "^0.2.2",
      "gulp-filter": "^2.0.0",
      "gulp-git": "^1.0.1",
      "gulp-tag-version": "^1.3.0",
      "jshint": "^2.5.6",
      "mocha": "^2.1.0"
    },
    "engines": {
      "node": ">=4.0"
    },
    "homepage": "https://github.com/estools/estraverse",
    "license": "BSD-2-Clause",
    "main": "estraverse.js",
    "maintainers": [
      {
        "name": "Yusuke Suzuki",
        "email": "utatane.tea@gmail.com",
        "url": "http://github.com/Constellation"
      }
    ],
    "name": "estraverse",
    "repository": {
      "type": "git",
      "url": "git+ssh://git@github.com/estools/estraverse.git"
    },
    "scripts": {
      "lint": "jshint estraverse.js",
      "test": "npm run-script lint && npm run-script unit-test",
      "unit-test": "mocha --compilers js:babel-register"
    },
    "version": "4.3.0"
  }

  },{}],95:[function(require,module,exports){
  /*
    Copyright (C) 2013 Yusuke Suzuki <utatane.tea@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are met:

      * Redistributions of source code must retain the above copyright
        notice, this list of conditions and the following disclaimer.
      * Redistributions in binary form must reproduce the above copyright
        notice, this list of conditions and the following disclaimer in the
        documentation and/or other materials provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS 'AS IS'
    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
    DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
    (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
    LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
    ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
    THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
  */

  (function () {
      'use strict';

      function isExpression(node) {
          if (node == null) { return false; }
          switch (node.type) {
              case 'ArrayExpression':
              case 'AssignmentExpression':
              case 'BinaryExpression':
              case 'CallExpression':
              case 'ConditionalExpression':
              case 'FunctionExpression':
              case 'Identifier':
              case 'Literal':
              case 'LogicalExpression':
              case 'MemberExpression':
              case 'NewExpression':
              case 'ObjectExpression':
              case 'SequenceExpression':
              case 'ThisExpression':
              case 'UnaryExpression':
              case 'UpdateExpression':
                  return true;
          }
          return false;
      }

      function isIterationStatement(node) {
          if (node == null) { return false; }
          switch (node.type) {
              case 'DoWhileStatement':
              case 'ForInStatement':
              case 'ForStatement':
              case 'WhileStatement':
                  return true;
          }
          return false;
      }

      function isStatement(node) {
          if (node == null) { return false; }
          switch (node.type) {
              case 'BlockStatement':
              case 'BreakStatement':
              case 'ContinueStatement':
              case 'DebuggerStatement':
              case 'DoWhileStatement':
              case 'EmptyStatement':
              case 'ExpressionStatement':
              case 'ForInStatement':
              case 'ForStatement':
              case 'IfStatement':
              case 'LabeledStatement':
              case 'ReturnStatement':
              case 'SwitchStatement':
              case 'ThrowStatement':
              case 'TryStatement':
              case 'VariableDeclaration':
              case 'WhileStatement':
              case 'WithStatement':
                  return true;
          }
          return false;
      }

      function isSourceElement(node) {
        return isStatement(node) || node != null && node.type === 'FunctionDeclaration';
      }

      function trailingStatement(node) {
          switch (node.type) {
          case 'IfStatement':
              if (node.alternate != null) {
                  return node.alternate;
              }
              return node.consequent;

          case 'LabeledStatement':
          case 'ForStatement':
          case 'ForInStatement':
          case 'WhileStatement':
          case 'WithStatement':
              return node.body;
          }
          return null;
      }

      function isProblematicIfStatement(node) {
          var current;

          if (node.type !== 'IfStatement') {
              return false;
          }
          if (node.alternate == null) {
              return false;
          }
          current = node.consequent;
          do {
              if (current.type === 'IfStatement') {
                  if (current.alternate == null)  {
                      return true;
                  }
              }
              current = trailingStatement(current);
          } while (current);

          return false;
      }

      module.exports = {
          isExpression: isExpression,
          isStatement: isStatement,
          isIterationStatement: isIterationStatement,
          isSourceElement: isSourceElement,
          isProblematicIfStatement: isProblematicIfStatement,

          trailingStatement: trailingStatement
      };
  }());
  /* vim: set sw=4 ts=4 et tw=80 : */

  },{}],96:[function(require,module,exports){
  /*
    Copyright (C) 2013-2014 Yusuke Suzuki <utatane.tea@gmail.com>
    Copyright (C) 2014 Ivan Nikulin <ifaaan@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are met:

      * Redistributions of source code must retain the above copyright
        notice, this list of conditions and the following disclaimer.
      * Redistributions in binary form must reproduce the above copyright
        notice, this list of conditions and the following disclaimer in the
        documentation and/or other materials provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
    DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
    (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
    LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
    ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
    THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
  */

  (function () {
      'use strict';

      var ES6Regex, ES5Regex, NON_ASCII_WHITESPACES, IDENTIFIER_START, IDENTIFIER_PART, ch;

      // See `tools/generate-identifier-regex.js`.
      ES5Regex = {
          // ECMAScript 5.1/Unicode v9.0.0 NonAsciiIdentifierStart:
          NonAsciiIdentifierStart: /[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0-\u08B4\u08B6-\u08BD\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0AF9\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D\u0C58-\u0C5A\u0C60\u0C61\u0C80\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D54-\u0D56\u0D5F-\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F5\u13F8-\u13FD\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u1884\u1887-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191E\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1C80-\u1C88\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FD5\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA69D\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA7AE\uA7B0-\uA7B7\uA7F7-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA8FD\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uA9E0-\uA9E4\uA9E6-\uA9EF\uA9FA-\uA9FE\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA7E-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB65\uAB70-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]/,
          // ECMAScript 5.1/Unicode v9.0.0 NonAsciiIdentifierPart:
          NonAsciiIdentifierPart: /[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u08A0-\u08B4\u08B6-\u08BD\u08D4-\u08E1\u08E3-\u0963\u0966-\u096F\u0971-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09F1\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0AF9\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BEF\u0C00-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58-\u0C5A\u0C60-\u0C63\u0C66-\u0C6F\u0C80-\u0C83\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D01-\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D-\u0D44\u0D46-\u0D48\u0D4A-\u0D4E\u0D54-\u0D57\u0D5F-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DE6-\u0DEF\u0DF2\u0DF3\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1380-\u138F\u13A0-\u13F5\u13F8-\u13FD\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191E\u1920-\u192B\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19D9\u1A00-\u1A1B\u1A20-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1AB0-\u1ABD\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1C80-\u1C88\u1CD0-\u1CD2\u1CD4-\u1CF6\u1CF8\u1CF9\u1D00-\u1DF5\u1DFB-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u200C\u200D\u203F\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2DE0-\u2DFF\u2E2F\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099\u309A\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FD5\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA7AE\uA7B0-\uA7B7\uA7F7-\uA827\uA840-\uA873\uA880-\uA8C5\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA8FD\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-\uA9D9\uA9E0-\uA9FE\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A-\uAAC2\uAADB-\uAADD\uAAE0-\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB65\uAB70-\uABEA\uABEC\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE2F\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]/
      };

      ES6Regex = {
          // ECMAScript 6/Unicode v9.0.0 NonAsciiIdentifierStart:
          NonAsciiIdentifierStart: /[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0-\u08B4\u08B6-\u08BD\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0AF9\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D\u0C58-\u0C5A\u0C60\u0C61\u0C80\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D54-\u0D56\u0D5F-\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F5\u13F8-\u13FD\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191E\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1C80-\u1C88\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2118-\u211D\u2124\u2126\u2128\u212A-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309B-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FD5\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA69D\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA7AE\uA7B0-\uA7B7\uA7F7-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA8FD\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uA9E0-\uA9E4\uA9E6-\uA9EF\uA9FA-\uA9FE\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA7E-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB65\uAB70-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]|\uD800[\uDC00-\uDC0B\uDC0D-\uDC26\uDC28-\uDC3A\uDC3C\uDC3D\uDC3F-\uDC4D\uDC50-\uDC5D\uDC80-\uDCFA\uDD40-\uDD74\uDE80-\uDE9C\uDEA0-\uDED0\uDF00-\uDF1F\uDF30-\uDF4A\uDF50-\uDF75\uDF80-\uDF9D\uDFA0-\uDFC3\uDFC8-\uDFCF\uDFD1-\uDFD5]|\uD801[\uDC00-\uDC9D\uDCB0-\uDCD3\uDCD8-\uDCFB\uDD00-\uDD27\uDD30-\uDD63\uDE00-\uDF36\uDF40-\uDF55\uDF60-\uDF67]|\uD802[\uDC00-\uDC05\uDC08\uDC0A-\uDC35\uDC37\uDC38\uDC3C\uDC3F-\uDC55\uDC60-\uDC76\uDC80-\uDC9E\uDCE0-\uDCF2\uDCF4\uDCF5\uDD00-\uDD15\uDD20-\uDD39\uDD80-\uDDB7\uDDBE\uDDBF\uDE00\uDE10-\uDE13\uDE15-\uDE17\uDE19-\uDE33\uDE60-\uDE7C\uDE80-\uDE9C\uDEC0-\uDEC7\uDEC9-\uDEE4\uDF00-\uDF35\uDF40-\uDF55\uDF60-\uDF72\uDF80-\uDF91]|\uD803[\uDC00-\uDC48\uDC80-\uDCB2\uDCC0-\uDCF2]|\uD804[\uDC03-\uDC37\uDC83-\uDCAF\uDCD0-\uDCE8\uDD03-\uDD26\uDD50-\uDD72\uDD76\uDD83-\uDDB2\uDDC1-\uDDC4\uDDDA\uDDDC\uDE00-\uDE11\uDE13-\uDE2B\uDE80-\uDE86\uDE88\uDE8A-\uDE8D\uDE8F-\uDE9D\uDE9F-\uDEA8\uDEB0-\uDEDE\uDF05-\uDF0C\uDF0F\uDF10\uDF13-\uDF28\uDF2A-\uDF30\uDF32\uDF33\uDF35-\uDF39\uDF3D\uDF50\uDF5D-\uDF61]|\uD805[\uDC00-\uDC34\uDC47-\uDC4A\uDC80-\uDCAF\uDCC4\uDCC5\uDCC7\uDD80-\uDDAE\uDDD8-\uDDDB\uDE00-\uDE2F\uDE44\uDE80-\uDEAA\uDF00-\uDF19]|\uD806[\uDCA0-\uDCDF\uDCFF\uDEC0-\uDEF8]|\uD807[\uDC00-\uDC08\uDC0A-\uDC2E\uDC40\uDC72-\uDC8F]|\uD808[\uDC00-\uDF99]|\uD809[\uDC00-\uDC6E\uDC80-\uDD43]|[\uD80C\uD81C-\uD820\uD840-\uD868\uD86A-\uD86C\uD86F-\uD872][\uDC00-\uDFFF]|\uD80D[\uDC00-\uDC2E]|\uD811[\uDC00-\uDE46]|\uD81A[\uDC00-\uDE38\uDE40-\uDE5E\uDED0-\uDEED\uDF00-\uDF2F\uDF40-\uDF43\uDF63-\uDF77\uDF7D-\uDF8F]|\uD81B[\uDF00-\uDF44\uDF50\uDF93-\uDF9F\uDFE0]|\uD821[\uDC00-\uDFEC]|\uD822[\uDC00-\uDEF2]|\uD82C[\uDC00\uDC01]|\uD82F[\uDC00-\uDC6A\uDC70-\uDC7C\uDC80-\uDC88\uDC90-\uDC99]|\uD835[\uDC00-\uDC54\uDC56-\uDC9C\uDC9E\uDC9F\uDCA2\uDCA5\uDCA6\uDCA9-\uDCAC\uDCAE-\uDCB9\uDCBB\uDCBD-\uDCC3\uDCC5-\uDD05\uDD07-\uDD0A\uDD0D-\uDD14\uDD16-\uDD1C\uDD1E-\uDD39\uDD3B-\uDD3E\uDD40-\uDD44\uDD46\uDD4A-\uDD50\uDD52-\uDEA5\uDEA8-\uDEC0\uDEC2-\uDEDA\uDEDC-\uDEFA\uDEFC-\uDF14\uDF16-\uDF34\uDF36-\uDF4E\uDF50-\uDF6E\uDF70-\uDF88\uDF8A-\uDFA8\uDFAA-\uDFC2\uDFC4-\uDFCB]|\uD83A[\uDC00-\uDCC4\uDD00-\uDD43]|\uD83B[\uDE00-\uDE03\uDE05-\uDE1F\uDE21\uDE22\uDE24\uDE27\uDE29-\uDE32\uDE34-\uDE37\uDE39\uDE3B\uDE42\uDE47\uDE49\uDE4B\uDE4D-\uDE4F\uDE51\uDE52\uDE54\uDE57\uDE59\uDE5B\uDE5D\uDE5F\uDE61\uDE62\uDE64\uDE67-\uDE6A\uDE6C-\uDE72\uDE74-\uDE77\uDE79-\uDE7C\uDE7E\uDE80-\uDE89\uDE8B-\uDE9B\uDEA1-\uDEA3\uDEA5-\uDEA9\uDEAB-\uDEBB]|\uD869[\uDC00-\uDED6\uDF00-\uDFFF]|\uD86D[\uDC00-\uDF34\uDF40-\uDFFF]|\uD86E[\uDC00-\uDC1D\uDC20-\uDFFF]|\uD873[\uDC00-\uDEA1]|\uD87E[\uDC00-\uDE1D]/,
          // ECMAScript 6/Unicode v9.0.0 NonAsciiIdentifierPart:
          NonAsciiIdentifierPart: /[\xAA\xB5\xB7\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u08A0-\u08B4\u08B6-\u08BD\u08D4-\u08E1\u08E3-\u0963\u0966-\u096F\u0971-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09F1\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0AF9\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BEF\u0C00-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58-\u0C5A\u0C60-\u0C63\u0C66-\u0C6F\u0C80-\u0C83\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D01-\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D-\u0D44\u0D46-\u0D48\u0D4A-\u0D4E\u0D54-\u0D57\u0D5F-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DE6-\u0DEF\u0DF2\u0DF3\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1369-\u1371\u1380-\u138F\u13A0-\u13F5\u13F8-\u13FD\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191E\u1920-\u192B\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19DA\u1A00-\u1A1B\u1A20-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1AB0-\u1ABD\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1C80-\u1C88\u1CD0-\u1CD2\u1CD4-\u1CF6\u1CF8\u1CF9\u1D00-\u1DF5\u1DFB-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u200C\u200D\u203F\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115\u2118-\u211D\u2124\u2126\u2128\u212A-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2DE0-\u2DFF\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FD5\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA7AE\uA7B0-\uA7B7\uA7F7-\uA827\uA840-\uA873\uA880-\uA8C5\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA8FD\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-\uA9D9\uA9E0-\uA9FE\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A-\uAAC2\uAADB-\uAADD\uAAE0-\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB65\uAB70-\uABEA\uABEC\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE2F\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]|\uD800[\uDC00-\uDC0B\uDC0D-\uDC26\uDC28-\uDC3A\uDC3C\uDC3D\uDC3F-\uDC4D\uDC50-\uDC5D\uDC80-\uDCFA\uDD40-\uDD74\uDDFD\uDE80-\uDE9C\uDEA0-\uDED0\uDEE0\uDF00-\uDF1F\uDF30-\uDF4A\uDF50-\uDF7A\uDF80-\uDF9D\uDFA0-\uDFC3\uDFC8-\uDFCF\uDFD1-\uDFD5]|\uD801[\uDC00-\uDC9D\uDCA0-\uDCA9\uDCB0-\uDCD3\uDCD8-\uDCFB\uDD00-\uDD27\uDD30-\uDD63\uDE00-\uDF36\uDF40-\uDF55\uDF60-\uDF67]|\uD802[\uDC00-\uDC05\uDC08\uDC0A-\uDC35\uDC37\uDC38\uDC3C\uDC3F-\uDC55\uDC60-\uDC76\uDC80-\uDC9E\uDCE0-\uDCF2\uDCF4\uDCF5\uDD00-\uDD15\uDD20-\uDD39\uDD80-\uDDB7\uDDBE\uDDBF\uDE00-\uDE03\uDE05\uDE06\uDE0C-\uDE13\uDE15-\uDE17\uDE19-\uDE33\uDE38-\uDE3A\uDE3F\uDE60-\uDE7C\uDE80-\uDE9C\uDEC0-\uDEC7\uDEC9-\uDEE6\uDF00-\uDF35\uDF40-\uDF55\uDF60-\uDF72\uDF80-\uDF91]|\uD803[\uDC00-\uDC48\uDC80-\uDCB2\uDCC0-\uDCF2]|\uD804[\uDC00-\uDC46\uDC66-\uDC6F\uDC7F-\uDCBA\uDCD0-\uDCE8\uDCF0-\uDCF9\uDD00-\uDD34\uDD36-\uDD3F\uDD50-\uDD73\uDD76\uDD80-\uDDC4\uDDCA-\uDDCC\uDDD0-\uDDDA\uDDDC\uDE00-\uDE11\uDE13-\uDE37\uDE3E\uDE80-\uDE86\uDE88\uDE8A-\uDE8D\uDE8F-\uDE9D\uDE9F-\uDEA8\uDEB0-\uDEEA\uDEF0-\uDEF9\uDF00-\uDF03\uDF05-\uDF0C\uDF0F\uDF10\uDF13-\uDF28\uDF2A-\uDF30\uDF32\uDF33\uDF35-\uDF39\uDF3C-\uDF44\uDF47\uDF48\uDF4B-\uDF4D\uDF50\uDF57\uDF5D-\uDF63\uDF66-\uDF6C\uDF70-\uDF74]|\uD805[\uDC00-\uDC4A\uDC50-\uDC59\uDC80-\uDCC5\uDCC7\uDCD0-\uDCD9\uDD80-\uDDB5\uDDB8-\uDDC0\uDDD8-\uDDDD\uDE00-\uDE40\uDE44\uDE50-\uDE59\uDE80-\uDEB7\uDEC0-\uDEC9\uDF00-\uDF19\uDF1D-\uDF2B\uDF30-\uDF39]|\uD806[\uDCA0-\uDCE9\uDCFF\uDEC0-\uDEF8]|\uD807[\uDC00-\uDC08\uDC0A-\uDC36\uDC38-\uDC40\uDC50-\uDC59\uDC72-\uDC8F\uDC92-\uDCA7\uDCA9-\uDCB6]|\uD808[\uDC00-\uDF99]|\uD809[\uDC00-\uDC6E\uDC80-\uDD43]|[\uD80C\uD81C-\uD820\uD840-\uD868\uD86A-\uD86C\uD86F-\uD872][\uDC00-\uDFFF]|\uD80D[\uDC00-\uDC2E]|\uD811[\uDC00-\uDE46]|\uD81A[\uDC00-\uDE38\uDE40-\uDE5E\uDE60-\uDE69\uDED0-\uDEED\uDEF0-\uDEF4\uDF00-\uDF36\uDF40-\uDF43\uDF50-\uDF59\uDF63-\uDF77\uDF7D-\uDF8F]|\uD81B[\uDF00-\uDF44\uDF50-\uDF7E\uDF8F-\uDF9F\uDFE0]|\uD821[\uDC00-\uDFEC]|\uD822[\uDC00-\uDEF2]|\uD82C[\uDC00\uDC01]|\uD82F[\uDC00-\uDC6A\uDC70-\uDC7C\uDC80-\uDC88\uDC90-\uDC99\uDC9D\uDC9E]|\uD834[\uDD65-\uDD69\uDD6D-\uDD72\uDD7B-\uDD82\uDD85-\uDD8B\uDDAA-\uDDAD\uDE42-\uDE44]|\uD835[\uDC00-\uDC54\uDC56-\uDC9C\uDC9E\uDC9F\uDCA2\uDCA5\uDCA6\uDCA9-\uDCAC\uDCAE-\uDCB9\uDCBB\uDCBD-\uDCC3\uDCC5-\uDD05\uDD07-\uDD0A\uDD0D-\uDD14\uDD16-\uDD1C\uDD1E-\uDD39\uDD3B-\uDD3E\uDD40-\uDD44\uDD46\uDD4A-\uDD50\uDD52-\uDEA5\uDEA8-\uDEC0\uDEC2-\uDEDA\uDEDC-\uDEFA\uDEFC-\uDF14\uDF16-\uDF34\uDF36-\uDF4E\uDF50-\uDF6E\uDF70-\uDF88\uDF8A-\uDFA8\uDFAA-\uDFC2\uDFC4-\uDFCB\uDFCE-\uDFFF]|\uD836[\uDE00-\uDE36\uDE3B-\uDE6C\uDE75\uDE84\uDE9B-\uDE9F\uDEA1-\uDEAF]|\uD838[\uDC00-\uDC06\uDC08-\uDC18\uDC1B-\uDC21\uDC23\uDC24\uDC26-\uDC2A]|\uD83A[\uDC00-\uDCC4\uDCD0-\uDCD6\uDD00-\uDD4A\uDD50-\uDD59]|\uD83B[\uDE00-\uDE03\uDE05-\uDE1F\uDE21\uDE22\uDE24\uDE27\uDE29-\uDE32\uDE34-\uDE37\uDE39\uDE3B\uDE42\uDE47\uDE49\uDE4B\uDE4D-\uDE4F\uDE51\uDE52\uDE54\uDE57\uDE59\uDE5B\uDE5D\uDE5F\uDE61\uDE62\uDE64\uDE67-\uDE6A\uDE6C-\uDE72\uDE74-\uDE77\uDE79-\uDE7C\uDE7E\uDE80-\uDE89\uDE8B-\uDE9B\uDEA1-\uDEA3\uDEA5-\uDEA9\uDEAB-\uDEBB]|\uD869[\uDC00-\uDED6\uDF00-\uDFFF]|\uD86D[\uDC00-\uDF34\uDF40-\uDFFF]|\uD86E[\uDC00-\uDC1D\uDC20-\uDFFF]|\uD873[\uDC00-\uDEA1]|\uD87E[\uDC00-\uDE1D]|\uDB40[\uDD00-\uDDEF]/
      };

      function isDecimalDigit(ch) {
          return 0x30 <= ch && ch <= 0x39;  // 0..9
      }

      function isHexDigit(ch) {
          return 0x30 <= ch && ch <= 0x39 ||  // 0..9
              0x61 <= ch && ch <= 0x66 ||     // a..f
              0x41 <= ch && ch <= 0x46;       // A..F
      }

      function isOctalDigit(ch) {
          return ch >= 0x30 && ch <= 0x37;  // 0..7
      }

      // 7.2 White Space

      NON_ASCII_WHITESPACES = [
          0x1680,
          0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A,
          0x202F, 0x205F,
          0x3000,
          0xFEFF
      ];

      function isWhiteSpace(ch) {
          return ch === 0x20 || ch === 0x09 || ch === 0x0B || ch === 0x0C || ch === 0xA0 ||
              ch >= 0x1680 && NON_ASCII_WHITESPACES.indexOf(ch) >= 0;
      }

      // 7.3 Line Terminators

      function isLineTerminator(ch) {
          return ch === 0x0A || ch === 0x0D || ch === 0x2028 || ch === 0x2029;
      }

      // 7.6 Identifier Names and Identifiers

      function fromCodePoint(cp) {
          if (cp <= 0xFFFF) { return String.fromCharCode(cp); }
          var cu1 = String.fromCharCode(Math.floor((cp - 0x10000) / 0x400) + 0xD800);
          var cu2 = String.fromCharCode(((cp - 0x10000) % 0x400) + 0xDC00);
          return cu1 + cu2;
      }

      IDENTIFIER_START = new Array(0x80);
      for(ch = 0; ch < 0x80; ++ch) {
          IDENTIFIER_START[ch] =
              ch >= 0x61 && ch <= 0x7A ||  // a..z
              ch >= 0x41 && ch <= 0x5A ||  // A..Z
              ch === 0x24 || ch === 0x5F;  // $ (dollar) and _ (underscore)
      }

      IDENTIFIER_PART = new Array(0x80);
      for(ch = 0; ch < 0x80; ++ch) {
          IDENTIFIER_PART[ch] =
              ch >= 0x61 && ch <= 0x7A ||  // a..z
              ch >= 0x41 && ch <= 0x5A ||  // A..Z
              ch >= 0x30 && ch <= 0x39 ||  // 0..9
              ch === 0x24 || ch === 0x5F;  // $ (dollar) and _ (underscore)
      }

      function isIdentifierStartES5(ch) {
          return ch < 0x80 ? IDENTIFIER_START[ch] : ES5Regex.NonAsciiIdentifierStart.test(fromCodePoint(ch));
      }

      function isIdentifierPartES5(ch) {
          return ch < 0x80 ? IDENTIFIER_PART[ch] : ES5Regex.NonAsciiIdentifierPart.test(fromCodePoint(ch));
      }

      function isIdentifierStartES6(ch) {
          return ch < 0x80 ? IDENTIFIER_START[ch] : ES6Regex.NonAsciiIdentifierStart.test(fromCodePoint(ch));
      }

      function isIdentifierPartES6(ch) {
          return ch < 0x80 ? IDENTIFIER_PART[ch] : ES6Regex.NonAsciiIdentifierPart.test(fromCodePoint(ch));
      }

      module.exports = {
          isDecimalDigit: isDecimalDigit,
          isHexDigit: isHexDigit,
          isOctalDigit: isOctalDigit,
          isWhiteSpace: isWhiteSpace,
          isLineTerminator: isLineTerminator,
          isIdentifierStartES5: isIdentifierStartES5,
          isIdentifierPartES5: isIdentifierPartES5,
          isIdentifierStartES6: isIdentifierStartES6,
          isIdentifierPartES6: isIdentifierPartES6
      };
  }());
  /* vim: set sw=4 ts=4 et tw=80 : */

  },{}],97:[function(require,module,exports){
  /*
    Copyright (C) 2013 Yusuke Suzuki <utatane.tea@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are met:

      * Redistributions of source code must retain the above copyright
        notice, this list of conditions and the following disclaimer.
      * Redistributions in binary form must reproduce the above copyright
        notice, this list of conditions and the following disclaimer in the
        documentation and/or other materials provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
    DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
    (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
    LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
    ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
    THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
  */

  (function () {
      'use strict';

      var code = require('./code');

      function isStrictModeReservedWordES6(id) {
          switch (id) {
          case 'implements':
          case 'interface':
          case 'package':
          case 'private':
          case 'protected':
          case 'public':
          case 'static':
          case 'let':
              return true;
          default:
              return false;
          }
      }

      function isKeywordES5(id, strict) {
          // yield should not be treated as keyword under non-strict mode.
          if (!strict && id === 'yield') {
              return false;
          }
          return isKeywordES6(id, strict);
      }

      function isKeywordES6(id, strict) {
          if (strict && isStrictModeReservedWordES6(id)) {
              return true;
          }

          switch (id.length) {
          case 2:
              return (id === 'if') || (id === 'in') || (id === 'do');
          case 3:
              return (id === 'var') || (id === 'for') || (id === 'new') || (id === 'try');
          case 4:
              return (id === 'this') || (id === 'else') || (id === 'case') ||
                  (id === 'void') || (id === 'with') || (id === 'enum');
          case 5:
              return (id === 'while') || (id === 'break') || (id === 'catch') ||
                  (id === 'throw') || (id === 'const') || (id === 'yield') ||
                  (id === 'class') || (id === 'super');
          case 6:
              return (id === 'return') || (id === 'typeof') || (id === 'delete') ||
                  (id === 'switch') || (id === 'export') || (id === 'import');
          case 7:
              return (id === 'default') || (id === 'finally') || (id === 'extends');
          case 8:
              return (id === 'function') || (id === 'continue') || (id === 'debugger');
          case 10:
              return (id === 'instanceof');
          default:
              return false;
          }
      }

      function isReservedWordES5(id, strict) {
          return id === 'null' || id === 'true' || id === 'false' || isKeywordES5(id, strict);
      }

      function isReservedWordES6(id, strict) {
          return id === 'null' || id === 'true' || id === 'false' || isKeywordES6(id, strict);
      }

      function isRestrictedWord(id) {
          return id === 'eval' || id === 'arguments';
      }

      function isIdentifierNameES5(id) {
          var i, iz, ch;

          if (id.length === 0) { return false; }

          ch = id.charCodeAt(0);
          if (!code.isIdentifierStartES5(ch)) {
              return false;
          }

          for (i = 1, iz = id.length; i < iz; ++i) {
              ch = id.charCodeAt(i);
              if (!code.isIdentifierPartES5(ch)) {
                  return false;
              }
          }
          return true;
      }

      function decodeUtf16(lead, trail) {
          return (lead - 0xD800) * 0x400 + (trail - 0xDC00) + 0x10000;
      }

      function isIdentifierNameES6(id) {
          var i, iz, ch, lowCh, check;

          if (id.length === 0) { return false; }

          check = code.isIdentifierStartES6;
          for (i = 0, iz = id.length; i < iz; ++i) {
              ch = id.charCodeAt(i);
              if (0xD800 <= ch && ch <= 0xDBFF) {
                  ++i;
                  if (i >= iz) { return false; }
                  lowCh = id.charCodeAt(i);
                  if (!(0xDC00 <= lowCh && lowCh <= 0xDFFF)) {
                      return false;
                  }
                  ch = decodeUtf16(ch, lowCh);
              }
              if (!check(ch)) {
                  return false;
              }
              check = code.isIdentifierPartES6;
          }
          return true;
      }

      function isIdentifierES5(id, strict) {
          return isIdentifierNameES5(id) && !isReservedWordES5(id, strict);
      }

      function isIdentifierES6(id, strict) {
          return isIdentifierNameES6(id) && !isReservedWordES6(id, strict);
      }

      module.exports = {
          isKeywordES5: isKeywordES5,
          isKeywordES6: isKeywordES6,
          isReservedWordES5: isReservedWordES5,
          isReservedWordES6: isReservedWordES6,
          isRestrictedWord: isRestrictedWord,
          isIdentifierNameES5: isIdentifierNameES5,
          isIdentifierNameES6: isIdentifierNameES6,
          isIdentifierES5: isIdentifierES5,
          isIdentifierES6: isIdentifierES6
      };
  }());
  /* vim: set sw=4 ts=4 et tw=80 : */

  },{"./code":96}],98:[function(require,module,exports){
  /*
    Copyright (C) 2013 Yusuke Suzuki <utatane.tea@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are met:

      * Redistributions of source code must retain the above copyright
        notice, this list of conditions and the following disclaimer.
      * Redistributions in binary form must reproduce the above copyright
        notice, this list of conditions and the following disclaimer in the
        documentation and/or other materials provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
    DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
    (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
    LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
    ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
    THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
  */


  (function () {
      'use strict';

      exports.ast = require('./ast');
      exports.code = require('./code');
      exports.keyword = require('./keyword');
  }());
  /* vim: set sw=4 ts=4 et tw=80 : */

  },{"./ast":95,"./code":96,"./keyword":97}],99:[function(require,module,exports){
  'use strict';

  var d        = require('d')
    , callable = require('es5-ext/object/valid-callable')

    , apply = Function.prototype.apply, call = Function.prototype.call
    , create = Object.create, defineProperty = Object.defineProperty
    , defineProperties = Object.defineProperties
    , hasOwnProperty = Object.prototype.hasOwnProperty
    , descriptor = { configurable: true, enumerable: false, writable: true }

    , on, once, off, emit, methods, descriptors, base;

  on = function (type, listener) {
    var data;

    callable(listener);

    if (!hasOwnProperty.call(this, '__ee__')) {
      data = descriptor.value = create(null);
      defineProperty(this, '__ee__', descriptor);
      descriptor.value = null;
    } else {
      data = this.__ee__;
    }
    if (!data[type]) data[type] = listener;
    else if (typeof data[type] === 'object') data[type].push(listener);
    else data[type] = [data[type], listener];

    return this;
  };

  once = function (type, listener) {
    var once, self;

    callable(listener);
    self = this;
    on.call(this, type, once = function () {
      off.call(self, type, once);
      apply.call(listener, this, arguments);
    });

    once.__eeOnceListener__ = listener;
    return this;
  };

  off = function (type, listener) {
    var data, listeners, candidate, i;

    callable(listener);

    if (!hasOwnProperty.call(this, '__ee__')) return this;
    data = this.__ee__;
    if (!data[type]) return this;
    listeners = data[type];

    if (typeof listeners === 'object') {
      for (i = 0; (candidate = listeners[i]); ++i) {
        if ((candidate === listener) ||
            (candidate.__eeOnceListener__ === listener)) {
          if (listeners.length === 2) data[type] = listeners[i ? 0 : 1];
          else listeners.splice(i, 1);
        }
      }
    } else {
      if ((listeners === listener) ||
          (listeners.__eeOnceListener__ === listener)) {
        delete data[type];
      }
    }

    return this;
  };

  emit = function (type) {
    var i, l, listener, listeners, args;

    if (!hasOwnProperty.call(this, '__ee__')) return;
    listeners = this.__ee__[type];
    if (!listeners) return;

    if (typeof listeners === 'object') {
      l = arguments.length;
      args = new Array(l - 1);
      for (i = 1; i < l; ++i) args[i - 1] = arguments[i];

      listeners = listeners.slice();
      for (i = 0; (listener = listeners[i]); ++i) {
        apply.call(listener, this, args);
      }
    } else {
      switch (arguments.length) {
      case 1:
        call.call(listeners, this);
        break;
      case 2:
        call.call(listeners, this, arguments[1]);
        break;
      case 3:
        call.call(listeners, this, arguments[1], arguments[2]);
        break;
      default:
        l = arguments.length;
        args = new Array(l - 1);
        for (i = 1; i < l; ++i) {
          args[i - 1] = arguments[i];
        }
        apply.call(listeners, this, args);
      }
    }
  };

  methods = {
    on: on,
    once: once,
    off: off,
    emit: emit
  };

  descriptors = {
    on: d(on),
    once: d(once),
    off: d(off),
    emit: d(emit)
  };

  base = defineProperties({}, descriptors);

  module.exports = exports = function (o) {
    return (o == null) ? create(base) : defineProperties(Object(o), descriptors);
  };
  exports.methods = methods;

  },{"d":6,"es5-ext/object/valid-callable":42}],100:[function(require,module,exports){
  /* -*- Mode: js; js-indent-level: 2; -*- */
  /*
   * Copyright 2011 Mozilla Foundation and contributors
   * Licensed under the New BSD license. See LICENSE or:
   * http://opensource.org/licenses/BSD-3-Clause
   */

  var util = require('./util');
  var has = Object.prototype.hasOwnProperty;
  var hasNativeMap = typeof Map !== "undefined";

  /**
   * A data structure which is a combination of an array and a set. Adding a new
   * member is O(1), testing for membership is O(1), and finding the index of an
   * element is O(1). Removing elements from the set is not supported. Only
   * strings are supported for membership.
   */
  function ArraySet() {
    this._array = [];
    this._set = hasNativeMap ? new Map() : Object.create(null);
  }

  /**
   * Static method for creating ArraySet instances from an existing array.
   */
  ArraySet.fromArray = function ArraySet_fromArray(aArray, aAllowDuplicates) {
    var set = new ArraySet();
    for (var i = 0, len = aArray.length; i < len; i++) {
      set.add(aArray[i], aAllowDuplicates);
    }
    return set;
  };

  /**
   * Return how many unique items are in this ArraySet. If duplicates have been
   * added, than those do not count towards the size.
   *
   * @returns Number
   */
  ArraySet.prototype.size = function ArraySet_size() {
    return hasNativeMap ? this._set.size : Object.getOwnPropertyNames(this._set).length;
  };

  /**
   * Add the given string to this set.
   *
   * @param String aStr
   */
  ArraySet.prototype.add = function ArraySet_add(aStr, aAllowDuplicates) {
    var sStr = hasNativeMap ? aStr : util.toSetString(aStr);
    var isDuplicate = hasNativeMap ? this.has(aStr) : has.call(this._set, sStr);
    var idx = this._array.length;
    if (!isDuplicate || aAllowDuplicates) {
      this._array.push(aStr);
    }
    if (!isDuplicate) {
      if (hasNativeMap) {
        this._set.set(aStr, idx);
      } else {
        this._set[sStr] = idx;
      }
    }
  };

  /**
   * Is the given string a member of this set?
   *
   * @param String aStr
   */
  ArraySet.prototype.has = function ArraySet_has(aStr) {
    if (hasNativeMap) {
      return this._set.has(aStr);
    } else {
      var sStr = util.toSetString(aStr);
      return has.call(this._set, sStr);
    }
  };

  /**
   * What is the index of the given string in the array?
   *
   * @param String aStr
   */
  ArraySet.prototype.indexOf = function ArraySet_indexOf(aStr) {
    if (hasNativeMap) {
      var idx = this._set.get(aStr);
      if (idx >= 0) {
          return idx;
      }
    } else {
      var sStr = util.toSetString(aStr);
      if (has.call(this._set, sStr)) {
        return this._set[sStr];
      }
    }

    throw new Error('"' + aStr + '" is not in the set.');
  };

  /**
   * What is the element at the given index?
   *
   * @param Number aIdx
   */
  ArraySet.prototype.at = function ArraySet_at(aIdx) {
    if (aIdx >= 0 && aIdx < this._array.length) {
      return this._array[aIdx];
    }
    throw new Error('No element indexed by ' + aIdx);
  };

  /**
   * Returns the array representation of this set (which has the proper indices
   * indicated by indexOf). Note that this is a copy of the internal array used
   * for storing the members so that no one can mess with internal state.
   */
  ArraySet.prototype.toArray = function ArraySet_toArray() {
    return this._array.slice();
  };

  exports.ArraySet = ArraySet;

  },{"./util":109}],101:[function(require,module,exports){
  /* -*- Mode: js; js-indent-level: 2; -*- */
  /*
   * Copyright 2011 Mozilla Foundation and contributors
   * Licensed under the New BSD license. See LICENSE or:
   * http://opensource.org/licenses/BSD-3-Clause
   *
   * Based on the Base 64 VLQ implementation in Closure Compiler:
   * https://code.google.com/p/closure-compiler/source/browse/trunk/src/com/google/debugging/sourcemap/Base64VLQ.java
   *
   * Copyright 2011 The Closure Compiler Authors. All rights reserved.
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are
   * met:
   *
   *  * Redistributions of source code must retain the above copyright
   *    notice, this list of conditions and the following disclaimer.
   *  * Redistributions in binary form must reproduce the above
   *    copyright notice, this list of conditions and the following
   *    disclaimer in the documentation and/or other materials provided
   *    with the distribution.
   *  * Neither the name of Google Inc. nor the names of its
   *    contributors may be used to endorse or promote products derived
   *    from this software without specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
   * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
   * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
   * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
   * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
   * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
   * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
   * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
   * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
   * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */

  var base64 = require('./base64');

  // A single base 64 digit can contain 6 bits of data. For the base 64 variable
  // length quantities we use in the source map spec, the first bit is the sign,
  // the next four bits are the actual value, and the 6th bit is the
  // continuation bit. The continuation bit tells us whether there are more
  // digits in this value following this digit.
  //
  //   Continuation
  //   |    Sign
  //   |    |
  //   V    V
  //   101011

  var VLQ_BASE_SHIFT = 5;

  // binary: 100000
  var VLQ_BASE = 1 << VLQ_BASE_SHIFT;

  // binary: 011111
  var VLQ_BASE_MASK = VLQ_BASE - 1;

  // binary: 100000
  var VLQ_CONTINUATION_BIT = VLQ_BASE;

  /**
   * Converts from a two-complement value to a value where the sign bit is
   * placed in the least significant bit.  For example, as decimals:
   *   1 becomes 2 (10 binary), -1 becomes 3 (11 binary)
   *   2 becomes 4 (100 binary), -2 becomes 5 (101 binary)
   */
  function toVLQSigned(aValue) {
    return aValue < 0
      ? ((-aValue) << 1) + 1
      : (aValue << 1) + 0;
  }

  /**
   * Converts to a two-complement value from a value where the sign bit is
   * placed in the least significant bit.  For example, as decimals:
   *   2 (10 binary) becomes 1, 3 (11 binary) becomes -1
   *   4 (100 binary) becomes 2, 5 (101 binary) becomes -2
   */
  function fromVLQSigned(aValue) {
    var isNegative = (aValue & 1) === 1;
    var shifted = aValue >> 1;
    return isNegative
      ? -shifted
      : shifted;
  }

  /**
   * Returns the base 64 VLQ encoded value.
   */
  exports.encode = function base64VLQ_encode(aValue) {
    var encoded = "";
    var digit;

    var vlq = toVLQSigned(aValue);

    do {
      digit = vlq & VLQ_BASE_MASK;
      vlq >>>= VLQ_BASE_SHIFT;
      if (vlq > 0) {
        // There are still more digits in this value, so we must make sure the
        // continuation bit is marked.
        digit |= VLQ_CONTINUATION_BIT;
      }
      encoded += base64.encode(digit);
    } while (vlq > 0);

    return encoded;
  };

  /**
   * Decodes the next base 64 VLQ value from the given string and returns the
   * value and the rest of the string via the out parameter.
   */
  exports.decode = function base64VLQ_decode(aStr, aIndex, aOutParam) {
    var strLen = aStr.length;
    var result = 0;
    var shift = 0;
    var continuation, digit;

    do {
      if (aIndex >= strLen) {
        throw new Error("Expected more digits in base 64 VLQ value.");
      }

      digit = base64.decode(aStr.charCodeAt(aIndex++));
      if (digit === -1) {
        throw new Error("Invalid base64 digit: " + aStr.charAt(aIndex - 1));
      }

      continuation = !!(digit & VLQ_CONTINUATION_BIT);
      digit &= VLQ_BASE_MASK;
      result = result + (digit << shift);
      shift += VLQ_BASE_SHIFT;
    } while (continuation);

    aOutParam.value = fromVLQSigned(result);
    aOutParam.rest = aIndex;
  };

  },{"./base64":102}],102:[function(require,module,exports){
  /* -*- Mode: js; js-indent-level: 2; -*- */
  /*
   * Copyright 2011 Mozilla Foundation and contributors
   * Licensed under the New BSD license. See LICENSE or:
   * http://opensource.org/licenses/BSD-3-Clause
   */

  var intToCharMap = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('');

  /**
   * Encode an integer in the range of 0 to 63 to a single base 64 digit.
   */
  exports.encode = function (number) {
    if (0 <= number && number < intToCharMap.length) {
      return intToCharMap[number];
    }
    throw new TypeError("Must be between 0 and 63: " + number);
  };

  /**
   * Decode a single base 64 character code digit to an integer. Returns -1 on
   * failure.
   */
  exports.decode = function (charCode) {
    var bigA = 65;     // 'A'
    var bigZ = 90;     // 'Z'

    var littleA = 97;  // 'a'
    var littleZ = 122; // 'z'

    var zero = 48;     // '0'
    var nine = 57;     // '9'

    var plus = 43;     // '+'
    var slash = 47;    // '/'

    var littleOffset = 26;
    var numberOffset = 52;

    // 0 - 25: ABCDEFGHIJKLMNOPQRSTUVWXYZ
    if (bigA <= charCode && charCode <= bigZ) {
      return (charCode - bigA);
    }

    // 26 - 51: abcdefghijklmnopqrstuvwxyz
    if (littleA <= charCode && charCode <= littleZ) {
      return (charCode - littleA + littleOffset);
    }

    // 52 - 61: 0123456789
    if (zero <= charCode && charCode <= nine) {
      return (charCode - zero + numberOffset);
    }

    // 62: +
    if (charCode == plus) {
      return 62;
    }

    // 63: /
    if (charCode == slash) {
      return 63;
    }

    // Invalid base64 digit.
    return -1;
  };

  },{}],103:[function(require,module,exports){
  /* -*- Mode: js; js-indent-level: 2; -*- */
  /*
   * Copyright 2011 Mozilla Foundation and contributors
   * Licensed under the New BSD license. See LICENSE or:
   * http://opensource.org/licenses/BSD-3-Clause
   */

  exports.GREATEST_LOWER_BOUND = 1;
  exports.LEAST_UPPER_BOUND = 2;

  /**
   * Recursive implementation of binary search.
   *
   * @param aLow Indices here and lower do not contain the needle.
   * @param aHigh Indices here and higher do not contain the needle.
   * @param aNeedle The element being searched for.
   * @param aHaystack The non-empty array being searched.
   * @param aCompare Function which takes two elements and returns -1, 0, or 1.
   * @param aBias Either 'binarySearch.GREATEST_LOWER_BOUND' or
   *     'binarySearch.LEAST_UPPER_BOUND'. Specifies whether to return the
   *     closest element that is smaller than or greater than the one we are
   *     searching for, respectively, if the exact element cannot be found.
   */
  function recursiveSearch(aLow, aHigh, aNeedle, aHaystack, aCompare, aBias) {
    // This function terminates when one of the following is true:
    //
    //   1. We find the exact element we are looking for.
    //
    //   2. We did not find the exact element, but we can return the index of
    //      the next-closest element.
    //
    //   3. We did not find the exact element, and there is no next-closest
    //      element than the one we are searching for, so we return -1.
    var mid = Math.floor((aHigh - aLow) / 2) + aLow;
    var cmp = aCompare(aNeedle, aHaystack[mid], true);
    if (cmp === 0) {
      // Found the element we are looking for.
      return mid;
    }
    else if (cmp > 0) {
      // Our needle is greater than aHaystack[mid].
      if (aHigh - mid > 1) {
        // The element is in the upper half.
        return recursiveSearch(mid, aHigh, aNeedle, aHaystack, aCompare, aBias);
      }

      // The exact needle element was not found in this haystack. Determine if
      // we are in termination case (3) or (2) and return the appropriate thing.
      if (aBias == exports.LEAST_UPPER_BOUND) {
        return aHigh < aHaystack.length ? aHigh : -1;
      } else {
        return mid;
      }
    }
    else {
      // Our needle is less than aHaystack[mid].
      if (mid - aLow > 1) {
        // The element is in the lower half.
        return recursiveSearch(aLow, mid, aNeedle, aHaystack, aCompare, aBias);
      }

      // we are in termination case (3) or (2) and return the appropriate thing.
      if (aBias == exports.LEAST_UPPER_BOUND) {
        return mid;
      } else {
        return aLow < 0 ? -1 : aLow;
      }
    }
  }

  /**
   * This is an implementation of binary search which will always try and return
   * the index of the closest element if there is no exact hit. This is because
   * mappings between original and generated line/col pairs are single points,
   * and there is an implicit region between each of them, so a miss just means
   * that you aren't on the very start of a region.
   *
   * @param aNeedle The element you are looking for.
   * @param aHaystack The array that is being searched.
   * @param aCompare A function which takes the needle and an element in the
   *     array and returns -1, 0, or 1 depending on whether the needle is less
   *     than, equal to, or greater than the element, respectively.
   * @param aBias Either 'binarySearch.GREATEST_LOWER_BOUND' or
   *     'binarySearch.LEAST_UPPER_BOUND'. Specifies whether to return the
   *     closest element that is smaller than or greater than the one we are
   *     searching for, respectively, if the exact element cannot be found.
   *     Defaults to 'binarySearch.GREATEST_LOWER_BOUND'.
   */
  exports.search = function search(aNeedle, aHaystack, aCompare, aBias) {
    if (aHaystack.length === 0) {
      return -1;
    }

    var index = recursiveSearch(-1, aHaystack.length, aNeedle, aHaystack,
                                aCompare, aBias || exports.GREATEST_LOWER_BOUND);
    if (index < 0) {
      return -1;
    }

    // We have found either the exact element, or the next-closest element than
    // the one we are searching for. However, there may be more than one such
    // element. Make sure we always return the smallest of these.
    while (index - 1 >= 0) {
      if (aCompare(aHaystack[index], aHaystack[index - 1], true) !== 0) {
        break;
      }
      --index;
    }

    return index;
  };

  },{}],104:[function(require,module,exports){
  /* -*- Mode: js; js-indent-level: 2; -*- */
  /*
   * Copyright 2014 Mozilla Foundation and contributors
   * Licensed under the New BSD license. See LICENSE or:
   * http://opensource.org/licenses/BSD-3-Clause
   */

  var util = require('./util');

  /**
   * Determine whether mappingB is after mappingA with respect to generated
   * position.
   */
  function generatedPositionAfter(mappingA, mappingB) {
    // Optimized for most common case
    var lineA = mappingA.generatedLine;
    var lineB = mappingB.generatedLine;
    var columnA = mappingA.generatedColumn;
    var columnB = mappingB.generatedColumn;
    return lineB > lineA || lineB == lineA && columnB >= columnA ||
           util.compareByGeneratedPositionsInflated(mappingA, mappingB) <= 0;
  }

  /**
   * A data structure to provide a sorted view of accumulated mappings in a
   * performance conscious manner. It trades a neglibable overhead in general
   * case for a large speedup in case of mappings being added in order.
   */
  function MappingList() {
    this._array = [];
    this._sorted = true;
    // Serves as infimum
    this._last = {generatedLine: -1, generatedColumn: 0};
  }

  /**
   * Iterate through internal items. This method takes the same arguments that
   * `Array.prototype.forEach` takes.
   *
   * NOTE: The order of the mappings is NOT guaranteed.
   */
  MappingList.prototype.unsortedForEach =
    function MappingList_forEach(aCallback, aThisArg) {
      this._array.forEach(aCallback, aThisArg);
    };

  /**
   * Add the given source mapping.
   *
   * @param Object aMapping
   */
  MappingList.prototype.add = function MappingList_add(aMapping) {
    if (generatedPositionAfter(this._last, aMapping)) {
      this._last = aMapping;
      this._array.push(aMapping);
    } else {
      this._sorted = false;
      this._array.push(aMapping);
    }
  };

  /**
   * Returns the flat, sorted array of mappings. The mappings are sorted by
   * generated position.
   *
   * WARNING: This method returns internal data without copying, for
   * performance. The return value must NOT be mutated, and should be treated as
   * an immutable borrow. If you want to take ownership, you must make your own
   * copy.
   */
  MappingList.prototype.toArray = function MappingList_toArray() {
    if (!this._sorted) {
      this._array.sort(util.compareByGeneratedPositionsInflated);
      this._sorted = true;
    }
    return this._array;
  };

  exports.MappingList = MappingList;

  },{"./util":109}],105:[function(require,module,exports){
  /* -*- Mode: js; js-indent-level: 2; -*- */
  /*
   * Copyright 2011 Mozilla Foundation and contributors
   * Licensed under the New BSD license. See LICENSE or:
   * http://opensource.org/licenses/BSD-3-Clause
   */

  // It turns out that some (most?) JavaScript engines don't self-host
  // `Array.prototype.sort`. This makes sense because C++ will likely remain
  // faster than JS when doing raw CPU-intensive sorting. However, when using a
  // custom comparator function, calling back and forth between the VM's C++ and
  // JIT'd JS is rather slow *and* loses JIT type information, resulting in
  // worse generated code for the comparator function than would be optimal. In
  // fact, when sorting with a comparator, these costs outweigh the benefits of
  // sorting in C++. By using our own JS-implemented Quick Sort (below), we get
  // a ~3500ms mean speed-up in `bench/bench.html`.

  /**
   * Swap the elements indexed by `x` and `y` in the array `ary`.
   *
   * @param {Array} ary
   *        The array.
   * @param {Number} x
   *        The index of the first item.
   * @param {Number} y
   *        The index of the second item.
   */
  function swap(ary, x, y) {
    var temp = ary[x];
    ary[x] = ary[y];
    ary[y] = temp;
  }

  /**
   * Returns a random integer within the range `low .. high` inclusive.
   *
   * @param {Number} low
   *        The lower bound on the range.
   * @param {Number} high
   *        The upper bound on the range.
   */
  function randomIntInRange(low, high) {
    return Math.round(low + (Math.random() * (high - low)));
  }

  /**
   * The Quick Sort algorithm.
   *
   * @param {Array} ary
   *        An array to sort.
   * @param {function} comparator
   *        Function to use to compare two items.
   * @param {Number} p
   *        Start index of the array
   * @param {Number} r
   *        End index of the array
   */
  function doQuickSort(ary, comparator, p, r) {
    // If our lower bound is less than our upper bound, we (1) partition the
    // array into two pieces and (2) recurse on each half. If it is not, this is
    // the empty array and our base case.

    if (p < r) {
      // (1) Partitioning.
      //
      // The partitioning chooses a pivot between `p` and `r` and moves all
      // elements that are less than or equal to the pivot to the before it, and
      // all the elements that are greater than it after it. The effect is that
      // once partition is done, the pivot is in the exact place it will be when
      // the array is put in sorted order, and it will not need to be moved
      // again. This runs in O(n) time.

      // Always choose a random pivot so that an input array which is reverse
      // sorted does not cause O(n^2) running time.
      var pivotIndex = randomIntInRange(p, r);
      var i = p - 1;

      swap(ary, pivotIndex, r);
      var pivot = ary[r];

      // Immediately after `j` is incremented in this loop, the following hold
      // true:
      //
      //   * Every element in `ary[p .. i]` is less than or equal to the pivot.
      //
      //   * Every element in `ary[i+1 .. j-1]` is greater than the pivot.
      for (var j = p; j < r; j++) {
        if (comparator(ary[j], pivot) <= 0) {
          i += 1;
          swap(ary, i, j);
        }
      }

      swap(ary, i + 1, j);
      var q = i + 1;

      // (2) Recurse on each half.

      doQuickSort(ary, comparator, p, q - 1);
      doQuickSort(ary, comparator, q + 1, r);
    }
  }

  /**
   * Sort the given array in-place with the given comparator function.
   *
   * @param {Array} ary
   *        An array to sort.
   * @param {function} comparator
   *        Function to use to compare two items.
   */
  exports.quickSort = function (ary, comparator) {
    doQuickSort(ary, comparator, 0, ary.length - 1);
  };

  },{}],106:[function(require,module,exports){
  /* -*- Mode: js; js-indent-level: 2; -*- */
  /*
   * Copyright 2011 Mozilla Foundation and contributors
   * Licensed under the New BSD license. See LICENSE or:
   * http://opensource.org/licenses/BSD-3-Clause
   */

  var util = require('./util');
  var binarySearch = require('./binary-search');
  var ArraySet = require('./array-set').ArraySet;
  var base64VLQ = require('./base64-vlq');
  var quickSort = require('./quick-sort').quickSort;

  function SourceMapConsumer(aSourceMap, aSourceMapURL) {
    var sourceMap = aSourceMap;
    if (typeof aSourceMap === 'string') {
      sourceMap = util.parseSourceMapInput(aSourceMap);
    }

    return sourceMap.sections != null
      ? new IndexedSourceMapConsumer(sourceMap, aSourceMapURL)
      : new BasicSourceMapConsumer(sourceMap, aSourceMapURL);
  }

  SourceMapConsumer.fromSourceMap = function(aSourceMap, aSourceMapURL) {
    return BasicSourceMapConsumer.fromSourceMap(aSourceMap, aSourceMapURL);
  }

  /**
   * The version of the source mapping spec that we are consuming.
   */
  SourceMapConsumer.prototype._version = 3;

  // `__generatedMappings` and `__originalMappings` are arrays that hold the
  // parsed mapping coordinates from the source map's "mappings" attribute. They
  // are lazily instantiated, accessed via the `_generatedMappings` and
  // `_originalMappings` getters respectively, and we only parse the mappings
  // and create these arrays once queried for a source location. We jump through
  // these hoops because there can be many thousands of mappings, and parsing
  // them is expensive, so we only want to do it if we must.
  //
  // Each object in the arrays is of the form:
  //
  //     {
  //       generatedLine: The line number in the generated code,
  //       generatedColumn: The column number in the generated code,
  //       source: The path to the original source file that generated this
  //               chunk of code,
  //       originalLine: The line number in the original source that
  //                     corresponds to this chunk of generated code,
  //       originalColumn: The column number in the original source that
  //                       corresponds to this chunk of generated code,
  //       name: The name of the original symbol which generated this chunk of
  //             code.
  //     }
  //
  // All properties except for `generatedLine` and `generatedColumn` can be
  // `null`.
  //
  // `_generatedMappings` is ordered by the generated positions.
  //
  // `_originalMappings` is ordered by the original positions.

  SourceMapConsumer.prototype.__generatedMappings = null;
  Object.defineProperty(SourceMapConsumer.prototype, '_generatedMappings', {
    configurable: true,
    enumerable: true,
    get: function () {
      if (!this.__generatedMappings) {
        this._parseMappings(this._mappings, this.sourceRoot);
      }

      return this.__generatedMappings;
    }
  });

  SourceMapConsumer.prototype.__originalMappings = null;
  Object.defineProperty(SourceMapConsumer.prototype, '_originalMappings', {
    configurable: true,
    enumerable: true,
    get: function () {
      if (!this.__originalMappings) {
        this._parseMappings(this._mappings, this.sourceRoot);
      }

      return this.__originalMappings;
    }
  });

  SourceMapConsumer.prototype._charIsMappingSeparator =
    function SourceMapConsumer_charIsMappingSeparator(aStr, index) {
      var c = aStr.charAt(index);
      return c === ";" || c === ",";
    };

  /**
   * Parse the mappings in a string in to a data structure which we can easily
   * query (the ordered arrays in the `this.__generatedMappings` and
   * `this.__originalMappings` properties).
   */
  SourceMapConsumer.prototype._parseMappings =
    function SourceMapConsumer_parseMappings(aStr, aSourceRoot) {
      throw new Error("Subclasses must implement _parseMappings");
    };

  SourceMapConsumer.GENERATED_ORDER = 1;
  SourceMapConsumer.ORIGINAL_ORDER = 2;

  SourceMapConsumer.GREATEST_LOWER_BOUND = 1;
  SourceMapConsumer.LEAST_UPPER_BOUND = 2;

  /**
   * Iterate over each mapping between an original source/line/column and a
   * generated line/column in this source map.
   *
   * @param Function aCallback
   *        The function that is called with each mapping.
   * @param Object aContext
   *        Optional. If specified, this object will be the value of `this` every
   *        time that `aCallback` is called.
   * @param aOrder
   *        Either `SourceMapConsumer.GENERATED_ORDER` or
   *        `SourceMapConsumer.ORIGINAL_ORDER`. Specifies whether you want to
   *        iterate over the mappings sorted by the generated file's line/column
   *        order or the original's source/line/column order, respectively. Defaults to
   *        `SourceMapConsumer.GENERATED_ORDER`.
   */
  SourceMapConsumer.prototype.eachMapping =
    function SourceMapConsumer_eachMapping(aCallback, aContext, aOrder) {
      var context = aContext || null;
      var order = aOrder || SourceMapConsumer.GENERATED_ORDER;

      var mappings;
      switch (order) {
      case SourceMapConsumer.GENERATED_ORDER:
        mappings = this._generatedMappings;
        break;
      case SourceMapConsumer.ORIGINAL_ORDER:
        mappings = this._originalMappings;
        break;
      default:
        throw new Error("Unknown order of iteration.");
      }

      var sourceRoot = this.sourceRoot;
      mappings.map(function (mapping) {
        var source = mapping.source === null ? null : this._sources.at(mapping.source);
        source = util.computeSourceURL(sourceRoot, source, this._sourceMapURL);
        return {
          source: source,
          generatedLine: mapping.generatedLine,
          generatedColumn: mapping.generatedColumn,
          originalLine: mapping.originalLine,
          originalColumn: mapping.originalColumn,
          name: mapping.name === null ? null : this._names.at(mapping.name)
        };
      }, this).forEach(aCallback, context);
    };

  /**
   * Returns all generated line and column information for the original source,
   * line, and column provided. If no column is provided, returns all mappings
   * corresponding to a either the line we are searching for or the next
   * closest line that has any mappings. Otherwise, returns all mappings
   * corresponding to the given line and either the column we are searching for
   * or the next closest column that has any offsets.
   *
   * The only argument is an object with the following properties:
   *
   *   - source: The filename of the original source.
   *   - line: The line number in the original source.  The line number is 1-based.
   *   - column: Optional. the column number in the original source.
   *    The column number is 0-based.
   *
   * and an array of objects is returned, each with the following properties:
   *
   *   - line: The line number in the generated source, or null.  The
   *    line number is 1-based.
   *   - column: The column number in the generated source, or null.
   *    The column number is 0-based.
   */
  SourceMapConsumer.prototype.allGeneratedPositionsFor =
    function SourceMapConsumer_allGeneratedPositionsFor(aArgs) {
      var line = util.getArg(aArgs, 'line');

      // When there is no exact match, BasicSourceMapConsumer.prototype._findMapping
      // returns the index of the closest mapping less than the needle. By
      // setting needle.originalColumn to 0, we thus find the last mapping for
      // the given line, provided such a mapping exists.
      var needle = {
        source: util.getArg(aArgs, 'source'),
        originalLine: line,
        originalColumn: util.getArg(aArgs, 'column', 0)
      };

      needle.source = this._findSourceIndex(needle.source);
      if (needle.source < 0) {
        return [];
      }

      var mappings = [];

      var index = this._findMapping(needle,
                                    this._originalMappings,
                                    "originalLine",
                                    "originalColumn",
                                    util.compareByOriginalPositions,
                                    binarySearch.LEAST_UPPER_BOUND);
      if (index >= 0) {
        var mapping = this._originalMappings[index];

        if (aArgs.column === undefined) {
          var originalLine = mapping.originalLine;

          // Iterate until either we run out of mappings, or we run into
          // a mapping for a different line than the one we found. Since
          // mappings are sorted, this is guaranteed to find all mappings for
          // the line we found.
          while (mapping && mapping.originalLine === originalLine) {
            mappings.push({
              line: util.getArg(mapping, 'generatedLine', null),
              column: util.getArg(mapping, 'generatedColumn', null),
              lastColumn: util.getArg(mapping, 'lastGeneratedColumn', null)
            });

            mapping = this._originalMappings[++index];
          }
        } else {
          var originalColumn = mapping.originalColumn;

          // Iterate until either we run out of mappings, or we run into
          // a mapping for a different line than the one we were searching for.
          // Since mappings are sorted, this is guaranteed to find all mappings for
          // the line we are searching for.
          while (mapping &&
                 mapping.originalLine === line &&
                 mapping.originalColumn == originalColumn) {
            mappings.push({
              line: util.getArg(mapping, 'generatedLine', null),
              column: util.getArg(mapping, 'generatedColumn', null),
              lastColumn: util.getArg(mapping, 'lastGeneratedColumn', null)
            });

            mapping = this._originalMappings[++index];
          }
        }
      }

      return mappings;
    };

  exports.SourceMapConsumer = SourceMapConsumer;

  /**
   * A BasicSourceMapConsumer instance represents a parsed source map which we can
   * query for information about the original file positions by giving it a file
   * position in the generated source.
   *
   * The first parameter is the raw source map (either as a JSON string, or
   * already parsed to an object). According to the spec, source maps have the
   * following attributes:
   *
   *   - version: Which version of the source map spec this map is following.
   *   - sources: An array of URLs to the original source files.
   *   - names: An array of identifiers which can be referrenced by individual mappings.
   *   - sourceRoot: Optional. The URL root from which all sources are relative.
   *   - sourcesContent: Optional. An array of contents of the original source files.
   *   - mappings: A string of base64 VLQs which contain the actual mappings.
   *   - file: Optional. The generated file this source map is associated with.
   *
   * Here is an example source map, taken from the source map spec[0]:
   *
   *     {
   *       version : 3,
   *       file: "out.js",
   *       sourceRoot : "",
   *       sources: ["foo.js", "bar.js"],
   *       names: ["src", "maps", "are", "fun"],
   *       mappings: "AA,AB;;ABCDE;"
   *     }
   *
   * The second parameter, if given, is a string whose value is the URL
   * at which the source map was found.  This URL is used to compute the
   * sources array.
   *
   * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit?pli=1#
   */
  function BasicSourceMapConsumer(aSourceMap, aSourceMapURL) {
    var sourceMap = aSourceMap;
    if (typeof aSourceMap === 'string') {
      sourceMap = util.parseSourceMapInput(aSourceMap);
    }

    var version = util.getArg(sourceMap, 'version');
    var sources = util.getArg(sourceMap, 'sources');
    // Sass 3.3 leaves out the 'names' array, so we deviate from the spec (which
    // requires the array) to play nice here.
    var names = util.getArg(sourceMap, 'names', []);
    var sourceRoot = util.getArg(sourceMap, 'sourceRoot', null);
    var sourcesContent = util.getArg(sourceMap, 'sourcesContent', null);
    var mappings = util.getArg(sourceMap, 'mappings');
    var file = util.getArg(sourceMap, 'file', null);

    // Once again, Sass deviates from the spec and supplies the version as a
    // string rather than a number, so we use loose equality checking here.
    if (version != this._version) {
      throw new Error('Unsupported version: ' + version);
    }

    if (sourceRoot) {
      sourceRoot = util.normalize(sourceRoot);
    }

    sources = sources
      .map(String)
      // Some source maps produce relative source paths like "./foo.js" instead of
      // "foo.js".  Normalize these first so that future comparisons will succeed.
      // See bugzil.la/1090768.
      .map(util.normalize)
      // Always ensure that absolute sources are internally stored relative to
      // the source root, if the source root is absolute. Not doing this would
      // be particularly problematic when the source root is a prefix of the
      // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
      .map(function (source) {
        return sourceRoot && util.isAbsolute(sourceRoot) && util.isAbsolute(source)
          ? util.relative(sourceRoot, source)
          : source;
      });

    // Pass `true` below to allow duplicate names and sources. While source maps
    // are intended to be compressed and deduplicated, the TypeScript compiler
    // sometimes generates source maps with duplicates in them. See Github issue
    // #72 and bugzil.la/889492.
    this._names = ArraySet.fromArray(names.map(String), true);
    this._sources = ArraySet.fromArray(sources, true);

    this._absoluteSources = this._sources.toArray().map(function (s) {
      return util.computeSourceURL(sourceRoot, s, aSourceMapURL);
    });

    this.sourceRoot = sourceRoot;
    this.sourcesContent = sourcesContent;
    this._mappings = mappings;
    this._sourceMapURL = aSourceMapURL;
    this.file = file;
  }

  BasicSourceMapConsumer.prototype = Object.create(SourceMapConsumer.prototype);
  BasicSourceMapConsumer.prototype.consumer = SourceMapConsumer;

  /**
   * Utility function to find the index of a source.  Returns -1 if not
   * found.
   */
  BasicSourceMapConsumer.prototype._findSourceIndex = function(aSource) {
    var relativeSource = aSource;
    if (this.sourceRoot != null) {
      relativeSource = util.relative(this.sourceRoot, relativeSource);
    }

    if (this._sources.has(relativeSource)) {
      return this._sources.indexOf(relativeSource);
    }

    // Maybe aSource is an absolute URL as returned by |sources|.  In
    // this case we can't simply undo the transform.
    var i;
    for (i = 0; i < this._absoluteSources.length; ++i) {
      if (this._absoluteSources[i] == aSource) {
        return i;
      }
    }

    return -1;
  };

  /**
   * Create a BasicSourceMapConsumer from a SourceMapGenerator.
   *
   * @param SourceMapGenerator aSourceMap
   *        The source map that will be consumed.
   * @param String aSourceMapURL
   *        The URL at which the source map can be found (optional)
   * @returns BasicSourceMapConsumer
   */
  BasicSourceMapConsumer.fromSourceMap =
    function SourceMapConsumer_fromSourceMap(aSourceMap, aSourceMapURL) {
      var smc = Object.create(BasicSourceMapConsumer.prototype);

      var names = smc._names = ArraySet.fromArray(aSourceMap._names.toArray(), true);
      var sources = smc._sources = ArraySet.fromArray(aSourceMap._sources.toArray(), true);
      smc.sourceRoot = aSourceMap._sourceRoot;
      smc.sourcesContent = aSourceMap._generateSourcesContent(smc._sources.toArray(),
                                                              smc.sourceRoot);
      smc.file = aSourceMap._file;
      smc._sourceMapURL = aSourceMapURL;
      smc._absoluteSources = smc._sources.toArray().map(function (s) {
        return util.computeSourceURL(smc.sourceRoot, s, aSourceMapURL);
      });

      // Because we are modifying the entries (by converting string sources and
      // names to indices into the sources and names ArraySets), we have to make
      // a copy of the entry or else bad things happen. Shared mutable state
      // strikes again! See github issue #191.

      var generatedMappings = aSourceMap._mappings.toArray().slice();
      var destGeneratedMappings = smc.__generatedMappings = [];
      var destOriginalMappings = smc.__originalMappings = [];

      for (var i = 0, length = generatedMappings.length; i < length; i++) {
        var srcMapping = generatedMappings[i];
        var destMapping = new Mapping;
        destMapping.generatedLine = srcMapping.generatedLine;
        destMapping.generatedColumn = srcMapping.generatedColumn;

        if (srcMapping.source) {
          destMapping.source = sources.indexOf(srcMapping.source);
          destMapping.originalLine = srcMapping.originalLine;
          destMapping.originalColumn = srcMapping.originalColumn;

          if (srcMapping.name) {
            destMapping.name = names.indexOf(srcMapping.name);
          }

          destOriginalMappings.push(destMapping);
        }

        destGeneratedMappings.push(destMapping);
      }

      quickSort(smc.__originalMappings, util.compareByOriginalPositions);

      return smc;
    };

  /**
   * The version of the source mapping spec that we are consuming.
   */
  BasicSourceMapConsumer.prototype._version = 3;

  /**
   * The list of original sources.
   */
  Object.defineProperty(BasicSourceMapConsumer.prototype, 'sources', {
    get: function () {
      return this._absoluteSources.slice();
    }
  });

  /**
   * Provide the JIT with a nice shape / hidden class.
   */
  function Mapping() {
    this.generatedLine = 0;
    this.generatedColumn = 0;
    this.source = null;
    this.originalLine = null;
    this.originalColumn = null;
    this.name = null;
  }

  /**
   * Parse the mappings in a string in to a data structure which we can easily
   * query (the ordered arrays in the `this.__generatedMappings` and
   * `this.__originalMappings` properties).
   */
  BasicSourceMapConsumer.prototype._parseMappings =
    function SourceMapConsumer_parseMappings(aStr, aSourceRoot) {
      var generatedLine = 1;
      var previousGeneratedColumn = 0;
      var previousOriginalLine = 0;
      var previousOriginalColumn = 0;
      var previousSource = 0;
      var previousName = 0;
      var length = aStr.length;
      var index = 0;
      var cachedSegments = {};
      var temp = {};
      var originalMappings = [];
      var generatedMappings = [];
      var mapping, str, segment, end, value;

      while (index < length) {
        if (aStr.charAt(index) === ';') {
          generatedLine++;
          index++;
          previousGeneratedColumn = 0;
        }
        else if (aStr.charAt(index) === ',') {
          index++;
        }
        else {
          mapping = new Mapping();
          mapping.generatedLine = generatedLine;

          // Because each offset is encoded relative to the previous one,
          // many segments often have the same encoding. We can exploit this
          // fact by caching the parsed variable length fields of each segment,
          // allowing us to avoid a second parse if we encounter the same
          // segment again.
          for (end = index; end < length; end++) {
            if (this._charIsMappingSeparator(aStr, end)) {
              break;
            }
          }
          str = aStr.slice(index, end);

          segment = cachedSegments[str];
          if (segment) {
            index += str.length;
          } else {
            segment = [];
            while (index < end) {
              base64VLQ.decode(aStr, index, temp);
              value = temp.value;
              index = temp.rest;
              segment.push(value);
            }

            if (segment.length === 2) {
              throw new Error('Found a source, but no line and column');
            }

            if (segment.length === 3) {
              throw new Error('Found a source and line, but no column');
            }

            cachedSegments[str] = segment;
          }

          // Generated column.
          mapping.generatedColumn = previousGeneratedColumn + segment[0];
          previousGeneratedColumn = mapping.generatedColumn;

          if (segment.length > 1) {
            // Original source.
            mapping.source = previousSource + segment[1];
            previousSource += segment[1];

            // Original line.
            mapping.originalLine = previousOriginalLine + segment[2];
            previousOriginalLine = mapping.originalLine;
            // Lines are stored 0-based
            mapping.originalLine += 1;

            // Original column.
            mapping.originalColumn = previousOriginalColumn + segment[3];
            previousOriginalColumn = mapping.originalColumn;

            if (segment.length > 4) {
              // Original name.
              mapping.name = previousName + segment[4];
              previousName += segment[4];
            }
          }

          generatedMappings.push(mapping);
          if (typeof mapping.originalLine === 'number') {
            originalMappings.push(mapping);
          }
        }
      }

      quickSort(generatedMappings, util.compareByGeneratedPositionsDeflated);
      this.__generatedMappings = generatedMappings;

      quickSort(originalMappings, util.compareByOriginalPositions);
      this.__originalMappings = originalMappings;
    };

  /**
   * Find the mapping that best matches the hypothetical "needle" mapping that
   * we are searching for in the given "haystack" of mappings.
   */
  BasicSourceMapConsumer.prototype._findMapping =
    function SourceMapConsumer_findMapping(aNeedle, aMappings, aLineName,
                                           aColumnName, aComparator, aBias) {
      // To return the position we are searching for, we must first find the
      // mapping for the given position and then return the opposite position it
      // points to. Because the mappings are sorted, we can use binary search to
      // find the best mapping.

      if (aNeedle[aLineName] <= 0) {
        throw new TypeError('Line must be greater than or equal to 1, got '
                            + aNeedle[aLineName]);
      }
      if (aNeedle[aColumnName] < 0) {
        throw new TypeError('Column must be greater than or equal to 0, got '
                            + aNeedle[aColumnName]);
      }

      return binarySearch.search(aNeedle, aMappings, aComparator, aBias);
    };

  /**
   * Compute the last column for each generated mapping. The last column is
   * inclusive.
   */
  BasicSourceMapConsumer.prototype.computeColumnSpans =
    function SourceMapConsumer_computeColumnSpans() {
      for (var index = 0; index < this._generatedMappings.length; ++index) {
        var mapping = this._generatedMappings[index];

        // Mappings do not contain a field for the last generated columnt. We
        // can come up with an optimistic estimate, however, by assuming that
        // mappings are contiguous (i.e. given two consecutive mappings, the
        // first mapping ends where the second one starts).
        if (index + 1 < this._generatedMappings.length) {
          var nextMapping = this._generatedMappings[index + 1];

          if (mapping.generatedLine === nextMapping.generatedLine) {
            mapping.lastGeneratedColumn = nextMapping.generatedColumn - 1;
            continue;
          }
        }

        // The last mapping for each line spans the entire line.
        mapping.lastGeneratedColumn = Infinity;
      }
    };

  /**
   * Returns the original source, line, and column information for the generated
   * source's line and column positions provided. The only argument is an object
   * with the following properties:
   *
   *   - line: The line number in the generated source.  The line number
   *     is 1-based.
   *   - column: The column number in the generated source.  The column
   *     number is 0-based.
   *   - bias: Either 'SourceMapConsumer.GREATEST_LOWER_BOUND' or
   *     'SourceMapConsumer.LEAST_UPPER_BOUND'. Specifies whether to return the
   *     closest element that is smaller than or greater than the one we are
   *     searching for, respectively, if the exact element cannot be found.
   *     Defaults to 'SourceMapConsumer.GREATEST_LOWER_BOUND'.
   *
   * and an object is returned with the following properties:
   *
   *   - source: The original source file, or null.
   *   - line: The line number in the original source, or null.  The
   *     line number is 1-based.
   *   - column: The column number in the original source, or null.  The
   *     column number is 0-based.
   *   - name: The original identifier, or null.
   */
  BasicSourceMapConsumer.prototype.originalPositionFor =
    function SourceMapConsumer_originalPositionFor(aArgs) {
      var needle = {
        generatedLine: util.getArg(aArgs, 'line'),
        generatedColumn: util.getArg(aArgs, 'column')
      };

      var index = this._findMapping(
        needle,
        this._generatedMappings,
        "generatedLine",
        "generatedColumn",
        util.compareByGeneratedPositionsDeflated,
        util.getArg(aArgs, 'bias', SourceMapConsumer.GREATEST_LOWER_BOUND)
      );

      if (index >= 0) {
        var mapping = this._generatedMappings[index];

        if (mapping.generatedLine === needle.generatedLine) {
          var source = util.getArg(mapping, 'source', null);
          if (source !== null) {
            source = this._sources.at(source);
            source = util.computeSourceURL(this.sourceRoot, source, this._sourceMapURL);
          }
          var name = util.getArg(mapping, 'name', null);
          if (name !== null) {
            name = this._names.at(name);
          }
          return {
            source: source,
            line: util.getArg(mapping, 'originalLine', null),
            column: util.getArg(mapping, 'originalColumn', null),
            name: name
          };
        }
      }

      return {
        source: null,
        line: null,
        column: null,
        name: null
      };
    };

  /**
   * Return true if we have the source content for every source in the source
   * map, false otherwise.
   */
  BasicSourceMapConsumer.prototype.hasContentsOfAllSources =
    function BasicSourceMapConsumer_hasContentsOfAllSources() {
      if (!this.sourcesContent) {
        return false;
      }
      return this.sourcesContent.length >= this._sources.size() &&
        !this.sourcesContent.some(function (sc) { return sc == null; });
    };

  /**
   * Returns the original source content. The only argument is the url of the
   * original source file. Returns null if no original source content is
   * available.
   */
  BasicSourceMapConsumer.prototype.sourceContentFor =
    function SourceMapConsumer_sourceContentFor(aSource, nullOnMissing) {
      if (!this.sourcesContent) {
        return null;
      }

      var index = this._findSourceIndex(aSource);
      if (index >= 0) {
        return this.sourcesContent[index];
      }

      var relativeSource = aSource;
      if (this.sourceRoot != null) {
        relativeSource = util.relative(this.sourceRoot, relativeSource);
      }

      var url;
      if (this.sourceRoot != null
          && (url = util.urlParse(this.sourceRoot))) {
        // XXX: file:// URIs and absolute paths lead to unexpected behavior for
        // many users. We can help them out when they expect file:// URIs to
        // behave like it would if they were running a local HTTP server. See
        // https://bugzilla.mozilla.org/show_bug.cgi?id=885597.
        var fileUriAbsPath = relativeSource.replace(/^file:\/\//, "");
        if (url.scheme == "file"
            && this._sources.has(fileUriAbsPath)) {
          return this.sourcesContent[this._sources.indexOf(fileUriAbsPath)]
        }

        if ((!url.path || url.path == "/")
            && this._sources.has("/" + relativeSource)) {
          return this.sourcesContent[this._sources.indexOf("/" + relativeSource)];
        }
      }

      // This function is used recursively from
      // IndexedSourceMapConsumer.prototype.sourceContentFor. In that case, we
      // don't want to throw if we can't find the source - we just want to
      // return null, so we provide a flag to exit gracefully.
      if (nullOnMissing) {
        return null;
      }
      else {
        throw new Error('"' + relativeSource + '" is not in the SourceMap.');
      }
    };

  /**
   * Returns the generated line and column information for the original source,
   * line, and column positions provided. The only argument is an object with
   * the following properties:
   *
   *   - source: The filename of the original source.
   *   - line: The line number in the original source.  The line number
   *     is 1-based.
   *   - column: The column number in the original source.  The column
   *     number is 0-based.
   *   - bias: Either 'SourceMapConsumer.GREATEST_LOWER_BOUND' or
   *     'SourceMapConsumer.LEAST_UPPER_BOUND'. Specifies whether to return the
   *     closest element that is smaller than or greater than the one we are
   *     searching for, respectively, if the exact element cannot be found.
   *     Defaults to 'SourceMapConsumer.GREATEST_LOWER_BOUND'.
   *
   * and an object is returned with the following properties:
   *
   *   - line: The line number in the generated source, or null.  The
   *     line number is 1-based.
   *   - column: The column number in the generated source, or null.
   *     The column number is 0-based.
   */
  BasicSourceMapConsumer.prototype.generatedPositionFor =
    function SourceMapConsumer_generatedPositionFor(aArgs) {
      var source = util.getArg(aArgs, 'source');
      source = this._findSourceIndex(source);
      if (source < 0) {
        return {
          line: null,
          column: null,
          lastColumn: null
        };
      }

      var needle = {
        source: source,
        originalLine: util.getArg(aArgs, 'line'),
        originalColumn: util.getArg(aArgs, 'column')
      };

      var index = this._findMapping(
        needle,
        this._originalMappings,
        "originalLine",
        "originalColumn",
        util.compareByOriginalPositions,
        util.getArg(aArgs, 'bias', SourceMapConsumer.GREATEST_LOWER_BOUND)
      );

      if (index >= 0) {
        var mapping = this._originalMappings[index];

        if (mapping.source === needle.source) {
          return {
            line: util.getArg(mapping, 'generatedLine', null),
            column: util.getArg(mapping, 'generatedColumn', null),
            lastColumn: util.getArg(mapping, 'lastGeneratedColumn', null)
          };
        }
      }

      return {
        line: null,
        column: null,
        lastColumn: null
      };
    };

  exports.BasicSourceMapConsumer = BasicSourceMapConsumer;

  /**
   * An IndexedSourceMapConsumer instance represents a parsed source map which
   * we can query for information. It differs from BasicSourceMapConsumer in
   * that it takes "indexed" source maps (i.e. ones with a "sections" field) as
   * input.
   *
   * The first parameter is a raw source map (either as a JSON string, or already
   * parsed to an object). According to the spec for indexed source maps, they
   * have the following attributes:
   *
   *   - version: Which version of the source map spec this map is following.
   *   - file: Optional. The generated file this source map is associated with.
   *   - sections: A list of section definitions.
   *
   * Each value under the "sections" field has two fields:
   *   - offset: The offset into the original specified at which this section
   *       begins to apply, defined as an object with a "line" and "column"
   *       field.
   *   - map: A source map definition. This source map could also be indexed,
   *       but doesn't have to be.
   *
   * Instead of the "map" field, it's also possible to have a "url" field
   * specifying a URL to retrieve a source map from, but that's currently
   * unsupported.
   *
   * Here's an example source map, taken from the source map spec[0], but
   * modified to omit a section which uses the "url" field.
   *
   *  {
   *    version : 3,
   *    file: "app.js",
   *    sections: [{
   *      offset: {line:100, column:10},
   *      map: {
   *        version : 3,
   *        file: "section.js",
   *        sources: ["foo.js", "bar.js"],
   *        names: ["src", "maps", "are", "fun"],
   *        mappings: "AAAA,E;;ABCDE;"
   *      }
   *    }],
   *  }
   *
   * The second parameter, if given, is a string whose value is the URL
   * at which the source map was found.  This URL is used to compute the
   * sources array.
   *
   * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit#heading=h.535es3xeprgt
   */
  function IndexedSourceMapConsumer(aSourceMap, aSourceMapURL) {
    var sourceMap = aSourceMap;
    if (typeof aSourceMap === 'string') {
      sourceMap = util.parseSourceMapInput(aSourceMap);
    }

    var version = util.getArg(sourceMap, 'version');
    var sections = util.getArg(sourceMap, 'sections');

    if (version != this._version) {
      throw new Error('Unsupported version: ' + version);
    }

    this._sources = new ArraySet();
    this._names = new ArraySet();

    var lastOffset = {
      line: -1,
      column: 0
    };
    this._sections = sections.map(function (s) {
      if (s.url) {
        // The url field will require support for asynchronicity.
        // See https://github.com/mozilla/source-map/issues/16
        throw new Error('Support for url field in sections not implemented.');
      }
      var offset = util.getArg(s, 'offset');
      var offsetLine = util.getArg(offset, 'line');
      var offsetColumn = util.getArg(offset, 'column');

      if (offsetLine < lastOffset.line ||
          (offsetLine === lastOffset.line && offsetColumn < lastOffset.column)) {
        throw new Error('Section offsets must be ordered and non-overlapping.');
      }
      lastOffset = offset;

      return {
        generatedOffset: {
          // The offset fields are 0-based, but we use 1-based indices when
          // encoding/decoding from VLQ.
          generatedLine: offsetLine + 1,
          generatedColumn: offsetColumn + 1
        },
        consumer: new SourceMapConsumer(util.getArg(s, 'map'), aSourceMapURL)
      }
    });
  }

  IndexedSourceMapConsumer.prototype = Object.create(SourceMapConsumer.prototype);
  IndexedSourceMapConsumer.prototype.constructor = SourceMapConsumer;

  /**
   * The version of the source mapping spec that we are consuming.
   */
  IndexedSourceMapConsumer.prototype._version = 3;

  /**
   * The list of original sources.
   */
  Object.defineProperty(IndexedSourceMapConsumer.prototype, 'sources', {
    get: function () {
      var sources = [];
      for (var i = 0; i < this._sections.length; i++) {
        for (var j = 0; j < this._sections[i].consumer.sources.length; j++) {
          sources.push(this._sections[i].consumer.sources[j]);
        }
      }
      return sources;
    }
  });

  /**
   * Returns the original source, line, and column information for the generated
   * source's line and column positions provided. The only argument is an object
   * with the following properties:
   *
   *   - line: The line number in the generated source.  The line number
   *     is 1-based.
   *   - column: The column number in the generated source.  The column
   *     number is 0-based.
   *
   * and an object is returned with the following properties:
   *
   *   - source: The original source file, or null.
   *   - line: The line number in the original source, or null.  The
   *     line number is 1-based.
   *   - column: The column number in the original source, or null.  The
   *     column number is 0-based.
   *   - name: The original identifier, or null.
   */
  IndexedSourceMapConsumer.prototype.originalPositionFor =
    function IndexedSourceMapConsumer_originalPositionFor(aArgs) {
      var needle = {
        generatedLine: util.getArg(aArgs, 'line'),
        generatedColumn: util.getArg(aArgs, 'column')
      };

      // Find the section containing the generated position we're trying to map
      // to an original position.
      var sectionIndex = binarySearch.search(needle, this._sections,
        function(needle, section) {
          var cmp = needle.generatedLine - section.generatedOffset.generatedLine;
          if (cmp) {
            return cmp;
          }

          return (needle.generatedColumn -
                  section.generatedOffset.generatedColumn);
        });
      var section = this._sections[sectionIndex];

      if (!section) {
        return {
          source: null,
          line: null,
          column: null,
          name: null
        };
      }

      return section.consumer.originalPositionFor({
        line: needle.generatedLine -
          (section.generatedOffset.generatedLine - 1),
        column: needle.generatedColumn -
          (section.generatedOffset.generatedLine === needle.generatedLine
           ? section.generatedOffset.generatedColumn - 1
           : 0),
        bias: aArgs.bias
      });
    };

  /**
   * Return true if we have the source content for every source in the source
   * map, false otherwise.
   */
  IndexedSourceMapConsumer.prototype.hasContentsOfAllSources =
    function IndexedSourceMapConsumer_hasContentsOfAllSources() {
      return this._sections.every(function (s) {
        return s.consumer.hasContentsOfAllSources();
      });
    };

  /**
   * Returns the original source content. The only argument is the url of the
   * original source file. Returns null if no original source content is
   * available.
   */
  IndexedSourceMapConsumer.prototype.sourceContentFor =
    function IndexedSourceMapConsumer_sourceContentFor(aSource, nullOnMissing) {
      for (var i = 0; i < this._sections.length; i++) {
        var section = this._sections[i];

        var content = section.consumer.sourceContentFor(aSource, true);
        if (content) {
          return content;
        }
      }
      if (nullOnMissing) {
        return null;
      }
      else {
        throw new Error('"' + aSource + '" is not in the SourceMap.');
      }
    };

  /**
   * Returns the generated line and column information for the original source,
   * line, and column positions provided. The only argument is an object with
   * the following properties:
   *
   *   - source: The filename of the original source.
   *   - line: The line number in the original source.  The line number
   *     is 1-based.
   *   - column: The column number in the original source.  The column
   *     number is 0-based.
   *
   * and an object is returned with the following properties:
   *
   *   - line: The line number in the generated source, or null.  The
   *     line number is 1-based.
   *   - column: The column number in the generated source, or null.
   *     The column number is 0-based.
   */
  IndexedSourceMapConsumer.prototype.generatedPositionFor =
    function IndexedSourceMapConsumer_generatedPositionFor(aArgs) {
      for (var i = 0; i < this._sections.length; i++) {
        var section = this._sections[i];

        // Only consider this section if the requested source is in the list of
        // sources of the consumer.
        if (section.consumer._findSourceIndex(util.getArg(aArgs, 'source')) === -1) {
          continue;
        }
        var generatedPosition = section.consumer.generatedPositionFor(aArgs);
        if (generatedPosition) {
          var ret = {
            line: generatedPosition.line +
              (section.generatedOffset.generatedLine - 1),
            column: generatedPosition.column +
              (section.generatedOffset.generatedLine === generatedPosition.line
               ? section.generatedOffset.generatedColumn - 1
               : 0)
          };
          return ret;
        }
      }

      return {
        line: null,
        column: null
      };
    };

  /**
   * Parse the mappings in a string in to a data structure which we can easily
   * query (the ordered arrays in the `this.__generatedMappings` and
   * `this.__originalMappings` properties).
   */
  IndexedSourceMapConsumer.prototype._parseMappings =
    function IndexedSourceMapConsumer_parseMappings(aStr, aSourceRoot) {
      this.__generatedMappings = [];
      this.__originalMappings = [];
      for (var i = 0; i < this._sections.length; i++) {
        var section = this._sections[i];
        var sectionMappings = section.consumer._generatedMappings;
        for (var j = 0; j < sectionMappings.length; j++) {
          var mapping = sectionMappings[j];

          var source = section.consumer._sources.at(mapping.source);
          source = util.computeSourceURL(section.consumer.sourceRoot, source, this._sourceMapURL);
          this._sources.add(source);
          source = this._sources.indexOf(source);

          var name = null;
          if (mapping.name) {
            name = section.consumer._names.at(mapping.name);
            this._names.add(name);
            name = this._names.indexOf(name);
          }

          // The mappings coming from the consumer for the section have
          // generated positions relative to the start of the section, so we
          // need to offset them to be relative to the start of the concatenated
          // generated file.
          var adjustedMapping = {
            source: source,
            generatedLine: mapping.generatedLine +
              (section.generatedOffset.generatedLine - 1),
            generatedColumn: mapping.generatedColumn +
              (section.generatedOffset.generatedLine === mapping.generatedLine
              ? section.generatedOffset.generatedColumn - 1
              : 0),
            originalLine: mapping.originalLine,
            originalColumn: mapping.originalColumn,
            name: name
          };

          this.__generatedMappings.push(adjustedMapping);
          if (typeof adjustedMapping.originalLine === 'number') {
            this.__originalMappings.push(adjustedMapping);
          }
        }
      }

      quickSort(this.__generatedMappings, util.compareByGeneratedPositionsDeflated);
      quickSort(this.__originalMappings, util.compareByOriginalPositions);
    };

  exports.IndexedSourceMapConsumer = IndexedSourceMapConsumer;

  },{"./array-set":100,"./base64-vlq":101,"./binary-search":103,"./quick-sort":105,"./util":109}],107:[function(require,module,exports){
  /* -*- Mode: js; js-indent-level: 2; -*- */
  /*
   * Copyright 2011 Mozilla Foundation and contributors
   * Licensed under the New BSD license. See LICENSE or:
   * http://opensource.org/licenses/BSD-3-Clause
   */

  var base64VLQ = require('./base64-vlq');
  var util = require('./util');
  var ArraySet = require('./array-set').ArraySet;
  var MappingList = require('./mapping-list').MappingList;

  /**
   * An instance of the SourceMapGenerator represents a source map which is
   * being built incrementally. You may pass an object with the following
   * properties:
   *
   *   - file: The filename of the generated source.
   *   - sourceRoot: A root for all relative URLs in this source map.
   */
  function SourceMapGenerator(aArgs) {
    if (!aArgs) {
      aArgs = {};
    }
    this._file = util.getArg(aArgs, 'file', null);
    this._sourceRoot = util.getArg(aArgs, 'sourceRoot', null);
    this._skipValidation = util.getArg(aArgs, 'skipValidation', false);
    this._sources = new ArraySet();
    this._names = new ArraySet();
    this._mappings = new MappingList();
    this._sourcesContents = null;
  }

  SourceMapGenerator.prototype._version = 3;

  /**
   * Creates a new SourceMapGenerator based on a SourceMapConsumer
   *
   * @param aSourceMapConsumer The SourceMap.
   */
  SourceMapGenerator.fromSourceMap =
    function SourceMapGenerator_fromSourceMap(aSourceMapConsumer) {
      var sourceRoot = aSourceMapConsumer.sourceRoot;
      var generator = new SourceMapGenerator({
        file: aSourceMapConsumer.file,
        sourceRoot: sourceRoot
      });
      aSourceMapConsumer.eachMapping(function (mapping) {
        var newMapping = {
          generated: {
            line: mapping.generatedLine,
            column: mapping.generatedColumn
          }
        };

        if (mapping.source != null) {
          newMapping.source = mapping.source;
          if (sourceRoot != null) {
            newMapping.source = util.relative(sourceRoot, newMapping.source);
          }

          newMapping.original = {
            line: mapping.originalLine,
            column: mapping.originalColumn
          };

          if (mapping.name != null) {
            newMapping.name = mapping.name;
          }
        }

        generator.addMapping(newMapping);
      });
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var sourceRelative = sourceFile;
        if (sourceRoot !== null) {
          sourceRelative = util.relative(sourceRoot, sourceFile);
        }

        if (!generator._sources.has(sourceRelative)) {
          generator._sources.add(sourceRelative);
        }

        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content != null) {
          generator.setSourceContent(sourceFile, content);
        }
      });
      return generator;
    };

  /**
   * Add a single mapping from original source line and column to the generated
   * source's line and column for this source map being created. The mapping
   * object should have the following properties:
   *
   *   - generated: An object with the generated line and column positions.
   *   - original: An object with the original line and column positions.
   *   - source: The original source file (relative to the sourceRoot).
   *   - name: An optional original token name for this mapping.
   */
  SourceMapGenerator.prototype.addMapping =
    function SourceMapGenerator_addMapping(aArgs) {
      var generated = util.getArg(aArgs, 'generated');
      var original = util.getArg(aArgs, 'original', null);
      var source = util.getArg(aArgs, 'source', null);
      var name = util.getArg(aArgs, 'name', null);

      if (!this._skipValidation) {
        this._validateMapping(generated, original, source, name);
      }

      if (source != null) {
        source = String(source);
        if (!this._sources.has(source)) {
          this._sources.add(source);
        }
      }

      if (name != null) {
        name = String(name);
        if (!this._names.has(name)) {
          this._names.add(name);
        }
      }

      this._mappings.add({
        generatedLine: generated.line,
        generatedColumn: generated.column,
        originalLine: original != null && original.line,
        originalColumn: original != null && original.column,
        source: source,
        name: name
      });
    };

  /**
   * Set the source content for a source file.
   */
  SourceMapGenerator.prototype.setSourceContent =
    function SourceMapGenerator_setSourceContent(aSourceFile, aSourceContent) {
      var source = aSourceFile;
      if (this._sourceRoot != null) {
        source = util.relative(this._sourceRoot, source);
      }

      if (aSourceContent != null) {
        // Add the source content to the _sourcesContents map.
        // Create a new _sourcesContents map if the property is null.
        if (!this._sourcesContents) {
          this._sourcesContents = Object.create(null);
        }
        this._sourcesContents[util.toSetString(source)] = aSourceContent;
      } else if (this._sourcesContents) {
        // Remove the source file from the _sourcesContents map.
        // If the _sourcesContents map is empty, set the property to null.
        delete this._sourcesContents[util.toSetString(source)];
        if (Object.keys(this._sourcesContents).length === 0) {
          this._sourcesContents = null;
        }
      }
    };

  /**
   * Applies the mappings of a sub-source-map for a specific source file to the
   * source map being generated. Each mapping to the supplied source file is
   * rewritten using the supplied source map. Note: The resolution for the
   * resulting mappings is the minimium of this map and the supplied map.
   *
   * @param aSourceMapConsumer The source map to be applied.
   * @param aSourceFile Optional. The filename of the source file.
   *        If omitted, SourceMapConsumer's file property will be used.
   * @param aSourceMapPath Optional. The dirname of the path to the source map
   *        to be applied. If relative, it is relative to the SourceMapConsumer.
   *        This parameter is needed when the two source maps aren't in the same
   *        directory, and the source map to be applied contains relative source
   *        paths. If so, those relative source paths need to be rewritten
   *        relative to the SourceMapGenerator.
   */
  SourceMapGenerator.prototype.applySourceMap =
    function SourceMapGenerator_applySourceMap(aSourceMapConsumer, aSourceFile, aSourceMapPath) {
      var sourceFile = aSourceFile;
      // If aSourceFile is omitted, we will use the file property of the SourceMap
      if (aSourceFile == null) {
        if (aSourceMapConsumer.file == null) {
          throw new Error(
            'SourceMapGenerator.prototype.applySourceMap requires either an explicit source file, ' +
            'or the source map\'s "file" property. Both were omitted.'
          );
        }
        sourceFile = aSourceMapConsumer.file;
      }
      var sourceRoot = this._sourceRoot;
      // Make "sourceFile" relative if an absolute Url is passed.
      if (sourceRoot != null) {
        sourceFile = util.relative(sourceRoot, sourceFile);
      }
      // Applying the SourceMap can add and remove items from the sources and
      // the names array.
      var newSources = new ArraySet();
      var newNames = new ArraySet();

      // Find mappings for the "sourceFile"
      this._mappings.unsortedForEach(function (mapping) {
        if (mapping.source === sourceFile && mapping.originalLine != null) {
          // Check if it can be mapped by the source map, then update the mapping.
          var original = aSourceMapConsumer.originalPositionFor({
            line: mapping.originalLine,
            column: mapping.originalColumn
          });
          if (original.source != null) {
            // Copy mapping
            mapping.source = original.source;
            if (aSourceMapPath != null) {
              mapping.source = util.join(aSourceMapPath, mapping.source)
            }
            if (sourceRoot != null) {
              mapping.source = util.relative(sourceRoot, mapping.source);
            }
            mapping.originalLine = original.line;
            mapping.originalColumn = original.column;
            if (original.name != null) {
              mapping.name = original.name;
            }
          }
        }

        var source = mapping.source;
        if (source != null && !newSources.has(source)) {
          newSources.add(source);
        }

        var name = mapping.name;
        if (name != null && !newNames.has(name)) {
          newNames.add(name);
        }

      }, this);
      this._sources = newSources;
      this._names = newNames;

      // Copy sourcesContents of applied map.
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content != null) {
          if (aSourceMapPath != null) {
            sourceFile = util.join(aSourceMapPath, sourceFile);
          }
          if (sourceRoot != null) {
            sourceFile = util.relative(sourceRoot, sourceFile);
          }
          this.setSourceContent(sourceFile, content);
        }
      }, this);
    };

  /**
   * A mapping can have one of the three levels of data:
   *
   *   1. Just the generated position.
   *   2. The Generated position, original position, and original source.
   *   3. Generated and original position, original source, as well as a name
   *      token.
   *
   * To maintain consistency, we validate that any new mapping being added falls
   * in to one of these categories.
   */
  SourceMapGenerator.prototype._validateMapping =
    function SourceMapGenerator_validateMapping(aGenerated, aOriginal, aSource,
                                                aName) {
      // When aOriginal is truthy but has empty values for .line and .column,
      // it is most likely a programmer error. In this case we throw a very
      // specific error message to try to guide them the right way.
      // For example: https://github.com/Polymer/polymer-bundler/pull/519
      if (aOriginal && typeof aOriginal.line !== 'number' && typeof aOriginal.column !== 'number') {
          throw new Error(
              'original.line and original.column are not numbers -- you probably meant to omit ' +
              'the original mapping entirely and only map the generated position. If so, pass ' +
              'null for the original mapping instead of an object with empty or null values.'
          );
      }

      if (aGenerated && 'line' in aGenerated && 'column' in aGenerated
          && aGenerated.line > 0 && aGenerated.column >= 0
          && !aOriginal && !aSource && !aName) {
        // Case 1.
        return;
      }
      else if (aGenerated && 'line' in aGenerated && 'column' in aGenerated
               && aOriginal && 'line' in aOriginal && 'column' in aOriginal
               && aGenerated.line > 0 && aGenerated.column >= 0
               && aOriginal.line > 0 && aOriginal.column >= 0
               && aSource) {
        // Cases 2 and 3.
        return;
      }
      else {
        throw new Error('Invalid mapping: ' + JSON.stringify({
          generated: aGenerated,
          source: aSource,
          original: aOriginal,
          name: aName
        }));
      }
    };

  /**
   * Serialize the accumulated mappings in to the stream of base 64 VLQs
   * specified by the source map format.
   */
  SourceMapGenerator.prototype._serializeMappings =
    function SourceMapGenerator_serializeMappings() {
      var previousGeneratedColumn = 0;
      var previousGeneratedLine = 1;
      var previousOriginalColumn = 0;
      var previousOriginalLine = 0;
      var previousName = 0;
      var previousSource = 0;
      var result = '';
      var next;
      var mapping;
      var nameIdx;
      var sourceIdx;

      var mappings = this._mappings.toArray();
      for (var i = 0, len = mappings.length; i < len; i++) {
        mapping = mappings[i];
        next = ''

        if (mapping.generatedLine !== previousGeneratedLine) {
          previousGeneratedColumn = 0;
          while (mapping.generatedLine !== previousGeneratedLine) {
            next += ';';
            previousGeneratedLine++;
          }
        }
        else {
          if (i > 0) {
            if (!util.compareByGeneratedPositionsInflated(mapping, mappings[i - 1])) {
              continue;
            }
            next += ',';
          }
        }

        next += base64VLQ.encode(mapping.generatedColumn
                                   - previousGeneratedColumn);
        previousGeneratedColumn = mapping.generatedColumn;

        if (mapping.source != null) {
          sourceIdx = this._sources.indexOf(mapping.source);
          next += base64VLQ.encode(sourceIdx - previousSource);
          previousSource = sourceIdx;

          // lines are stored 0-based in SourceMap spec version 3
          next += base64VLQ.encode(mapping.originalLine - 1
                                     - previousOriginalLine);
          previousOriginalLine = mapping.originalLine - 1;

          next += base64VLQ.encode(mapping.originalColumn
                                     - previousOriginalColumn);
          previousOriginalColumn = mapping.originalColumn;

          if (mapping.name != null) {
            nameIdx = this._names.indexOf(mapping.name);
            next += base64VLQ.encode(nameIdx - previousName);
            previousName = nameIdx;
          }
        }

        result += next;
      }

      return result;
    };

  SourceMapGenerator.prototype._generateSourcesContent =
    function SourceMapGenerator_generateSourcesContent(aSources, aSourceRoot) {
      return aSources.map(function (source) {
        if (!this._sourcesContents) {
          return null;
        }
        if (aSourceRoot != null) {
          source = util.relative(aSourceRoot, source);
        }
        var key = util.toSetString(source);
        return Object.prototype.hasOwnProperty.call(this._sourcesContents, key)
          ? this._sourcesContents[key]
          : null;
      }, this);
    };

  /**
   * Externalize the source map.
   */
  SourceMapGenerator.prototype.toJSON =
    function SourceMapGenerator_toJSON() {
      var map = {
        version: this._version,
        sources: this._sources.toArray(),
        names: this._names.toArray(),
        mappings: this._serializeMappings()
      };
      if (this._file != null) {
        map.file = this._file;
      }
      if (this._sourceRoot != null) {
        map.sourceRoot = this._sourceRoot;
      }
      if (this._sourcesContents) {
        map.sourcesContent = this._generateSourcesContent(map.sources, map.sourceRoot);
      }

      return map;
    };

  /**
   * Render the source map being generated to a string.
   */
  SourceMapGenerator.prototype.toString =
    function SourceMapGenerator_toString() {
      return JSON.stringify(this.toJSON());
    };

  exports.SourceMapGenerator = SourceMapGenerator;

  },{"./array-set":100,"./base64-vlq":101,"./mapping-list":104,"./util":109}],108:[function(require,module,exports){
  /* -*- Mode: js; js-indent-level: 2; -*- */
  /*
   * Copyright 2011 Mozilla Foundation and contributors
   * Licensed under the New BSD license. See LICENSE or:
   * http://opensource.org/licenses/BSD-3-Clause
   */

  var SourceMapGenerator = require('./source-map-generator').SourceMapGenerator;
  var util = require('./util');

  // Matches a Windows-style `\r\n` newline or a `\n` newline used by all other
  // operating systems these days (capturing the result).
  var REGEX_NEWLINE = /(\r?\n)/;

  // Newline character code for charCodeAt() comparisons
  var NEWLINE_CODE = 10;

  // Private symbol for identifying `SourceNode`s when multiple versions of
  // the source-map library are loaded. This MUST NOT CHANGE across
  // versions!
  var isSourceNode = "$$$isSourceNode$$$";

  /**
   * SourceNodes provide a way to abstract over interpolating/concatenating
   * snippets of generated JavaScript source code while maintaining the line and
   * column information associated with the original source code.
   *
   * @param aLine The original line number.
   * @param aColumn The original column number.
   * @param aSource The original source's filename.
   * @param aChunks Optional. An array of strings which are snippets of
   *        generated JS, or other SourceNodes.
   * @param aName The original identifier.
   */
  function SourceNode(aLine, aColumn, aSource, aChunks, aName) {
    this.children = [];
    this.sourceContents = {};
    this.line = aLine == null ? null : aLine;
    this.column = aColumn == null ? null : aColumn;
    this.source = aSource == null ? null : aSource;
    this.name = aName == null ? null : aName;
    this[isSourceNode] = true;
    if (aChunks != null) this.add(aChunks);
  }

  /**
   * Creates a SourceNode from generated code and a SourceMapConsumer.
   *
   * @param aGeneratedCode The generated code
   * @param aSourceMapConsumer The SourceMap for the generated code
   * @param aRelativePath Optional. The path that relative sources in the
   *        SourceMapConsumer should be relative to.
   */
  SourceNode.fromStringWithSourceMap =
    function SourceNode_fromStringWithSourceMap(aGeneratedCode, aSourceMapConsumer, aRelativePath) {
      // The SourceNode we want to fill with the generated code
      // and the SourceMap
      var node = new SourceNode();

      // All even indices of this array are one line of the generated code,
      // while all odd indices are the newlines between two adjacent lines
      // (since `REGEX_NEWLINE` captures its match).
      // Processed fragments are accessed by calling `shiftNextLine`.
      var remainingLines = aGeneratedCode.split(REGEX_NEWLINE);
      var remainingLinesIndex = 0;
      var shiftNextLine = function() {
        var lineContents = getNextLine();
        // The last line of a file might not have a newline.
        var newLine = getNextLine() || "";
        return lineContents + newLine;

        function getNextLine() {
          return remainingLinesIndex < remainingLines.length ?
              remainingLines[remainingLinesIndex++] : undefined;
        }
      };

      // We need to remember the position of "remainingLines"
      var lastGeneratedLine = 1, lastGeneratedColumn = 0;

      // The generate SourceNodes we need a code range.
      // To extract it current and last mapping is used.
      // Here we store the last mapping.
      var lastMapping = null;

      aSourceMapConsumer.eachMapping(function (mapping) {
        if (lastMapping !== null) {
          // We add the code from "lastMapping" to "mapping":
          // First check if there is a new line in between.
          if (lastGeneratedLine < mapping.generatedLine) {
            // Associate first line with "lastMapping"
            addMappingWithCode(lastMapping, shiftNextLine());
            lastGeneratedLine++;
            lastGeneratedColumn = 0;
            // The remaining code is added without mapping
          } else {
            // There is no new line in between.
            // Associate the code between "lastGeneratedColumn" and
            // "mapping.generatedColumn" with "lastMapping"
            var nextLine = remainingLines[remainingLinesIndex] || '';
            var code = nextLine.substr(0, mapping.generatedColumn -
                                          lastGeneratedColumn);
            remainingLines[remainingLinesIndex] = nextLine.substr(mapping.generatedColumn -
                                                lastGeneratedColumn);
            lastGeneratedColumn = mapping.generatedColumn;
            addMappingWithCode(lastMapping, code);
            // No more remaining code, continue
            lastMapping = mapping;
            return;
          }
        }
        // We add the generated code until the first mapping
        // to the SourceNode without any mapping.
        // Each line is added as separate string.
        while (lastGeneratedLine < mapping.generatedLine) {
          node.add(shiftNextLine());
          lastGeneratedLine++;
        }
        if (lastGeneratedColumn < mapping.generatedColumn) {
          var nextLine = remainingLines[remainingLinesIndex] || '';
          node.add(nextLine.substr(0, mapping.generatedColumn));
          remainingLines[remainingLinesIndex] = nextLine.substr(mapping.generatedColumn);
          lastGeneratedColumn = mapping.generatedColumn;
        }
        lastMapping = mapping;
      }, this);
      // We have processed all mappings.
      if (remainingLinesIndex < remainingLines.length) {
        if (lastMapping) {
          // Associate the remaining code in the current line with "lastMapping"
          addMappingWithCode(lastMapping, shiftNextLine());
        }
        // and add the remaining lines without any mapping
        node.add(remainingLines.splice(remainingLinesIndex).join(""));
      }

      // Copy sourcesContent into SourceNode
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content != null) {
          if (aRelativePath != null) {
            sourceFile = util.join(aRelativePath, sourceFile);
          }
          node.setSourceContent(sourceFile, content);
        }
      });

      return node;

      function addMappingWithCode(mapping, code) {
        if (mapping === null || mapping.source === undefined) {
          node.add(code);
        } else {
          var source = aRelativePath
            ? util.join(aRelativePath, mapping.source)
            : mapping.source;
          node.add(new SourceNode(mapping.originalLine,
                                  mapping.originalColumn,
                                  source,
                                  code,
                                  mapping.name));
        }
      }
    };

  /**
   * Add a chunk of generated JS to this source node.
   *
   * @param aChunk A string snippet of generated JS code, another instance of
   *        SourceNode, or an array where each member is one of those things.
   */
  SourceNode.prototype.add = function SourceNode_add(aChunk) {
    if (Array.isArray(aChunk)) {
      aChunk.forEach(function (chunk) {
        this.add(chunk);
      }, this);
    }
    else if (aChunk[isSourceNode] || typeof aChunk === "string") {
      if (aChunk) {
        this.children.push(aChunk);
      }
    }
    else {
      throw new TypeError(
        "Expected a SourceNode, string, or an array of SourceNodes and strings. Got " + aChunk
      );
    }
    return this;
  };

  /**
   * Add a chunk of generated JS to the beginning of this source node.
   *
   * @param aChunk A string snippet of generated JS code, another instance of
   *        SourceNode, or an array where each member is one of those things.
   */
  SourceNode.prototype.prepend = function SourceNode_prepend(aChunk) {
    if (Array.isArray(aChunk)) {
      for (var i = aChunk.length-1; i >= 0; i--) {
        this.prepend(aChunk[i]);
      }
    }
    else if (aChunk[isSourceNode] || typeof aChunk === "string") {
      this.children.unshift(aChunk);
    }
    else {
      throw new TypeError(
        "Expected a SourceNode, string, or an array of SourceNodes and strings. Got " + aChunk
      );
    }
    return this;
  };

  /**
   * Walk over the tree of JS snippets in this node and its children. The
   * walking function is called once for each snippet of JS and is passed that
   * snippet and the its original associated source's line/column location.
   *
   * @param aFn The traversal function.
   */
  SourceNode.prototype.walk = function SourceNode_walk(aFn) {
    var chunk;
    for (var i = 0, len = this.children.length; i < len; i++) {
      chunk = this.children[i];
      if (chunk[isSourceNode]) {
        chunk.walk(aFn);
      }
      else {
        if (chunk !== '') {
          aFn(chunk, { source: this.source,
                       line: this.line,
                       column: this.column,
                       name: this.name });
        }
      }
    }
  };

  /**
   * Like `String.prototype.join` except for SourceNodes. Inserts `aStr` between
   * each of `this.children`.
   *
   * @param aSep The separator.
   */
  SourceNode.prototype.join = function SourceNode_join(aSep) {
    var newChildren;
    var i;
    var len = this.children.length;
    if (len > 0) {
      newChildren = [];
      for (i = 0; i < len-1; i++) {
        newChildren.push(this.children[i]);
        newChildren.push(aSep);
      }
      newChildren.push(this.children[i]);
      this.children = newChildren;
    }
    return this;
  };

  /**
   * Call String.prototype.replace on the very right-most source snippet. Useful
   * for trimming whitespace from the end of a source node, etc.
   *
   * @param aPattern The pattern to replace.
   * @param aReplacement The thing to replace the pattern with.
   */
  SourceNode.prototype.replaceRight = function SourceNode_replaceRight(aPattern, aReplacement) {
    var lastChild = this.children[this.children.length - 1];
    if (lastChild[isSourceNode]) {
      lastChild.replaceRight(aPattern, aReplacement);
    }
    else if (typeof lastChild === 'string') {
      this.children[this.children.length - 1] = lastChild.replace(aPattern, aReplacement);
    }
    else {
      this.children.push(''.replace(aPattern, aReplacement));
    }
    return this;
  };

  /**
   * Set the source content for a source file. This will be added to the SourceMapGenerator
   * in the sourcesContent field.
   *
   * @param aSourceFile The filename of the source file
   * @param aSourceContent The content of the source file
   */
  SourceNode.prototype.setSourceContent =
    function SourceNode_setSourceContent(aSourceFile, aSourceContent) {
      this.sourceContents[util.toSetString(aSourceFile)] = aSourceContent;
    };

  /**
   * Walk over the tree of SourceNodes. The walking function is called for each
   * source file content and is passed the filename and source content.
   *
   * @param aFn The traversal function.
   */
  SourceNode.prototype.walkSourceContents =
    function SourceNode_walkSourceContents(aFn) {
      for (var i = 0, len = this.children.length; i < len; i++) {
        if (this.children[i][isSourceNode]) {
          this.children[i].walkSourceContents(aFn);
        }
      }

      var sources = Object.keys(this.sourceContents);
      for (var i = 0, len = sources.length; i < len; i++) {
        aFn(util.fromSetString(sources[i]), this.sourceContents[sources[i]]);
      }
    };

  /**
   * Return the string representation of this source node. Walks over the tree
   * and concatenates all the various snippets together to one string.
   */
  SourceNode.prototype.toString = function SourceNode_toString() {
    var str = "";
    this.walk(function (chunk) {
      str += chunk;
    });
    return str;
  };

  /**
   * Returns the string representation of this source node along with a source
   * map.
   */
  SourceNode.prototype.toStringWithSourceMap = function SourceNode_toStringWithSourceMap(aArgs) {
    var generated = {
      code: "",
      line: 1,
      column: 0
    };
    var map = new SourceMapGenerator(aArgs);
    var sourceMappingActive = false;
    var lastOriginalSource = null;
    var lastOriginalLine = null;
    var lastOriginalColumn = null;
    var lastOriginalName = null;
    this.walk(function (chunk, original) {
      generated.code += chunk;
      if (original.source !== null
          && original.line !== null
          && original.column !== null) {
        if(lastOriginalSource !== original.source
           || lastOriginalLine !== original.line
           || lastOriginalColumn !== original.column
           || lastOriginalName !== original.name) {
          map.addMapping({
            source: original.source,
            original: {
              line: original.line,
              column: original.column
            },
            generated: {
              line: generated.line,
              column: generated.column
            },
            name: original.name
          });
        }
        lastOriginalSource = original.source;
        lastOriginalLine = original.line;
        lastOriginalColumn = original.column;
        lastOriginalName = original.name;
        sourceMappingActive = true;
      } else if (sourceMappingActive) {
        map.addMapping({
          generated: {
            line: generated.line,
            column: generated.column
          }
        });
        lastOriginalSource = null;
        sourceMappingActive = false;
      }
      for (var idx = 0, length = chunk.length; idx < length; idx++) {
        if (chunk.charCodeAt(idx) === NEWLINE_CODE) {
          generated.line++;
          generated.column = 0;
          // Mappings end at eol
          if (idx + 1 === length) {
            lastOriginalSource = null;
            sourceMappingActive = false;
          } else if (sourceMappingActive) {
            map.addMapping({
              source: original.source,
              original: {
                line: original.line,
                column: original.column
              },
              generated: {
                line: generated.line,
                column: generated.column
              },
              name: original.name
            });
          }
        } else {
          generated.column++;
        }
      }
    });
    this.walkSourceContents(function (sourceFile, sourceContent) {
      map.setSourceContent(sourceFile, sourceContent);
    });

    return { code: generated.code, map: map };
  };

  exports.SourceNode = SourceNode;

  },{"./source-map-generator":107,"./util":109}],109:[function(require,module,exports){
  /* -*- Mode: js; js-indent-level: 2; -*- */
  /*
   * Copyright 2011 Mozilla Foundation and contributors
   * Licensed under the New BSD license. See LICENSE or:
   * http://opensource.org/licenses/BSD-3-Clause
   */

  /**
   * This is a helper function for getting values from parameter/options
   * objects.
   *
   * @param args The object we are extracting values from
   * @param name The name of the property we are getting.
   * @param defaultValue An optional value to return if the property is missing
   * from the object. If this is not specified and the property is missing, an
   * error will be thrown.
   */
  function getArg(aArgs, aName, aDefaultValue) {
    if (aName in aArgs) {
      return aArgs[aName];
    } else if (arguments.length === 3) {
      return aDefaultValue;
    } else {
      throw new Error('"' + aName + '" is a required argument.');
    }
  }
  exports.getArg = getArg;

  var urlRegexp = /^(?:([\w+\-.]+):)?\/\/(?:(\w+:\w+)@)?([\w.-]*)(?::(\d+))?(.*)$/;
  var dataUrlRegexp = /^data:.+\,.+$/;

  function urlParse(aUrl) {
    var match = aUrl.match(urlRegexp);
    if (!match) {
      return null;
    }
    return {
      scheme: match[1],
      auth: match[2],
      host: match[3],
      port: match[4],
      path: match[5]
    };
  }
  exports.urlParse = urlParse;

  function urlGenerate(aParsedUrl) {
    var url = '';
    if (aParsedUrl.scheme) {
      url += aParsedUrl.scheme + ':';
    }
    url += '//';
    if (aParsedUrl.auth) {
      url += aParsedUrl.auth + '@';
    }
    if (aParsedUrl.host) {
      url += aParsedUrl.host;
    }
    if (aParsedUrl.port) {
      url += ":" + aParsedUrl.port
    }
    if (aParsedUrl.path) {
      url += aParsedUrl.path;
    }
    return url;
  }
  exports.urlGenerate = urlGenerate;

  /**
   * Normalizes a path, or the path portion of a URL:
   *
   * - Replaces consecutive slashes with one slash.
   * - Removes unnecessary '.' parts.
   * - Removes unnecessary '<dir>/..' parts.
   *
   * Based on code in the Node.js 'path' core module.
   *
   * @param aPath The path or url to normalize.
   */
  function normalize(aPath) {
    var path = aPath;
    var url = urlParse(aPath);
    if (url) {
      if (!url.path) {
        return aPath;
      }
      path = url.path;
    }
    var isAbsolute = exports.isAbsolute(path);

    var parts = path.split(/\/+/);
    for (var part, up = 0, i = parts.length - 1; i >= 0; i--) {
      part = parts[i];
      if (part === '.') {
        parts.splice(i, 1);
      } else if (part === '..') {
        up++;
      } else if (up > 0) {
        if (part === '') {
          // The first part is blank if the path is absolute. Trying to go
          // above the root is a no-op. Therefore we can remove all '..' parts
          // directly after the root.
          parts.splice(i + 1, up);
          up = 0;
        } else {
          parts.splice(i, 2);
          up--;
        }
      }
    }
    path = parts.join('/');

    if (path === '') {
      path = isAbsolute ? '/' : '.';
    }

    if (url) {
      url.path = path;
      return urlGenerate(url);
    }
    return path;
  }
  exports.normalize = normalize;

  /**
   * Joins two paths/URLs.
   *
   * @param aRoot The root path or URL.
   * @param aPath The path or URL to be joined with the root.
   *
   * - If aPath is a URL or a data URI, aPath is returned, unless aPath is a
   *   scheme-relative URL: Then the scheme of aRoot, if any, is prepended
   *   first.
   * - Otherwise aPath is a path. If aRoot is a URL, then its path portion
   *   is updated with the result and aRoot is returned. Otherwise the result
   *   is returned.
   *   - If aPath is absolute, the result is aPath.
   *   - Otherwise the two paths are joined with a slash.
   * - Joining for example 'http://' and 'www.example.com' is also supported.
   */
  function join(aRoot, aPath) {
    if (aRoot === "") {
      aRoot = ".";
    }
    if (aPath === "") {
      aPath = ".";
    }
    var aPathUrl = urlParse(aPath);
    var aRootUrl = urlParse(aRoot);
    if (aRootUrl) {
      aRoot = aRootUrl.path || '/';
    }

    // `join(foo, '//www.example.org')`
    if (aPathUrl && !aPathUrl.scheme) {
      if (aRootUrl) {
        aPathUrl.scheme = aRootUrl.scheme;
      }
      return urlGenerate(aPathUrl);
    }

    if (aPathUrl || aPath.match(dataUrlRegexp)) {
      return aPath;
    }

    // `join('http://', 'www.example.com')`
    if (aRootUrl && !aRootUrl.host && !aRootUrl.path) {
      aRootUrl.host = aPath;
      return urlGenerate(aRootUrl);
    }

    var joined = aPath.charAt(0) === '/'
      ? aPath
      : normalize(aRoot.replace(/\/+$/, '') + '/' + aPath);

    if (aRootUrl) {
      aRootUrl.path = joined;
      return urlGenerate(aRootUrl);
    }
    return joined;
  }
  exports.join = join;

  exports.isAbsolute = function (aPath) {
    return aPath.charAt(0) === '/' || urlRegexp.test(aPath);
  };

  /**
   * Make a path relative to a URL or another path.
   *
   * @param aRoot The root path or URL.
   * @param aPath The path or URL to be made relative to aRoot.
   */
  function relative(aRoot, aPath) {
    if (aRoot === "") {
      aRoot = ".";
    }

    aRoot = aRoot.replace(/\/$/, '');

    // It is possible for the path to be above the root. In this case, simply
    // checking whether the root is a prefix of the path won't work. Instead, we
    // need to remove components from the root one by one, until either we find
    // a prefix that fits, or we run out of components to remove.
    var level = 0;
    while (aPath.indexOf(aRoot + '/') !== 0) {
      var index = aRoot.lastIndexOf("/");
      if (index < 0) {
        return aPath;
      }

      // If the only part of the root that is left is the scheme (i.e. http://,
      // file:///, etc.), one or more slashes (/), or simply nothing at all, we
      // have exhausted all components, so the path is not relative to the root.
      aRoot = aRoot.slice(0, index);
      if (aRoot.match(/^([^\/]+:\/)?\/*$/)) {
        return aPath;
      }

      ++level;
    }

    // Make sure we add a "../" for each component we removed from the root.
    return Array(level + 1).join("../") + aPath.substr(aRoot.length + 1);
  }
  exports.relative = relative;

  var supportsNullProto = (function () {
    var obj = Object.create(null);
    return !('__proto__' in obj);
  }());

  function identity (s) {
    return s;
  }

  /**
   * Because behavior goes wacky when you set `__proto__` on objects, we
   * have to prefix all the strings in our set with an arbitrary character.
   *
   * See https://github.com/mozilla/source-map/pull/31 and
   * https://github.com/mozilla/source-map/issues/30
   *
   * @param String aStr
   */
  function toSetString(aStr) {
    if (isProtoString(aStr)) {
      return '$' + aStr;
    }

    return aStr;
  }
  exports.toSetString = supportsNullProto ? identity : toSetString;

  function fromSetString(aStr) {
    if (isProtoString(aStr)) {
      return aStr.slice(1);
    }

    return aStr;
  }
  exports.fromSetString = supportsNullProto ? identity : fromSetString;

  function isProtoString(s) {
    if (!s) {
      return false;
    }

    var length = s.length;

    if (length < 9 /* "__proto__".length */) {
      return false;
    }

    if (s.charCodeAt(length - 1) !== 95  /* '_' */ ||
        s.charCodeAt(length - 2) !== 95  /* '_' */ ||
        s.charCodeAt(length - 3) !== 111 /* 'o' */ ||
        s.charCodeAt(length - 4) !== 116 /* 't' */ ||
        s.charCodeAt(length - 5) !== 111 /* 'o' */ ||
        s.charCodeAt(length - 6) !== 114 /* 'r' */ ||
        s.charCodeAt(length - 7) !== 112 /* 'p' */ ||
        s.charCodeAt(length - 8) !== 95  /* '_' */ ||
        s.charCodeAt(length - 9) !== 95  /* '_' */) {
      return false;
    }

    for (var i = length - 10; i >= 0; i--) {
      if (s.charCodeAt(i) !== 36 /* '$' */) {
        return false;
      }
    }

    return true;
  }

  /**
   * Comparator between two mappings where the original positions are compared.
   *
   * Optionally pass in `true` as `onlyCompareGenerated` to consider two
   * mappings with the same original source/line/column, but different generated
   * line and column the same. Useful when searching for a mapping with a
   * stubbed out mapping.
   */
  function compareByOriginalPositions(mappingA, mappingB, onlyCompareOriginal) {
    var cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp !== 0) {
      return cmp;
    }

    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp !== 0) {
      return cmp;
    }

    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp !== 0 || onlyCompareOriginal) {
      return cmp;
    }

    cmp = mappingA.generatedColumn - mappingB.generatedColumn;
    if (cmp !== 0) {
      return cmp;
    }

    cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp !== 0) {
      return cmp;
    }

    return strcmp(mappingA.name, mappingB.name);
  }
  exports.compareByOriginalPositions = compareByOriginalPositions;

  /**
   * Comparator between two mappings with deflated source and name indices where
   * the generated positions are compared.
   *
   * Optionally pass in `true` as `onlyCompareGenerated` to consider two
   * mappings with the same generated line and column, but different
   * source/name/original line and column the same. Useful when searching for a
   * mapping with a stubbed out mapping.
   */
  function compareByGeneratedPositionsDeflated(mappingA, mappingB, onlyCompareGenerated) {
    var cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp !== 0) {
      return cmp;
    }

    cmp = mappingA.generatedColumn - mappingB.generatedColumn;
    if (cmp !== 0 || onlyCompareGenerated) {
      return cmp;
    }

    cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp !== 0) {
      return cmp;
    }

    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp !== 0) {
      return cmp;
    }

    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp !== 0) {
      return cmp;
    }

    return strcmp(mappingA.name, mappingB.name);
  }
  exports.compareByGeneratedPositionsDeflated = compareByGeneratedPositionsDeflated;

  function strcmp(aStr1, aStr2) {
    if (aStr1 === aStr2) {
      return 0;
    }

    if (aStr1 === null) {
      return 1; // aStr2 !== null
    }

    if (aStr2 === null) {
      return -1; // aStr1 !== null
    }

    if (aStr1 > aStr2) {
      return 1;
    }

    return -1;
  }

  /**
   * Comparator between two mappings with inflated source and name strings where
   * the generated positions are compared.
   */
  function compareByGeneratedPositionsInflated(mappingA, mappingB) {
    var cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp !== 0) {
      return cmp;
    }

    cmp = mappingA.generatedColumn - mappingB.generatedColumn;
    if (cmp !== 0) {
      return cmp;
    }

    cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp !== 0) {
      return cmp;
    }

    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp !== 0) {
      return cmp;
    }

    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp !== 0) {
      return cmp;
    }

    return strcmp(mappingA.name, mappingB.name);
  }
  exports.compareByGeneratedPositionsInflated = compareByGeneratedPositionsInflated;

  /**
   * Strip any JSON XSSI avoidance prefix from the string (as documented
   * in the source maps specification), and then parse the string as
   * JSON.
   */
  function parseSourceMapInput(str) {
    return JSON.parse(str.replace(/^\)]}'[^\n]*\n/, ''));
  }
  exports.parseSourceMapInput = parseSourceMapInput;

  /**
   * Compute the URL of a source given the the source root, the source's
   * URL, and the source map's URL.
   */
  function computeSourceURL(sourceRoot, sourceURL, sourceMapURL) {
    sourceURL = sourceURL || '';

    if (sourceRoot) {
      // This follows what Chrome does.
      if (sourceRoot[sourceRoot.length - 1] !== '/' && sourceURL[0] !== '/') {
        sourceRoot += '/';
      }
      // The spec says:
      //   Line 4: An optional source root, useful for relocating source
      //   files on a server or removing repeated values in the
      //   “sources” entry.  This value is prepended to the individual
      //   entries in the “source” field.
      sourceURL = sourceRoot + sourceURL;
    }

    // Historically, SourceMapConsumer did not take the sourceMapURL as
    // a parameter.  This mode is still somewhat supported, which is why
    // this code block is conditional.  However, it's preferable to pass
    // the source map URL to SourceMapConsumer, so that this function
    // can implement the source URL resolution algorithm as outlined in
    // the spec.  This block is basically the equivalent of:
    //    new URL(sourceURL, sourceMapURL).toString()
    // ... except it avoids using URL, which wasn't available in the
    // older releases of node still supported by this library.
    //
    // The spec says:
    //   If the sources are not absolute URLs after prepending of the
    //   “sourceRoot”, the sources are resolved relative to the
    //   SourceMap (like resolving script src in a html document).
    if (sourceMapURL) {
      var parsed = urlParse(sourceMapURL);
      if (!parsed) {
        throw new Error("sourceMapURL could not be parsed");
      }
      if (parsed.path) {
        // Strip the last path component, but keep the "/".
        var index = parsed.path.lastIndexOf('/');
        if (index >= 0) {
          parsed.path = parsed.path.substring(0, index + 1);
        }
      }
      sourceURL = join(urlGenerate(parsed), sourceURL);
    }

    return normalize(sourceURL);
  }
  exports.computeSourceURL = computeSourceURL;

  },{}],110:[function(require,module,exports){
  /*
   * Copyright 2009-2011 Mozilla Foundation and contributors
   * Licensed under the New BSD license. See LICENSE.txt or:
   * http://opensource.org/licenses/BSD-3-Clause
   */
  exports.SourceMapGenerator = require('./lib/source-map-generator').SourceMapGenerator;
  exports.SourceMapConsumer = require('./lib/source-map-consumer').SourceMapConsumer;
  exports.SourceNode = require('./lib/source-node').SourceNode;

  },{"./lib/source-map-consumer":106,"./lib/source-map-generator":107,"./lib/source-node":108}],111:[function(require,module,exports){

  },{}],112:[function(require,module,exports){
  (function (global){
  'use strict';

  var objectAssign = require('object-assign');

  // compare and isBuffer taken from https://github.com/feross/buffer/blob/680e9e5e488f22aac27599a57dc844a6315928dd/index.js
  // original notice:

  /*!
   * The buffer module from node.js, for the browser.
   *
   * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
   * @license  MIT
   */
  function compare(a, b) {
    if (a === b) {
      return 0;
    }

    var x = a.length;
    var y = b.length;

    for (var i = 0, len = Math.min(x, y); i < len; ++i) {
      if (a[i] !== b[i]) {
        x = a[i];
        y = b[i];
        break;
      }
    }

    if (x < y) {
      return -1;
    }
    if (y < x) {
      return 1;
    }
    return 0;
  }
  function isBuffer(b) {
    if (global.Buffer && typeof global.Buffer.isBuffer === 'function') {
      return global.Buffer.isBuffer(b);
    }
    return !!(b != null && b._isBuffer);
  }

  // based on node assert, original notice:
  // NB: The URL to the CommonJS spec is kept just for tradition.
  //     node-assert has evolved a lot since then, both in API and behavior.

  // http://wiki.commonjs.org/wiki/Unit_Testing/1.0
  //
  // THIS IS NOT TESTED NOR LIKELY TO WORK OUTSIDE V8!
  //
  // Originally from narwhal.js (http://narwhaljs.org)
  // Copyright (c) 2009 Thomas Robinson <280north.com>
  //
  // Permission is hereby granted, free of charge, to any person obtaining a copy
  // of this software and associated documentation files (the 'Software'), to
  // deal in the Software without restriction, including without limitation the
  // rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
  // sell copies of the Software, and to permit persons to whom the Software is
  // furnished to do so, subject to the following conditions:
  //
  // The above copyright notice and this permission notice shall be included in
  // all copies or substantial portions of the Software.
  //
  // THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  // IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  // FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  // AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
  // ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
  // WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

  var util = require('util/');
  var hasOwn = Object.prototype.hasOwnProperty;
  var pSlice = Array.prototype.slice;
  var functionsHaveNames = (function () {
    return function foo() {}.name === 'foo';
  }());
  function pToString (obj) {
    return Object.prototype.toString.call(obj);
  }
  function isView(arrbuf) {
    if (isBuffer(arrbuf)) {
      return false;
    }
    if (typeof global.ArrayBuffer !== 'function') {
      return false;
    }
    if (typeof ArrayBuffer.isView === 'function') {
      return ArrayBuffer.isView(arrbuf);
    }
    if (!arrbuf) {
      return false;
    }
    if (arrbuf instanceof DataView) {
      return true;
    }
    if (arrbuf.buffer && arrbuf.buffer instanceof ArrayBuffer) {
      return true;
    }
    return false;
  }
  // 1. The assert module provides functions that throw
  // AssertionError's when particular conditions are not met. The
  // assert module must conform to the following interface.

  var assert = module.exports = ok;

  // 2. The AssertionError is defined in assert.
  // new assert.AssertionError({ message: message,
  //                             actual: actual,
  //                             expected: expected })

  var regex = /\s*function\s+([^\(\s]*)\s*/;
  // based on https://github.com/ljharb/function.prototype.name/blob/adeeeec8bfcc6068b187d7d9fb3d5bb1d3a30899/implementation.js
  function getName(func) {
    if (!util.isFunction(func)) {
      return;
    }
    if (functionsHaveNames) {
      return func.name;
    }
    var str = func.toString();
    var match = str.match(regex);
    return match && match[1];
  }
  assert.AssertionError = function AssertionError(options) {
    this.name = 'AssertionError';
    this.actual = options.actual;
    this.expected = options.expected;
    this.operator = options.operator;
    if (options.message) {
      this.message = options.message;
      this.generatedMessage = false;
    } else {
      this.message = getMessage(this);
      this.generatedMessage = true;
    }
    var stackStartFunction = options.stackStartFunction || fail;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, stackStartFunction);
    } else {
      // non v8 browsers so we can have a stacktrace
      var err = new Error();
      if (err.stack) {
        var out = err.stack;

        // try to strip useless frames
        var fn_name = getName(stackStartFunction);
        var idx = out.indexOf('\n' + fn_name);
        if (idx >= 0) {
          // once we have located the function frame
          // we need to strip out everything before it (and its line)
          var next_line = out.indexOf('\n', idx + 1);
          out = out.substring(next_line + 1);
        }

        this.stack = out;
      }
    }
  };

  // assert.AssertionError instanceof Error
  util.inherits(assert.AssertionError, Error);

  function truncate(s, n) {
    if (typeof s === 'string') {
      return s.length < n ? s : s.slice(0, n);
    } else {
      return s;
    }
  }
  function inspect(something) {
    if (functionsHaveNames || !util.isFunction(something)) {
      return util.inspect(something);
    }
    var rawname = getName(something);
    var name = rawname ? ': ' + rawname : '';
    return '[Function' +  name + ']';
  }
  function getMessage(self) {
    return truncate(inspect(self.actual), 128) + ' ' +
           self.operator + ' ' +
           truncate(inspect(self.expected), 128);
  }

  // At present only the three keys mentioned above are used and
  // understood by the spec. Implementations or sub modules can pass
  // other keys to the AssertionError's constructor - they will be
  // ignored.

  // 3. All of the following functions must throw an AssertionError
  // when a corresponding condition is not met, with a message that
  // may be undefined if not provided.  All assertion methods provide
  // both the actual and expected values to the assertion error for
  // display purposes.

  function fail(actual, expected, message, operator, stackStartFunction) {
    throw new assert.AssertionError({
      message: message,
      actual: actual,
      expected: expected,
      operator: operator,
      stackStartFunction: stackStartFunction
    });
  }

  // EXTENSION! allows for well behaved errors defined elsewhere.
  assert.fail = fail;

  // 4. Pure assertion tests whether a value is truthy, as determined
  // by !!guard.
  // assert.ok(guard, message_opt);
  // This statement is equivalent to assert.equal(true, !!guard,
  // message_opt);. To test strictly for the value true, use
  // assert.strictEqual(true, guard, message_opt);.

  function ok(value, message) {
    if (!value) fail(value, true, message, '==', assert.ok);
  }
  assert.ok = ok;

  // 5. The equality assertion tests shallow, coercive equality with
  // ==.
  // assert.equal(actual, expected, message_opt);

  assert.equal = function equal(actual, expected, message) {
    if (actual != expected) fail(actual, expected, message, '==', assert.equal);
  };

  // 6. The non-equality assertion tests for whether two objects are not equal
  // with != assert.notEqual(actual, expected, message_opt);

  assert.notEqual = function notEqual(actual, expected, message) {
    if (actual == expected) {
      fail(actual, expected, message, '!=', assert.notEqual);
    }
  };

  // 7. The equivalence assertion tests a deep equality relation.
  // assert.deepEqual(actual, expected, message_opt);

  assert.deepEqual = function deepEqual(actual, expected, message) {
    if (!_deepEqual(actual, expected, false)) {
      fail(actual, expected, message, 'deepEqual', assert.deepEqual);
    }
  };

  assert.deepStrictEqual = function deepStrictEqual(actual, expected, message) {
    if (!_deepEqual(actual, expected, true)) {
      fail(actual, expected, message, 'deepStrictEqual', assert.deepStrictEqual);
    }
  };

  function _deepEqual(actual, expected, strict, memos) {
    // 7.1. All identical values are equivalent, as determined by ===.
    if (actual === expected) {
      return true;
    } else if (isBuffer(actual) && isBuffer(expected)) {
      return compare(actual, expected) === 0;

    // 7.2. If the expected value is a Date object, the actual value is
    // equivalent if it is also a Date object that refers to the same time.
    } else if (util.isDate(actual) && util.isDate(expected)) {
      return actual.getTime() === expected.getTime();

    // 7.3 If the expected value is a RegExp object, the actual value is
    // equivalent if it is also a RegExp object with the same source and
    // properties (`global`, `multiline`, `lastIndex`, `ignoreCase`).
    } else if (util.isRegExp(actual) && util.isRegExp(expected)) {
      return actual.source === expected.source &&
             actual.global === expected.global &&
             actual.multiline === expected.multiline &&
             actual.lastIndex === expected.lastIndex &&
             actual.ignoreCase === expected.ignoreCase;

    // 7.4. Other pairs that do not both pass typeof value == 'object',
    // equivalence is determined by ==.
    } else if ((actual === null || typeof actual !== 'object') &&
               (expected === null || typeof expected !== 'object')) {
      return strict ? actual === expected : actual == expected;

    // If both values are instances of typed arrays, wrap their underlying
    // ArrayBuffers in a Buffer each to increase performance
    // This optimization requires the arrays to have the same type as checked by
    // Object.prototype.toString (aka pToString). Never perform binary
    // comparisons for Float*Arrays, though, since e.g. +0 === -0 but their
    // bit patterns are not identical.
    } else if (isView(actual) && isView(expected) &&
               pToString(actual) === pToString(expected) &&
               !(actual instanceof Float32Array ||
                 actual instanceof Float64Array)) {
      return compare(new Uint8Array(actual.buffer),
                     new Uint8Array(expected.buffer)) === 0;

    // 7.5 For all other Object pairs, including Array objects, equivalence is
    // determined by having the same number of owned properties (as verified
    // with Object.prototype.hasOwnProperty.call), the same set of keys
    // (although not necessarily the same order), equivalent values for every
    // corresponding key, and an identical 'prototype' property. Note: this
    // accounts for both named and indexed properties on Arrays.
    } else if (isBuffer(actual) !== isBuffer(expected)) {
      return false;
    } else {
      memos = memos || {actual: [], expected: []};

      var actualIndex = memos.actual.indexOf(actual);
      if (actualIndex !== -1) {
        if (actualIndex === memos.expected.indexOf(expected)) {
          return true;
        }
      }

      memos.actual.push(actual);
      memos.expected.push(expected);

      return objEquiv(actual, expected, strict, memos);
    }
  }

  function isArguments(object) {
    return Object.prototype.toString.call(object) == '[object Arguments]';
  }

  function objEquiv(a, b, strict, actualVisitedObjects) {
    if (a === null || a === undefined || b === null || b === undefined)
      return false;
    // if one is a primitive, the other must be same
    if (util.isPrimitive(a) || util.isPrimitive(b))
      return a === b;
    if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b))
      return false;
    var aIsArgs = isArguments(a);
    var bIsArgs = isArguments(b);
    if ((aIsArgs && !bIsArgs) || (!aIsArgs && bIsArgs))
      return false;
    if (aIsArgs) {
      a = pSlice.call(a);
      b = pSlice.call(b);
      return _deepEqual(a, b, strict);
    }
    var ka = objectKeys(a);
    var kb = objectKeys(b);
    var key, i;
    // having the same number of owned properties (keys incorporates
    // hasOwnProperty)
    if (ka.length !== kb.length)
      return false;
    //the same set of keys (although not necessarily the same order),
    ka.sort();
    kb.sort();
    //~~~cheap key test
    for (i = ka.length - 1; i >= 0; i--) {
      if (ka[i] !== kb[i])
        return false;
    }
    //equivalent values for every corresponding key, and
    //~~~possibly expensive deep test
    for (i = ka.length - 1; i >= 0; i--) {
      key = ka[i];
      if (!_deepEqual(a[key], b[key], strict, actualVisitedObjects))
        return false;
    }
    return true;
  }

  // 8. The non-equivalence assertion tests for any deep inequality.
  // assert.notDeepEqual(actual, expected, message_opt);

  assert.notDeepEqual = function notDeepEqual(actual, expected, message) {
    if (_deepEqual(actual, expected, false)) {
      fail(actual, expected, message, 'notDeepEqual', assert.notDeepEqual);
    }
  };

  assert.notDeepStrictEqual = notDeepStrictEqual;
  function notDeepStrictEqual(actual, expected, message) {
    if (_deepEqual(actual, expected, true)) {
      fail(actual, expected, message, 'notDeepStrictEqual', notDeepStrictEqual);
    }
  }


  // 9. The strict equality assertion tests strict equality, as determined by ===.
  // assert.strictEqual(actual, expected, message_opt);

  assert.strictEqual = function strictEqual(actual, expected, message) {
    if (actual !== expected) {
      fail(actual, expected, message, '===', assert.strictEqual);
    }
  };

  // 10. The strict non-equality assertion tests for strict inequality, as
  // determined by !==.  assert.notStrictEqual(actual, expected, message_opt);

  assert.notStrictEqual = function notStrictEqual(actual, expected, message) {
    if (actual === expected) {
      fail(actual, expected, message, '!==', assert.notStrictEqual);
    }
  };

  function expectedException(actual, expected) {
    if (!actual || !expected) {
      return false;
    }

    if (Object.prototype.toString.call(expected) == '[object RegExp]') {
      return expected.test(actual);
    }

    try {
      if (actual instanceof expected) {
        return true;
      }
    } catch (e) {
      // Ignore.  The instanceof check doesn't work for arrow functions.
    }

    if (Error.isPrototypeOf(expected)) {
      return false;
    }

    return expected.call({}, actual) === true;
  }

  function _tryBlock(block) {
    var error;
    try {
      block();
    } catch (e) {
      error = e;
    }
    return error;
  }

  function _throws(shouldThrow, block, expected, message) {
    var actual;

    if (typeof block !== 'function') {
      throw new TypeError('"block" argument must be a function');
    }

    if (typeof expected === 'string') {
      message = expected;
      expected = null;
    }

    actual = _tryBlock(block);

    message = (expected && expected.name ? ' (' + expected.name + ').' : '.') +
              (message ? ' ' + message : '.');

    if (shouldThrow && !actual) {
      fail(actual, expected, 'Missing expected exception' + message);
    }

    var userProvidedMessage = typeof message === 'string';
    var isUnwantedException = !shouldThrow && util.isError(actual);
    var isUnexpectedException = !shouldThrow && actual && !expected;

    if ((isUnwantedException &&
        userProvidedMessage &&
        expectedException(actual, expected)) ||
        isUnexpectedException) {
      fail(actual, expected, 'Got unwanted exception' + message);
    }

    if ((shouldThrow && actual && expected &&
        !expectedException(actual, expected)) || (!shouldThrow && actual)) {
      throw actual;
    }
  }

  // 11. Expected to throw an error:
  // assert.throws(block, Error_opt, message_opt);

  assert.throws = function(block, /*optional*/error, /*optional*/message) {
    _throws(true, block, error, message);
  };

  // EXTENSION! This is annoying to write outside this module.
  assert.doesNotThrow = function(block, /*optional*/error, /*optional*/message) {
    _throws(false, block, error, message);
  };

  assert.ifError = function(err) { if (err) throw err; };

  // Expose a strict only variant of assert
  function strict(value, message) {
    if (!value) fail(value, true, message, '==', strict);
  }
  assert.strict = objectAssign(strict, assert, {
    equal: assert.strictEqual,
    deepEqual: assert.deepStrictEqual,
    notEqual: assert.notStrictEqual,
    notDeepEqual: assert.notDeepStrictEqual
  });
  assert.strict.strict = assert.strict;

  var objectKeys = Object.keys || function (obj) {
    var keys = [];
    for (var key in obj) {
      if (hasOwn.call(obj, key)) keys.push(key);
    }
    return keys;
  };

  }).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
  },{"object-assign":116,"util/":115}],113:[function(require,module,exports){
  if (typeof Object.create === 'function') {
    // implementation from standard node.js 'util' module
    module.exports = function inherits(ctor, superCtor) {
      ctor.super_ = superCtor
      ctor.prototype = Object.create(superCtor.prototype, {
        constructor: {
          value: ctor,
          enumerable: false,
          writable: true,
          configurable: true
        }
      });
    };
  } else {
    // old school shim for old browsers
    module.exports = function inherits(ctor, superCtor) {
      ctor.super_ = superCtor
      var TempCtor = function () {}
      TempCtor.prototype = superCtor.prototype
      ctor.prototype = new TempCtor()
      ctor.prototype.constructor = ctor
    }
  }

  },{}],114:[function(require,module,exports){
  module.exports = function isBuffer(arg) {
    return arg && typeof arg === 'object'
      && typeof arg.copy === 'function'
      && typeof arg.fill === 'function'
      && typeof arg.readUInt8 === 'function';
  }
  },{}],115:[function(require,module,exports){
  (function (process,global){
  // Copyright Joyent, Inc. and other Node contributors.
  //
  // Permission is hereby granted, free of charge, to any person obtaining a
  // copy of this software and associated documentation files (the
  // "Software"), to deal in the Software without restriction, including
  // without limitation the rights to use, copy, modify, merge, publish,
  // distribute, sublicense, and/or sell copies of the Software, and to permit
  // persons to whom the Software is furnished to do so, subject to the
  // following conditions:
  //
  // The above copyright notice and this permission notice shall be included
  // in all copies or substantial portions of the Software.
  //
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
  // NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
  // DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  // OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
  // USE OR OTHER DEALINGS IN THE SOFTWARE.

  var formatRegExp = /%[sdj%]/g;
  exports.format = function(f) {
    if (!isString(f)) {
      var objects = [];
      for (var i = 0; i < arguments.length; i++) {
        objects.push(inspect(arguments[i]));
      }
      return objects.join(' ');
    }

    var i = 1;
    var args = arguments;
    var len = args.length;
    var str = String(f).replace(formatRegExp, function(x) {
      if (x === '%%') return '%';
      if (i >= len) return x;
      switch (x) {
        case '%s': return String(args[i++]);
        case '%d': return Number(args[i++]);
        case '%j':
          try {
            return JSON.stringify(args[i++]);
          } catch (_) {
            return '[Circular]';
          }
        default:
          return x;
      }
    });
    for (var x = args[i]; i < len; x = args[++i]) {
      if (isNull(x) || !isObject(x)) {
        str += ' ' + x;
      } else {
        str += ' ' + inspect(x);
      }
    }
    return str;
  };


  // Mark that a method should not be used.
  // Returns a modified function which warns once by default.
  // If --no-deprecation is set, then it is a no-op.
  exports.deprecate = function(fn, msg) {
    // Allow for deprecating things in the process of starting up.
    if (isUndefined(global.process)) {
      return function() {
        return exports.deprecate(fn, msg).apply(this, arguments);
      };
    }

    if (process.noDeprecation === true) {
      return fn;
    }

    var warned = false;
    function deprecated() {
      if (!warned) {
        if (process.throwDeprecation) {
          throw new Error(msg);
        } else if (process.traceDeprecation) {
          console.trace(msg);
        } else {
          console.error(msg);
        }
        warned = true;
      }
      return fn.apply(this, arguments);
    }

    return deprecated;
  };


  var debugs = {};
  var debugEnviron;
  exports.debuglog = function(set) {
    if (isUndefined(debugEnviron))
      debugEnviron = process.env.NODE_DEBUG || '';
    set = set.toUpperCase();
    if (!debugs[set]) {
      if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
        var pid = process.pid;
        debugs[set] = function() {
          var msg = exports.format.apply(exports, arguments);
          console.error('%s %d: %s', set, pid, msg);
        };
      } else {
        debugs[set] = function() {};
      }
    }
    return debugs[set];
  };


  /**
   * Echos the value of a value. Trys to print the value out
   * in the best way possible given the different types.
   *
   * @param {Object} obj The object to print out.
   * @param {Object} opts Optional options object that alters the output.
   */
  /* legacy: obj, showHidden, depth, colors*/
  function inspect(obj, opts) {
    // default options
    var ctx = {
      seen: [],
      stylize: stylizeNoColor
    };
    // legacy...
    if (arguments.length >= 3) ctx.depth = arguments[2];
    if (arguments.length >= 4) ctx.colors = arguments[3];
    if (isBoolean(opts)) {
      // legacy...
      ctx.showHidden = opts;
    } else if (opts) {
      // got an "options" object
      exports._extend(ctx, opts);
    }
    // set default options
    if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
    if (isUndefined(ctx.depth)) ctx.depth = 2;
    if (isUndefined(ctx.colors)) ctx.colors = false;
    if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
    if (ctx.colors) ctx.stylize = stylizeWithColor;
    return formatValue(ctx, obj, ctx.depth);
  }
  exports.inspect = inspect;


  // http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
  inspect.colors = {
    'bold' : [1, 22],
    'italic' : [3, 23],
    'underline' : [4, 24],
    'inverse' : [7, 27],
    'white' : [37, 39],
    'grey' : [90, 39],
    'black' : [30, 39],
    'blue' : [34, 39],
    'cyan' : [36, 39],
    'green' : [32, 39],
    'magenta' : [35, 39],
    'red' : [31, 39],
    'yellow' : [33, 39]
  };

  // Don't use 'blue' not visible on cmd.exe
  inspect.styles = {
    'special': 'cyan',
    'number': 'yellow',
    'boolean': 'yellow',
    'undefined': 'grey',
    'null': 'bold',
    'string': 'green',
    'date': 'magenta',
    // "name": intentionally not styling
    'regexp': 'red'
  };


  function stylizeWithColor(str, styleType) {
    var style = inspect.styles[styleType];

    if (style) {
      return '\u001b[' + inspect.colors[style][0] + 'm' + str +
             '\u001b[' + inspect.colors[style][1] + 'm';
    } else {
      return str;
    }
  }


  function stylizeNoColor(str, styleType) {
    return str;
  }


  function arrayToHash(array) {
    var hash = {};

    array.forEach(function(val, idx) {
      hash[val] = true;
    });

    return hash;
  }


  function formatValue(ctx, value, recurseTimes) {
    // Provide a hook for user-specified inspect functions.
    // Check that value is an object with an inspect function on it
    if (ctx.customInspect &&
        value &&
        isFunction(value.inspect) &&
        // Filter out the util module, it's inspect function is special
        value.inspect !== exports.inspect &&
        // Also filter out any prototype objects using the circular check.
        !(value.constructor && value.constructor.prototype === value)) {
      var ret = value.inspect(recurseTimes, ctx);
      if (!isString(ret)) {
        ret = formatValue(ctx, ret, recurseTimes);
      }
      return ret;
    }

    // Primitive types cannot have properties
    var primitive = formatPrimitive(ctx, value);
    if (primitive) {
      return primitive;
    }

    // Look up the keys of the object.
    var keys = Object.keys(value);
    var visibleKeys = arrayToHash(keys);

    if (ctx.showHidden) {
      keys = Object.getOwnPropertyNames(value);
    }

    // IE doesn't make error fields non-enumerable
    // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
    if (isError(value)
        && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
      return formatError(value);
    }

    // Some type of object without properties can be shortcutted.
    if (keys.length === 0) {
      if (isFunction(value)) {
        var name = value.name ? ': ' + value.name : '';
        return ctx.stylize('[Function' + name + ']', 'special');
      }
      if (isRegExp(value)) {
        return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
      }
      if (isDate(value)) {
        return ctx.stylize(Date.prototype.toString.call(value), 'date');
      }
      if (isError(value)) {
        return formatError(value);
      }
    }

    var base = '', array = false, braces = ['{', '}'];

    // Make Array say that they are Array
    if (isArray(value)) {
      array = true;
      braces = ['[', ']'];
    }

    // Make functions say that they are functions
    if (isFunction(value)) {
      var n = value.name ? ': ' + value.name : '';
      base = ' [Function' + n + ']';
    }

    // Make RegExps say that they are RegExps
    if (isRegExp(value)) {
      base = ' ' + RegExp.prototype.toString.call(value);
    }

    // Make dates with properties first say the date
    if (isDate(value)) {
      base = ' ' + Date.prototype.toUTCString.call(value);
    }

    // Make error with message first say the error
    if (isError(value)) {
      base = ' ' + formatError(value);
    }

    if (keys.length === 0 && (!array || value.length == 0)) {
      return braces[0] + base + braces[1];
    }

    if (recurseTimes < 0) {
      if (isRegExp(value)) {
        return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
      } else {
        return ctx.stylize('[Object]', 'special');
      }
    }

    ctx.seen.push(value);

    var output;
    if (array) {
      output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
    } else {
      output = keys.map(function(key) {
        return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
      });
    }

    ctx.seen.pop();

    return reduceToSingleString(output, base, braces);
  }


  function formatPrimitive(ctx, value) {
    if (isUndefined(value))
      return ctx.stylize('undefined', 'undefined');
    if (isString(value)) {
      var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                               .replace(/'/g, "\\'")
                                               .replace(/\\"/g, '"') + '\'';
      return ctx.stylize(simple, 'string');
    }
    if (isNumber(value))
      return ctx.stylize('' + value, 'number');
    if (isBoolean(value))
      return ctx.stylize('' + value, 'boolean');
    // For some reason typeof null is "object", so special case here.
    if (isNull(value))
      return ctx.stylize('null', 'null');
  }


  function formatError(value) {
    return '[' + Error.prototype.toString.call(value) + ']';
  }


  function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
    var output = [];
    for (var i = 0, l = value.length; i < l; ++i) {
      if (hasOwnProperty(value, String(i))) {
        output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
            String(i), true));
      } else {
        output.push('');
      }
    }
    keys.forEach(function(key) {
      if (!key.match(/^\d+$/)) {
        output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
            key, true));
      }
    });
    return output;
  }


  function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
    var name, str, desc;
    desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
    if (desc.get) {
      if (desc.set) {
        str = ctx.stylize('[Getter/Setter]', 'special');
      } else {
        str = ctx.stylize('[Getter]', 'special');
      }
    } else {
      if (desc.set) {
        str = ctx.stylize('[Setter]', 'special');
      }
    }
    if (!hasOwnProperty(visibleKeys, key)) {
      name = '[' + key + ']';
    }
    if (!str) {
      if (ctx.seen.indexOf(desc.value) < 0) {
        if (isNull(recurseTimes)) {
          str = formatValue(ctx, desc.value, null);
        } else {
          str = formatValue(ctx, desc.value, recurseTimes - 1);
        }
        if (str.indexOf('\n') > -1) {
          if (array) {
            str = str.split('\n').map(function(line) {
              return '  ' + line;
            }).join('\n').substr(2);
          } else {
            str = '\n' + str.split('\n').map(function(line) {
              return '   ' + line;
            }).join('\n');
          }
        }
      } else {
        str = ctx.stylize('[Circular]', 'special');
      }
    }
    if (isUndefined(name)) {
      if (array && key.match(/^\d+$/)) {
        return str;
      }
      name = JSON.stringify('' + key);
      if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
        name = name.substr(1, name.length - 2);
        name = ctx.stylize(name, 'name');
      } else {
        name = name.replace(/'/g, "\\'")
                   .replace(/\\"/g, '"')
                   .replace(/(^"|"$)/g, "'");
        name = ctx.stylize(name, 'string');
      }
    }

    return name + ': ' + str;
  }


  function reduceToSingleString(output, base, braces) {
    var numLinesEst = 0;
    var length = output.reduce(function(prev, cur) {
      numLinesEst++;
      if (cur.indexOf('\n') >= 0) numLinesEst++;
      return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
    }, 0);

    if (length > 60) {
      return braces[0] +
             (base === '' ? '' : base + '\n ') +
             ' ' +
             output.join(',\n  ') +
             ' ' +
             braces[1];
    }

    return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
  }


  // NOTE: These type checking functions intentionally don't use `instanceof`
  // because it is fragile and can be easily faked with `Object.create()`.
  function isArray(ar) {
    return Array.isArray(ar);
  }
  exports.isArray = isArray;

  function isBoolean(arg) {
    return typeof arg === 'boolean';
  }
  exports.isBoolean = isBoolean;

  function isNull(arg) {
    return arg === null;
  }
  exports.isNull = isNull;

  function isNullOrUndefined(arg) {
    return arg == null;
  }
  exports.isNullOrUndefined = isNullOrUndefined;

  function isNumber(arg) {
    return typeof arg === 'number';
  }
  exports.isNumber = isNumber;

  function isString(arg) {
    return typeof arg === 'string';
  }
  exports.isString = isString;

  function isSymbol(arg) {
    return typeof arg === 'symbol';
  }
  exports.isSymbol = isSymbol;

  function isUndefined(arg) {
    return arg === void 0;
  }
  exports.isUndefined = isUndefined;

  function isRegExp(re) {
    return isObject(re) && objectToString(re) === '[object RegExp]';
  }
  exports.isRegExp = isRegExp;

  function isObject(arg) {
    return typeof arg === 'object' && arg !== null;
  }
  exports.isObject = isObject;

  function isDate(d) {
    return isObject(d) && objectToString(d) === '[object Date]';
  }
  exports.isDate = isDate;

  function isError(e) {
    return isObject(e) &&
        (objectToString(e) === '[object Error]' || e instanceof Error);
  }
  exports.isError = isError;

  function isFunction(arg) {
    return typeof arg === 'function';
  }
  exports.isFunction = isFunction;

  function isPrimitive(arg) {
    return arg === null ||
           typeof arg === 'boolean' ||
           typeof arg === 'number' ||
           typeof arg === 'string' ||
           typeof arg === 'symbol' ||  // ES6 symbol
           typeof arg === 'undefined';
  }
  exports.isPrimitive = isPrimitive;

  exports.isBuffer = require('./support/isBuffer');

  function objectToString(o) {
    return Object.prototype.toString.call(o);
  }


  function pad(n) {
    return n < 10 ? '0' + n.toString(10) : n.toString(10);
  }


  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
                'Oct', 'Nov', 'Dec'];

  // 26 Feb 16:19:34
  function timestamp() {
    var d = new Date();
    var time = [pad(d.getHours()),
                pad(d.getMinutes()),
                pad(d.getSeconds())].join(':');
    return [d.getDate(), months[d.getMonth()], time].join(' ');
  }


  // log is just a thin wrapper to console.log that prepends a timestamp
  exports.log = function() {
    console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
  };


  /**
   * Inherit the prototype methods from one constructor into another.
   *
   * The Function.prototype.inherits from lang.js rewritten as a standalone
   * function (not on Function.prototype). NOTE: If this file is to be loaded
   * during bootstrapping this function needs to be rewritten using some native
   * functions as prototype setup using normal JavaScript does not work as
   * expected during bootstrapping (see mirror.js in r114903).
   *
   * @param {function} ctor Constructor function which needs to inherit the
   *     prototype.
   * @param {function} superCtor Constructor function to inherit prototype from.
   */
  exports.inherits = require('inherits');

  exports._extend = function(origin, add) {
    // Don't do anything if add isn't an object
    if (!add || !isObject(add)) return origin;

    var keys = Object.keys(add);
    var i = keys.length;
    while (i--) {
      origin[keys[i]] = add[keys[i]];
    }
    return origin;
  };

  function hasOwnProperty(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  }

  }).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
  },{"./support/isBuffer":114,"_process":117,"inherits":113}],116:[function(require,module,exports){
  /*
  object-assign
  (c) Sindre Sorhus
  @license MIT
  */

  'use strict';
  /* eslint-disable no-unused-vars */
  var getOwnPropertySymbols = Object.getOwnPropertySymbols;
  var hasOwnProperty = Object.prototype.hasOwnProperty;
  var propIsEnumerable = Object.prototype.propertyIsEnumerable;

  function toObject(val) {
    if (val === null || val === undefined) {
      throw new TypeError('Object.assign cannot be called with null or undefined');
    }

    return Object(val);
  }

  function shouldUseNative() {
    try {
      if (!Object.assign) {
        return false;
      }

      // Detect buggy property enumeration order in older V8 versions.

      // https://bugs.chromium.org/p/v8/issues/detail?id=4118
      var test1 = new String('abc');  // eslint-disable-line no-new-wrappers
      test1[5] = 'de';
      if (Object.getOwnPropertyNames(test1)[0] === '5') {
        return false;
      }

      // https://bugs.chromium.org/p/v8/issues/detail?id=3056
      var test2 = {};
      for (var i = 0; i < 10; i++) {
        test2['_' + String.fromCharCode(i)] = i;
      }
      var order2 = Object.getOwnPropertyNames(test2).map(function (n) {
        return test2[n];
      });
      if (order2.join('') !== '0123456789') {
        return false;
      }

      // https://bugs.chromium.org/p/v8/issues/detail?id=3056
      var test3 = {};
      'abcdefghijklmnopqrst'.split('').forEach(function (letter) {
        test3[letter] = letter;
      });
      if (Object.keys(Object.assign({}, test3)).join('') !==
          'abcdefghijklmnopqrst') {
        return false;
      }

      return true;
    } catch (err) {
      // We don't expect any of the above to throw, but better to be safe.
      return false;
    }
  }

  module.exports = shouldUseNative() ? Object.assign : function (target, source) {
    var from;
    var to = toObject(target);
    var symbols;

    for (var s = 1; s < arguments.length; s++) {
      from = Object(arguments[s]);

      for (var key in from) {
        if (hasOwnProperty.call(from, key)) {
          to[key] = from[key];
        }
      }

      if (getOwnPropertySymbols) {
        symbols = getOwnPropertySymbols(from);
        for (var i = 0; i < symbols.length; i++) {
          if (propIsEnumerable.call(from, symbols[i])) {
            to[symbols[i]] = from[symbols[i]];
          }
        }
      }
    }

    return to;
  };

  },{}],117:[function(require,module,exports){
  // shim for using process in browser
  var process = module.exports = {};

  // cached from whatever global is present so that test runners that stub it
  // don't break things.  But we need to wrap it in a try catch in case it is
  // wrapped in strict mode code which doesn't define any globals.  It's inside a
  // function because try/catches deoptimize in certain engines.

  var cachedSetTimeout;
  var cachedClearTimeout;

  function defaultSetTimout() {
      throw new Error('setTimeout has not been defined');
  }
  function defaultClearTimeout () {
      throw new Error('clearTimeout has not been defined');
  }
  (function () {
      try {
          if (typeof setTimeout === 'function') {
              cachedSetTimeout = setTimeout;
          } else {
              cachedSetTimeout = defaultSetTimout;
          }
      } catch (e) {
          cachedSetTimeout = defaultSetTimout;
      }
      try {
          if (typeof clearTimeout === 'function') {
              cachedClearTimeout = clearTimeout;
          } else {
              cachedClearTimeout = defaultClearTimeout;
          }
      } catch (e) {
          cachedClearTimeout = defaultClearTimeout;
      }
  } ())
  function runTimeout(fun) {
      if (cachedSetTimeout === setTimeout) {
          //normal enviroments in sane situations
          return setTimeout(fun, 0);
      }
      // if setTimeout wasn't available but was latter defined
      if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
          cachedSetTimeout = setTimeout;
          return setTimeout(fun, 0);
      }
      try {
          // when when somebody has screwed with setTimeout but no I.E. maddness
          return cachedSetTimeout(fun, 0);
      } catch(e){
          try {
              // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
              return cachedSetTimeout.call(null, fun, 0);
          } catch(e){
              // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
              return cachedSetTimeout.call(this, fun, 0);
          }
      }


  }
  function runClearTimeout(marker) {
      if (cachedClearTimeout === clearTimeout) {
          //normal enviroments in sane situations
          return clearTimeout(marker);
      }
      // if clearTimeout wasn't available but was latter defined
      if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
          cachedClearTimeout = clearTimeout;
          return clearTimeout(marker);
      }
      try {
          // when when somebody has screwed with setTimeout but no I.E. maddness
          return cachedClearTimeout(marker);
      } catch (e){
          try {
              // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
              return cachedClearTimeout.call(null, marker);
          } catch (e){
              // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
              // Some versions of I.E. have different rules for clearTimeout vs setTimeout
              return cachedClearTimeout.call(this, marker);
          }
      }



  }
  var queue = [];
  var draining = false;
  var currentQueue;
  var queueIndex = -1;

  function cleanUpNextTick() {
      if (!draining || !currentQueue) {
          return;
      }
      draining = false;
      if (currentQueue.length) {
          queue = currentQueue.concat(queue);
      } else {
          queueIndex = -1;
      }
      if (queue.length) {
          drainQueue();
      }
  }

  function drainQueue() {
      if (draining) {
          return;
      }
      var timeout = runTimeout(cleanUpNextTick);
      draining = true;

      var len = queue.length;
      while(len) {
          currentQueue = queue;
          queue = [];
          while (++queueIndex < len) {
              if (currentQueue) {
                  currentQueue[queueIndex].run();
              }
          }
          queueIndex = -1;
          len = queue.length;
      }
      currentQueue = null;
      draining = false;
      runClearTimeout(timeout);
  }

  process.nextTick = function (fun) {
      var args = new Array(arguments.length - 1);
      if (arguments.length > 1) {
          for (var i = 1; i < arguments.length; i++) {
              args[i - 1] = arguments[i];
          }
      }
      queue.push(new Item(fun, args));
      if (queue.length === 1 && !draining) {
          runTimeout(drainQueue);
      }
  };

  // v8 likes predictible objects
  function Item(fun, array) {
      this.fun = fun;
      this.array = array;
  }
  Item.prototype.run = function () {
      this.fun.apply(null, this.array);
  };
  process.title = 'browser';
  process.browser = true;
  process.env = {};
  process.argv = [];
  process.version = ''; // empty string to avoid regexp issues
  process.versions = {};

  function noop() {}

  process.on = noop;
  process.addListener = noop;
  process.once = noop;
  process.off = noop;
  process.removeListener = noop;
  process.removeAllListeners = noop;
  process.emit = noop;
  process.prependListener = noop;
  process.prependOnceListener = noop;

  process.listeners = function (name) { return [] }

  process.binding = function (name) {
      throw new Error('process.binding is not supported');
  };

  process.cwd = function () { return '/' };
  process.chdir = function (dir) {
      throw new Error('process.chdir is not supported');
  };
  process.umask = function() { return 0; };

  },{}]},{},[1]);

// ################ END OF REWRITE

// If obj.hasOwnProperty has been overridden, then calling
// obj.hasOwnProperty(prop) will break.
// See: https://github.com/joyent/node/issues/1707
function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

function stat(filename) {
  filename = path._makeLong(filename);
  const cache = stat.cache;
  if (cache !== null) {
    const result = cache.get(filename);
    if (result !== undefined) return result;
  }
  const result = internalModuleStat(filename);
  if (cache !== null) cache.set(filename, result);
  return result;
}
stat.cache = null;

function Module(id, parent) {
  this.id = id;
  this.exports = {};
  this.parent = parent;
  if (parent && parent.children) {
    parent.children.push(this);
  }

  this.filename = null;
  this.loaded = false;
  this.children = [];
}
module.exports = Module;

Module._cache = {};
Module._pathCache = {};
Module._extensions = {};
var modulePaths = [];
Module.globalPaths = [];

Module.builtins = ['assert', 'buffer', 'child_process', 'cluster',
'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'https', 'net',
'os', 'path', 'punycode', 'querystring', 'readline', 'repl', 'stream',
'string_decoder', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'zlib', 'async_wrap',
'buffer','cares_wrap', 'config', 'constants', 'contextify',
'fs_event_wrap', 'http_parser', 'icu', 'inspector', 'js_stream', 'natives',
'pipe_wrap', 'process_wrap', 'signal_wrap', 'spawn_sync', 'stream_wrap', 'tcp_wrap',
'tls_wrap', 'tty_wrap', 'udp_wrap', 'uv', 'module'];

Module.permissions = {};
Module.builtins.forEach(function(m){
  Module.permissions[m] = new Set();
});
Module.permissions["http"] = new Set(["network"]);
Module.permissions["https"] = new Set(["network"]);
Module.permissions["http2"] = new Set(["network"]);
Module.permissions["net"] = new Set(["network"]);
Module.permissions["fs"] = new Set(["filesystem"]);
Module.permissions["child_process"] = new Set(["process"]);

// *** MODIFIED WRAPPER
Module.wrapper = [
    '(function (exports, require, module, __filename, __dirname) { ',
    '\n});'
];
Module.wrap = function(script) {
    return Module.wrapper[0] + script + Module.wrapper[1];
};

Module._debug = util.debuglog('module');

// We use this alias for the preprocessor that filters it out
const debug = Module._debug;


// given a module name, and a list of paths to test, returns the first
// matching file in the following precedence.
//
// require("a.<ext>")–
//   -> a.<ext>
//
// require("a")
//   -> a
//   -> a.<ext>
//   -> a/index.<ext>

// check if the directory is a package.json dir
const packageMainCache = {};

function readPackage(requestPath) {
  if (hasOwnProperty(packageMainCache, requestPath)) {
    return packageMainCache[requestPath];
  }

  const jsonPath = path.resolve(requestPath, 'package.json');
  const json = internalModuleReadFile(path._makeLong(jsonPath));

  if (json === undefined) {
    return false;
  }

  try {
    var pkg = packageMainCache[requestPath] = JSON.parse(json).main;
  } catch (e) {
    e.path = jsonPath;
    e.message = 'Error parsing ' + jsonPath + ': ' + e.message;
    throw e;
  }
  return pkg;
}

function tryPackage(requestPath, exts, isMain) {
  var pkg = readPackage(requestPath);

  if (!pkg) return false;

  var filename = path.resolve(requestPath, pkg);
  return tryFile(filename, isMain) ||
         tryExtensions(filename, exts, isMain) ||
         tryExtensions(path.resolve(filename, 'index'), exts, isMain);
}

// In order to minimize unnecessary lstat() calls,
// this cache is a list of known-real paths.
// Set to an empty Map to reset.
const realpathCache = new Map();

const realpathCacheKey = fs.realpathCacheKey;
delete fs.realpathCacheKey;

// check if the file exists and is not a directory
// if using --preserve-symlinks and isMain is false,
// keep symlinks intact, otherwise resolve to the
// absolute realpath.
function tryFile(requestPath, isMain) {
  const rc = stat(requestPath);
  if (preserveSymlinks && !isMain) {
    return rc === 0 && path.resolve(requestPath);
  }
  return rc === 0 && toRealPath(requestPath);
}

function toRealPath(requestPath) {
  return fs.realpathSync(requestPath, {
    [realpathCacheKey]: realpathCache
  });
}

// given a path check a the file exists with any of the set extensions
function tryExtensions(p, exts, isMain) {
  for (var i = 0; i < exts.length; i++) {
    const filename = tryFile(p + exts[i], isMain);

    if (filename) {
      return filename;
    }
  }
  return false;
}

var warned = false;
Module._findPath = function(request, paths, isMain) {
  if (path.isAbsolute(request)) {
    paths = [''];
  } else if (!paths || paths.length === 0) {
    return false;
  }

  const cacheKey = JSON.stringify({request: request, paths: paths});
  if (Module._pathCache[cacheKey]) {
    return Module._pathCache[cacheKey];
  }

  var exts;
  const trailingSlash = request.length > 0 &&
                        request.charCodeAt(request.length - 1) === 47/*/*/;

  // For each path
  for (var i = 0; i < paths.length; i++) {
    // Don't search further if path doesn't exist
    const curPath = paths[i];
    if (curPath && stat(curPath) < 1) continue;
    var basePath = path.resolve(curPath, request);
    var filename;

    const rc = stat(basePath);
    if (!trailingSlash) {
      if (rc === 0) {  // File.
        if (preserveSymlinks && !isMain) {
          filename = path.resolve(basePath);
        } else {
          filename = toRealPath(basePath);
        }
      } else if (rc === 1) {  // Directory.
        if (exts === undefined)
          exts = Object.keys(Module._extensions);
        filename = tryPackage(basePath, exts, isMain);
      }

      if (!filename) {
        // try it with each of the extensions
        if (exts === undefined)
          exts = Object.keys(Module._extensions);
        filename = tryExtensions(basePath, exts, isMain);
      }
    }

    if (!filename && rc === 1) {  // Directory.
      if (exts === undefined)
        exts = Object.keys(Module._extensions);
      filename = tryPackage(basePath, exts, isMain);
    }

    if (!filename && rc === 1) {  // Directory.
      // try it with each of the extensions at "index"
      if (exts === undefined)
        exts = Object.keys(Module._extensions);
      filename = tryExtensions(path.resolve(basePath, 'index'), exts, isMain);
    }

    if (filename) {
      // Warn once if '.' resolved outside the module dir
      if (request === '.' && i > 0) {
        if (!warned) {
          warned = true;
          process.emitWarning(
            'warning: require(\'.\') resolved outside the package ' +
            'directory. This functionality is deprecated and will be removed ' +
            'soon.',
            'DeprecationWarning');
        }
      }

      Module._pathCache[cacheKey] = filename;
      return filename;
    }
  }
  return false;
};

// 'node_modules' character codes reversed
var nmChars = [ 115, 101, 108, 117, 100, 111, 109, 95, 101, 100, 111, 110 ];
var nmLen = nmChars.length;
if (process.platform === 'win32') {
  // 'from' is the __dirname of the module.
  Module._nodeModulePaths = function(from) {
    // guarantee that 'from' is absolute.
    from = path.resolve(from);

    // note: this approach *only* works when the path is guaranteed
    // to be absolute.  Doing a fully-edge-case-correct path.split
    // that works on both Windows and Posix is non-trivial.

    // return root node_modules when path is 'D:\\'.
    // path.resolve will make sure from.length >=3 in Windows.
    if (from.charCodeAt(from.length - 1) === 92/*\*/ &&
        from.charCodeAt(from.length - 2) === 58/*:*/)
      return [from + 'node_modules'];

    const paths = [];
    var p = 0;
    var last = from.length;
    for (var i = from.length - 1; i >= 0; --i) {
      const code = from.charCodeAt(i);
      // The path segment separator check ('\' and '/') was used to get
      // node_modules path for every path segment.
      // Use colon as an extra condition since we can get node_modules
      // path for dirver root like 'C:\node_modules' and don't need to
      // parse driver name.
      if (code === 92/*\*/ || code === 47/*/*/ || code === 58/*:*/) {
        if (p !== nmLen)
          paths.push(from.slice(0, last) + '\\node_modules');
        last = i;
        p = 0;
      } else if (p !== -1) {
        if (nmChars[p] === code) {
          ++p;
        } else {
          p = -1;
        }
      }
    }

    return paths;
  };
} else { // posix
  // 'from' is the __dirname of the module.
  Module._nodeModulePaths = function(from) {
    // guarantee that 'from' is absolute.
    from = path.resolve(from);
    // Return early not only to avoid unnecessary work, but to *avoid* returning
    // an array of two items for a root: [ '//node_modules', '/node_modules' ]
    if (from === '/')
      return ['/node_modules'];

    // note: this approach *only* works when the path is guaranteed
    // to be absolute.  Doing a fully-edge-case-correct path.split
    // that works on both Windows and Posix is non-trivial.
    const paths = [];
    var p = 0;
    var last = from.length;
    for (var i = from.length - 1; i >= 0; --i) {
      const code = from.charCodeAt(i);
      if (code === 47/*/*/) {
        if (p !== nmLen)
          paths.push(from.slice(0, last) + '/node_modules');
        last = i;
        p = 0;
      } else if (p !== -1) {
        if (nmChars[p] === code) {
          ++p;
        } else {
          p = -1;
        }
      }
    }

    // Append /node_modules to handle root paths.
    paths.push('/node_modules');

    return paths;
  };
}


// 'index.' character codes
var indexChars = [ 105, 110, 100, 101, 120, 46 ];
var indexLen = indexChars.length;
Module._resolveLookupPaths = function(request, parent) {
  if (NativeModule.nonInternalExists(request)) {
    return [request, []];
  }

  var reqLen = request.length;
  // Check for relative path
  if (reqLen < 2 ||
      request.charCodeAt(0) !== 46/*.*/ ||
      (request.charCodeAt(1) !== 46/*.*/ &&
       request.charCodeAt(1) !== 47/*/*/)) {
    var paths = modulePaths;
    if (parent) {
      if (!parent.paths)
        paths = parent.paths = [];
      else
        paths = parent.paths.concat(paths);
    }

    // Maintain backwards compat with certain broken uses of require('.')
    // by putting the module's directory in front of the lookup paths.
    if (request === '.') {
      if (parent && parent.filename) {
        paths.unshift(path.dirname(parent.filename));
      } else {
        paths.unshift(path.resolve(request));
      }
    }

    return [request, paths];
  }

  // with --eval, parent.id is not set and parent.filename is null
  if (!parent || !parent.id || !parent.filename) {
    // make require('./path/to/foo') work - normally the path is taken
    // from realpath(__filename) but with eval there is no filename
    var mainPaths = ['.'].concat(Module._nodeModulePaths('.'), modulePaths);
    return [request, mainPaths];
  }

  // Is the parent an index module?
  // We can assume the parent has a valid extension,
  // as it already has been accepted as a module.
  const base = path.basename(parent.filename);
  var parentIdPath;
  if (base.length > indexLen) {
    var i = 0;
    for (; i < indexLen; ++i) {
      if (indexChars[i] !== base.charCodeAt(i))
        break;
    }
    if (i === indexLen) {
      // We matched 'index.', let's validate the rest
      for (; i < base.length; ++i) {
        const code = base.charCodeAt(i);
        if (code !== 95/*_*/ &&
            (code < 48/*0*/ || code > 57/*9*/) &&
            (code < 65/*A*/ || code > 90/*Z*/) &&
            (code < 97/*a*/ || code > 122/*z*/))
          break;
      }
      if (i === base.length) {
        // Is an index module
        parentIdPath = parent.id;
      } else {
        // Not an index module
        parentIdPath = path.dirname(parent.id);
      }
    } else {
      // Not an index module
      parentIdPath = path.dirname(parent.id);
    }
  } else {
    // Not an index module
    parentIdPath = path.dirname(parent.id);
  }
  var id = path.resolve(parentIdPath, request);

  // make sure require('./path') and require('path') get distinct ids, even
  // when called from the toplevel js file
  if (parentIdPath === '.' && id.indexOf('/') === -1) {
    id = './' + id;
  }

  debug('RELATIVE: requested: %s set ID to: %s from %s', request, id,
        parent.id);

  return [id, [path.dirname(parent.filename)]];
};


// Check the cache for the requested file.
// 1. If a module already exists in the cache: return its exports object.
// 2. If the module is native: call `NativeModule.require()` with the
//    filename and return the result.
// 3. Otherwise, create a new module for the file and save it to the cache.
//    Then have it load  the file contents before returning its exports
//    object.
Module._load = function(request, parent, isMain) {
  // console.log("Module._load: %s %s (%s)", request, parent, isMain);
  if (parent) {
    debug('Module._load REQUEST %s parent: %s', request, parent.id);
  }
  var filename = Module._resolveFilename(request, parent, isMain);

  var cachedModule = Module._cache[filename];
  if (cachedModule) {
      return cachedModule.exports;
  }

  if (NativeModule.nonInternalExists(filename)) {
  	debug('load non-internal native module %s', request);
    return NativeModule.require(filename);
  }

  var module = new Module(filename, parent);

  if (isMain) {
    process.mainModule = module;
    module.id = '.';
    module.isMain = true;
  }

  Module._cache[filename] = module;

  tryModuleLoad(module, filename);
  return module.exports;
};

function tryModuleLoad(module, filename) {
  var threw = true;
  try {
    module.load(filename);
    threw = false;
  } finally {
    if (threw) {
      delete Module._cache[filename];
    }
  }
}

Module._resolveFilename = function(request, parent, isMain) {
  if (NativeModule.nonInternalExists(request)) {
    return request;
  }

  var resolvedModule = Module._resolveLookupPaths(request, parent);
  var id = resolvedModule[0];
  var paths = resolvedModule[1];

  // look up the filename first, since that's the cache key.
  // debug('looking for %j in %j', id, paths);
  // console.log('looking for %j in %j', id, paths);

  var filename = Module._findPath(request, paths, isMain);
  if (!filename) {
    var err = new Error("Cannot find module '" + request + "'");
    err.code = 'MODULE_NOT_FOUND';
    throw err;
  }

  return filename;
};


// Given a file name, pass it to the proper extension handler.
Module.prototype.load = function(filename) {
  debug('load %j for module %j', filename, this.id);

  assert(!this.loaded);
  this.filename = filename;
  this.paths = Module._nodeModulePaths(path.dirname(filename));

  var extension = path.extname(filename) || '.js';
  if (!Module._extensions[extension]) extension = '.js';
  Module._extensions[extension](this, filename);
  this.loaded = true;
};


// Loads a module at the given file path. Returns that module's
// `exports` property.
Module.prototype.require = function(rpath) {
  assert(rpath, 'missing path');
  assert(typeof rpath === 'string', 'path must be a string');

  var module = Module._load(rpath, this, /* isMain */ false);
  return module;
};


// Resolved path to process.argv[1] will be lazily placed here
// (needed for setting breakpoint when called with --debug-brk)
var resolvedArgv;


// Run the file contents in the correct scope or sandbox. Expose
// the correct helper variables (require, module, exports) to
// the file.
// Returns exception, if any.
Module.prototype._compile = function(content, filename) {
  // Remove shebang
  var contLen = content.length;
  if (contLen >= 2) {
    if (content.charCodeAt(0) === 35/*#*/ &&
        content.charCodeAt(1) === 33/*!*/) {
      if (contLen === 2) {
        // Exact match
        content = '';
      } else {
        // Find end of shebang line and slice it off
        var i = 2;
        for (; i < contLen; ++i) {
          var code = content.charCodeAt(i);
          if (code === 10/*\n*/ || code === 13/*\r*/)
            break;
        }
        if (i === contLen)
          content = '';
        else {
          // Note that this actually includes the newline character(s) in the
          // new output. This duplicates the behavior of the regular expression
          // that was previously used to replace the shebang line
          content = content.slice(i);
        }
      }
    }
  }

  var dirname = path.dirname(filename);
  var sourceModule = Module.convertFileNameToModule(dirname);
  var dirnameArray = dirname.split(path.sep);

  var wrapper = content;
  if (sourceModule !== "(node-application)") {
    // load source module permissions
    let sourceModuleRootDir = dirnameArray.slice(0, dirnameArray.indexOf(sourceModule) + 1).join(path.sep);
    let sourceModulePermissions = Module.loadPermissions(sourceModuleRootDir);
    if (!sourceModulePermissions.has("all")) {
      wrapper = nodesbox.rewrite(wrapper);
    }  else { wrapper = Module.wrap(wrapper); }
  }
  else { wrapper = Module.wrap(wrapper); }

  var compiledWrapper = vm.runInThisContext(wrapper, {
    filename: filename,
    lineOffset: 0,
    displayErrors: true
  });

  if (process._debugWaitConnect) {
    if (!resolvedArgv) {
      // we enter the repl if we're not given a filename argument.
      if (process.argv[1]) {
        resolvedArgv = Module._resolveFilename(process.argv[1], null);
      } else {
        resolvedArgv = 'repl';
      }
    }

    // Set breakpoint on module start
    if (filename === resolvedArgv) {
      delete process._debugWaitConnect;
      const Debug = vm.runInDebugContext('Debug');
      Debug.setBreakPoint(compiledWrapper, 0, 0);
    }
  }

  var require = internalModule.makeRequireFunction.call(this);
  // --------------------------------------------------------------------------
  // replace 'require' function with 'require' with permissions checking
  var newRequire = Module.wrapRequire(require, "require", sourceModule, dirname);
  // --------------------------------------------------------------------------

  var args = [this.exports, newRequire, this, filename, dirname];
  // var args = [this.exports, require, this, filename, dirname];
  var depth = internalModule.requireDepth;
  if (depth === 0) stat.cache = new Map();
  var result = compiledWrapper.apply(this.exports, args);
  if (depth === 0) stat.cache = null;
  return result;
};

Module.isLocalImport = function(module) {
  return module.startsWith("\./") || module.startsWith("\.\./") ||
    module.startsWith("\/") || module.endsWith("\.json");
}

Module.wrapRequire = function(require, resource, origin, dirname) {
  var handler = {
    apply: function(target, that, args) {

      var result = target.apply(that, args);
      if (result == undefined) return result;

      // resolve source and target modules
      var sourceModule = origin;
      var targetModule = Module.isLocalImport(args[0]) ? origin : args[0];

      // console.log(sourceModule + " IMPORT-MODULE " + targetModule);
      if (sourceModule !== targetModule) {
        let sourceModuleRootDir = dirname;
        let targetModuleRootDir = dirname;

        var dirnameArray = dirname.split(path.sep);

        // resolves source module directory:
        // handles cases where sourceModule is not the application
        if (sourceModule !== "(node-application)") {
          sourceModuleRootDir = dirnameArray.slice(0, dirnameArray.indexOf(sourceModule) + 1).join(path.sep);
        }
        // load source module permissions
        const sourceModulePermissions = Module.loadPermissions(sourceModuleRootDir);

        let targetModulePermissions = [];
        if (Module.isCoreLib(targetModule)) {  // load core libraries fixed permissions
          targetModulePermissions = Module.getPermissions(targetModule);

        } else { // load external libraries permissions from directory
          // resolves target module directory:
          let targetModuleRootDirArr = dirnameArray;
          if (dirnameArray.includes("node_modules")) {
            targetModuleRootDirArr = dirnameArray.slice(0, dirnameArray.indexOf("node_modules") + 1);
          } else {
            targetModuleRootDirArr.push("node_modules");
          }
          targetModuleRootDirArr.push(targetModule);
          targetModuleRootDir = targetModuleRootDirArr.join(path.sep);

          // load target module permissions
          targetModulePermissions = Module.loadPermissions(targetModuleRootDir);
        }
        if (sourceModulePermissions.has("all")) {
          return result;
        }

        // console.log("*** Loading permissions for module %s [%s]  trying to access module: %s [%s]", sourceModule, Array.from(sourceModulePermissions), targetModule, Array.from(targetModulePermissions));
        if (!Module.checkPermission(sourceModulePermissions, targetModulePermissions)) {
          // ########### to generate files before running ###########
          //Module.createPermissionFile(sourceModuleRootDir, targetModulePermissions);
          // ########################################################

          console.error("[PERM-ERROR-REPORT] Module %s [%s] does not have permission to import module %s [%s]", sourceModule, Array.from(sourceModulePermissions), targetModule, Array.from(targetModulePermissions));
          return result;
        }
      }
      return result;
    }
  };
  return new Proxy(require, handler);
};

Module.createPermissionFile = function(moduleRootDir, targetModulePermissions) {
  var permFile = util.format("%s/permissions.txt", moduleRootDir);
  let writeStream = fs.createWriteStream(permFile, { flags: 'a' });
  writeStream.write("\n");
  targetModulePermissions.forEach(function (m) {
    writeStream.write(m + "\n");
  });
  writeStream.end();
}

Module.getPermissions = function(moduleName) {
  return Module.permissions[moduleName];
}

Module.loadPermissions = function(moduleRootDir) {
  var permFile = util.format("%s/permissions.txt", moduleRootDir);
  var permissions = [];

  if (Module.permissions[moduleRootDir] != undefined) {
    return Module.permissions[moduleRootDir];
  }
  try {
      if (fs.existsSync(permFile)) {
        permissions = fs.readFileSync(permFile).toString().split("\n");
        permissions = permissions.filter(function(e) { return (typeof e === 'string') && !!e; });
      } else {
        let writeStream = fs.createWriteStream(permFile);
        writeStream.write("");
        writeStream.end();
      }
    } catch(error) {
    console.error("*** [PERM-ERROR] No permission file for " + permFile, error);
  }
  Module.permissions[moduleRootDir] = new Set(permissions);
  return new Set(permissions);
};

Module.hasAllPermission = function(sourceModulePermissions) {
  return sourceModulePermissions.has("all");
};

Module.checkPermission = function(sourceModulePermissions, targetModulePermissions) {
  var diff = false;
  targetModulePermissions.forEach(function(elem) {
    if (!sourceModulePermissions.has(elem)) { diff=true; }
  });
  return !diff;
};

Module.convertFileNameToModule = function(filename, rootDir="") {
  var modulename = "(node-application)";
  if (filename != undefined && rootDir != undefined) {
    filename = filename.replace(rootDir, "");

    var fileStringArray = filename.split(path.sep);
    var nodeModulesIndex = fileStringArray.indexOf('node_modules');


    // look up on node_modules dir
    if (filename.includes("node_modules")) {
      modulename = fileStringArray[nodeModulesIndex+1];
      // if it is a scoped package, go one level deeper
      if (modulename.charAt('0') === '@') {
      	modulename += path.sep + fileStringArray[nodeModulesIndex+2];
      }
    }
  }
  return modulename;
};

Module.isCoreLib = function(moduleName) {
  return ['fs', 'http', 'https', 'http2', 'child_process', 'net'].includes(moduleName);
};
// --------------------------------------------------------------------------
// --------------------------------------------------------------------------

// Native extension for .js
Module._extensions['.js'] = function(module, filename) {
  var content = fs.readFileSync(filename, 'utf8');
  module._compile(internalModule.stripBOM(content), filename);
};


// Native extension for .json
Module._extensions['.json'] = function(module, filename) {
  var content = fs.readFileSync(filename, 'utf8');
  try {
    module.exports = JSON.parse(internalModule.stripBOM(content));
  } catch (err) {
    err.message = filename + ': ' + err.message;
    throw err;
  }
};


//Native extension for .node
Module._extensions['.node'] = function(module, filename) {
  return process.dlopen(module, path._makeLong(filename));
};


// bootstrap main module.
Module.runMain = function() {
  // Load the main module--the command line argument.
  Module._load(process.argv[1], null, true);
  // Handle any nextTicks added in the first tick of the program
  process._tickCallback();
};

Module._initPaths = function() {
  const isWindows = process.platform === 'win32';

  var homeDir;
  if (isWindows) {
    homeDir = process.env.USERPROFILE;
  } else {
    homeDir = process.env.HOME;
  }

  var paths = [path.resolve(process.execPath, '..', '..', 'lib', 'node')];

  if (homeDir) {
    paths.unshift(path.resolve(homeDir, '.node_libraries'));
    paths.unshift(path.resolve(homeDir, '.node_modules'));
  }

  var nodePath = process.env['NODE_PATH'];
  if (nodePath) {
    paths = nodePath.split(path.delimiter).filter(function(path) {
      return !!path;
    }).concat(paths);
  }

  modulePaths = paths;

  // clone as a shallow copy, for introspection.
  Module.globalPaths = modulePaths.slice(0);
};

Module._preloadModules = function(requests) {
  if (!Array.isArray(requests))
    return;

  // Preloaded modules have a dummy parent module which is deemed to exist
  // in the current working directory. This seeds the search path for
  // preloaded modules.
  var parent = new Module('internal/preload', null);
  try {
    parent.paths = Module._nodeModulePaths(process.cwd());
  } catch (e) {
    if (e.code !== 'ENOENT') {
      throw e;
    }
  }
  requests.forEach(function(request) {
    parent.require(request);
  });
};

Module._initPaths();

// backwards compatibility
Module.Module = Module;

