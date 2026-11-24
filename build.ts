// Builds each page into one self-contained HTML file: no server, no network,
// nothing to install. TSX goes through Babel with Solid's JSX compiler, then
// esbuild bundles each page into a single inline script.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformAsync } from '@babel/core';
import typescriptPreset from '@babel/preset-typescript';
import solidPreset from 'babel-preset-solid';
import { build, type Metafile, type Plugin } from 'esbuild';
import { checkPages } from './src/build/html-checks.ts';
import { pages } from './src/view/pages.ts';

const root = path.dirname(fileURLToPath(import.meta.url));
const destination = path.resolve(root, process.env['BUILD_DIR'] ?? 'dist');

const solidJsx: Plugin = {
  name: 'solid-jsx',
  setup(builder) {
    builder.onLoad({ filter: /\.tsx$/ }, async (arguments_) => {
      const result = await transformAsync(await readFile(arguments_.path, 'utf8'), {
        filename: arguments_.path,
        babelrc: false,
        configFile: false,
        sourceMaps: false,
        presets: [[solidPreset, { generate: 'dom' }], [typescriptPreset, { onlyRemoveTypeImports: true }]],
      });
      assert.ok(result?.code, 'Babel produced no code for ' + arguments_.path);
      return { contents: result.code, loader: 'js' };
    });
  },
};

/** The license notices of every package bundled into a page, read from the packages themselves. */
async function licenseNotices(metafile: Metafile): Promise<string> {
  const packages = new Set<string>();
  for (const input of Object.keys(metafile.inputs)) {
    const match = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)\//.exec(input);
    if (match?.[1]) packages.add(match[1]);
  }
  const notices: string[] = [];
  for (const name of [...packages].sort()) {
    const directory = path.join(root, 'node_modules', name);
    const license = (await readdir(directory)).find((file) => /^licen[cs]e/i.test(file));
    assert.ok(license, `The bundled package ${name} ships no license file.`);
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')) as { version: string };
    notices.push(`${name} ${manifest.version}\n\n${(await readFile(path.join(directory, license), 'utf8')).trim()}`);
  }
  return notices.join('\n\n---\n\n');
}

const styles = await readFile(path.join(root, 'src/view/styles.css'), 'utf8');
assert.ok(!/<\/style/i.test(styles), 'The stylesheet must not close its own element.');

const output = new Map<string, string>();
for (const page of pages) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [path.join(root, page.entry)],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minifyWhitespace: true,
    legalComments: 'none',
    metafile: true,
    plugins: [solidJsx],
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  assert.equal(result.outputFiles.length, 1, `${page.entry} must bundle into one script.`);
  const notices = await licenseNotices(result.metafile);
  assert.ok(!notices.includes('*/'), 'The license notices must fit in a script comment.');
  const script = result.outputFiles[0]!.text.replace(/<\/script/gi, '<\\/script');
  output.set(
    page.file,
    `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${page.title}</title>
<style>
${styles.trim()}
</style>
<div id="app"></div>
<script>/*
${notices}
*/
${script}</script>
</html>
`,
  );
}

checkPages(output);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const [file, html] of output) await writeFile(path.join(destination, file), html);
console.log(`Built ${output.size} self-contained pages in ${path.relative(root, destination) || '.'}.`);
