const makeScheduler = () => {
  let globalPromptPromise = Promise.resolve();

  const runWithLock = async waiter => {
    return new Promise(async (resolve, reject) => {
      globalPromptPromise = globalPromptPromise.then(() => {
        return waiter().then(res => {
          resolve(res);
        }, reject);
      });
    });
  }

  return runWithLock;
}

module.exports = makeScheduler;