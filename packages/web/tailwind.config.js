/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Layered dark surfaces
        base: "#0a0b0f",
        surface: "#12141c",
        "surface-2": "#1a1d28",
        "surface-3": "#232735",
        border: "#2a2e3d",
        muted: "#8b90a3",
        faint: "#5a5f72",
        // Brand / accent
        accent: {
          DEFAULT: "#7c5cff",
          soft: "#9d86ff",
          dim: "#5b43c4",
        },
        good: "#22c55e",
        warn: "#f59e0b",
        bad: "#ef4444",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(124,92,255,0.3), 0 8px 30px -8px rgba(124,92,255,0.35)",
        card: "0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6)",
      },
      backgroundImage: {
        "grid-fade":
          "radial-gradient(ellipse at top, rgba(124,92,255,0.10), transparent 55%)",
      },
      keyframes: {
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(34,197,94,0.5)" },
          "70%": { boxShadow: "0 0 0 6px rgba(34,197,94,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(34,197,94,0)" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 2s infinite",
      },
    },
  },
  plugins: [],
};
