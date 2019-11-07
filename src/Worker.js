
/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

const EventEmitter = require('events').EventEmitter;

const async = require('neo-async');
const fs = require('graceful-fs');
const writeFileAtomic = require('write-file-atomic');
const { DEFAULT_EXTENSIONS } = require('@babel/core');
const getParser = require('./getParser');

const jscodeshift = require('./core');

let emitter;
let finish;
let notify;
let transform;
let parserFromTransform;

if (module.parent) {
  emitter = new EventEmitter();
  emitter.send = (data) => { run(data); };
  finish = () => { emitter.emit('disconnect'); };
  notify = (data) => { emitter.emit('message', data); };
  module.exports = (args) => {
    setUp(args[0], args[1]);
    return emitter;
  };
} else {
  finish = () => setImmediate(() => process.disconnect());
  notify = (data) => { process.send(data); };
  process.on('message', (data) => { run(data); });
  setUp(process.argv[2], process.argv[3]);
}

function prepareJscodeshift(options) {
  const parser = parserFromTransform ||
    getParser(options.parser, options.parserConfig);
  return jscodeshift.withParser(parser);
}

function setUp(tr, babel) {
  if (babel === 'babel') {
    require('@babel/register')({
      babelrc: false,
      presets: [
        [
          require('@babel/preset-env').default,
          {targets: {node: true}},
        ],
        /\.tsx?$/.test(tr) ?
          require('@babel/preset-typescript').default :
          require('@babel/preset-flow').default,
      ],
      plugins: [
        require('@babel/plugin-proposal-class-properties').default,
      ],
      extensions: [...DEFAULT_EXTENSIONS, '.ts', '.tsx'],
      // By default, babel register only compiles things inside the current working directory.
      // https://github.com/babel/babel/blob/2a4f16236656178e84b05b8915aab9261c55782c/packages/babel-register/src/node.js#L140-L157
      ignore: [
        // Ignore parser related files
        /@babel\/parser/,
        /\/flow-parser\//,
        /\/recast\//,
        /\/ast-types\//,
      ],
    });
  }

  const module = require(tr);
  transform = typeof module.default === 'function' ?
    module.default :
    module;
  if (module.parser) {
    parserFromTransform = typeof module.parser === 'string' ?
      getParser(module.parser) :
      module.parser;
  }
}

function free() {
  notify({action: 'free'});
}

function updateStatus(status, file, msg) {
  msg = msg ? file + ' ' + msg : file;
  notify({action: 'status', status: status, msg: msg});
}

function report(file, msg) {
  notify({action: 'report', file, msg});
}

function empty() {}

function stats(name, quantity) {
  quantity = typeof quantity !== 'number' ? 1 : quantity;
  notify({action: 'update', name: name, quantity: quantity});
}

function trimStackTrace(trace) {
  if (!trace) {
    return '';
  }
  // Remove this file from the stack trace of an error thrown in the transformer
  const lines = trace.split('\n');
  const result = [];
  lines.every(function(line) {
    if (line.indexOf(__filename) === -1) {
      result.push(line);
      return true;
    }
  });
  return result.join('\n');
}

const makeScheduler = require('./utils/runWithGlobalLock');
const runWithGlobalLock = makeScheduler();

// Consider using inquirer instead
const prompts = require('prompts');

const ansiColors = require('ansi-colors');
const {highlight} = require('cli-highlight');

const maxLinesToShow = 10;
const makePromptApi = ({source, path}) => (node, prompt) => {
  const startLine = node.value.loc.start.line;
  const endLine = node.value.loc.end.line;
  const nodeLineLength = endLine - startLine;
  const startLineToShow = Math.max(0, endLine - Math.max(nodeLineLength, maxLinesToShow));

  const codeLines = highlight(source, {language: 'js'}).split('\n');
  const codeSample = codeLines
    .slice(startLineToShow, endLine)
    .map((line, index) => `${ansiColors.white(index + startLineToShow)}\t${line}`)
    .join('\n');

  // Locking here could remove the need for it in forEach
  return runWithGlobalLock(() => prompts({
    ...prompt,

    message: `${path}: ${prompt.message}`,
    hint: `\n${codeSample}`
  }))
}

function run(data) {
  const files = data.files;
  const options = data.options || {};
  if (!files.length) {
    finish();
    return;
  }
  async.each(
    files,
    function(file, callback) {
      fs.readFile(file, function(err, source) {
        if (err) {
          updateStatus('error', file, 'File error: ' + err);
          callback();
          return;
        }
        source = source.toString();

        function handleTransformError(err) {
          updateStatus(
            'error',
            file,
            'Transformation error ('+ err.message.replace(/\n/g, ' ') + ')\n' + trimStackTrace(err.stack)
          );
          callback();
        }

        try {
          const jscodeshift = prepareJscodeshift(options);

          const fileInfo = {
            path: file,
            source: source,
          };

          const transformPromise = Promise.resolve(transform(
            fileInfo,
            {
              prompt: makePromptApi(fileInfo),
              j: jscodeshift,
              jscodeshift: jscodeshift,
              stats: options.dry ? stats : empty,
              report: msg => report(file, msg),
            },
            options
          ));

          transformPromise.then(out => {
            if (!out || out === source) {
              updateStatus(out ? 'nochange' : 'skip', file);
              callback();
              return;
            }
            if (options.print) {
              console.log(out); // eslint-disable-line no-console
            }
            if (!options.dry) {
              writeFileAtomic(file, out, function(err) {
                if (err) {
                  updateStatus('error', file, 'File writer error: ' + err);
                } else {
                  updateStatus('ok', file);
                }
                callback();
              });
            } else {
              updateStatus('ok', file);
              callback();
            }
          }).catch(handleTransformError)
        } catch(err) {
          handleTransformError(err);
        }
      });
    },
    function(err) {
      if (err) {
        updateStatus('error', '', 'This should never be shown!');
      }
      free();
    }
  );
}
