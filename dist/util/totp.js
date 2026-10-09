import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
/**
 * Código de verificação em duas etapas (TOTP, RFC 6238) — o mesmo usado pelo
 * Google Authenticator, Microsoft Authenticator, Authy etc.
 */
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
    let bits = 0, valor = 0, out = '';
    for (const byte of buf) {
        valor = (valor << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += ALFABETO[(valor >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0)
        out += ALFABETO[(valor << (5 - bits)) & 31];
    return out;
}
export function deBase32(s) {
    const limpo = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = 0, valor = 0;
    const out = [];
    for (const c of limpo) {
        valor = (valor << 5) | ALFABETO.indexOf(c);
        bits += 5;
        if (bits >= 8) {
            out.push((valor >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}
export const novoSegredoTotp = () => base32(randomBytes(20));
export function codigoTotp(segredo, passo) {
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(passo));
    const h = createHmac('sha1', deBase32(segredo)).update(msg).digest();
    const o = h[h.length - 1] & 15;
    const n = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
    return String(n).padStart(6, '0');
}
export const passoAtual = (agora = Date.now()) => Math.floor(agora / 30_000);
/**
 * Confere o código aceitando 30 s de diferença no relógio. Retorna o passo
 * usado (para impedir que o mesmo código seja reutilizado) ou 0 se inválido.
 */
export function conferirTotp(segredo, codigo, ultimoUsado = 0, agora = Date.now()) {
    const c = String(codigo ?? '').replace(/\D/g, '');
    if (c.length !== 6)
        return 0;
    const atual = passoAtual(agora);
    for (const p of [atual, atual - 1, atual + 1]) {
        if (p <= ultimoUsado)
            continue;
        if (timingSafeEqual(Buffer.from(codigoTotp(segredo, p)), Buffer.from(c)))
            return p;
    }
    return 0;
}
export const uriTotp = (segredo, conta, emissor) => `otpauth://totp/${encodeURIComponent(emissor)}:${encodeURIComponent(conta)}?secret=${segredo}&issuer=${encodeURIComponent(emissor)}&algorithm=SHA1&digits=6&period=30`;
