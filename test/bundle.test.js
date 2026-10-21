"use strict";
/**
 * Tek dosyalık derleme (`bun build --compile`) uyumluluğu.
 * jsonc-parser'ın UMD paketi bundler'larca izlenemiyordu (`Cannot find module './impl/format'`); kütüphane onun
 * gömülü CJS kopyasını kullanır ve çalışma zamanında dış bağımlılığı yoktur.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const { tmpDir, plainEnv } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

function jsFiles(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? jsFiles(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []));
}

test("dist içinde jsonc-parser paketine require yok", () => {
	const offenders = jsFiles(DIST).filter(f => /require\(["']jsonc-parser["']\)/.test(fs.readFileSync(f, "utf8")));
	assert.deepEqual(offenders, []);
});

test("package.json çalışma zamanı bağımlılığı içermez", () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
	assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
});

test("gömülü jsonc-parser parse/modify/applyEdits sağlar", () => {
	const jsonc = require(path.join(DIST, "vendor", "jsonc-parser.js"));
	const text = '{\n\t// yorum\n\t"a": 1\n}';
	assert.deepEqual(jsonc.parse(text), { a: 1 });
	const edited = jsonc.applyEdits(text, jsonc.modify(text, ["b"], 2, { formattingOptions: { insertSpaces: false, tabSize: 1 } }));
	assert.deepEqual(jsonc.parse(edited), { a: 1, b: 2 });
	assert.match(edited, /\/\/ yorum/);
});

const hasBun = spawnSync("bun", ["--version"]).status === 0;

test("bun ile tek dosya derlenen uygulama config yükler", { skip: !hasBun && "bun kurulu değil" }, () => {
	const app = tmpDir("cagd-bun-");
	try {
		const entry = path.join(app, "main.js");
		fs.writeFileSync(
			entry,
			`const { config, baseConfig } = require(${JSON.stringify(path.join(DIST, "config"))});
config.manager.setDefaultConfig({ ...baseConfig, app: { name: "x" } }, { env: false });
console.log(config.data.app.name, require("node:fs").existsSync("config.jsonc"));`,
		);
		const out = path.join(app, "app-bin");
		execFileSync("bun", ["build", "--compile", entry, "--outfile", out], { cwd: app, stdio: "pipe" });
		const runDir = tmpDir("cagd-bun-run-");
		try {
			fs.copyFileSync(out, path.join(runDir, "app-bin"));
			fs.chmodSync(path.join(runDir, "app-bin"), 0o755);
			const result = execFileSync(path.join(runDir, "app-bin"), { cwd: runDir, encoding: "utf8", env: plainEnv() }).trim();
			assert.equal(result, "x true");
		} finally {
			fs.rmSync(runDir, { recursive: true, force: true });
		}
	} finally {
		fs.rmSync(app, { recursive: true, force: true });
	}
});
