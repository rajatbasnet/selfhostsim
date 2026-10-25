import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'media',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        side: 'var(--side)',
        fg: 'var(--fg)',
        mut: 'var(--mut)',
        line: 'var(--line)',
        card: 'var(--card)',
        code: 'var(--code)',
        link: 'var(--link)',
        ok: 'var(--ok)',
        okb: 'var(--okb)',
        bad: 'var(--bad)',
        badb: 'var(--badb)',
        info: 'var(--info)',
        infob: 'var(--infob)',
        warn: 'var(--warn)',
        warnb: 'var(--warnb)',
        grey: 'var(--grey)',
        greyb: 'var(--greyb)',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        card: '10px',
      },
    },
  },
  plugins: [],
}

export default config
