import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Bir modülü ÖNCE tüketici uygulamanın dizininden (`process.cwd()`), bulunamazsa
 * bu paketin kendi konumundan yükler.
 *
 * Neden: opsiyonel paketler (`@prisma/client`, `@prisma/adapter-*`, `cagd-log`)
 * tüketici projede kuruludur. Paket `npm link` ile bağlandığında normal `require()`
 * bu paketin gerçek dizininden yukarı arar ve onları bulamaz.
 *
 * Göreli yollar ("./prisma/generated/...") çalışma dizinine göre çözülür.
 */
export function requireFromApp<T = any>(id: string, options: { asEntry?: boolean } = {}): T {
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
