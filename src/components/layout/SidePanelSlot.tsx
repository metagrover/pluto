import type React from 'react';
import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

/** Full-height column at the right edge of the main pane, beside the top bar. */
export const SidePanelSlotContext = createContext<HTMLElement | null>(null);

/** Renders a side panel (such as Ask Pluto) in the app's full-height slot,
 * or in place when no slot is mounted (tests, standalone views). */
export const SidePanelPortal: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const slot = useContext(SidePanelSlotContext);
  return slot ? createPortal(children, slot) : children;
};
