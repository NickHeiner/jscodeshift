

// TODO add an example that produces multiple prompts for a single file.

async function transformer(file, api) {
  const j = api.jscodeshift;

  const nodes = j(file.source);

  const moduleExports = nodes
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

  let namedExports;

  await moduleExports.forEachAsync(async node => {
    const exportNames = node.value.right.properties.map(({key}) => ({title: key.name, value: key.name}));

    namedExports = (await api.prompt(node, {
      type: 'multiselect',
      name: 'namedExports',
      message: 'Choose the exports that should be converted to named exports.',
      choices: exportNames
    })).namedExports;

    const exportSpecifiers = node.value.right.properties
      .filter(({key: {name}}) => !namedExports.includes(name))
      .map(({key: {name}}) => {
        const identifier = j.identifier(name);
        return j.exportSpecifier(identifier, identifier);
      });

    // This produces a double semi-colon. Not sure why.
    // j(node).replaceWith(j.exportNamedDeclaration(null, exportSpecifiers));

    const scope = j(node).closestScope();

    namedExports.forEach(namedExport => {
      const countFunctionReplacementsMade = scope
        .find(j.FunctionDeclaration, {
          id: {
            name: namedExport
          }
        })
        .replaceWith(node => j.exportNamedDeclaration(node.value))
        .length

      if (!countFunctionReplacementsMade) {
        const countVarReplacementsMade = scope
          .find(j.VariableDeclarator, {
            id: {
              name: namedExport
            }
          })
          // .map(node => j(node).closest(j.VariableDeclaration).paths())
          .forEach(node => {
            const vd = j(node).closest(j.VariableDeclaration).replaceWith(n => j.exportNamedDeclaration(n.value));
          })
          .length

        if (!countVarReplacementsMade) {
          throw new Error(`Could not find the declaration for "${namedExport}", so it was not exported.`)
        }
      }
    })

  });

  // This doesn't work, because a function won't have a variable declaration.


  // nodes
  //   .find(j.Identifier)
  //   .filter(node => namedExports.includes(node.value.name))
  //   .forEach(node => {
  //     console.log('found', node.value);
  //   })
    // .getDeclarators(node => node.value.name)
    // .replaceWith(node => j.exportNamedDeclaration(node.value))

    // TODO: Make the normal chaining work, instead of having forEachAsync be terminal.
    return nodes.toSource();
}

module.exports = transformer;
