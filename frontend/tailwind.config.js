/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        zoomBlue: '#0E71EB',         // Authentic Zoom Blue (Brand primary, active buttons)
        zoomBlueHover: '#005CE6',    // Darker Zoom Blue Hover
        zoomOrange: '#FF7426',       // Zoom New Meeting Orange
        zoomOrangeHover: '#E05615',  // Darker Zoom Orange Hover
        zoomDarkBg: '#121214',       // Zoom Charcoal Dark Background
        zoomCard: '#232328',         // Zoom Dark Card Background
        zoomPanel: '#1C1C20',        // Zoom Dark Panel / Sidebar Background
        zoomControlBar: '#1A1A1E',   // Zoom Meeting Control Bar Dark Background
        zoomBorder: '#2E3038',       // Zoom Subtle Dark Border
        zoomText: '#FFFFFF',         // Zoom Crisp White Text
        zoomTextSec: '#94A3B8',      // Zoom Slate Secondary Text
        stateGreen: '#22C55E',       // Zoom Share Screen Green
        stateYellow: '#F59E0B',      // Attention Warning Amber
        stateRed: '#E02828',         // Zoom End / Leave Button Red
      },
      fontFamily: {
        sans: ['SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
