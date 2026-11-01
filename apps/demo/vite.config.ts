import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { demoApi } from './server/api';

export default defineConfig({
  plugins: [react(), demoApi()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
