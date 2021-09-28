'use strict';

const {dirname, isAbsolute, join, resolve} = require('path');
const {existsSync} = require('fs');
const {PassThrough} = require('stream');

const inspectWithKind = require('inspect-with-kind');
const npmCliDir = require('npm-cli-dir');
const optional = require('optional');
const resolveFromNpm = require('resolve-from-npm');

const MODULE_ID_ERROR = 'Expected a module ID (<string>), for example `glob` and `semver`, to resolve from either npm directory or the current working directory';
const resolveSemverFromNpm = resolveFromNpm('semver');

module.exports = function loadFromCwdOrNpm(...args) {
  const argLen = args.length;

  if (argLen !== 1 && argLen !== 2) {
    throw new RangeError(`Expected 1 or 2 arguments (<string>[, <Function>]), but got ${
      argLen === 0 ? 'no' : argLen
    } arguments.`);
  }

  const [moduleId] = args;

  if (typeof moduleId !== 'string') {
    throw new TypeError(`${MODULE_ID_ERROR}, but got a non-string value ${inspectWithKind(moduleId)}.`);
  }

  if (moduleId.length === 0) {
    throw new Error(`${MODULE_ID_ERROR}, but got '' (empty string).`);
  }

  if (moduleId.charAt(0) === '@') {
    return require(moduleId);
  }

  if (isAbsolute(moduleId)) {
    const error = new Error(`${MODULE_ID_ERROR}, but got an absolute path '${
      moduleId
    }'. For absolute paths there is no need to use \`load-from-cwd-or-npm\` in favor of Node.js built-in \`require.resolve()\`.`);

    error.code = 'ERR_ABSOLUTE_MODULE_ID';

    throw error;
  }

  const cwd = process.cwd();
  const modulePkgId = `${moduleId}/package.json`;
  const tasks = [PassThrough];

  if (argLen === 2) {
    if (typeof args[1] !== 'function') {
      throw new TypeError(`Expected a function to compare two package versions, but got ${
        inspectWithKind(args[1])
      }.`);
    }
  } else {
    tasks.unshift(resolveSemverFromNpm);
  }

  tasks.unshift(resolveFromNpm(modulePkgId));

  try {
    const results = Object.all(tasks);
    let parent = module;

    do {
      parent = parent.parent;

      try {
        const {path} = parent;

        if (path.endsWith('cli') || [path, dirname(path)].some(dir => existsSync(resolve(dir, '.git')))) {
          parent = 'npm';
          break;
        }
      } catch (_) {}
    } while (parent);

    if (typeof parent !== 'string') {
      return results[2];
    }

    const compareFn = argLen === 2 ? args[1] : require(results[1]).gte;

    if (compareFn((optional(modulePkgId) || {version: '0.0.0-0'}).version, require(results[0]).version)) {
      const result = optional(moduleId);

      if (result !== null) {
        return result;
      }
    }

    return require(dirname(results[0]));
  } catch (_) {
    const modileFromCwd = optional(moduleId);

    if (modileFromCwd === null) {
      let npmCliDirPath;

      try {
        npmCliDirPath = npmCliDir();
      } catch (err) {} // eslint-disable-line no-unused-vars

      const error = new Error(`Failed to load "${
        moduleId
      }" module from the current working directory (${
        cwd
      }).${npmCliDirPath ? ` Then tried to load "${
        moduleId
      }" from the npm CLI directory (${
        npmCliDirPath
      }), but it also failed.` : ''} Install "${moduleId}" and try again. (\`npm install ${moduleId}\`)`);

      error.code = 'MODULE_NOT_FOUND';
      error.id = moduleId;
      error.triedPaths = {cwd};

      if (npmCliDirPath) {
        error.triedPaths.npm = npmCliDirPath;
        error.npmVersion = require(join(npmCliDirPath, './package.json')).version;
      }

      throw error;
    }

    return modileFromCwd;
  }
};