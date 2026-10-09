/** Erro de regra de negócio: vira resposta HTTP com a mensagem para o usuário. */
export class ErroNegocio extends Error {
    status;
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}
export function falhar(msg, status = 400) {
    throw new ErroNegocio(msg, status);
}
/** Arredonda em centavos evitando erros de ponto flutuante. */
export const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
export const hoje = () => dataLocal(new Date());
/** Data AAAA-MM-DD no fuso do servidor. */
export function dataLocal(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** Soma meses mantendo o dia (ajusta para o último dia do mês quando preciso). */
export function somarMeses(data, meses) {
    const [a, m, d] = data.split('-').map(Number);
    const alvo = new Date(a, m - 1 + meses, 1);
    const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
    alvo.setDate(Math.min(d, ultimo));
    return dataLocal(alvo);
}
/** Divide um valor em parcelas; a diferença de centavos vai para a primeira. */
export function parcelar(total, n) {
    const base = Math.floor((total / n) * 100) / 100;
    const partes = Array(n).fill(base);
    partes[0] = r2(total - base * (n - 1));
    return partes;
}
export const texto = (v, padrao = '') => (v === undefined || v === null ? padrao : String(v).trim());
export const numero = (v, padrao = 0) => {
    if (v === undefined || v === null || v === '')
        return padrao;
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : padrao;
};
