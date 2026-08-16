/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        zoomBlue: '#4F46E5', // Premium Indigo
        zoomBlueHover: '#4338CA',
        zoomOrange: '#F97316', // Orange Accent
        zoomOrangeHover: '#EA580C',
        zoomDarkBg: '#F8FAFC', // Slate 50 Light Background
        zoomCard: '#FFFFFF', // Clean White Cards
        zoomPanel: '#FFFFFF', // Clean White Panels
        zoomControlBar: '#F1F5F9', // Clean light Slate Control Bar
        zoomBorder: '#E2E8F0', // Soft borders
        zoomText: '#0F172A', // Slate 900 primary text
        zoomTextSec: '#475569', // Slate 600 secondary text
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
