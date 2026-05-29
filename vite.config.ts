import { defineConfig } from 'vite'
import path from 'path'
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

// Use '/5472/' as base only for production GitHub Pages deploys.
// In dev (including Codespaces), use '/' so the tunnel URL works directly.
const base = process.env.NODE_ENV === 'production' ? '/5472/' : '/';

export default defineConfig({
  base,
  plugins: [
    figmaAssetResolver(),
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
