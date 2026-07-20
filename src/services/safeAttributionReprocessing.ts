export const reprocessAttributedMeeting = async <
  TPrevious,
  TReplacement,
>(params: {
  previous: TPrevious;
  buildReplacement: (previous: TPrevious) => Promise<TReplacement>;
  validateReplacement: (replacement: TReplacement) => Promise<boolean>;
  saveReplacement: (replacement: TReplacement) => Promise<unknown>;
}): Promise<
  | { status: 'validation_failed'; preserved: true }
  | { status: 'save_conflict'; preserved: true }
  | { status: 'save_failed'; preserved: true }
  | { status: 'replaced'; preserved: false }
> => {
  const replacement = await params.buildReplacement(params.previous);
  if (!(await params.validateReplacement(replacement))) {
    return { status: 'validation_failed', preserved: true };
  }
  try {
    if ((await params.saveReplacement(replacement)) === false) {
      return { status: 'save_conflict', preserved: true };
    }
  } catch {
    return { status: 'save_failed', preserved: true };
  }
  return { status: 'replaced', preserved: false };
};
