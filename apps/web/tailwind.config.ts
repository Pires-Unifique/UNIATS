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

        // Acento da marca (Collab / Unifique) — azul institucional oficial do
        // manual Unifique (Pantone 2746 C, #212492). Mantido fixo nos dois temas
        // para o acento permanecer vivo sobre o grafite escuro. O nome do token
        // segue `unifique` (a cor é da Unifique); o produto agora se chama Collab.
        unifique: {
          50: '#eef1fc',
          100: '#d8defa',
          200: '#b4c1f4',
          300: '#8a9dec',
          400: '#5f77e1',
          500: '#3a50c8',
          600: '#212492', // cor principal oficial (Pantone 2746 C)
          700: '#1b1d76',
          800: '#15165c',
          900: '#0e0f44',
        },
        // Cores secundárias do manual Unifique — disponíveis para acentos,
        // gráficos e destaques pontuais.
        azul: '#00A2FF', // Pantone 299 C
        ciano: '#3FCFD5', // Pantone 319 C
        amarelo: '#F5EC5A', // Pantone 101 C
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
        // Tipografia de sistema da marca Unifique é a Segoe (manual, pág. 3) —
        // usada em aplicações digitais onde a Praktika (licenciada) não cabe.
        sans: ['Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
