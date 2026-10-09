/**
 * Roda numa thread separada e conversa com o PostgreSQL (Supabase).
 * A thread principal fica esperando a resposta (ver postgres.ts), o que
 * mantém a camada de banco síncrona, igual à do SQLite.
 */
import { workerData } from 'node:worker_threads';
import pg from 'pg';
const { url, ssl, esquema, porta, sinal } = workerData;
const aviso = new Int32Array(sinal);
// Números grandes (COUNT, SUM de inteiros) e decimais voltam como number, como no SQLite
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => parseFloat(v));
let cliente = null;
let emTransacao = false;
async function conectar() {
    if (cliente)
        return cliente;
    const c = new pg.Client({
        connectionString: url,
        ssl: ssl ? { rejectUnauthorized: false } : undefined,
        connectionTimeoutMillis: 15000,
        statement_timeout: 25000,
        application_name: 'erp-veiculos',
    });
    c.on('error', () => { if (cliente === c)
        cliente = null; });
    await c.connect();
    if (esquema)
        await c.query(`CREATE SCHEMA IF NOT EXISTS "${esquema}"; SET search_path TO "${esquema}", public`);
    cliente = c;
    return c;
}
const caiuConexao = (e) => !e?.code || /^(08|57P0)/.test(e.code) || /Connection terminated|ECONNRESET|EPIPE|not queryable|ETIMEDOUT/i.test(String(e?.message));
/** Mensagens no mesmo formato do SQLite, que o resto do sistema já entende. */
function traduzirErro(e) {
    if (e?.code === '23505') {
        const col = /Key \((?:lower\()?([\w ,]+)\)?\)=/.exec(e.detail ?? '')?.[1] ?? '';
        return `UNIQUE constraint failed: ${e.table ?? ''}.${col}`;
    }
    if (e?.code === '23503')
        return `FOREIGN KEY constraint failed (${e.constraint ?? ''})`;
    if (e?.code === '23514')
        return `CHECK constraint failed: ${e.constraint ?? ''}`;
    if (e?.code === '23502')
        return `NOT NULL constraint failed: ${e.table ?? ''}.${e.column ?? ''}`;
    return String(e?.message ?? e);
}
async function executar(p) {
    const inicioTx = /^\s*BEGIN/i.test(p.sql);
    for (let tentativa = 0;; tentativa++) {
        try {
            const c = await conectar();
            const r = p.params ? await c.query({ text: p.sql, values: p.params }) : await c.query(p.sql);
            const ultimo = Array.isArray(r) ? r[r.length - 1] : r;
            if (inicioTx)
                emTransacao = true;
            else if (/^\s*(COMMIT|ROLLBACK)\s*;?\s*$/i.test(p.sql))
                emTransacao = false;
            return { id: p.id, linhas: ultimo?.rows ?? [], alteradas: ultimo?.rowCount ?? 0 };
        }
        catch (e) {
            // Conexão derrubada (função "congelada" na Vercel, queda de rede): reconecta e tenta de novo,
            // mas só fora de transação, para não perder metade de uma operação.
            if (tentativa === 0 && caiuConexao(e) && (!emTransacao || inicioTx)) {
                try {
                    await cliente?.end();
                }
                catch { /* já caiu */ }
                cliente = null;
                emTransacao = false;
                continue;
            }
            if (caiuConexao(e)) {
                cliente = null;
                emTransacao = false;
            }
            return { id: p.id, erro: traduzirErro(e), codigo: e?.code };
        }
    }
}
porta.on('message', async (p) => {
    const resposta = await executar(p);
    porta.postMessage(resposta);
    Atomics.store(aviso, 0, 1);
    Atomics.notify(aviso, 0);
});
