/**
 * Guarda uma cópia de cada arquivo enviado (fotos, documentos, logo,
 * certificado, QR do Pix…) no Supabase Storage, num bucket privado.
 *
 * O sistema continua lendo e gravando na pasta de dados local; este módulo
 * só espelha. Na Vercel a pasta local é temporária, então um arquivo que
 * não estiver nela é trazido do Storage na primeira vez que for pedido.
 *
 * Fica desligado (não faz nada) quando SUPABASE_URL e a chave secreta
 * não estão configuradas — por exemplo, na instalação em servidor próprio.
 */
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { dirname, relative, sep } from 'node:path';
let cfg = null;
let bucketPronto = null;
export function configurarNuvem(pastaDados) {
    const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const chave = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    cfg = url && chave ? { url, chave, bucket: process.env.SUPABASE_BUCKET || 'erp-arquivos', raiz: pastaDados } : null;
}
export const nuvemAtiva = () => !!cfg;
function caminhoRemoto(local) {
    if (!cfg)
        return null;
    const r = relative(cfg.raiz, local);
    if (!r || r.startsWith('..') || /(^|[\\/])\./.test(r))
        return null; // fora da pasta ou arquivo oculto
    return r.split(sep).map(encodeURIComponent).join('/');
}
const cabecalhos = () => ({ Authorization: `Bearer ${cfg.chave}`, apikey: cfg.chave });
async function garantirBucket() {
    bucketPronto ??= (async () => {
        const r = await fetch(`${cfg.url}/storage/v1/bucket/${cfg.bucket}`, { headers: cabecalhos() });
        if (r.ok)
            return;
        const c = await fetch(`${cfg.url}/storage/v1/bucket`, {
            method: 'POST',
            headers: { ...cabecalhos(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: cfg.bucket, name: cfg.bucket, public: false, file_size_limit: 20 * 1024 * 1024 }),
        });
        if (!c.ok && c.status !== 409 && !/already exists/i.test(await c.text()))
            throw new Error(`Não foi possível criar o bucket ${cfg.bucket} (${c.status}).`);
    })().catch((e) => { bucketPronto = null; throw e; });
    return bucketPronto;
}
/** Envia (ou substitui) o arquivo local no Storage. */
export async function enviarNuvem(local, conteudo) {
    const remoto = caminhoRemoto(local);
    if (!remoto)
        return;
    await garantirBucket();
    const corpo = conteudo ?? (await readFile(local));
    const r = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${remoto}`, {
        method: 'POST',
        headers: { ...cabecalhos(), 'Content-Type': 'application/octet-stream', 'x-upsert': 'true', 'Cache-Control': 'max-age=31536000' },
        body: new Uint8Array(corpo),
        signal: AbortSignal.timeout(30000),
    });
    if (!r.ok)
        throw new Error(`Falha ao guardar o arquivo no armazenamento (${r.status}): ${(await r.text()).slice(0, 200)}`);
}
/** Apaga do Storage (não falha se já não existir). */
export async function apagarNuvem(local) {
    const remoto = caminhoRemoto(local);
    if (!remoto)
        return;
    await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${remoto}`, { method: 'DELETE', headers: cabecalhos(), signal: AbortSignal.timeout(15000) }).catch(() => undefined);
}
/**
 * Garante que o arquivo exista na pasta local, trazendo do Storage se
 * preciso. Retorna false se não existir em lugar nenhum.
 */
export async function trazerDaNuvem(local) {
    if (await stat(local).then((s) => s.isFile(), () => false))
        return true;
    const remoto = caminhoRemoto(local);
    if (!remoto)
        return false;
    try {
        const r = await fetch(`${cfg.url}/storage/v1/object/authenticated/${cfg.bucket}/${remoto}`, { headers: cabecalhos(), signal: AbortSignal.timeout(20000) });
        if (!r.ok)
            return false;
        const buf = Buffer.from(await r.arrayBuffer());
        await mkdir(dirname(local), { recursive: true });
        await writeFile(local, buf, { mode: 0o600 });
        return true;
    }
    catch {
        return false;
    }
}
