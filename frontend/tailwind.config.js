/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        zoomBlue: '#0284C7',         // Sky Blue (Active buttons & Highlights)
        zoomBlueHover: '#0369A1',    // Deep Sky Hover state
        zoomOrange: '#F97316',       // Amber (Warnings / Alerts)
        zoomOrangeHover: '#EA580C',  // Dark Amber Hover
        zoomDarkBg: '#F0F9FF',       // Sky 50 (Refreshing icy-blue background)
        zoomCard: '#FFFFFF',         // Crisp White Cards
        zoomPanel: '#FFFFFF',        // Crisp White Sidebar
        zoomControlBar: '#E0F2FE',   // Sky 100 (Control bar background)
        zoomBorder: '#BAE6FD',       // Soft Frost-Blue borders
        zoomText: '#0C4A6E',         // Sky 900 (Deep steel blue primary text)
        zoomTextSec: '#0369A1',      // Sky 700 (Secondary text)
        stateGreen: '#0D9488',       // Teal Green
        stateYellow: '#D97706',      // Dark Amber
        stateRed: '#E11D48',         // Bright Rose
      },
      fontFamily: {
        sans: ['SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
