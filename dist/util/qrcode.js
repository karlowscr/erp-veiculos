/**
 * Gerador de QR Code (modo byte, correção de erro nível M, versões 1 a 13),
 * usado para o Pix nos carnês. Segue a norma ISO/IEC 18004.
 */
// [dados por bloco do grupo 1, blocos g1, dados por bloco g2, blocos g2, EC por bloco]
const TABELA_M = {
    1: [16, 1, 0, 0, 10], 2: [28, 1, 0, 0, 16], 3: [44, 1, 0, 0, 26], 4: [32, 2, 0, 0, 18],
    5: [43, 2, 0, 0, 24], 6: [27, 4, 0, 0, 16], 7: [31, 4, 0, 0, 18], 8: [38, 2, 39, 2, 22],
    9: [36, 3, 37, 2, 22], 10: [43, 4, 44, 1, 26], 11: [50, 1, 51, 4, 30], 12: [36, 6, 37, 2, 22],
    13: [37, 8, 38, 1, 22],
};
const ALINHAMENTO = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42],
    9: [6, 26, 46], 10: [6, 28, 50], 11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62],
};
const capacidadeDados = (v) => {
    const [d1, b1, d2, b2] = TABELA_M[v];
    return d1 * b1 + d2 * b2;
};
// ---- Aritmética em GF(256) para Reed-Solomon ----
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
    let x = 1;
    for (let i = 0; i < 255; i++) {
        EXP[i] = x;
        LOG[x] = i;
        x <<= 1;
        if (x & 0x100)
            x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++)
        EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
