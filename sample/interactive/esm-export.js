// Consider using inquirer instead
const prompts = require('prompts');

const ansiColors = require('ansi-colors');
const {highlight} = require('cli-highlight');

// TODO: add ability to remember answers

class Questions {
  constructor() {
    // TODO: don't make this publicly visible
    this.questions = [];
  }

  addPrompt = (...promptDescriptor) => this.questions.push(...promptDescriptor);

  gatherAnswers = async () => {
    const answers = {};
    for (const prompt of this.questions) {
      const answer = await prompts(prompt);
      Object.assign(answers, answer);
    }
    return answers;
  }
}

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

  let questions = new Questions();

  j(file.source)
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
    .forEach(node => {
      

      const exportNames = node.value.right.properties.map(({key}) => ({title: key.name, value: key.name}));

      questions.addPrompt(getPromptForNode(node, {
        type: 'multiselect',
        name: 'exportType',
        message: 'Choose the exports that should be named exports.',
        choices: exportNames
      }));
    });

    const answers = await questions.gatherAnswers();
    console.log({answers});

    console.log('end', file.path);
}

module.exports = transformer;
