/* global process */
// jsonc-parser'ın ESM kaynağını tek dosyalık CJS'e derler: src/vendor/jsonc-parser.js
// Neden: paketin "main"i UMD; iç require'ları bir sarmalayıcının içinde olduğundan bundler'lar (bun build --compile)
// izleyemiyor. jsonc-parser güncellenince: npm i -D jsonc-parser@<sürüm> && npm run vendor
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve("jsonc-parser/package.json"));
const { version } = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const license = fs.readFileSync(path.join(pkgDir, "LICENSE.md"), "utf8").trim();

await build({
	entryPoints: [path.join(pkgDir, "lib", "esm", "main.js")],
	outfile: "src/vendor/jsonc-parser.js",
	bundle: true,
	format: "cjs",
	platform: "node",
	target: "es2022",
	legalComments: "none",
	banner: { js: `/* jsonc-parser ${version} — scripts/vendor-jsonc.mjs ile üretildi, elle düzenlemeyin.\n\n${license}\n*/` },
});
process.stdout.write(`src/vendor/jsonc-parser.js <- jsonc-parser ${version}\n`);
