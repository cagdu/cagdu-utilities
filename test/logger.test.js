"use strict";
/**
 * cagd-log, satırdaki dosya adını kendisini ilk `require()` eden modülden (`module.parent`) alır.
 * Paket onu uygulamanın giriş dosyası adına yüklemeli; aksi halde her satırda `dist/util/require.js` görünür.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { tmpDir } = require("./helpers");

const DIST = path.join(__dirname, "..", "dist");

test("cagd-log uygulamanın giriş dosyası adına yüklenir", () => {
	const app = tmpDir("cagd-app-");
	try {
		const dir = path.join(app, "node_modules", "cagd-log");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "cagd-log", version: "0.0.0", main: "index.js" }));
		fs.writeFileSync(path.join(dir, "index.js"), "const p = module.parent && module.parent.filename; exports.error = exports.warn = exports.info = exports.debug = () => console.log(p);");
		const entry = path.join(app, "main.js");
		fs.writeFileSync(entry, `require(${JSON.stringify(path.join(DIST, "util", "logger"))}).log.warn("x");`);
		const out = execFileSync(process.execPath, [entry], { cwd: app, encoding: "utf8" }).trim();
		assert.equal(out, entry);
	} finally {
		fs.rmSync(app, { recursive: true, force: true });
	}
});
