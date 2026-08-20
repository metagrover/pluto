import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  children?: ReactNode;
  className?: string;
}

export const PageHeader = ({ title, children, className }: PageHeaderProps) => (
  <div
    className={`flex items-center justify-between gap-4 border-b border-pro-border/30 pb-4 mb-10 ${className || ''}`}
  >
    <h1 className="font-serif text-[32px] font-medium tracking-[-0.01em] text-pro-text-main">
      {title}
    </h1>
    {children}
  </div>
);
