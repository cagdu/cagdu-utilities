/**
 * ============================================================
 *  util.env  —  ORTAM DEĞİŞKENİ DOĞRULAMA YARDIMCILARI
 * ============================================================
 *
 * Uygulamalar yalnızca şemayı tanımlar; ayrıştırma, varsayılanlar, boş değer ("") kuralları ve hata mesajları buradadır.
 *
 *   import { z } from "zod";
 *   import { util } from "cagdu-utilities";
 *
 *   const { nodeEnv, requiredEnv, postgresUrl, positiveIntEnv, booleanEnv, pemEnv, optionalEnv } = util.env.createEnvHelpers(z);
 *
 *   export const envSchema = z.object({
 *       NODE_ENV: nodeEnv(),
 *       DATABASE_URL: postgresUrl("DATABASE_URL"),
 *       REDIS_URL: requiredEnv("REDIS_URL"),
 *       JWT_PRIVATE_KEY: pemEnv("JWT_PRIVATE_KEY"),
 *       ACCESS_TTL_SEC: positiveIntEnv(900, "ACCESS_TTL_SEC"),
 *       PUSH_ENABLED: booleanEnv(true, "PUSH_ENABLED"),
 *       EXPO_ACCESS_TOKEN: optionalEnv(z.string().trim()),
 *   });
 *   export const env = util.env.loadEnv(envSchema); // hata varsa loglar ve process.exit(1)
 *
 * Kurallar:
 *  - Boş metin (`""` ya da yalnızca boşluk) "tanımsız" sayılır: varsayılan kullanılır, zorunluysa "zorunludur" hatası verilir.
 *  - Hata mesajları değeri İÇERMEZ (sırlar loga düşmesin); yalnızca değişken adı ve beklenen biçim yazılır.
 *  - Kütüphane zod'u çalışma zamanında yüklemez: zod örneği parametre olarak verilir (uygulamanın zod sürümü kullanılır, v4).
 */
import type * as zod from "zod";

import { log } from "./logger";
import type { ParseableSchema } from "./list";

type Zod = typeof zod.z;

/** Bir ortam değişkeni şeması: `string | undefined` alır, `T` üretir. */
export type EnvSchema<T> = zod.ZodType<T, any>;

const TRUE_VALUES = ["1", "true", "yes", "on"];
const FALSE_VALUES = ["0", "false", "no", "off"];

const isBlank = (value: unknown): boolean => value === undefined || value === null || (typeof value === "string" && value.trim() === "");

/**
 * `\n` kaçışlı tek satır PEM'i gerçek satır sonlarına çevirir. `.env` dosyalarında çok satırlı PEM saklamak zor olduğu için
 * anahtarlar `\n` kaçışlı tek satır olarak tutulur. Kaçış yoksa değer olduğu gibi döner.
 */
