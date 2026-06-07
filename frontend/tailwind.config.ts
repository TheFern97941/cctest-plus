import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cctest: {
          base: '#050218',
          panel: 'rgba(255,255,255,0.05)'
        }
      },
      boxShadow: {
        glow: '0 0 40px rgba(59, 130, 246, 0.18)'
      }
    }
  },
  plugins: []
} satisfies Config;
