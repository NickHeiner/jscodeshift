// Consider using inquirer instead
const prompts = require('prompts');

const ansiColors = require('ansi-colors');
const {highlight} = require('cli-highlight');

// TODO: add ability to remember answers

// TODO add an example that produces multiple prompts for a single file.
// TODO add ability to run this against more than one file at a time.

async function transformer(file, api) {
  const maxLinesToShow = 10;
  const getPromptForNode = (node, prompt) => {
    const startLine = node.value.loc.start.line;
    const endLine = node.value.loc.end.line;
    const nodeLineLength = endLine - startLine;
    const startLineToShow = Math.max(0, endLine - Math.max(nodeLineLength, maxLinesToShow));
  
    const codeLines = highlight(file.source, {language: 'js'}).split('\n');
    const codeSample = codeLines
      .slice(startLineToShow, endLine)
      .map((line, index) => `${ansiColors.white(index + startLineToShow)}\t${line}`)
      .join('\n');
  
    return {
      ...prompt,
  
      message: `${file.path}: ${prompt.message}`,
      hint: `\n${codeSample}`
    }
  }

  console.log('start', file.path);
  const j = api.jscodeshift;

  await j(file.source)
    .find(j.AssignmentExpression, {
      operator: '=',
      left: {
        type: 'MemberExpression',
        object: {
          type: 'Identifier',
          name: 'module'
        },
        property: { name: 'exports' }
      }
    })
    .filter(p => p.parentPath.parentPath.name === 'body')
    .forEachAsync(async node => {
      const exportNames = node.value.right.properties.map(({key}) => ({title: key.name, value: key.name}));

      const answer = await prompts(getPromptForNode(node, {
        type: 'multiselect',
        name: 'exportType',
        message: 'Choose the exports that should be named exports.',
        choices: exportNames
      }));

      console.log({answer});
    });

    console.log('end', file.path);
}

module.exports = transformer;
