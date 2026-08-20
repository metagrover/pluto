import type React from 'react';
import {
  ENTITY_ICONS,
  type Entity,
  type EntityType,
  STATUS_COLORS,
} from '../../api/knowledgeGraph';

interface EntityPillProps {
  entity: Entity | { type: EntityType; name: string };
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  className?: string;
  showStatus?: boolean;
}

export const EntityPill: React.FC<EntityPillProps> = ({
  entity,
  size = 'md',
  onClick,
  className = '',
  showStatus = false,
}) => {
  const icon = ENTITY_ICONS[entity.type as EntityType] || '📍';

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[10px] gap-1',
    md: 'px-2.5 py-1 text-[12px] gap-1.5',
    lg: 'px-4 py-2 text-[14px] gap-2',
  };

  const status = 'status' in entity ? entity.status : null;
  const statusColor = status ? STATUS_COLORS[status] : null;

  return (
    <button
      type="button"
      onClick={onClick}
      title={entity.name}
      className={`
        inline-flex items-center font-bold rounded-lg border transition-all
        ${onClick ? 'cursor-pointer hover:scale-105 active:scale-95' : 'cursor-default'}
        ${sizeClasses[size]}
        bg-pro-surface border-pro-border shadow-sm
        hover:border-pro-accent/40 hover:shadow-md
        ${className}
      `}
    >
      <span className="opacity-70">{icon}</span>
      <span className="text-pro-text-main truncate max-w-[150px]">
        {entity.name}
      </span>

      {showStatus && status && statusColor && (
        <span
          className={`
          ml-1 px-1.5 py-0.25 rounded-md text-[8px] font-medium
          ${statusColor.bg} ${statusColor.text}
        `}
        >
          {status}
        </span>
      )}
    </button>
  );
};