export function unescapePem(value: string): string {
	return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

export interface IntEnvOptions {
	/** Alt sınır (dahil). */
	min?: number;
	/** Üst sınır (dahil). */
	max?: number;
	/** Hatalı değerde kullanılacak mesaj (varsayılan: sınırlara göre üretilir). */
	message?: string;
}

export interface UrlEnvOptions {
	/** İzin verilen şemalar (`["redis", "rediss"]`). Verilmezse yalnızca geçerli bir URL olması beklenir. */
	protocols?: readonly string[];
	/** Hata mesajının sonuna parantez içinde eklenir (ör. "bkz. .env.example"). */
	hint?: string;
}

export interface EnumEnvOptions<V extends string> {
	/** Değer tanımsız/boşsa kullanılır. Verilmezse değişken zorunludur. */
	default?: V;
	/** Geçersiz değerde kullanılacak mesaj. */
	message?: string;
}

export interface JsonEnvOptions {
	/** Değer geçerli JSON değilse kullanılacak mesaj. */
	message?: string;
}

export interface EnvHelpers {
	/** Zorunlu metin; kırpılır. Tanımsız/boşsa `"<label> zorunludur"` (ya da `message`). */
	requiredEnv(label: string, message?: string): EnvSchema<string>;
	/** Metin; kırpılır. Tanımsız/boşsa `defaultValue`. */
	stringEnv(defaultValue: string): EnvSchema<string>;
	/** Herhangi bir şemayı isteğe bağlı yapar: tanımsız/boş → `undefined`, aksi halde şemayla doğrulanır. */
	optionalEnv<T>(schema: EnvSchema<T>): EnvSchema<T | undefined>;
	/** Tam sayı; tanımsız/boşsa `defaultValue`. `min`/`max` dahil sınırlardır. */
	intEnv(defaultValue: number, label: string, options?: IntEnvOptions): EnvSchema<number>;
	/** Pozitif tam sayı (≥ 1); tanımsız/boşsa `defaultValue`. Ör. `"900"` → `900`. */
	positiveIntEnv(defaultValue: number, label: string): EnvSchema<number>;
	/** TCP portu (1–65535); tanımsız/boşsa `defaultValue`. */
	portEnv(defaultValue: number, label: string): EnvSchema<number>;
	/** `true/false/1/0/yes/no/on/off` (büyük-küçük harf duyarsız); tanımsız/boşsa `defaultValue`, başka değer hatadır. */
	booleanEnv(defaultValue: boolean, label: string): EnvSchema<boolean>;
	/** Virgülle (ya da `separator` ile) ayrılmış liste; öğeler kırpılır, boşlar atılır. Tanımsız/boşsa `defaultValue`. */
	listEnv(defaultValue?: string[], separator?: string): EnvSchema<string[]>;
	/** Sabit değerlerden biri. `default` verilmezse zorunludur. */
	enumEnv<const V extends readonly [string, ...string[]]>(label: string, values: V, options?: EnumEnvOptions<V[number]>): EnvSchema<V[number]>;
	/** `NODE_ENV`: `development | test | production`, varsayılan `development`. */
	nodeEnv(defaultValue?: "development" | "test" | "production"): EnvSchema<"development" | "test" | "production">;
	/** Zorunlu URL. `protocols` verilirse yalnızca bu şemalarla başlayan adresler kabul edilir. */
	urlEnv(label: string, options?: UrlEnvOptions): EnvSchema<string>;
	/** Zorunlu `postgres://` ya da `postgresql://` bağlantı adresi. */
	postgresUrl(label: string, options?: Pick<UrlEnvOptions, "hint">): EnvSchema<string>;
	/** Zorunlu PEM (anahtar/sertifika); kırpılır ve `\n` kaçışları gerçek satır sonuna çevrilir (`unescapePem`). */
	pemEnv(label: string, message?: string): EnvSchema<string>;
	/** Zorunlu JSON metni; ayrıştırılıp `schema` ile doğrulanır. Hata yolları değişken adının altına düşer (`["KEYS", 0, "kid"]`). */
	jsonEnv<T>(label: string, schema: EnvSchema<T>, options?: JsonEnvOptions): EnvSchema<T>;
}

/**
 * Ortam değişkeni şema yardımcılarını üretir. `z`, uygulamanın zod (v4) örneğidir.
 *
 *   const { postgresUrl, positiveIntEnv } = util.env.createEnvHelpers(z);
 */
export function createEnvHelpers(z: Zod): EnvHelpers {
	/** Tanımsız/boş değeri `fallback`'e çevirir; aksi halde kırpılmış metni döner. */
	const blankTo =
		<T>(fallback: T) =>
		(value: unknown) =>
			isBlank(value) ? fallback : typeof value === "string" ? value.trim() : value;

	const requiredEnv = (label: string, message?: string): EnvSchema<string> =>
		z.preprocess(blankTo(""), z.string().min(1, { message: message ?? `${label} zorunludur`, abort: true })) as unknown as EnvSchema<string>;

	const stringEnv = (defaultValue: string): EnvSchema<string> => z.preprocess(blankTo(defaultValue), z.string()) as unknown as EnvSchema<string>;

	const optionalEnv = <T>(schema: EnvSchema<T>): EnvSchema<T | undefined> =>
		z.preprocess(value => (isBlank(value) ? undefined : value), (schema as zod.ZodType).optional()) as unknown as EnvSchema<T | undefined>;

	const intEnv = (defaultValue: number, label: string, options: IntEnvOptions = {}): EnvSchema<number> => {
		const { min, max } = options;
		const message =
			options.message ??
			(min !== undefined && max !== undefined
				? `${label} ${min} ile ${max} arasında bir tam sayı olmalı`
				: min !== undefined
					? `${label} en az ${min} olan bir tam sayı olmalı`
					: max !== undefined
						? `${label} en fazla ${max} olan bir tam sayı olmalı`
						: `${label} bir tam sayı olmalı`);
		return z
			.string()
			.optional()
			.transform((value, ctx) => {
				if (isBlank(value)) return defaultValue;
				const parsed = Number(value!.trim());
				if (!Number.isInteger(parsed) || (min !== undefined && parsed < min) || (max !== undefined && parsed > max)) {
					ctx.addIssue({ code: "custom", message });
					return z.NEVER;
				}
				return parsed;
			}) as unknown as EnvSchema<number>;
	};

	const positiveIntEnv = (defaultValue: number, label: string): EnvSchema<number> => intEnv(defaultValue, label, { min: 1, message: `${label} pozitif bir tam sayı olmalı` });

	const portEnv = (defaultValue: number, label: string): EnvSchema<number> => intEnv(defaultValue, label, { min: 1, max: 65535, message: `${label} 1 ile 65535 arasında bir port olmalı` });

	const booleanEnv = (defaultValue: boolean, label: string): EnvSchema<boolean> =>
		z
			.string()
			.optional()
			.transform((value, ctx) => {
				if (isBlank(value)) return defaultValue;
				const text = value!.trim().toLowerCase();
				if (TRUE_VALUES.includes(text)) return true;
				if (FALSE_VALUES.includes(text)) return false;
				ctx.addIssue({ code: "custom", message: `${label} true/false (1/0, yes/no, on/off) olmalı` });
				return z.NEVER;
			}) as unknown as EnvSchema<boolean>;

	const listEnv = (defaultValue: string[] = [], separator = ","): EnvSchema<string[]> =>
		z
			.string()
			.optional()
			.transform(value => {
				if (isBlank(value)) return [...defaultValue];
				return value!
					.split(separator)
					.map(item => item.trim())
					.filter(Boolean);
			}) as unknown as EnvSchema<string[]>;

	const enumEnv = <const V extends readonly [string, ...string[]]>(label: string, values: V, options: EnumEnvOptions<V[number]> = {}): EnvSchema<V[number]> => {
		const message = options.message ?? `${label} şunlardan biri olmalı: ${values.join(", ")}`;
		return z.preprocess(
			blankTo(options.default),
			z.string({ error: options.default === undefined ? `${label} zorunludur` : message }).refine(value => (values as readonly string[]).includes(value), message),
		) as unknown as EnvSchema<V[number]>;
	};

	const nodeEnv = (defaultValue: "development" | "test" | "production" = "development") => enumEnv("NODE_ENV", ["development", "test", "production"], { default: defaultValue });

	const urlEnv = (label: string, options: UrlEnvOptions = {}): EnvSchema<string> => {
		const { protocols, hint } = options;
		const suffix = hint ? ` (${hint})` : "";
		const pattern = protocols?.length ? new RegExp(`^(${protocols.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}):\\/\\/`, "i") : null;
		const message = pattern ? `${label} ${protocols!.map(p => `${p}://`).join(" ya da ")} ile başlamalı${suffix}` : `${label} geçerli bir URL olmalı${suffix}`;
		return z.preprocess(
			blankTo(""),
			z
				.string()
				.min(1, { message: `${label} zorunludur`, abort: true })
				.refine(value => {
					if (pattern) return pattern.test(value);
					try {
						new URL(value);
						return true;
					} catch {
						return false;
					}
				}, message),
		) as unknown as EnvSchema<string>;
	};

	const postgresUrl = (label: string, options: Pick<UrlEnvOptions, "hint"> = {}): EnvSchema<string> => {
		const suffix = options.hint ? ` (${options.hint})` : "";
		return z.preprocess(
			blankTo(""),
			z
				.string()
				.min(1, { message: `${label} zorunludur`, abort: true })
				.refine(value => /^postgres(ql)?:\/\//i.test(value), `${label} postgresql:// ile başlamalı${suffix}`),
		) as unknown as EnvSchema<string>;
	};

	const pemEnv = (label: string, message?: string): EnvSchema<string> =>
		z.preprocess(
			blankTo(""),
			z
				.string()
				.min(1, { message: message ?? `${label} zorunludur`, abort: true })
				.transform(unescapePem),
		) as unknown as EnvSchema<string>;

	const jsonEnv = <T>(label: string, schema: EnvSchema<T>, options: JsonEnvOptions = {}): EnvSchema<T> =>
		z.preprocess(
			blankTo(""),
			z
				.string()
				.min(1, { message: `${label} zorunludur`, abort: true })
				.transform((value, ctx) => {
					try {
						return JSON.parse(value) as unknown;
					} catch {
						ctx.addIssue({ code: "custom", message: options.message ?? `${label} geçerli bir JSON olmalı` });
						return z.NEVER;
					}
				})
				.pipe(schema as zod.ZodType),
		) as unknown as EnvSchema<T>;

	return { requiredEnv, stringEnv, optionalEnv, intEnv, positiveIntEnv, portEnv, booleanEnv, listEnv, enumEnv, nodeEnv, urlEnv, postgresUrl, pemEnv, jsonEnv };
}

// ------------------------------------------------------------------
// Doğrulama
// ------------------------------------------------------------------

/** zod hatasının kullandığımız kısmı (zod'a çalışma zamanı bağımlılığı olmadan). */
export interface EnvIssue {
	path: PropertyKey[];
	message: string;
}

export type EnvParseResult<T> = { success: true; data: T } | { success: false; error: { issues: EnvIssue[] } };

/** Saf (yan etkisiz) doğrulama: testlerde farklı `process.env` kombinasyonlarını denemek için. `process.exit` çağırmaz. */
export function parseEnv<T>(schema: ParseableSchema<T>, source: NodeJS.ProcessEnv = process.env): EnvParseResult<T> {
	const result = schema.safeParse(source);
	return result.success ? { success: true, data: result.data } : { success: false, error: result.error };
}

/** Doğrulama hatasını tek satıra çevirir: `'DATABASE_URL' - DATABASE_URL zorunludur; 'PORT' - ...`. Değerler yazılmaz. */
export function formatEnvError(error: { issues: EnvIssue[] }): string {
	const issues = error.issues ?? [];
	if (!issues.length) return "geçersiz değer";
	return issues.map(issue => `'${issue.path.map(String).join(".") || "?"}' - ${issue.message}`).join("; ");
}

export interface LoadEnvOptions {
	/** Varsayılan: `process.env`. */
	source?: NodeJS.ProcessEnv;
	/** `true` (varsayılan): hatayı loglar ve `process.exit(exitCode)`. `false`: `Error` fırlatır (testler, kendi kapanış akışın için). */
	exitOnError?: boolean;
	/** Varsayılan: 1. */
	exitCode?: number;
}

/**
 * Ortamı doğrular ve sonucu döner. Hata varsa `log.error("[env] Ortam değişkeni doğrulanamadı: ...")` yazar ve süreci kapatır
 * (`exitOnError: false` ile fırlatır). Uygulama genelinde `process.env` yerine bunun sonucu kullanılmalı.
 *
 *   export const env = util.env.loadEnv(envSchema);
 */
export function loadEnv<T>(schema: ParseableSchema<T>, options: LoadEnvOptions = {}): T {
	const result = parseEnv(schema, options.source ?? process.env);
	if (result.success) return result.data;

	const message = `Ortam değişkeni doğrulanamadı: ${formatEnvError(result.error)}`;
	if (options.exitOnError === false) throw new Error(message);
	log.error(`[env] ${message}`);
	process.exit(options.exitCode ?? 1);
}
