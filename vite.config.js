import { defineConfig } from 'vite';

// Vite needs the cloud preview hostname allowlisted. That is supplied per
// process via __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS rather than hardcoded here.
export default defineConfig({
  // relative base keeps the bundle working at /<repo>/ on GitHub Pages and at
  // the root of a local dev server
  base: './',
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
  },
  build: {
    target: 'es2020',
  },
});
