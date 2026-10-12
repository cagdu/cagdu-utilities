"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");

const { dist, captureLogs } = require("./helpers");

const logs = captureLogs();
const { util } = dist("index");
const { createEnvHelpers, unescapePem, parseEnv, loadEnv, formatEnvError } = util.env;

const h = createEnvHelpers(z);

/** Tek alanlı şemayı doğrular: başarılıysa değeri, değilse ilk hatayı döner. */
function check(schema, value) {
	const result = z.object({ X: schema }).safeParse(value === undefined ? {} : { X: value });
	return result.success ? { ok: true, value: result.data.X } : { ok: false, issue: result.error.issues[0] };
}

describe("unescapePem", () => {
	test("\\n kaçışlarını satır sonuna çevirir, kaçışsız değeri olduğu gibi bırakır", () => {
		assert.equal(unescapePem("-----BEGIN-----\\nABC\\n-----END-----"), "-----BEGIN-----\nABC\n-----END-----");
		assert.equal(unescapePem("a\nb"), "a\nb");
	});
});

describe("createEnvHelpers", () => {
	test("requiredEnv: kırpar; tanımsız/boş/boşluk → '<label> zorunludur'", () => {
		assert.deepEqual(check(h.requiredEnv("X"), "  v  "), { ok: true, value: "v" });
		for (const v of [undefined, "", "   "]) {
			const r = check(h.requiredEnv("X"), v);
			assert.equal(r.ok, false);
			assert.equal(r.issue.message, "X zorunludur");
			assert.deepEqual(r.issue.path, ["X"]);
		}
		assert.equal(check(h.requiredEnv("X", "özel"), "").issue.message, "özel");
	});

	test("stringEnv: tanımsız/boş → varsayılan", () => {
		assert.equal(check(h.stringEnv("def"), undefined).value, "def");
		assert.equal(check(h.stringEnv("def"), " ").value, "def");
		assert.equal(check(h.stringEnv("def"), " x ").value, "x");
	});

	test("optionalEnv: tanımsız/boş → undefined, dolu değer şemayla doğrulanır", () => {
		const s = h.optionalEnv(h.postgresUrl("X"));
		assert.deepEqual(check(s, undefined), { ok: true, value: undefined });
		assert.deepEqual(check(s, ""), { ok: true, value: undefined });
		assert.equal(check(s, "postgres://u@h/db").value, "postgres://u@h/db");
		assert.equal(check(s, "sqlserver://x").ok, false);
		assert.deepEqual(check(h.optionalEnv(z.string().trim()), " a ").value, "a");
	});

	test("positiveIntEnv: varsayılan, dönüşüm ve hata mesajı", () => {
		const s = h.positiveIntEnv(900, "TTL");
		assert.equal(check(s, undefined).value, 900);
		assert.equal(check(s, "").value, 900);
		assert.equal(check(s, " 60 ").value, 60);
		for (const v of ["0", "-1", "1.5", "abc", "Infinity", "1e400"]) {
			const r = check(s, v);
			assert.equal(r.ok, false, v);
			assert.equal(r.issue.message, "TTL pozitif bir tam sayı olmalı");
		}
	});

	test("intEnv / portEnv: sınırlar", () => {
		assert.equal(check(h.intEnv(0, "N"), "-5").value, -5);
		assert.equal(check(h.intEnv(0, "N", { min: 0, max: 10 }), "11").issue.message, "N 0 ile 10 arasında bir tam sayı olmalı");
		assert.equal(check(h.intEnv(0, "N", { min: 2 }), "1").issue.message, "N en az 2 olan bir tam sayı olmalı");
		assert.equal(check(h.portEnv(3000, "PORT"), undefined).value, 3000);
		assert.equal(check(h.portEnv(3000, "PORT"), "8080").value, 8080);
		assert.equal(check(h.portEnv(3000, "PORT"), "70000").ok, false);
	});

	test("booleanEnv: bilinen değerler, varsayılan; bilinmeyen değer hatadır", () => {
		const s = h.booleanEnv(true, "PUSH");
		assert.equal(check(s, undefined).value, true);
		assert.equal(check(h.booleanEnv(false, "PUSH"), "").value, false);
		for (const v of ["true", "1", "YES", " on "]) assert.equal(check(s, v).value, true, v);
		for (const v of ["false", "0", "No", "OFF"]) assert.equal(check(s, v).value, false, v);
		assert.equal(check(s, "belki").issue.message, "PUSH true/false (1/0, yes/no, on/off) olmalı");
	});

	test("listEnv: virgülle ayrılır, boşlar atılır, ayraç seçilebilir", () => {
		assert.deepEqual(check(h.listEnv(), undefined).value, []);
		assert.deepEqual(check(h.listEnv(["a"]), "").value, ["a"]);
		assert.deepEqual(check(h.listEnv(), " a, b ,,c ").value, ["a", "b", "c"]);
		assert.deepEqual(check(h.listEnv([], ";"), "a;b").value, ["a", "b"]);
	});

	test("enumEnv / nodeEnv", () => {
		const s = h.enumEnv("DATABASE_TYPE", ["postgres"], { message: 'DATABASE_TYPE "postgres" olmalı' });
		assert.equal(check(s, "postgres").value, "postgres");
		assert.equal(check(s, "mssql").issue.message, 'DATABASE_TYPE "postgres" olmalı');
		assert.equal(check(s, undefined).issue.message, "DATABASE_TYPE zorunludur");
		assert.equal(check(h.enumEnv("M", ["a", "b"]), "c").issue.message, "M şunlardan biri olmalı: a, b");
		assert.equal(check(h.enumEnv("M", ["a", "b"], { default: "b" }), "").value, "b");
		assert.equal(check(h.nodeEnv(), undefined).value, "development");
		assert.equal(check(h.nodeEnv("production"), "").value, "production");
		assert.equal(check(h.nodeEnv(), "test").value, "test");
		assert.equal(check(h.nodeEnv(), "staging").ok, false);
	});

	test("postgresUrl / urlEnv", () => {
		const pg = h.postgresUrl("DATABASE_URL", { hint: "bkz. .env.example" });
		assert.equal(check(pg, "postgres://u:p@h/db").ok, true);
		assert.equal(check(pg, "POSTGRESQL://u:p@h/db").ok, true);
		assert.equal(check(pg, "sqlserver://x").issue.message, "DATABASE_URL postgresql:// ile başlamalı (bkz. .env.example)");
		assert.equal(check(pg, undefined).issue.message, "DATABASE_URL zorunludur");

		const redis = h.urlEnv("REDIS_URL", { protocols: ["redis", "rediss"] });
		assert.equal(check(redis, "rediss://h:6380").ok, true);
		assert.equal(check(redis, "http://h").issue.message, "REDIS_URL redis:// ya da rediss:// ile başlamalı");
		assert.equal(check(h.urlEnv("U"), "https://example.com/x").ok, true);
		assert.equal(check(h.urlEnv("U"), "örnek").issue.message, "U geçerli bir URL olmalı");
	});

	test("pemEnv: zorunlu, kırpılır, \\n kaçışları çevrilir", () => {
		const s = h.pemEnv("JWT_PRIVATE_KEY", "JWT_PRIVATE_KEY zorunludur (bkz. keys:generate)");
		assert.equal(check(s, " A\\nB ").value, "A\nB");
		assert.equal(check(s, "").issue.message, "JWT_PRIVATE_KEY zorunludur (bkz. keys:generate)");
	});

	test("jsonEnv: ayrıştırır, şemayla doğrular; hata yolu değişken adının altına düşer", () => {
		const s = h.optionalEnv(h.jsonEnv("KEYS", z.array(z.object({ kid: z.string(), pem: z.string().transform(unescapePem) }))));
		assert.deepEqual(check(s, undefined), { ok: true, value: undefined });
		assert.deepEqual(check(s, JSON.stringify([{ kid: "k1", pem: "A\\nB" }])).value, [{ kid: "k1", pem: "A\nB" }]);
		assert.equal(check(s, "not-json").issue.message, "KEYS geçerli bir JSON olmalı");
		assert.deepEqual(check(s, JSON.stringify([{ kid: 1, pem: "x" }])).issue.path, ["X", 0, "kid"]);
		assert.equal(check(h.jsonEnv("KEYS", z.array(z.string()), { message: "özel" }), "{").issue.message, "özel");
	});
});