function geradorRS(grau) {
    let g = [1];
    for (let i = 0; i < grau; i++) {
        const novo = new Array(g.length + 1).fill(0);
        for (let j = 0; j < g.length; j++) {
            novo[j] ^= g[j];
            novo[j + 1] ^= mul(g[j], EXP[i]);
        }
        g = novo;
    }
    return g;
}
function restoRS(dados, grau) {
    const g = geradorRS(grau);
    const r = [...dados, ...new Array(grau).fill(0)];
    for (let i = 0; i < dados.length; i++) {
        const c = r[i];
        if (c !== 0)
            for (let j = 0; j < g.length; j++)
                r[i + j] ^= mul(g[j], c);
    }
    return r.slice(dados.length);
}
// ---- Montagem ----
function codewords(texto) {
    const bytes = [...Buffer.from(texto, 'utf8')];
    let versao = 0;
    for (let v = 1; v <= 13; v++) {
        const bitsContagem = v <= 9 ? 8 : 16;
        if (4 + bitsContagem + bytes.length * 8 <= capacidadeDados(v) * 8) {
            versao = v;
            break;
        }
    }
    if (!versao)
        throw new Error('Texto longo demais para o QR Code.');
    const bits = [];
    const por = (valor, n) => { for (let i = n - 1; i >= 0; i--)
        bits.push((valor >>> i) & 1); };
    por(0b0100, 4); // modo byte
    por(bytes.length, versao <= 9 ? 8 : 16);
    for (const b of bytes)
        por(b, 8);
    const cap = capacidadeDados(versao) * 8;
    por(0, Math.min(4, cap - bits.length));
    while (bits.length % 8)
        bits.push(0);
    const dados = [];
    for (let i = 0; i < bits.length; i += 8)
        dados.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let p = 0; dados.length < capacidadeDados(versao); p++)
        dados.push(p % 2 ? 0x11 : 0xec);
    const [d1, b1, d2, b2, ec] = TABELA_M[versao];
    const blocos = [];
    let pos = 0;
    for (let i = 0; i < b1; i++) {
        blocos.push(dados.slice(pos, pos + d1));
        pos += d1;
    }
    for (let i = 0; i < b2; i++) {
        blocos.push(dados.slice(pos, pos + d2));
        pos += d2;
    }
    const ecs = blocos.map((bl) => restoRS(bl, ec));
    const saida = [];
    const maior = Math.max(d1, d2);
    for (let i = 0; i < maior; i++)
        for (const bl of blocos)
            if (i < bl.length)
                saida.push(bl[i]);
    for (let i = 0; i < ec; i++)
        for (const e of ecs)
            saida.push(e[i]);
    return { versao, palavras: saida };
}
function bch(valor, gerador, bitsGerador) {
    let v = valor << (bitsGerador - 1);
    for (let i = 31; i >= bitsGerador - 1; i--)
        if ((v >>> i) & 1)
            v ^= gerador << (i - (bitsGerador - 1));
    return v;
}
/** Matriz do QR Code (true = módulo escuro). */
export function gerarQr(texto) {
    const { versao, palavras } = codewords(texto);
    const n = versao * 4 + 17;
    const m = Array.from({ length: n }, () => Array(n).fill(false));
    const reservado = Array.from({ length: n }, () => Array(n).fill(false));
    const set = (x, y, escuro) => { m[y][x] = escuro; reservado[y][x] = true; };
    // Padrões localizadores e separadores
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
        for (let dy = -4; dy <= 4; dy++)
            for (let dx = -4; dx <= 4; dx++) {
                const x = cx + dx, y = cy + dy;
                if (x < 0 || y < 0 || x >= n || y >= n)
                    continue;
                const d = Math.max(Math.abs(dx), Math.abs(dy));
                set(x, y, d !== 2 && d !== 4);
            }
    }
    // Alinhamento
    const al = ALINHAMENTO[versao];
    for (const ay of al)
        for (const ax of al) {
            if ((ax === 6 && ay === 6) || (ax === 6 && ay === n - 7) || (ax === n - 7 && ay === 6))
                continue;
            for (let dy = -2; dy <= 2; dy++)
                for (let dx = -2; dx <= 2; dx++)
                    set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
    // Temporização
    for (let i = 8; i < n - 8; i++) {
        set(i, 6, i % 2 === 0);
        set(6, i, i % 2 === 0);
    }
    // Reserva áreas de formato e módulo escuro
    for (let i = 0; i < 9; i++) {
        reservado[8][i] = true;
        reservado[i][8] = true;
    }
    for (let i = 0; i < 8; i++) {
        reservado[8][n - 1 - i] = true;
        reservado[n - 1 - i][8] = true;
    }
    set(8, n - 8, true);
    // Informação de versão (v >= 7)
    if (versao >= 7) {
        const info = (versao << 12) | bch(versao, 0x1f25, 13);
        for (let i = 0; i < 18; i++) {
            const bit = ((info >>> i) & 1) === 1;
            const a = n - 11 + (i % 3), b = Math.floor(i / 3);
            set(a, b, bit);
            set(b, a, bit);
        }
    }
    // Dados em zigue-zague
    const bits = [];
    for (const p of palavras)
        for (let i = 7; i >= 0; i--)
            bits.push((p >>> i) & 1);
    let k = 0;
    for (let dir = n - 1; dir >= 1; dir -= 2) {
        if (dir === 6)
            dir = 5;
        for (let vert = 0; vert < n; vert++) {
            for (let j = 0; j < 2; j++) {
                const x = dir - j;
                const subindo = ((dir + 1) & 2) === 0;
                const y = subindo ? n - 1 - vert : vert;
                if (!reservado[y][x]) {
                    m[y][x] = k < bits.length ? bits[k] === 1 : false;
                    k++;
                }
            }
        }
    }
    // Escolhe a máscara com menor penalidade
    const mascaras = [
        (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
        (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
        (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    let melhor = m;
    let menor = Infinity;
    for (let mk = 0; mk < 8; mk++) {
        const t = m.map((linha, y) => linha.map((v, x) => (reservado[y][x] ? v : v !== mascaras[mk](x, y))));
        desenharFormato(t, n, mk);
        const p = penalidade(t, n);
        if (p < menor) {
            menor = p;
            melhor = t;
        }
    }
    return melhor;
}
function desenharFormato(t, n, mascara) {
    const dados = (0b00 << 3) | mascara; // nível M = 00
    const f = ((dados << 10) | bch(dados, 0x537, 11)) ^ 0x5412;
    const bit = (i) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++)
        t[i][8] = bit(i);
    t[7][8] = bit(6);
    t[8][8] = bit(7);
    t[8][7] = bit(8);
    for (let i = 9; i < 15; i++)
        t[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i++)
        t[8][n - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++)
        t[n - 15 + i][8] = bit(i);
    t[n - 8][8] = true;
}
function penalidade(t, n) {
    let p = 0;
    const linhaPen = (get) => {
        let corrida = 1;
        for (let i = 1; i < n; i++) {
            if (get(i) === get(i - 1)) {
                corrida++;
                if (corrida === 5)
                    p += 3;
                else if (corrida > 5)
                    p++;
            }
            else
                corrida = 1;
        }
        const s = Array.from({ length: n }, (_, i) => (get(i) ? '1' : '0')).join('');
        p += 40 * ((s.match(/(?=10111010000)/g)?.length ?? 0) + (s.match(/(?=00001011101)/g)?.length ?? 0));
    };
    for (let y = 0; y < n; y++)
        linhaPen((i) => t[y][i]);
    for (let x = 0; x < n; x++)
        linhaPen((i) => t[i][x]);
    for (let y = 0; y < n - 1; y++)
        for (let x = 0; x < n - 1; x++) {
            const c = t[y][x];
            if (c === t[y][x + 1] && c === t[y + 1][x] && c === t[y + 1][x + 1])
                p += 3;
        }
    const escuros = t.flat().filter(Boolean).length;
    p += Math.floor(Math.abs((escuros * 20) / (n * n) - 10)) * 10;
    return p;
}
/** QR Code como SVG (com zona de silêncio de 4 módulos). */
export function qrSvg(texto, tamanhoPx = 160) {
    const m = gerarQr(texto);
    const n = m.length;
    let caminho = '';
    m.forEach((linha, y) => linha.forEach((v, x) => { if (v)
        caminho += `M${x + 4} ${y + 4}h1v1h-1z`; }));
    const total = n + 8;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${tamanhoPx}" height="${tamanhoPx}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${caminho}" fill="#000"/></svg>`;
}
