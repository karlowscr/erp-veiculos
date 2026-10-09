import { randomInt } from 'node:crypto';
export const CODIGO_UF = {
    RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26,
    AL: 27, SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
};
/**
 * Dígito verificador da chave de acesso: módulo 11, pesos 2 a 9 da direita
 * para a esquerda. Cada caractere vale (ASCII − 48), o que mantém o cálculo
 * tradicional para dígitos e já cobre o CNPJ alfanumérico.
 */
export function dvChave(chave43) {
    let soma = 0;
    let peso = 2;
    for (let i = chave43.length - 1; i >= 0; i--) {
        soma += (chave43.charCodeAt(i) - 48) * peso;
        peso = peso === 9 ? 2 : peso + 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
}
/** Código numérico aleatório de 8 dígitos, diferente do número da nota. */
export function gerarCNF(numero) {
    let c;
    do
        c = String(randomInt(0, 100_000_000)).padStart(8, '0');
    while (Number(c) === numero || /^(\d)\1{7}$/.test(c));
    return c;
}
export function montarChave(p) {
    const cUF = CODIGO_UF[p.uf];
    if (!cUF)
        throw new Error(`UF inválida: ${p.uf}`);
    const aamm = p.dhEmi.slice(2, 4) + p.dhEmi.slice(5, 7);
    const cNF = p.cNF ?? gerarCNF(p.numero);
    const base = String(cUF) + aamm + p.cnpj.padStart(14, '0') + String(p.modelo ?? 55).padStart(2, '0') +
        String(p.serie).padStart(3, '0') + String(p.numero).padStart(9, '0') + String(p.tpEmis ?? 1) + cNF;
    if (base.length !== 43)
        throw new Error('Chave de acesso com tamanho inválido.');
    const cDV = dvChave(base);
    return { chave: base + cDV, cNF, cDV };
}
/** Data/hora no formato da NF-e: AAAA-MM-DDThh:mm:ss-03:00 (fuso informado). */
export function dataHoraNFe(d, fusoMinutos = -180) {
    const local = new Date(d.getTime() + fusoMinutos * 60_000);
    const s = local.toISOString().slice(0, 19);
    const sinal = fusoMinutos < 0 ? '-' : '+';
    const abs = Math.abs(fusoMinutos);
    return `${s}${sinal}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
