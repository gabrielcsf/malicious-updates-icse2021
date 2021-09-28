var vm = require('vm'),
  code = 'var square = n * n;',
  fn = new Function('n', code),
  script = vm.createScript(code),
  sandbox;

n = 5;
sandbox = { n: n };

benchmark = function(title, funk) {
  var end, i, start;
  start = new Date;
  for (i = 0; i < 5000; i++) {
    funk();
  }
  end = new Date;
  console.log(title + ': ' + (end - start) + 'ms');
}

var ctx = vm.createContext(sandbox);
benchmark('vm.runInThisContext',     function() { vm.runInThisContext(code); });
benchmark('vm.runInProxiedContext',  function() { vm.runInProxiedContext(code, sandbox); });
benchmark('vm.runInSameContext',     function() { vm.runInSameContext(code, sandbox); });
benchmark('vm.runInNewContext',      function() { vm.runInNewContext(code, sandbox); });
benchmark('script.runInThisContext', function() { script.runInThisContext(); });
benchmark('script.runInNewContext',  function() { script.runInNewContext(sandbox); });
benchmark('script.runInContext',     function() { script.runInContext(ctx); });
benchmark('fn',                      function() { fn(n); });

/*
vm.runInThisContext: 10ms
vm.runInNewContext: 1432ms
script.runInThisContext: 4ms
script.runInNewContext: 1426ms
script.runInContext: 49ms
fn: 0ms
*/

