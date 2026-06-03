import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta Unifique — laranja queimado + grafite
        unifique: {
          50: '#fff7ed',
          100: '#ffedd5',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
        },
        grafite: {
          50: '#f7f7f8',
          100: '#ececef',
          200: '#d4d4d8',
          400: '#71717a',
          600: '#3f3f46',
          700: '#2e2e33',
          800: '#1f1f23',
          900: '#0f0f10',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
