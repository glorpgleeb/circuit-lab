import { defineConfig } from 'vite';

// Relative asset paths: the same build works at a GitHub Pages sub-path (/circuit-lab/) and locally.
export default defineConfig({ base: './' });
