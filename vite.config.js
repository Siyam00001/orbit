import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// relative base so the phone build works from any URL (e.g. GitHub Pages at /orbit/)
export default defineConfig({ base: './', plugins: [react()] });
