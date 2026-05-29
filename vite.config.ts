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
    // Listen on all interfaces so Codespaces port forwarding can reach the dev server.
    // Without this, Vite only binds to 127.0.0.1 and the tunnel returns 404.
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // React core
          'react-vendor': ['react', 'react-dom'],
          // Routing
          'router': ['react-router'],
          // Supabase
          'supabase': ['@supabase/supabase-js'],
          // MUI (largest chunk — MUI + Emotion together are heavy)
          'mui': ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
          // All Radix UI primitives
          'radix': [
            '@radix-ui/react-accordion',
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-aspect-ratio',
            '@radix-ui/react-avatar',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-collapsible',
            '@radix-ui/react-context-menu',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-hover-card',
            '@radix-ui/react-label',
            '@radix-ui/react-menubar',
            '@radix-ui/react-navigation-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-progress',
            '@radix-ui/react-radio-group',
            '@radix-ui/react-scroll-area',
            '@radix-ui/react-select',
            '@radix-ui/react-separator',
            '@radix-ui/react-slider',
            '@radix-ui/react-slot',
            '@radix-ui/react-switch',
            '@radix-ui/react-tabs',
            '@radix-ui/react-toggle',
            '@radix-ui/react-toggle-group',
            '@radix-ui/react-tooltip',
          ],
          // Charts
          'charts': ['recharts'],
          // Form utilities
          'forms': ['react-hook-form', 'react-day-picker', 'input-otp'],
          // Misc UI libs
          'ui-misc': [
            'lucide-react',
            'cmdk',
            'sonner',
            'vaul',
            'embla-carousel-react',
            'react-resizable-panels',
            'react-dnd',
            'react-dnd-html5-backend',
            'canvas-confetti',
            'date-fns',
          ],
        },
      },
    },
  },
})
