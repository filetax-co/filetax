import { defineConfig } from 'vite'
import path from 'path'
import fs from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id: string) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

// End-to-end test harness, served only by the dev server and only when asked
// for with E2E_DRIVER=1. The driver and its 100 scenarios live in testing/
// rather than public/ deliberately: anything in public/ is copied verbatim into
// dist/, so keeping them there shipped a script that overrides
// HTMLAnchorElement.click to production. `apply: 'serve'` means this plugin
// does not exist in a build at all.
//
//   E2E_DRIVER=1 npm run dev      then run scripts/pdfReceiver.mjs alongside
function e2eDriver() {
  const enabled = process.env.E2E_DRIVER === '1'
  return {
    name: 'e2e-driver',
    apply: 'serve' as const,
    configureServer(server: { middlewares: { use: (fn: (req: any, res: any, next: any) => void) => void } }) {
      if (!enabled) return
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0]
        const file =
          url === '/__driver.js' ? 'testing/__driver.js'
          : url === '/__scenarios.json' ? 'testing/__scenarios.json'
          : null
        if (!file) return next()
        res.setHeader('Content-Type', url.endsWith('.json') ? 'application/json' : 'text/javascript')
        res.end(fs.readFileSync(path.resolve(__dirname, file)))
      })
    },
    // Inject the driver tag only in this mode, so index.html stays clean.
    transformIndexHtml(html: string) {
      if (!enabled) return html
      return html.replace('</body>', '  <script src="/__driver.js"></script>\n  </body>')
    },
  }
}

// Use '/5472/' as base only for production GitHub Pages deploys.
// In dev (including Codespaces), use '/' so the tunnel URL works directly.
const base = process.env.NODE_ENV === 'production' ? '/5472/' : '/';

export default defineConfig({
  base,
  plugins: [
    figmaAssetResolver(),
    e2eDriver(),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
  },
  build: {
    // pdf-lib + jszip together are ~529 kB (lazy — loaded only on download click).
    // This is intentional and acceptable; raise the limit to suppress the noise.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // PDF libs — kept as a separate lazy chunk (loaded only on download click)
          if (id.includes('pdf-lib') || id.includes('jszip')) return 'pdf';
          // React core
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) return 'react-vendor';
          // Routing
          if (id.includes('node_modules/react-router')) return 'router';
          // Supabase
          if (id.includes('node_modules/@supabase')) return 'supabase';
          // MUI + Emotion
          if (id.includes('node_modules/@mui') || id.includes('node_modules/@emotion')) return 'mui';
          // Radix UI
          if (id.includes('node_modules/@radix-ui')) return 'radix';
          // Charts
          if (id.includes('node_modules/recharts')) return 'charts';
          // Form utilities
          if (
            id.includes('node_modules/react-hook-form') ||
            id.includes('node_modules/react-day-picker') ||
            id.includes('node_modules/input-otp')
          ) return 'forms';
          // Misc UI libs
          if (
            id.includes('node_modules/lucide-react') ||
            id.includes('node_modules/cmdk') ||
            id.includes('node_modules/sonner') ||
            id.includes('node_modules/vaul') ||
            id.includes('node_modules/embla-carousel') ||
            id.includes('node_modules/react-resizable-panels') ||
            id.includes('node_modules/react-dnd') ||
            id.includes('node_modules/canvas-confetti') ||
            id.includes('node_modules/date-fns')
          ) return 'ui-misc';
        },
      },
    },
  },
})
