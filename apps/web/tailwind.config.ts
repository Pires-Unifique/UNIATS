import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Superfície de cards/cabeçalhos. Em tema claro é branco; no escuro
        // vira um grafite elevado. Por isso `bg-white` adapta-se sozinho.
        // (Texto sobre fundos coloridos usa `text-[#fff]` fixo, não `white`.)
        white: 'var(--surface)',

        // Paleta Unifique — laranja queimado da logo. Mantida fixa nos dois temas
        // para o acento da marca permanecer vivo sobre o grafite escuro.
        unifique: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
        },
        // Escala grafite dirigida por variáveis CSS. No tema escuro a rampa é
        // invertida (claros viram escuros e vice-versa), então textos e fundos
        // que já usam `grafite-*` adaptam-se automaticamente.
        grafite: {
          50: 'var(--g-50)',
          100: 'var(--g-100)',
          200: 'var(--g-200)',
          400: 'var(--g-400)',
          600: 'var(--g-600)',
          700: 'var(--g-700)',
          800: 'var(--g-800)',
          900: 'var(--g-900)',
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
