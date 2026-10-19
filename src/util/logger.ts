/**
 * `cagd-log` varsa onu kullanır, yoksa console'a düşer.
 * Böylece paket, cagd-log kurulu olmayan bir projede de çalışır.
 *
 * `cagd-log`, log satırındaki dosya adını kendisini İLK `require()` eden modülden
 * (`module.parent`) alır. Bu paket onu kendisi yüklerse tüm satırlarda dosya adı bu
 * paketin `require.js`'i görünür. Bu yüzden cagd-log, uygulamanın giriş dosyası adına
 * yüklenir (`requireFromApp(..., { asEntry: true })`) ve ilk log anına kadar ertelenir;
 * uygulama cagd-log'u kendisi önce import ettiyse onun modülü kullanılır.
 */
import { requireFromApp } from "./require";

export interface Logger {
	info: (...args: any[]) => void;
	warn: (...args: any[]) => void;
	error: (...args: any[]) => void;
	debug: (...args: any[]) => void;
}

const LEVELS = ["info", "warn", "error", "debug"] as const;

const consoleLogger: Logger = {
	info: (...args) => console.log("[cagdu-utilities]", ...args),
	warn: (...args) => console.warn("[cagdu-utilities]", ...args),
	error: (...args) => console.error("[cagdu-utilities]", ...args),
	debug: (...args) => console.debug("[cagdu-utilities]", ...args),
};

function resolveLogger(): Logger {
	try {
		const mod = requireFromApp("cagd-log", { asEntry: true });
		const candidate = (mod?.default ?? mod) as Partial<Logger>;
		if (candidate && typeof candidate.error === "function") {
			const out = { ...consoleLogger };
			for (const level of LEVELS) {
				const fn = candidate[level];
				if (typeof fn === "function") out[level] = fn.bind(candidate);
			}
			return out;
		}
	} catch {
		/* cagd-log kurulu değil */
	}
	return consoleLogger;
}

let active: Logger | null = null;

const current = (): Logger => (active ??= resolveLogger());

/** Dışarıdan kendi logger'ını enjekte etmek istersen. Verilmeyen seviyeler mevcut logger'da kalır. */
export function setLogger(logger: Partial<Logger>): void {
	active = { ...current(), ...logger };
}

export const log: Logger = {
	info: (...a) => current().info(...a),
	warn: (...a) => current().warn(...a),
	error: (...a) => current().error(...a),
	debug: (...a) => current().debug(...a),
};

export default log;
