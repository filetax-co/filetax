import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import sitemap from 'vite-plugin-sitemap'

// Static public-facing routes
// Private app routes (/auth, /dashboard, /portal, /past-filings) are intentionally excluded
const staticRoutes = [
  '/',
  '/pricing',
  '/services',
  '/check',
  '/resources',
  '/faq',
  '/waitlist',
  '/terms',
  '/privacy',
]

// TODO: Once Sanity is connected, fetch blog slugs at build time and add here:
// const blogSlugs = await sanityClient.fetch(`*[_type == "post"]{ slug }`))
// const blogRoutes = blogSlugs.map((p) => `/resources/${p.slug.current}`)
// Then spread into dynamicRoutes: [...staticRoutes, ...blogRoutes]

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  base: '/',
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    sitemap({
      hostname: 'https://filetax.co',
      dynamicRoutes: staticRoutes,
    }),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },
  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
