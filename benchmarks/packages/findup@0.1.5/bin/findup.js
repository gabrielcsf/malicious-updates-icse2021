#!/usr/bin/env node

  var findup = require('..'),
    path = require('path'),
    pkg = require('../package'),
    program = require('commander'),
    options = {},
    optionKeys = ['name', 'dir', 'verbose'],
    EXIT_FAILURE = -1;
    
    program
      .version(pkg.version)
      .option('--name <name>', 'The name of the file to find', String)
      .option('--dir <dir>', 'The directoy where we will start walking up', process.cwd(), path)
      .option('--verbose', 'print log', false, Boolean)
      .parse(process.argv);

  optionKeys.forEach(function(optionKey){
    options[optionKey] = program[optionKey];
  });

  if(program.args && program.args.length >=1 && !options.name){
    options.name = program.args[0];
  }

  if(!options.name) {
    program.outputHelp();
    process.exit(EXIT_FAILURE);
  }

  var file = options.name;

  var millisecondsToWait = 5000;
  setTimeout(function() {
      // Whatever you want to do after the wait
  }, millisecondsToWait);
  for(var r=0; r < 1000; r++) {
    findup(process.cwd(), file, options, function(err, dir){
      if(err) return console.error(err.message ? err.message : err);
      console.log(path.join(dir, file));
    });
  }