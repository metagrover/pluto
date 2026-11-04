import type React from 'react';

interface NotionCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
  variant?: 'todo' | 'task';
}

export const NotionCheckbox: React.FC<NotionCheckboxProps> = ({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
  id,
  className = '',
  variant = 'todo',
}) => {
  const baseClass =
    variant === 'task' ? 'notion-task-checkbox' : 'notion-todo-checkbox';
  return (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={
        ariaLabel ||
        (checked
          ? variant === 'task'
            ? 'Mark task incomplete'
            : 'Mark checklist item incomplete'
          : variant === 'task'
            ? 'Mark task complete'
            : 'Mark checklist item complete')
      }
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className={`${baseClass} ${
        variant === 'task' ? 'rounded-full' : 'rounded-[4px]'
      } shrink-0 cursor-pointer ${checked ? 'is-checked' : ''} ${className}`}
    />
  );
};
