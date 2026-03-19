/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'pro-bg': 'hsl(var(--pro-bg) / <alpha-value>)',
        'pro-surface': 'hsl(var(--pro-surface) / <alpha-value>)',
        'pro-border': 'hsl(var(--pro-border) / <alpha-value>)',
        'pro-text-main': 'hsl(var(--pro-text-main) / <alpha-value>)',
        'pro-text-muted': 'hsl(var(--pro-text-muted) / <alpha-value>)',
        'pro-primary': 'hsl(var(--pro-text-main) / <alpha-value>)',
        'pro-accent': 'hsl(var(--pro-accent) / <alpha-value>)',
        'pro-hover': 'hsl(var(--pro-hover) / <alpha-value>)',
      },
      boxShadow: {
        premium:
          '0 10px 30px -5px rgba(26, 35, 64, 0.1), 0 4px 10px -3px rgba(26, 35, 64, 0.05)',
        'inner-soft': 'inset 0 2px 4px 0 rgba(26, 35, 64, 0.03)',
      },
      borderRadius: {
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },
    },
  },
  plugins: [],
};
