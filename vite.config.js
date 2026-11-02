import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (path) => fileURLToPath(new URL(`./web/${path}`, import.meta.url));

export default defineConfig({
  root: 'web',
  // Relative paths: the site also works under https://<user>.github.io/<repo>/
  base: './',
  // Collected data is served as is, at the site root: data/core-bo1/index.json → ./core-bo1/index.json
  publicDir: '../data',
  server: { fs: { allow: ['..'] } },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // The homepage, then one page per tool, each in its own folder
    rolldownOptions: {
      input: {
        home: page('index.html'),
        meta: page('meta/index.html'),
        proxies: page('proxies/index.html'),
        tournaments: page('tournaments/index.html'),
        prep: page('prep/index.html'),
        podcast: page('podcast/index.html'),
        episode: page('podcast/episode/index.html'),
      },
    },
  },
});