describe("parseEnv / loadEnv / formatEnvError", () => {
	const schema = z.object({ DATABASE_URL: h.postgresUrl("DATABASE_URL"), PORT: h.portEnv(3000, "PORT") });

	test("parseEnv: saf doğrulama", () => {
		const ok = parseEnv(schema, { DATABASE_URL: "postgres://h/db" });
		assert.deepEqual(ok, { success: true, data: { DATABASE_URL: "postgres://h/db", PORT: 3000 } });
		const bad = parseEnv(schema, { PORT: "x" });
		assert.equal(bad.success, false);
		assert.equal(bad.error.issues.length, 2);
	});

	test("formatEnvError: tüm hataları yol ve mesajla yazar, değeri yazmaz", () => {
		const bad = parseEnv(schema, { DATABASE_URL: "sqlserver://gizli-sifre", PORT: "x" });
		const text = formatEnvError(bad.error);
		assert.equal(text, "'DATABASE_URL' - DATABASE_URL postgresql:// ile başlamalı; 'PORT' - PORT 1 ile 65535 arasında bir port olmalı");
		assert.ok(!text.includes("gizli-sifre"));
	});

	test("loadEnv: başarılıysa veriyi döner; exitOnError:false ile fırlatır", () => {
		assert.equal(loadEnv(schema, { source: { DATABASE_URL: "postgresql://h/db", PORT: "1" } }).PORT, 1);
		assert.throws(() => loadEnv(schema, { source: {}, exitOnError: false }), /Ortam değişkeni doğrulanamadı: 'DATABASE_URL' - DATABASE_URL zorunludur/);
	});

	test("loadEnv: varsayılan olarak loglar ve process.exit(exitCode) çağırır", () => {
		const originalExit = process.exit;
		let code;
		process.exit = c => {
			code = c;
			throw new Error("exit");
		};
		try {
			assert.throws(() => loadEnv(schema, { source: {}, exitCode: 3 }), /exit/);
		} finally {
			process.exit = originalExit;
		}
		assert.equal(code, 3);
		assert.ok(logs.some(l => l.level === "error" && l.text.startsWith("[env] Ortam değişkeni doğrulanamadı: 'DATABASE_URL'")));
	});
});

