const fs = require('fs');
const path = require('path');
const terser = require('terser');
const { minify } = require('html-minifier-terser');

async function build() {
  const { ZipArchive } = await import('archiver');
  console.log('🚀 [BUILD] Starting Core Striker Alpha Production Build for Itch.io...');

  const rootDir = path.resolve(__dirname, '..');
  const distDir = path.resolve(rootDir, 'dist');
  const srcIndexPath = path.resolve(rootDir, 'index.html');

  if (!fs.existsSync(srcIndexPath)) {
    throw new Error('Could not find index.html at ' + srcIndexPath);
  }

  // 1. Prepare dist directory
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  const rawHtml = fs.readFileSync(srcIndexPath, 'utf8');

  // Verify Alpha Watermark is present
  const watermarkText = 'CORE STRIKER // ALPHA PLAYTEST v0.1.0 — © 2026 ORANGE MFG';
  if (!rawHtml.includes('ALPHA PLAYTEST v0.1.0') || !rawHtml.includes('ORANGE MFG')) {
    console.warn('⚠️ Warning: Alpha watermark text not detected in source HTML!');
  } else {
    console.log('🛡️  [SECURITY] Alpha watermark confirmed in source.');
  }

  // Verify Context Menu prevention on Canvas
  if (!rawHtml.includes('contextmenu') || !rawHtml.includes('preventDefault')) {
    console.warn('⚠️ Warning: Context menu prevention not detected in source!');
  } else {
    console.log('🛡️  [SECURITY] Canvas context-menu prevention confirmed in source.');
  }

  // 2. Extract JavaScript
  const scriptRegex = /<script>([\s\S]*?)<\/script>/;
  const scriptMatch = rawHtml.match(scriptRegex);
  if (!scriptMatch) {
    throw new Error('Failed to find <script> tag in index.html');
  }

  const rawJs = scriptMatch[1];
  console.log(`📦 [ASSET] Extracted client script: ${(rawJs.length / 1024).toFixed(1)} KB`);

  // 3. Minify and Obfuscate JavaScript
  console.log('🔒 [SECURITY] Minifying and obfuscating JavaScript (mangling top-level, stripping comments & source maps)...');
  const terserResult = await terser.minify(rawJs, {
    compress: {
      dead_code: true,
      drop_debugger: true,
      passes: 2,
      pure_funcs: ['console.debug']
    },
    mangle: {
      toplevel: true
    },
    format: {
      comments: false,
      ascii_only: false
    }
  });

  if (terserResult.error) {
    throw new Error('Terser minification error: ' + terserResult.error);
  }

  const minifiedJs = terserResult.code;
  console.log(`✨ [MINIFY] JavaScript minified: ${(minifiedJs.length / 1024).toFixed(1)} KB (${((minifiedJs.length / rawJs.length) * 100).toFixed(1)}% of original)`);

  const distJsPath = path.resolve(distDir, 'game.min.js');
  fs.writeFileSync(distJsPath, minifiedJs, 'utf8');

  // 4. Prepare and Minify HTML
  console.log('📄 [ASSET] Minifying HTML and inline CSS...');
  const htmlWithExternalScript = rawHtml.replace(
    scriptRegex,
    () => '<script src="./game.min.js"></script>'
  );

  const minifiedHtml = await minify(htmlWithExternalScript, {
    collapseWhitespace: true,
    removeComments: true,
    minifyCSS: true,
    minifyJS: true,
    removeRedundantAttributes: true,
    useShortDoctype: true,
    removeEmptyAttributes: true
  });

  const distIndexPath = path.resolve(distDir, 'index.html');
  fs.writeFileSync(distIndexPath, minifiedHtml, 'utf8');
  console.log(`📄 [MINIFY] HTML minified: ${(minifiedHtml.length / 1024).toFixed(1)} KB`);

  // Also create a standalone single-file index.standalone.html
  const standaloneHtml = await minify(
    rawHtml.replace(scriptRegex, () => `<script>${minifiedJs}</script>`),
    {
      collapseWhitespace: true,
      removeComments: true,
      minifyCSS: true,
      minifyJS: false, // already minified
      removeRedundantAttributes: true,
      useShortDoctype: true,
      removeEmptyAttributes: true
    }
  );
  fs.writeFileSync(path.resolve(distDir, 'index.standalone.html'), standaloneHtml, 'utf8');

  // 5. Create Standalone Root-Level Zip Archive for Itch.io
  const zipPath = path.resolve(distDir, 'core-striker-itch-alpha.zip');
  console.log('📦 [ARCHIVE] Creating Itch.io compatible zip archive at ' + zipPath);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`🎉 [SUCCESS] Archive created: ${(archive.pointer() / 1024).toFixed(1)} KB`);
      resolve();
    });

    archive.on('error', (err) => reject(err));

    archive.pipe(output);

    // Append index.html and game.min.js directly at the root of the archive
    archive.file(distIndexPath, { name: 'index.html' });
    archive.file(distJsPath, { name: 'game.min.js' });

    archive.finalize();
  });

  console.log('\n================ BUILD COMPLETE ================');
  console.log(`  Distribution Directory: ${distDir}`);
  console.log(`  Itch.io Deployable Zip: ${zipPath}`);
  console.log(`  Total Zip File Size:    ${(fs.statSync(zipPath).size / 1024).toFixed(1)} KB`);
  console.log('================================================\n');
}

build().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
