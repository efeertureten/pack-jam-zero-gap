#!/usr/bin/env node
/* Assemble the single-file game: src/page.html + CDN libs + engine/levels/game → index.html */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const page = read('src/page.html').replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '');
const cut = page.indexOf('<div id="app">');
const head = page.slice(0, cut).trim(), body = page.slice(cut).trim();
const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#2E98A4">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}</style>
${head}
</head>
<body>
${body}
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<script>
${read('src/engine.js')}
${read('src/levels.js')}
${read('src/levels.baked.js')}
${read('src/icons.js')}
</script>
<script>
${read('src/game.js')}
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log('index.html', (html.length / 1024).toFixed(1) + ' KB');
