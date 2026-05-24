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
})
