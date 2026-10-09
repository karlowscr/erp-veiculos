/**
 * Acesso síncrono ao PostgreSQL (Supabase). As consultas rodam numa thread
 * auxiliar (pg-trabalhador.ts); esta thread espera a resposta com
 * Atomics.wait. Assim o sistema inteiro continua usando a mesma interface
 * do SQLite (one/all/run/tx), sem reescrever cada módulo.
 */
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import { randomBytes } from 'node:crypto';
const ESPERA_MAX_MS = 30_000;
export class MotorPg {
    worker;
    porta;
    aviso;
    proximo = 1;
    esquema;
    constructor(urlOriginal) {
        const u = new URL(urlOriginal);
        // Parâmetros próprios do sistema / de outras bibliotecas que o driver não entende
        let esquema = u.searchParams.get('esquema') ?? undefined;
        if (u.searchParams.get('isolar') === '1')
            esquema = 'teste_' + randomBytes(6).toString('hex');
        for (const p of ['esquema', 'isolar', 'supa', 'pgbouncer', 'sslmode', 'sslrootcert'])
            u.searchParams.delete(p);
        const local = /^(localhost|127\.|\[::1\]|$)/.test(u.hostname) || u.searchParams.has('host');
        this.esquema = esquema;
        const sinal = new SharedArrayBuffer(4);
        this.aviso = new Int32Array(sinal);
        const { port1, port2 } = new MessageChannel();
        this.porta = port1;
        this.worker = new Worker(new URL('./pg-trabalhador.js', import.meta.url), {
            workerData: { url: u.toString(), ssl: !local, esquema, porta: port2, sinal },
            transferList: [port2],
        });
        this.worker.unref();
        this.porta.unref();
    }
    /** Executa e espera a resposta (bloqueia esta thread até o banco responder). */
    consultar(sql, params) {
        const id = this.proximo++;
        Atomics.store(this.aviso, 0, 0);
        this.porta.postMessage({ id, sql, params });
        const limite = Date.now() + ESPERA_MAX_MS;
        for (;;) {
            const resta = limite - Date.now();
            if (resta <= 0)
                throw new Error('O banco de dados não respondeu a tempo. Tente de novo.');
            Atomics.wait(this.aviso, 0, 0, resta);
            Atomics.store(this.aviso, 0, 0);
            let msg;
            while ((msg = receiveMessageOnPort(this.porta))) {
                const r = msg.message;
                if (r.id !== id)
                    continue; // resposta atrasada de um pedido que já desistimos
                if (r.erro !== undefined) {
                    const e = new Error(r.erro);
                    e.code = r.codigo;
                    throw e;
                }
                return { linhas: r.linhas ?? [], alteradas: r.alteradas ?? 0 };
            }
        }
    }
    fechar() {
        void this.worker.terminate();
    }
}
/* ------------------------------------------------------------------ */
/* Tradução do SQL escrito para o SQLite para o dialeto do PostgreSQL */
/* ------------------------------------------------------------------ */
const cache = new Map();
/**
 * Converte `?` em `$1, $2…` e as poucas funções próprias do SQLite usadas no
 * sistema (datetime, date, julianday, LIKE sem diferenciar maiúsculas,
 * COLLATE NOCASE). Textos entre aspas não são tocados.
 */
export function traduzirSql(sql) {
    const pronto = cache.get(sql);
    if (pronto !== undefined)
        return pronto;
    let out = '';
    let n = 0;
    let i = 0;
    let trecho = '';
    const fecharTrecho = () => {
        out += trecho
            .replace(/\bBEGIN\s+IMMEDIATE\b/gi, 'BEGIN')
            .replace(/(?<![\w.])datetime\s*\(/gi, 'sl_datetime(')
            .replace(/(?<![\w.])date\s*\(/gi, 'sl_date(')
            .replace(/(?<![\w.])julianday\s*\(/gi, 'sl_julianday(')
            .replace(/\s+COLLATE\s+NOCASE\b/gi, '')
            .replace(/\bNOT\s+LIKE\b/gi, 'NOT ILIKE')
            .replace(/(?<!NOT I)(?<!\bI)\bLIKE\b/gi, 'ILIKE')
            .replace(/\?(\s+IS\s+(?:NOT\s+)?NULL)/gi, '?::text$1')
            .replace(/\?/g, () => `$${++n}`);
        trecho = '';
    };
    while (i < sql.length) {
        const c = sql[i];
        if (c === "'" || c === '"') {
            fecharTrecho();
            let j = i + 1;
            while (j < sql.length) {
                if (sql[j] === c) {
                    if (sql[j + 1] === c) {
                        j += 2;
                        continue;
                    }
                    break;
                }
                j++;
            }
            out += sql.slice(i, j + 1);
            i = j + 1;
        }
        else if (c === '-' && sql[i + 1] === '-') {
            const j = sql.indexOf('\n', i);
            fecharTrecho();
            i = j < 0 ? sql.length : j;
        }
        else {
            trecho += c;
            i++;
        }
    }
    fecharTrecho();
    if (cache.size < 5000)
        cache.set(sql, out);
    return out;
}
