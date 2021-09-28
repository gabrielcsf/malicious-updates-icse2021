var fs = require('fs');
var esprima = require('esprima');
var walk = require( 'esprima-walk' )

// input args
var args = process.argv;
var inputFile = args[2];

if (inputFile == undefined || inputFile == "") {
  throw new Error("Error: no js input file");
}

// parse input file
var ast = parseFile(args[2]);

// analyze AST
walk(ast, analyzeAST);


function analyzeAST(node, meta) {
  selectRequire(node);
  selectMetaProgramming(node);

}

function selectRequire(node) {
  if (node != undefined && node.type === 'CallExpression') {
    if ((node.callee.type === 'Identifier') && (node.callee.name === 'require')) {
      console.log("require;" + node.arguments[0].value);     
    }
  }
}

function selectMetaProgramming(node) {
  if (node != undefined && node.type === 'CallExpression') {
    if ((node.callee.type === 'Identifier') && (node.callee.name === 'eval')) {
      console.log("metaprogramming;eval");
    }  
  }
  if (node != undefined && node.type === 'NewExpression') {
    if ((node.callee.type === 'Identifier') && (node.callee.name === 'Function')) {
      console.log("metaprogramming;Function.new");
    }
  }
  // if (node != undefined && node.type === 'Identifier' && node.name === 'eval') {
  //   console.log("metaprogramming;eval");  
  // }
  // if (node != undefined && node.type === 'Identifier' && (node.name === 'Function')) {
  //   console.log("metaprogramming;Function.new");
  // }
  //console.log(node); 
} 

function parseFile(filePath, visitFunction) {
  try {  
    var data = fs.readFileSync(args[2], 'utf8');
    data = data.split('#!/usr/bin/env node').join("");

    var ast = esprima.parseScript(data, { loc : true });
    return ast;
  } catch(e) {
    console.error("Error parsing file (" + filePath + "): " + e);
  }
  
}

