

// TODO add an example that produces multiple prompts for a single file.

async function transformer(file, api) {
  const j = api.jscodeshift;

  const nodes = j(file.source)
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
    .filter(p => p.parentPath.parentPath.name === 'body');

  await nodes.forEachAsync(async node => {
      const exportNames = node.value.right.properties.map(({key}) => ({title: key.name, value: key.name}));

      const {namedExports} = await api.prompt(node, {
        type: 'multiselect',
        name: 'namedExports',
        message: 'Choose the exports that should be converted to named exports.',
        choices: exportNames
      });

      const propertiesWithoutNamedExports = 
        node.value.right.properties.filter(({key: {name}}) => !namedExports.includes(name));

      node.value.right.properties = propertiesWithoutNamedExports;

      j(node).replaceWith(node.value);
    });

    // TODO: Make the normal chaining work, instead of having forEachAsync be terminal.
    return nodes.toSource();
}

module.exports = transformer;
