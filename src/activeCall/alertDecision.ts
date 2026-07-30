export type AlertCallObservation = {
  active: boolean;
  appName: string | null;
  confidence: 'low' | 'medium' | 'high';
};

export const isAlertEligible = ({
  active,
  appName,
  confidence,
}: AlertCallObservation): boolean =>
  active && Boolean(appName) && confidence === 'high';
