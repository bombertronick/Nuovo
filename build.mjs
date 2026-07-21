/* build.mjs — genera la versione "tutto in un unico file" del gestionale.
   Inlinea CSS e JS dentro un solo HTML autonomo (gestionale.html), comodo da
   scaricare e aprire ovunque senza server. Uso: node build.mjs */
import { readFileSync, writeFileSync } from 'fs';

const css = readFileSync('assets/styles.css', 'utf8');
const dbjs = readFileSync('assets/db.js', 'utf8');
const appjs = readFileSync('assets/app.js', 'utf8');
const iconSvg = readFileSync('icons/icon.svg', 'utf8');
const index = readFileSync('index.html', 'utf8');
const iconDataUri = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg).toString('base64');

// Estrae il markup del <body> dall'index, togliendo i tag <script> esterni e
// lo script di registrazione del service worker (non serve nel file unico).
let body = index.match(/<body>([\s\S]*)<\/body>/)[1];
body = body
  .replace(/<script src="assets\/db\.js"><\/script>\s*/g, '')
  .replace(/<script src="assets\/app\.js"><\/script>\s*/g, '')
  .replace(/<script>[\s\S]*?serviceWorker[\s\S]*?<\/script>\s*/g, '')
  .trim();

const standalone = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=5.0">
<meta name="theme-color" content="#1e5eff">
<meta name="description" content="Gestionale cantieri per elettricista e impresa di ristrutturazioni: cantieri per categorie, fatture, scarico IVA, scadenzario, preventivi, statistiche.">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Cantieri">
<link rel="icon" href="${iconDataUri}" type="image/svg+xml">
<title>Gestionale Cantieri</title>
<style>
${css}
</style>
</head>
<body>
${body}
<script>
${dbjs}
</script>
<script>
${appjs}
</script>
</body>
</html>
`;

writeFileSync('gestionale.html', standalone);
console.log('Creato gestionale.html (' + (standalone.length / 1024).toFixed(0) + ' KB)');

// Versione per l'Artifact di Claude (solo contenuto, senza wrapper doctype/head/body)
const artifact = `<style>
${css}
</style>
${body}
<script>
${dbjs}
</script>
<script>
${appjs}
</script>
`;
writeFileSync(process.env.ARTIFACT_OUT || '/tmp/artifact-gestionale.html', artifact);
console.log('Creato file artifact');
