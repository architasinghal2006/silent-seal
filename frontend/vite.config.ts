/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // Single .env at the repo root; only VITE_* values reach the browser bundle.
  const env = loadEnv(mode, '..', '')
  return {
    envDir: '..',
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'icon-192.png', 'apple-touch-icon.png'],
        manifest: {
          // Neutral identity: on the home screen this is just a calculator.
          name: 'Calculator',
          short_name: 'Calculator',
          description: 'Calculator',
          theme_color: '#f7f8f8',
          background_color: '#f7f8f8',
          display: 'standalone',
          orientation: 'portrait',
          id: '/',
          start_url: '/',
          scope: '/',
          categories: ['utilities'],
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          ],
        },
        workbox: {
          navigateFallbackDenylist: [/^\/api/],
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        },
      }),
    ],
    test: {
      // Component tests opt in to a browser-like environment with a comment at the top of the file.
      environment: 'node',
      setupFiles: ['./src/test/setup.ts'],
      restoreMocks: true,
    },
    server: {
      port: 5173,
      proxy: { '/api': { target: env.API_PROXY_TARGET || 'http://localhost:8000', changeOrigin: true } },
    },
    preview: {
      port: 4173,
      proxy: { '/api': { target: env.API_PROXY_TARGET || 'http://localhost:8000', changeOrigin: true } },
    },
  }
})
