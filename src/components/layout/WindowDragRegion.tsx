import type React from 'react';

export interface WindowDragRegionProps
  extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

/**
 * Reusable draggable titlebar/window region for frameless/hiddenInset windows.
 * Encapsulates the `-webkit-app-region: drag` and `pointer-events-auto` styling.
 */
export const WindowDragRegion = ({
  className = '',
  ...props
}: WindowDragRegionProps) => {
  const combinedClassName = className
    ? `${className} drag-region pointer-events-auto`
    : 'drag-region pointer-events-auto';

  return <div className={combinedClassName} aria-hidden="true" {...props} />;
};
