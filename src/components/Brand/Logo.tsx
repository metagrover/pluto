import React from 'react';
import plutoLogo from '../../assets/brand/pluto_logo_v4.png';

interface LogoProps {
  className?: string;
  size?: number;
  showText?: boolean;
  showTagline?: boolean;
  variant?: 'default' | 'light' | 'gold';
}

export const Logo: React.FC<LogoProps> = ({ 
  className = "", 
  size = 40, 
  showText = false, 
  showTagline = false,
  variant = 'default' 
}) => {
  const colors = {
    darkBlue: '#1A2340',
    gold: '#D4B483',
    white: '#FFFFFF',
  };

  const mainColor = variant === 'light' ? colors.white : colors.darkBlue;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div style={{ width: size, height: size }} className="relative flex-shrink-0">
        <img 
            src={plutoLogo} 
            alt="Pluto Logo" 
            className="w-full h-full object-contain" 
        />
      </div>

      {(showText || showTagline) && (
        <div className="flex flex-col">
          {showText && (
            <span 
              className="font-bold tracking-tight leading-none"
              style={{ color: mainColor, fontSize: size * 0.7 }}
            >
              Pluto
            </span>
          )}
          {showTagline && (
            <span 
              className="font-normal tracking-tight opacity-70 mt-1"
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
