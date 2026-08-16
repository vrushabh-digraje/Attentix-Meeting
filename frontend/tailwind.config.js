/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        zoomBlue: '#D97706',         // Bronze Amber (Active buttons & Highlights)
        zoomBlueHover: '#B45309',    // Dark Amber Hover state
        zoomOrange: '#06B6D4',       // Soft Cyan (Focus highlights / Alerts)
        zoomOrangeHover: '#0891B2',  // Dark Cyan Hover
        zoomDarkBg: '#FAF9F6',       // Alabaster/Cream 50 (Soft, organic background)
        zoomCard: '#FFFFFF',         // Crisp White Cards
        zoomPanel: '#FFFFFF',        // Crisp White Sidebar
        zoomControlBar: '#F5F4F0',   // Alabaster/Warm-Stone 100 (Control bar background)
        zoomBorder: '#E6E4DC',       // Stone 200 (Soft organic borders)
        zoomText: '#1C1917',         // Stone 900 (Very dark warm gray primary text)
        zoomTextSec: '#57534E',      // Stone 600 (Secondary descriptive text)
        stateGreen: '#15803D',       // Sage Green
        stateYellow: '#CA8A04',      // Soft Yellow-Gold
        stateRed: '#BE123C',         // Burgundy/Rose Red
      },
      fontFamily: {
        sans: ['SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
