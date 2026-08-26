import type React from 'react';
import logoSvg from '../../assets/brand/pluto_logo.svg';
import logoDarkSvg from '../../assets/brand/pluto_logo_dark_mode.svg';

interface LogoProps {
  className?: string;
  size?: number;
  showText?: boolean;
  showTagline?: boolean;
  variant?: 'default' | 'light' | 'gold';
}

export const Logo: React.FC<LogoProps> = ({
  className = '',
  size = 40,
  showText = false,
  showTagline = false,
  variant = 'default',
}) => {
  const colors = {
    darkBlue: '#1A2340',
    gold: '#D4B483',
    white: '#FFFFFF',
    offWhite: '#FAFAFA',
  };

  const mainColor =
    variant === 'light'
      ? colors.white
      : variant === 'gold'
        ? colors.gold
        : colors.darkBlue;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        style={{ width: size, height: size }}
        className="relative flex-shrink-0"
      >
        {variant === 'light' ? (
          <img
            src={logoDarkSvg}
            alt="Pluto Logo"
            className="block h-full w-full object-contain transition-all duration-300 hover:scale-110 active:scale-95"
          />
        ) : (
          <>
            <img
              src={logoSvg}
              alt="Pluto Logo"
              className="block h-full w-full object-contain transition-all duration-300 hover:scale-110 active:scale-95 dark:hidden"
            />
            <img
              src={logoDarkSvg}
              alt="Pluto Logo"
              className="hidden h-full w-full object-contain transition-all duration-300 hover:scale-110 active:scale-95 dark:block"
            />
          </>
        )}
      </div>

      {(showText || showTagline) && (
        <div className="flex flex-col">
          {showText && (
            <span
              className="relative top-px font-serif font-semibold leading-none dark:!text-[#FAFAFA]"
              style={{ color: mainColor, fontSize: size * 0.7 }}
            >
              Pluto
            </span>
          )}
          {showTagline && (
            <span
              className="font-normal opacity-70 mt-1 dark:!text-[#FAFAFA]/70"
              style={{ color: mainColor, fontSize: size * 0.22 }}
            >
              Your Second Brain for Work
            </span>
          )}
        </div>
      )}
    </div>
  );
};
