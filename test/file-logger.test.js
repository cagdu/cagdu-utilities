"use strict";
/**
 * util.createFileLogger: dosyaya ekleyerek yazan, günlük dönen, eski dosyaları silen ve son kayıtları bellekte tutan logger.
 * Yıllarca çalışan servislerde dosya büyüdükçe yavaşlamamalı (cagd-log her satırda dosyanın tamamını baştan yazıyordu).
 */
const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { dist, tmpDir } = require("./helpers");

const { util } = dist("index");

/** Yerel saatle sabit bir an. */
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0);
const lines = file => fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);

describe("util.createFileLogger", () => {
	let dir;
	let now;
	let logger;
	const make = (opts = {}) => (logger = util.createFileLogger({ dir, prefix: "app", console: false, now: () => now, ...opts }));

	beforeEach(() => {
		dir = path.join(tmpDir("cagd-flog-"), "log");
		now = at(2026, 10, 21);
	});
	afterEach(() => {
		logger?.close();
		fs.rmSync(path.dirname(dir), { recursive: true, force: true });
	});

	test("dizin yoksa oluşturulur ve satırlar dosyanın sonuna eklenir", () => {
		make();
		logger.info("bir");
		logger.warn("iki", { a: 1 });
		const file = path.join(dir, "app-2026-10-21.log");
		const rows = lines(file);
		assert.equal(rows.length, 2);
		assert.equal(rows[0].level, "info");
		assert.equal(rows[0].message, "bir");
		assert.equal(rows[1].message, "iki { a: 1 }");
		assert.match(rows[0].time, /^2026-10-21T12:00:00\.000[+-]\d\d:\d\d$/);
	});

	test("gün değişince yeni dosyaya yazılır", () => {
		make();
		logger.info("dün");
		now = at(2026, 10, 22, 0);
		logger.info("bugün");
		assert.equal(lines(path.join(dir, "app-2026-10-21.log")).length, 1);
		assert.equal(lines(path.join(dir, "app-2026-10-22.log"))[0].message, "bugün");
	});

	test("saklama süresinden eski dosyalar silinir, başka önekler korunur", () => {
		fs.mkdirSync(dir, { recursive: true });
		for (const name of ["app-2026-09-01.log", "app-2026-10-15.log", "other-2026-01-01.log", "app-notes.txt"]) fs.writeFileSync(path.join(dir, name), "x\n");
		make({ retentionDays: 30 });
		logger.info("başla");
		assert.deepEqual(fs.readdirSync(dir).sort(), ["app-2026-10-15.log", "app-2026-10-21.log", "app-notes.txt", "other-2026-01-01.log"]);
	});

	test("gün değişiminde eski dosyalar yine temizlenir", () => {
		make({ retentionDays: 1 });
		logger.info("ilk");
		now = at(2026, 10, 25);
		logger.info("sonra");
		assert.deepEqual(fs.readdirSync(dir), ["app-2026-10-25.log"]);
	});

	test("recent tampon boyutunu aşmaz ve seviye filtresi uygular", () => {
		make({ bufferSize: 3 });
		logger.info("1");
		logger.error("2");
		logger.info("3");
		logger.warn("4");
		assert.deepEqual(
			logger.recent().map(e => e.message),
			["2", "3", "4"],
		);
		assert.deepEqual(
			logger.recent(10, "warn").map(e => e.message),
			["2", "4"],
		);
		assert.deepEqual(
			logger.recent(1).map(e => e.message),
			["4"],
		);
	});

	test("level altındaki kayıtlar yazılmaz", () => {
		make({ level: "warn" });
		logger.debug("d");
		logger.info("i");
		logger.error("e");
		assert.deepEqual(
			lines(path.join(dir, "app-2026-10-21.log")).map(r => r.message),
			["e"],
		);
		assert.equal(logger.recent().length, 1);
	});

	test("Error yığınıyla yazılır", () => {
		make();
		logger.error("olmadı:", new Error("patladı"));
		const [row] = lines(path.join(dir, "app-2026-10-21.log"));
		assert.match(row.message, /^olmadı: Error: patladı\n\s+at /);
	});

	test("yazılamazsa hata fırlatmaz, kayıt yine tamponda", () => {
		fs.mkdirSync(path.dirname(dir), { recursive: true });
		fs.writeFileSync(dir, "dizin değil, dosya");
		const warnings = [];
		const original = console.warn;
		console.warn = (...a) => warnings.push(a.join(" "));
		try {
			make();
			logger.info("a");
			logger.info("b");
		} finally {
			console.warn = original;
		}
		assert.equal(logger.recent().length, 2);
		assert.equal(warnings.length, 1);
	});
});
