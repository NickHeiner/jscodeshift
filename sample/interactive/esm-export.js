

// TODO add an example that produces multiple prompts for a single file.

async function transformer(file, api) {
  if (file.path.includes('node_modules')) {
    return;
  }

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
    if (!node.value.right.properties) {
      j(node).replaceWith(j.exportDefaultDeclaration(node.value.right));
      return;
    }

    for (const property of node.value.right.properties) {
      if (property.type === 'SpreadElement') {
        // It's not valid syntax to transform this to `export {...obj, c}`. Instead, we need to do something like:
        // 
        //    const toExport = {...obj, c};
        //    export default toExport;
        // 
        // For now, we'll punt.
        api.report('Skipping this file because it contains a `...spread` in a module.exports assignment.');
        return;
      }
    }

    const exportNames = node.value.right.properties.map(({key}) => ({title: key.name, value: key.name}));

    const promptPromise = api.prompt(node, {
      type: 'multiselect',
      name: 'namedExports',
      message: 'Choose the exports that should be converted to named exports.',
      choices: exportNames
    });

    api.report('This log should not mess up the prompt');

    namedExports = (await promptPromise).namedExports;

    // TODO: This will get a bit more cumbersome when there are multiple prompts per file. What happens when you
    // skip one and not others? Ideally, that should stop all execution, but I'm not sure what the best way to do 
    // that is without getting complicated with yield.

    // If the user hit control-c, skip this file.
    if (!namedExports) {
      return;
    }

    const exportSpecifiers = node.value.right.properties
      .filter(({key: {name}}) => !namedExports.includes(name))
      .map(({key: {name}}) => {
        const identifier = j.identifier(name);
        return j.exportSpecifier(identifier, identifier);
      });

    // This produces a double semi-colon. Not sure why.
    j(node).replaceWith(j.exportNamedDeclaration(null, exportSpecifiers));

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
        let countVarReplacementsMade;
        scope
          .find(j.VariableDeclarator, {
            id: {
              name: namedExport
            }
          })
          .forEach(node => {
            // TODO Do we need forEach here? Can we do closest() and replaceWith on the top level?
            countVarReplacementsMade = j(node)
              .closest(j.VariableDeclaration)
              .replaceWith(n => j.exportNamedDeclaration(n.value)).length;
          })

        if (!countVarReplacementsMade) {
          throw new Error(`Could not find the declaration for "${namedExport}", so it was not exported.`)
        }
      }
    })
  });

  // TODO: Make the normal chaining work, instead of having forEachAsync be terminal.
  return nodes.toSource();
}

module.exports = transformer;
