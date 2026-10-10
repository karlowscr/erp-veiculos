import { createCipheriv, createDecipheriv, randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
/**
 * Cifra segredos guardados no banco (ex.: senha do certificado) com
 * AES-256-GCM. A chave vem de APP_SEGREDO ou de um arquivo gerado na
 * primeira execução (data/.segredo). Faça backup desse arquivo junto
 * com o banco: sem ele a senha do certificado precisa ser reenviada.
 */
let chave;
export function iniciarSegredo(arquivo) {
    if (process.env.APP_SEGREDO) {
        chave = createHash('sha256').update(process.env.APP_SEGREDO).digest();
        return;
    }
    if (!existsSync(arquivo)) {
        mkdirSync(dirname(arquivo), { recursive: true });
        writeFileSync(arquivo, randomBytes(32).toString('hex'), { mode: 0o600 });
    }
    chave = Buffer.from(readFileSync(arquivo, 'utf8').trim(), 'hex');
}
/** Selo curto (HMAC) para links públicos que não podem ser adivinhados, ex.: comprovante. */
export function seloLink(texto) {
    return createHmac('sha256', k()).update(texto).digest('base64url').slice(0, 22);
}
export function conferirSelo(texto, selo) {
    const certo = Buffer.from(seloLink(texto));
    const dado = Buffer.from(String(selo));
    return dado.length === certo.length && timingSafeEqual(dado, certo);
}
function k() {
    if (!chave)
        chave = createHash('sha256').update('erp-veiculos-sem-segredo-configurado').digest();
    return chave;
}
export function cifrar(texto) {
    if (!texto)
        return '';
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', k(), iv);
    const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
    return `gcm:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${dados.toString('base64')}`;
}
export function decifrar(valor) {
    if (!valor || !valor.startsWith('gcm:'))
        return valor;
    const [, iv, tag, dados] = valor.split(':');
    const d = createDecipheriv('aes-256-gcm', k(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    try {
        return Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8');
    }
    catch {
        throw new Error('Não foi possível ler a senha do certificado (chave de segredo diferente). Reenvie o certificado.');
    }
}
