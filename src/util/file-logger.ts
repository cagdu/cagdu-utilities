/**
 * ============================================================
 *  util.createFileLogger  —  DÖNDÜRMELİ DOSYA LOGGER'I
 * ============================================================
 * Uzun süre bakımsız çalışan servisler için bağımlılıksız logger:
 *
 *   const logger = util.createFileLogger({ dir: "log", prefix: "agent", retentionDays: 30 });
 *   util.setLogger(logger);          // paketin kendi logları da buraya
 *   logger.recent(100, "warn");      // son uyarı/hatalar (ör. yönetim paneli için)
 *
 * - Her satır bir JSON kaydıdır: {"time":"2026-10-21T12:00:00.000+03:00","level":"info","message":"..."}.
 *   Dosyaya EKLENİR (dosya baştan okunup yazılmaz); dosya büyüdükçe yazma yavaşlamaz.
 * - Dosya adı yerel güne göre: `<dir>/<prefix>-YYYY-MM-DD.log`. Gün değişince yeni dosyaya geçilir ve
 *   `retentionDays`'ten eski `<prefix>-*.log` dosyaları silinir.
 * - Yazılamazsa (disk dolu, izin yok) hata fırlatmaz; console'a bir kez uyarır, kayıt bellek tamponunda kalır.
 */
import fs from "node:fs";
import path from "node:path";
import { inspect } from "node:util";

import { getLocalDay, getLocalISO } from "./date";
import type { Logger } from "./logger";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
	/** Yerel saat, ofsetli ISO 8601. */
	time: string;
	level: LogLevel;
	message: string;
}

export interface FileLoggerOptions {
	/** Log dizini (yoksa oluşturulur). Göreli yollar çalışma dizinine göre. */
	dir: string;
	/** Dosya adı öneki. Varsayılan: "app". */
	prefix?: string;
	/** Kaç günlük dosya tutulsun. Varsayılan: 30. */
	retentionDays?: number;
	/** Bu seviyenin altındakiler yazılmaz ve tampona girmez. Varsayılan: "info". */
	level?: LogLevel;
	/** Console'a da yazılsın mı? Varsayılan: true. */
	console?: boolean;
	/** Bellekte tutulan son kayıt sayısı (`recent()`). Varsayılan: 500. */
	bufferSize?: number;
	/** Saat kaynağı (testler için). */
	now?: () => Date;
}

export interface FileLogger extends Logger {
	/** Son kayıtlar, eskiden yeniye. `minLevel` verilirse yalnızca o seviye ve üstü. */
	recent(limit?: number, minLevel?: LogLevel): LogEntry[];
	/** Kaynakları bırakır (şimdilik açık dosya tutulmuyor; ileriye dönük). */
	close(): void;
}

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const DAY_FILE = /^(.+)-(\d{4}-\d{2}-\d{2})\.log$/;

const format = (args: unknown[]): string => args.map(a => (typeof a === "string" ? a : inspect(a, { depth: 5, breakLength: Infinity }))).join(" ");

export function createFileLogger(options: FileLoggerOptions): FileLogger {
	const dir = path.resolve(options.dir);
	const prefix = options.prefix ?? "app";
	const retentionDays = options.retentionDays ?? 30;
	const minLevel = ORDER[options.level ?? "info"];
	const toConsole = options.console ?? true;
	const bufferSize = Math.max(1, options.bufferSize ?? 500);
	const now = options.now ?? (() => new Date());

	const buffer: LogEntry[] = [];
	let currentDay: string | null = null;
	let warned = false;

	const cleanup = (today: Date) => {
		const cutoff = new Date(today);
		cutoff.setDate(cutoff.getDate() - retentionDays);
		const cutoffDay = getLocalDay(cutoff);
		for (const name of fs.readdirSync(dir)) {
			const match = DAY_FILE.exec(name);
			if (match && match[1] === prefix && match[2] < cutoffDay) fs.rmSync(path.join(dir, name), { force: true });
		}
	};

	const write = (entry: LogEntry, date: Date) => {
		try {
			const day = getLocalDay(date);
			if (day !== currentDay) {
				fs.mkdirSync(dir, { recursive: true });
				cleanup(date);
				currentDay = day;
			}
			fs.appendFileSync(path.join(dir, `${prefix}-${day}.log`), `${JSON.stringify(entry)}\n`, "utf8");
		} catch (err) {
			currentDay = null; // sonraki satırda dizini yeniden dene
			if (!warned) {
				warned = true;
				console.warn(`[cagdu-utilities] log dosyasına yazılamadı (${dir}):`, err instanceof Error ? err.message : err);
			}
		}
	};

	const emit =
		(level: LogLevel) =>
		(...args: unknown[]) => {
			if (ORDER[level] < minLevel) return;
			const date = now();
			const entry: LogEntry = { time: getLocalISO(date), level, message: format(args) };
			buffer.push(entry);
			if (buffer.length > bufferSize) buffer.splice(0, buffer.length - bufferSize);
			write(entry, date);
			if (toConsole) (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(`[${entry.time}] ${level.toUpperCase()} ${entry.message}`);
		};

	return {
		debug: emit("debug"),
		info: emit("info"),
		warn: emit("warn"),
		error: emit("error"),
		recent(limit = bufferSize, level?: LogLevel) {
			const filtered = level ? buffer.filter(e => ORDER[e.level] >= ORDER[level]) : buffer;
			return filtered.slice(-Math.max(0, limit));
		},
		close() {
			currentDay = null;
		},
	};
}
