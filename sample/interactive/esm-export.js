function transformer(file, api) {
  const j = api.jscodeshift;

  return j(file.source)
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
    // .filter(p => p.parentPath.parentPath.name === 'body')
    .forEach(node => {
      console.log(node.value.start, file.path);
    });
}

module.exports = transformer;
