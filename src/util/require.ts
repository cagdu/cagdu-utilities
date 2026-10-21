import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const registered = new Map<string, unknown>();

/**
 * Bir modülü uygulamanın kendisi verir; `requireFromApp(id)` artık onu döner.
 *
 * Neden: tek dosyalık derlemede (`bun build --compile`) dinamik `require` ile aranan paketler (`mssql`, `pg`,
 * `@prisma/adapter-*`, `cagd-log`) exe'ye gömülmez. Uygulama paketi statik import edip burada kaydeder:
 *
 *   import sql from "mssql";
 *   util.registerModule("mssql", sql);
 *
 * Kullanılmadan ÖNCE çağrılmalı (sürücüler ilk kullanımda yüklenir).
 */
export function registerModule(id: string, mod: unknown): void {
	registered.set(id, mod);
}

/** `registerModule()` kaydını kaldırır; `requireFromApp` normal çözümlemeye döner. */
export function unregisterModule(id: string): void {
	registered.delete(id);
}

/**
 * Bir modülü (kayıtlıysa kayıttan, değilse) ÖNCE tüketici uygulamanın dizininden (`process.cwd()`), bulunamazsa
 * bu paketin kendi konumundan yükler.
 *
 * Neden: opsiyonel paketler (`@prisma/client`, `@prisma/adapter-*`, `cagd-log`)
 * tüketici projede kuruludur. Paket `npm link` ile bağlandığında normal `require()`
 * bu paketin gerçek dizininden yukarı arar ve onları bulamaz.
 *
 * Göreli yollar ("./prisma/generated/...") çalışma dizinine göre çözülür.
 */
export function requireFromApp<T = any>(id: string, options: { asEntry?: boolean } = {}): T {
	if (registered.has(id)) return registered.get(id) as T;
	const request = id.startsWith(".") ? path.resolve(process.cwd(), id) : id;
	let resolved: string | null = null;
	try {
		resolved = require.resolve(request, { paths: [process.cwd()] });
	} catch {
		/* uygulama dizininde yok, paketin kendi konumundan dene */
	}
	if (options.asEntry) {
		const entry = appEntryFile();
		if (entry) return createRequire(entry)(resolved ?? require.resolve(request)) as T;
	}
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return require(resolved ?? request) as T;
}

/**
 * Tüketici uygulamanın giriş dosyası: Node CJS'te `require.main`, ESM/Bun'da `process.argv[1]`. Bulunamazsa `null`.
 * `requireFromApp(id, { asEntry: true })` modülü bu dosya adına yükler; modülün `module.parent`'ı bu paketin değil
 * uygulamanın dosyası olur.
 */
export function appEntryFile(): string | null {
	for (const candidate of [require.main?.filename, process.argv[1]]) {
		if (!candidate) continue;
		const file = path.resolve(process.cwd(), candidate);
		try {
			if (fs.statSync(file).isFile()) return file;
		} catch {
			/* dosya değil (REPL, `node -e` vb.) */
		}
	}
	return null;
}
