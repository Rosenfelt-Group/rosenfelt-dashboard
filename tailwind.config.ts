import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          orange: "#C05621",
          "orange-light": "#D4703A",
          "orange-dark": "#9A4318",
          black: "#1C1C1E",
          offwhite: "#F0EEE9",
          muted: "#6B6B6E",
          border: "#E5E3DE",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
