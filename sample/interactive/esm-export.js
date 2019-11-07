const prompts = require('prompts');

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

async function transformer(file, api) {
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

      questions.addPrompt({
        type: 'multiselect',
        name: 'exportType',
        message: 'Choose the exports that should be named exports.',
        choices: exportNames
      });
    });

    const answers = await questions.gatherAnswers();
    console.log({answers});
}

module.exports = transformer;
