/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        zoomBlue: '#00F2FE',         // Glowing Neon Teal/Cyan (Active highlights & buttons)
        zoomBlueHover: '#05B6D4',    // Dark Cyan Hover
        zoomOrange: '#FF0844',       // Neon Magenta/Pink Alerts (Focus warning)
        zoomOrangeHover: '#FF2E63',  // Dark Rose Hover
        zoomDarkBg: '#000000',       // Pitch Black Background
        zoomCard: '#090A0F',         // Deep Obsidian Card background
        zoomPanel: '#0C0D15',        // Translucent Obsidian Panel background
        zoomControlBar: '#090A0F',   // Control Bar Background
        zoomBorder: '#1A1D2D',       // Dark Cyber borders
        zoomText: '#E2E8F0',         // Slate 200 light gray text (high readability)
        zoomTextSec: '#94A3B8',      // Slate 400 secondary text
        stateGreen: '#10B981',       // Emerald Green (Active status)
        stateYellow: '#F59E0B',      // Amber Yellow
        stateRed: '#EF4444',         // Crimson Red (Leave/Disconnect buttons)
      },
      fontFamily: {
        sans: ['SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
