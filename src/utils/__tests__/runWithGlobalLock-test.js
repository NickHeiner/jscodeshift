const makeScheduler = require('../runWithGlobalLock');

describe('runWithGlobalLock', () => {
  it('only allows one function to execute at a time', async () => {
    const runWithGlobalLock = makeScheduler();

    const taskRecord = [];
    const makeAsyncTask = taskName => async () => {
      taskRecord.push('start task ' + taskName);
      await new Promise(resolve => setTimeout(resolve, 50));
      taskRecord.push('end task ' + taskName);
    }

    await Promise.all([
      runWithGlobalLock(makeAsyncTask('A')),
      runWithGlobalLock(makeAsyncTask('B'))
    ])

    expect(taskRecord).toEqual([
      'start task A',
      'end task A',
      'start task B',
      'end task B',
    ]);
  });
});