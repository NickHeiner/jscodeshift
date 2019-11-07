

// TODO: add ability to remember answers

// TODO add an example that produces multiple prompts for a single file.

async function transformer(file, api) {

  // console.log('start', file.path);
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

      const answer = await api.prompt(node, {
        type: 'multiselect',
        name: 'exportType',
        message: 'Choose the exports that should be named exports.',
        choices: exportNames
      });

      console.log({answer});
    });

    // console.log('end', file.path);
}

module.exports = transformer;