describe("makro-api şemasının yardımcılarla yazılmış hali, mevcut davranışı korur", () => {
	const envSchema = z.object({
		NODE_ENV: h.nodeEnv(),
		DATABASE_TYPE: h.enumEnv("DATABASE_TYPE", ["postgres"], { message: 'DATABASE_TYPE "postgres" olmalı (veritabanı PostgreSQL; eski MSSQL ayarı mı kaldı? bkz. .env.example)' }),
		DATABASE_URL: h.postgresUrl("DATABASE_URL", { hint: "veritabanı PostgreSQL; eski sqlserver:// adresi mi kaldı? bkz. .env.example" }),
		DATABASE_MIGRATE_URL: h.optionalEnv(h.postgresUrl("DATABASE_MIGRATE_URL")),
		REDIS_URL: h.requiredEnv("REDIS_URL"),
		JWT_ISSUER: h.stringEnv("makro-api"),
		JWT_PRIVATE_KEY: h.pemEnv("JWT_PRIVATE_KEY", "JWT_PRIVATE_KEY zorunludur (bkz. `bun run keys:generate`)"),
		JWT_KEY_ID: h.requiredEnv("JWT_KEY_ID"),
		JWT_PREVIOUS_PUBLIC_KEYS: h.optionalEnv(h.jsonEnv("JWT_PREVIOUS_PUBLIC_KEYS", z.array(z.object({ kid: z.string(), pem: z.string().transform(unescapePem) })))),
		ACCESS_TTL_USER_SEC: h.positiveIntEnv(900, "ACCESS_TTL_USER_SEC"),
		PUSH_ENABLED: h.booleanEnv(true, "PUSH_ENABLED"),
		EXPO_ACCESS_TOKEN: h.optionalEnv(z.string().trim()),
	});
	const validBase = {
		NODE_ENV: "test",
		DATABASE_TYPE: "postgres",
		DATABASE_URL: "postgresql://app:x@127.0.0.1:54330/db",
		REDIS_URL: "redis://localhost:6379",
		JWT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nMC4=\\n-----END PRIVATE KEY-----",
		JWT_KEY_ID: "20260101-abcdef",
	};

	test("geçerli ortam ve varsayılanlar", () => {
		const r = parseEnv(envSchema, validBase);
		assert.equal(r.success, true);
		assert.equal(r.data.JWT_ISSUER, "makro-api");
		assert.equal(r.data.ACCESS_TTL_USER_SEC, 900);
		assert.equal(r.data.PUSH_ENABLED, true);
		assert.ok(r.data.JWT_PRIVATE_KEY.includes("\n") && !r.data.JWT_PRIVATE_KEY.includes("\\n"));
	});

	test("eksik / eski ayarlar anlaşılır hatayla reddedilir", () => {
		const noKey = { ...validBase };
		delete noKey.JWT_PRIVATE_KEY;
		assert.ok(parseEnv(envSchema, noKey).error.issues.some(i => i.path.includes("JWT_PRIVATE_KEY")));
		assert.match(parseEnv(envSchema, { ...validBase, DATABASE_TYPE: "mssql" }).error.issues[0].message, /postgres/);
		assert.deepEqual(parseEnv(envSchema, { ...validBase, DATABASE_URL: "sqlserver://h;user=sa" }).error.issues[0].path, ["DATABASE_URL"]);
		assert.equal(parseEnv(envSchema, { ...validBase, DATABASE_MIGRATE_URL: "" }).success, true);
		assert.equal(parseEnv(envSchema, { ...validBase, DATABASE_MIGRATE_URL: "sqlserver://x" }).success, false);
		assert.equal(parseEnv(envSchema, { ...validBase, JWT_PREVIOUS_PUBLIC_KEYS: "not-json" }).success, false);
		assert.equal(parseEnv(envSchema, { ...validBase, JWT_PREVIOUS_PUBLIC_KEYS: JSON.stringify([{ kid: "old-1", pem: "PEM" }]) }).data.JWT_PREVIOUS_PUBLIC_KEYS[0].kid, "old-1");
		assert.equal(parseEnv(envSchema, { ...validBase, NODE_ENV: "staging" }).success, false);
		assert.equal(parseEnv(envSchema, { ...validBase, PUSH_ENABLED: "false" }).data.PUSH_ENABLED, false);
	});
});
