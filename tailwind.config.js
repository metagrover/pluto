/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'pro-bg': '#F8F5F0', // Warm Cream
        'pro-surface': '#FFFFFF',
        'pro-border': '#E8E2D9', // Muted cream/gold for borders
        'pro-text-main': '#1A2340', // Midnight Blue
        'pro-text-muted': '#5C637A', // Muted Midnight Blue
        'pro-primary': '#1A2340', // Midnight Blue
        'pro-accent': '#D4B483', // Champagne Gold
        'pro-hover': '#F1ECE4', // Slightly darker cream for hover
      },
      boxShadow: {
        'premium': '0 10px 30px -5px rgba(26, 35, 64, 0.1), 0 4px 10px -3px rgba(26, 35, 64, 0.05)',
        'inner-soft': 'inset 0 2px 4px 0 rgba(26, 35, 64, 0.03)',
      },
      borderRadius: {
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      }
    },
  },
  plugins: [],
}

