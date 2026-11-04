import { GripVertical, Plus } from 'lucide-react';
import type React from 'react';

interface NotionBlockGutterProps {
  onAddBlock?: () => void;
  onGripClick?: () => void;
  blockType?: string;
  className?: string;
}

export const NotionBlockGutter: React.FC<NotionBlockGutterProps> = ({
  onAddBlock,
  onGripClick,
  blockType = 'paragraph',
  className = '',
}) => {
  return (
    <div
      className={`notion-block-gutter flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-120 select-none shrink-0 ${className}`}
    >
      {onAddBlock ? (
        <button
          type="button"
          onClick={onAddBlock}
          className="w-4 h-5 flex items-center justify-center rounded text-pro-text-muted/40 hover:text-pro-text-main hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer transition-colors"
          title="Add block below"
          aria-label="Add block below"
        >
          <Plus size={12} />
        </button>
      ) : null}
      {onGripClick ? (
        <button
          type="button"
          onClick={onGripClick}
          className="w-4 h-5 flex items-center justify-center rounded text-pro-text-muted/40 hover:text-pro-text-main hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer transition-colors"
          title={`Change block type (currently ${blockType})`}
          aria-label={`Change block type from ${blockType}`}
        >
          <GripVertical size={13} />
        </button>
      ) : null}
    </div>
  );
};
