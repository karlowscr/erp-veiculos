/** Valor monetário por extenso em português (até 999 milhões). */
const UN = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze',
    'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEM = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function ate999(n) {
    if (n === 0)
        return '';
    if (n === 100)
        return 'cem';
    const c = Math.floor(n / 100), r = n % 100;
    const partes = [];
    if (c)
        partes.push(CEM[c]);
    if (r < 20) {
        if (r)
            partes.push(UN[r]);
    }
    else {
        partes.push(DEZ[Math.floor(r / 10)]);
        if (r % 10)
            partes.push(UN[r % 10]);
    }
    return partes.join(' e ');
}
function inteiro(n) {
    if (n === 0)
        return 'zero';
    const mi = Math.floor(n / 1_000_000), mil = Math.floor((n % 1_000_000) / 1000), resto = n % 1000;
    const partes = [];
    if (mi)
        partes.push(mi === 1 ? 'um milhão' : `${ate999(mi)} milhões`);
    if (mil)
        partes.push(mil === 1 ? 'mil' : `${ate999(mil)} mil`);
    if (resto)
        partes.push(ate999(resto));
    // "e" antes do último grupo quando ele é menor que 100 ou centena redonda
    if (partes.length > 1 && resto && (resto < 100 || resto % 100 === 0)) {
        const ultimo = partes.pop();
        return partes.join(' ') + ' e ' + ultimo;
    }
    return partes.join(' ');
}
export function valorPorExtenso(valor) {
    const centavosTotal = Math.round(valor * 100);
    const reais = Math.floor(centavosTotal / 100), cent = centavosTotal % 100;
    const partes = [];
    if (reais) {
        const t = inteiro(reais);
        const de = reais % 1_000_000 === 0 ? ' de' : '';
        partes.push(`${t}${de} ${reais === 1 ? 'real' : 'reais'}`);
    }
    if (cent)
        partes.push(`${inteiro(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`);
    return partes.length ? partes.join(' e ') : 'zero reais';
}
