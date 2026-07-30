export const runConditionalMeetingUpdateForIpc = <Result>(
  update: () => Result,
): Result | 'failed' => {
  try {
    return update();
  } catch {
    return 'failed';
  }
};
