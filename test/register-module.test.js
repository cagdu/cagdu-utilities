"use strict";
/**
 * Tek dosyalık derlemede (`bun build --compile`) dinamik `require` ile aranan paketler exe'ye gömülmez.
 * Uygulama sürücüyü statik import edip `util.registerModule()` ile verir; kayıt yoksa eski çözümleme sürer.
 */
const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { dist, tmpDir, captureLogs } = require("./helpers");

captureLogs();
const { config, baseConfig, services, util } = dist("index");
const { requireFromApp } = dist("util/require");
config.manager.setDefaultConfig(baseConfig, { useFile: false, env: false });

describe("util.registerModule", () => {
	afterEach(() => {
		util.unregisterModule("mssql");
		util.unregisterModule("pg");
	});

	test("kayıtlı modül requireFromApp'ten döner", () => {
		const fake = { kayitli: true };
		util.registerModule("mssql", fake);
		assert.equal(requireFromApp("mssql"), fake);
		assert.equal(requireFromApp("mssql", { asEntry: true }), fake);
	});

	test("kayıt kaldırılınca eski çözümleme sürer", () => {
		util.registerModule("node:path", { sahte: true });
		util.unregisterModule("node:path");
		assert.equal(requireFromApp("node:path"), path);
	});

	test("MssqlService kayıtlı sürücüyü kullanır", async () => {
		const created = [];
		class ConnectionPool {
			constructor(cfg) {
				created.push(cfg);
			}
			async connect() {
				throw new Error("sahte bağlantı hatası");
			}
		}
		util.registerModule("mssql", { ConnectionPool });
		await assert.rejects(services.MssqlService.getInstance().connect(), /sahte bağlantı hatası/);
		assert.equal(created.length, 1);
		assert.equal(created[0].server, baseConfig.database.mssql.host);
		await services.MssqlService.getInstance().close();
	});

	test("PostgresService kayıtlı sürücüyü kullanır", async () => {
		class Pool {
			on() {}
			async query() {
				return { rows: [{ from: "registered-pg" }] };
			}
			async end() {}
		}
		util.registerModule("pg", { Pool });
		const rows = await services.PostgresService.getInstance().query("SELECT 1");
		assert.deepEqual(rows, [{ from: "registered-pg" }]);
		await services.PostgresService.getInstance().close();
	});
});

test("servis modülleri yüklenince sürücü aranmaz (ilk kullanımda yüklenir)", () => {
	const app = tmpDir("cagd-nodriver-");
	try {
		const script = ["database/Mssql.Service", "database/Postgres.Service"].map(m => `require(${JSON.stringify(path.join(__dirname, "..", "dist", "services", m))});`).join("\n");
		const entry = path.join(app, "main.js");
		const check = "console.log(Object.keys(require.cache).filter(f => /node_modules[\\\\/](mssql|pg)[\\\\/]/.test(f)).length);";
		fs.writeFileSync(entry, `${script}\n${check}`);
		const out = execFileSync(process.execPath, [entry], { cwd: app, encoding: "utf8" }).trim();
		assert.equal(out, "0");
	} finally {
		fs.rmSync(app, { recursive: true, force: true });
	}
});
