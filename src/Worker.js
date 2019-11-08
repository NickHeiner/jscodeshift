
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

const makeScheduler = require('./utils/runWithGlobalLock');
const runWithGlobalLock = makeScheduler();

function free() {
  notify({action: 'free'});
}

// These locks should possibly be moved further upstream, to the point where the messages are written to the console.
// That can be done when this adds cross-process support.

function updateStatus(status, file, msg) {
  msg = msg ? file + ' ' + msg : file;
  runWithGlobalLock(() => notify({action: 'status', status: status, msg: msg}));
}

function report(file, msg) {
  runWithGlobalLock(() => notify({action: 'report', file, msg}));
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

// Consider using inquirer instead
// The key advantage I see is the BottomBar functionality. But I'm not sure that'll work in our scenario of interleaved
// questions and other output.
const prompts = require('prompts');

const ansiColors = require('ansi-colors');
const {highlight} = require('cli-highlight');

const writeJsonFile = require('write-json-file');
const loadJsonFile = require('load-json-file');
const crypto = require('crypto');

const hash = crypto.createHash('sha256');

const ensureJsonFileExists = filePath => {
  try {
    return loadJsonFile.sync(filePath);
  } catch (e) {
    if (e.code === 'ENOENT') {
      writeJsonFile.sync(filePath, {})
      return {};
    }
    throw e;
  }
}

const getAnswerCache = () => {
  // TODO: make this a jscodeshift arg instead of a env var.
  if (!process.env.ANSWER_CACHE_FILE_PATH) {
    return {
      getCachedAnswer() {},
      cacheAnswer() {},
      writeCacheToDisk() {}
    }
  }

  // I wonder if using fileInfo.path is a good hash key. If the user runs the codemod from a different root dir,
  // it would invalidate the entire cache.

  const cache = ensureJsonFileExists(process.env.ANSWER_CACHE_FILE_PATH);

  // hash.copy() was added in Node 13.
  const hashOfFile = fileInfo => hash.copy().update(fileInfo.source).digest('hex');

  return {
    getCachedAnswer(fileInfo) {
      const cachedEntry = cache[fileInfo.path];
      if (!cachedEntry) {
        return;
      }
      const sourceHash = hashOfFile(fileInfo);
      if (cachedEntry.hash === sourceHash) {
        return cachedEntry.answers;
      }
    },
    cacheAnswer(fileInfo, answers) {
      cache[fileInfo.path] = {
        hash: hashOfFile(fileInfo),
        answers
      }
    },
    async writeCacheToDisk() {
      await writeJsonFile(process.env.ANSWER_CACHE_FILE_PATH, cache);
    }
  }
}

const answerCache = getAnswerCache();

let userChoseToSaveAndExit = false;

const maxLinesToShow = 10;
const makePromptApi = (fileInfo, onCancel, filesRemainingToProcess) => async (node, prompt) => {
  const {source, path} = fileInfo;
  const startLine = node.value.loc.start.line;
  const endLine = node.value.loc.end.line;
  const nodeLineLength = endLine - startLine;
  const startLineToShow = Math.max(0, endLine - Math.max(nodeLineLength, maxLinesToShow));

  const codeLines = highlight(source, {language: 'js'}).split('\n');
  const codeSample = codeLines
    .slice(startLineToShow, endLine)
    .map((line, index) => `${ansiColors.white(index + startLineToShow)}\t${line}`)
    .join('\n');

  // TODO This only works if each file only has a single prompt.
  // And I feel that I've observed errors when running this on TVUI.
  const cachedAnswer = answerCache.getCachedAnswer(fileInfo);
  if (cachedAnswer) {
    return cachedAnswer;
  }

  // Locking here could remove the need for it in forEach
  return runWithGlobalLock(async () => {
    if (userChoseToSaveAndExit) {
      onCancel();
      return {};
    }

    const answer = await prompts({
      ...prompt,

      hotkeys: {
        d: {
          handle() {
            userChoseToSaveAndExit = true;
          },
          instruction: 'Save current progress and stop answering questions.'
        }
      },
      message: `${path}: ${prompt.message}`,
      // filesRemainingToProcess will be accurate as of the time that the transfomer starts working.
      // By the time it asks a prompt, the real value could be lower. So we'll add a <= to make it clear
      // that it's an upper bound.
      hint: `(<=${filesRemainingToProcess} files remaining)\n${codeSample}`
    }, 
    // onCancel can be passed as a field of one of a question, or it can be passed as at the top level of this call.
    // In the former case, onCancel will be called even when the user does not cancel.
    {onCancel}
  )

    // TODO: ensure that we do not cache an answer if the user canceled.

    answerCache.cacheAnswer(fileInfo, answer);
    return answer;
  })
}

function run(data) {
  const files = data.files;
  const options = data.options || {};
  if (!files.length) {
    finish();
    return;
  }

  let filesRemainingToProcess = files.length;

  // TODO: How can the user bail out when they're done?

  async.eachLimit(
    files,
    // TODO: If I don't set this, the process locks up. 
    // Maybe that would happen, even on master, when applied to 10k files?
    10,
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
            'Transformation error ('+ err.message.replace(/\n/g, ' ') + ')\n' + err.stack
          );
          callback();
        }

        try {
          const jscodeshift = prepareJscodeshift(options);

          const fileInfo = {
            path: file,
            source: source,
          };
          let userHasSkippedPrompt = false;

          const transformPromise = Promise.resolve(transform(
            fileInfo,
            {
              prompt: makePromptApi(fileInfo, () => { userHasSkippedPrompt = true; }, filesRemainingToProcess),
              j: jscodeshift,
              jscodeshift: jscodeshift,
              stats: options.dry ? stats : empty,
              report: msg => report(file, msg),
            },
            options
          ));

          transformPromise.then(out => {
            if (!out || (out === source) || userHasSkippedPrompt) {
              console.log('we out', {userHasSkippedPrompt});
              let status = out && !userHasSkippedPrompt ? 'nochange' : 'skip';
              updateStatus(status, file);
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
          }).catch(handleTransformError).finally(() => {
            filesRemainingToProcess--;
          })
        } catch(err) {
          handleTransformError(err);
        }
      });
    },
    function(err) {
      if (err) {
        updateStatus('error', '', 'This should never be shown!');
      }
      answerCache.writeCacheToDisk();
      free();
    }
  );
}
