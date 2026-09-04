#!/usr/bin/env node
/* Inlines styles.css and app.js into index.html to produce
   etude-standalone.html — one file you can email, drop on a USB stick,
   or double-click anywhere. Run `node build.js` after changing any source. */
const fs = require('fs');
const path = require('path');
const dir = __dirname;

const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
let html = read('index.html');

const before = html;
html = html.replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${read('styles.css')}\n</style>`);
html = html.replace('<script src="app.js"></script>', () => `<script>\n${read('app.js')}\n</script>`);

if (html === before || html.includes('href="styles.css"') || html.includes('src="app.js"')) {
  console.error('build failed: could not find the <link>/<script> tags to inline');
  process.exit(1);
}

fs.writeFileSync(path.join(dir, 'etude-standalone.html'), html);
console.log(`etude-standalone.html — ${(html.length / 1024).toFixed(1)} KB`);
