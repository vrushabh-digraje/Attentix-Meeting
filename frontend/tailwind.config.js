/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        zoomBlue: '#0E71EB',
        zoomBlueHover: '#0b5cbF',
        zoomOrange: '#E05713',
        zoomOrangeHover: '#c74a0e',
        zoomDarkBg: '#0e0f11',
        zoomCard: '#1a1a1c',
        zoomPanel: '#1e1e21',
        zoomControlBar: '#18181a',
        zoomBorder: '#232326',
        zoomText: '#F5F5F5',
        zoomTextSec: '#A1A1A6',
        stateGreen: '#10b981',
        stateYellow: '#f59e0b',
        stateRed: '#ef4444',
      },
      fontFamily: {
        sans: ['SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
