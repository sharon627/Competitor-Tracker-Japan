import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // The third parameter '' loads all envs regardless of the `VITE_` prefix.
  // Cast process to any to access cwd() when node types are missing or restricted.
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  // We prioritize VITE_API_KEY as it is the standard for Vite, 
  // but fallback to API_KEY or GEMINI_API_KEY for convenience.
  const apiKey = env.VITE_API_KEY || env.API_KEY || env.GEMINI_API_KEY;

  return {
    plugins: [react()],
    base: './',
    define: {
      'process.env.API_KEY': JSON.stringify(apiKey)
    },
    server: {
      port: 5173,
      host: true
    }
  };
});