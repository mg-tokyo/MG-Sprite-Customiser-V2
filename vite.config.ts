import { defineConfig } from 'vite';

export default defineConfig({
  base: '/MG-Sprite-Customiser-V2/',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  // Prevent Vite from pre-bundling canvas-advanced (it contains a .wasm binary
  // that must be served as a static asset, not inlined by the pre-bundler).
  optimizeDeps: {
    exclude: ['@rive-app/canvas-advanced'],
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://mg-api.ariedam.fr',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Proxy magicgarden.gg assets (cosmetics) through dev server to add CORS headers.
      // followRedirects: true ensures Vite follows any server-side redirects internally
      // rather than passing a 3xx back to the browser (which would cause a cross-origin fetch).
      '/mggg-proxy': {
        target: 'https://magicgarden.gg',
        changeOrigin: true,
        followRedirects: true,
        rewrite: (path) => path.replace(/^\/mggg-proxy/, ''),
      },
    },
  },
  preview: {
    proxy: {
      '/api': {
        target: 'https://mg-api.ariedam.fr',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/mggg-proxy': {
        target: 'https://magicgarden.gg',
        changeOrigin: true,
        followRedirects: true,
        rewrite: (path) => path.replace(/^\/mggg-proxy/, ''),
      },
    },
  },
});
