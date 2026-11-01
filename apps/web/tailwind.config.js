/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
        ink: {
          50: '#f6f7f8',
          100: '#e9ecef',
          200: '#cfd5db',
          300: '#a8b1ba',
          400: '#737f8a',
          500: '#4b5560',
          600: '#333d47',
          700: '#222b34',
          800: '#141b23',
          900: '#0a0f14',
          950: '#05080b',
        },
        paper: '#f1f2ef',
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,0.04), 0 18px 44px -34px rgba(15,23,42,0.28)',
        lift: '0 28px 64px -32px rgba(15,23,42,0.38)',
        insetline: 'inset 0 1px 0 rgba(255,255,255,0.06)',
      },
      keyframes: {
        'page-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'bar-grow': {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },
      },
      animation: {
        'page-in': 'page-in 480ms cubic-bezier(0.16,1,0.3,1) both',
        'bar-grow': 'bar-grow 900ms cubic-bezier(0.16,1,0.3,1) both',
      },
    },
  },
  plugins: [],
};
