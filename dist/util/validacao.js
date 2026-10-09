/** Validações de documentos brasileiros e de veículos. */
export const soDigitos = (s) => (s ?? '').replace(/\D/g, '');
/** Remove pontuação mantendo letras (CNPJ alfanumérico, chassi, placa). */
export const limparDoc = (s) => (s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
export function cpfValido(cpf) {
    const d = soDigitos(cpf);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d))
        return false;
    const calc = (n) => {
        let s = 0;
        for (let i = 0; i < n; i++)
            s += Number(d[i]) * (n + 1 - i);
        const r = (s * 10) % 11;
        return r === 10 ? 0 : r;
    };
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}
/**
 * CNPJ numérico ou alfanumérico (formato válido a partir de julho/2026).
 * No alfanumérico, cada caractere vale (código ASCII − 48); os dois
 * dígitos verificadores continuam numéricos.
 */
export function cnpjValido(cnpj) {
    const c = limparDoc(cnpj);
    if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c) || /^(\d)\1{13}$/.test(c))
        return false;
    const valor = (ch) => ch.charCodeAt(0) - 48;
    const dv = (base) => {
        const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
        const s = [...base].reduce((acc, ch, i) => acc + valor(ch) * pesos[i], 0);
        const r = s % 11;
        return r < 2 ? 0 : 11 - r;
    };
    const d1 = dv(c.slice(0, 12));
    const d2 = dv(c.slice(0, 12) + d1);
    return d1 === Number(c[12]) && d2 === Number(c[13]);
}
export function docValido(doc) {
    const c = limparDoc(doc);
    return c.length === 11 ? cpfValido(c) : c.length === 14 ? cnpjValido(c) : false;
}
/** RENAVAM: 11 dígitos, DV módulo 11 com pesos 3,2,9,8,7,6,5,4,3,2. */
export function renavamValido(renavam) {
    let d = soDigitos(renavam);
    if (d.length === 9)
        d = d.padStart(11, '0'); // RENAVAM antigo
    if (d.length !== 11)
        return false;
    const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((acc, p, i) => acc + p * Number(d[i]), 0);
    let dv = (s * 10) % 11;
    if (dv === 10)
        dv = 0;
    return dv === Number(d[10]);
}
/** Chassi/VIN: 17 caracteres, sem I, O, Q. */
export function chassiValido(chassi) {
    return /^[A-HJ-NPR-Z0-9]{17}$/.test(limparDoc(chassi));
}
/** Placa antiga (ABC1234) ou Mercosul (ABC1D23). */
export function placaValida(placa) {
    return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(limparDoc(placa));
}
export function emailValido(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
