/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        zoomBlue: '#2563EB',
        zoomBlueHover: '#1D4ED8',
        zoomOrange: '#F97316',
        zoomOrangeHover: '#EA580C',
        zoomDarkBg: '#090A0F',
        zoomCard: '#151622',
        zoomPanel: '#10111A',
        zoomControlBar: '#0C0D15',
        zoomBorder: '#202236',
        zoomText: '#F8FAFC',
        zoomTextSec: '#94A3B8',
        stateGreen: '#10B981',
        stateYellow: '#F59E0B',
        stateRed: '#EF4444',
      },
      fontFamily: {
        sans: ['SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
