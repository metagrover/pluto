export const createCaptureJournalMutationCoordinator = () => {
  let queue = Promise.resolve();

  const run = <Result>(mutation: () => Promise<Result>): Promise<Result> => {
    const result = queue.then(mutation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return {
    run,
    drain: () => queue,
  };
};
