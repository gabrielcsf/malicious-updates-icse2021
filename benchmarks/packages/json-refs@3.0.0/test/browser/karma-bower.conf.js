/* Karma configuration for Bower build */

'use strict';

module.exports = function (config) {
  console.log();
  console.log('Browser (Bower) Tests');
  console.log();

  config.set({
    basePath: '.',
    frameworks: ['mocha'],
    files: [
      {pattern: 'vendor/lodash.min.js', watch: false}, // Manually loaded first to avoid graphlib load issue
      {pattern: 'vendor/**/*', watch: false, included: true},
      {pattern: 'json-refs.js', watch: false, included: true},
      {pattern: 'test-browser.js', watch: false, included: true},
      {pattern: 'documents/**/*', watched: false, included: false, served: true}
    ],
    client: {
      mocha: {
        reporter: 'html',
        timeout: 10000,
        ui: 'bdd'
      }
    },
    plugins: [
      'karma-mocha',
      'karma-mocha-reporter',
      'karma-phantomjs-launcher'
    ],
    browsers: ['PhantomJS'],
    reporters: ['mocha'],
    colors: true,
    autoWatch: false,
    singleRun: true
  });
};
