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
          // Cream surface tones (was gray-leaning "offwhite" — now warmer per brand refresh)
          cream: "#F6F1EB",
          offwhite: "#EFE7DC",
          muted: "#8A8178",
          border: "#E3D9CB",
          status: {
            ok: "#3F8E5B",
            working: "#C79A2E",
            idle: "#9AA0A6",
          },
        },
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "system-ui", "sans-serif"],
        urbanist: ["Urbanist", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
