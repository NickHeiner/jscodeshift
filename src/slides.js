let A, B;

// export function A() {/* ... */}
// export function B() {/* ... */}

// export function A() {/* ... */}
// export function B() {/* ... */}

module.exports = {A, B}

export {A, B}

let codemod, writeFile, allFiles, newCode;

for (const file in allFiles) {
  const newFile = codemod(file);
  writeFile(newFile)
}


console.log(newCode);