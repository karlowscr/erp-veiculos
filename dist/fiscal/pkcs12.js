/**
 * Leitor de certificado A1 (.pfx / .p12, PKCS#12) feito só com o Node.
 * Dispensa o OpenSSL instalado no computador.
 *
 * Suporta os formatos usados pelas certificadoras e pelo Windows:
 *  - PBES2 (PBKDF2 + AES ou 3DES), padrão dos arquivos gerados recentemente;
 *  - PBE-SHA1-3DES e PBE-SHA1-RC2 (40 e 128 bits), dos arquivos mais antigos
 *    e dos exportados pelo Windows. O RC2 é implementado aqui porque o Node
 *    não o habilita por padrão.
 * Também confere o MAC do arquivo para avisar quando a senha está errada.
 */
import { createHash, createHmac, createDecipheriv, pbkdf2Sync, createPrivateKey, X509Certificate } from 'node:crypto';
function lerNo(buf, pos) {
    if (pos + 2 > buf.length)
        throw new Error('Arquivo de certificado corrompido.');
    const tag = buf[pos];
    let p = pos + 1;
    let len = buf[p++];
    let indefinido = false;
    if (len === 0x80) {
        indefinido = true;
        len = 0;
    }
    else if (len & 0x80) {
        const n = len & 0x7f;
        if (n > 4)
            throw new Error('Arquivo de certificado corrompido.');
        len = 0;
        for (let i = 0; i < n; i++)
            len = len * 256 + buf[p++];
    }
    const construido = (tag & 0x20) !== 0;
    const filhos = [];
    if (indefinido) {
        // BER: comprimento indefinido termina em 00 00
        let q = p;
        while (!(buf[q] === 0 && buf[q + 1] === 0)) {
            const r = lerNo(buf, q);
            filhos.push(r.no);
            q = r.fim;
        }
        return { no: { tag, construido, conteudo: buf.subarray(p, q), filhos }, fim: q + 2 };
    }
    const fim = p + len;
    if (fim > buf.length)
        throw new Error('Arquivo de certificado corrompido.');
    const conteudo = buf.subarray(p, fim);
    if (construido) {
        let q = p;
        while (q < fim) {
            const r = lerNo(buf, q);
            filhos.push(r.no);
            q = r.fim;
        }
    }
    return { no: { tag, construido, conteudo, filhos }, fim };
}
const der = (buf) => lerNo(buf, 0).no;
function oid(no) {
    if (no.tag !== 0x06)
        throw new Error('OID esperado.');
    const b = no.conteudo;
    const partes = [Math.floor(b[0] / 40), b[0] % 40];
    let v = 0;
    for (let i = 1; i < b.length; i++) {
        v = v * 128 + (b[i] & 0x7f);
        if (!(b[i] & 0x80)) {
            partes.push(v);
            v = 0;
        }
    }
    return partes.join('.');
}
function inteiro(no) {
    let v = 0;
    for (const x of no.conteudo)
        v = v * 256 + x;
    return v;
}
/** Conteúdo de OCTET STRING, juntando os pedaços quando vier fragmentada (BER). */
function octetos(no) {
    if (!no.construido)
        return no.conteudo;
    return Buffer.concat(no.filhos.map(octetos));
}
/** Desembrulha um [0] EXPLICIT. */
const explicito = (no) => no.filhos[0];
// ---------------------------------------------------------------- OIDs
const OID = {
    data: '1.2.840.113549.1.7.1',
    encryptedData: '1.2.840.113549.1.7.6',
    keyBag: '1.2.840.113549.1.12.10.1.1',
    shroudedKeyBag: '1.2.840.113549.1.12.10.1.2',
    certBag: '1.2.840.113549.1.12.10.1.3',
    safeContentsBag: '1.2.840.113549.1.12.10.1.6',
    x509: '1.2.840.113549.1.9.22.1',
    pbes2: '1.2.840.113549.1.5.13',
    pbkdf2: '1.2.840.113549.1.5.12',
};
const PBE_PKCS12 = {
    '1.2.840.113549.1.12.1.3': { cifra: 'des-ede3-cbc', chave: 24, iv: 8 },
    '1.2.840.113549.1.12.1.4': { cifra: 'des-ede-cbc', chave: 16, iv: 8 },
    '1.2.840.113549.1.12.1.5': { cifra: 'rc2', chave: 16, iv: 8, rc2Bits: 128 },
    '1.2.840.113549.1.12.1.6': { cifra: 'rc2', chave: 5, iv: 8, rc2Bits: 40 },
};
const PRF = {
    '1.2.840.113549.2.7': 'sha1', '1.2.840.113549.2.8': 'sha224', '1.2.840.113549.2.9': 'sha256',
    '1.2.840.113549.2.10': 'sha384', '1.2.840.113549.2.11': 'sha512',
};
const CIFRA_PBES2 = {
    '2.16.840.1.101.3.4.1.2': { cifra: 'aes-128-cbc', chave: 16 },
    '2.16.840.1.101.3.4.1.22': { cifra: 'aes-192-cbc', chave: 24 },
    '2.16.840.1.101.3.4.1.42': { cifra: 'aes-256-cbc', chave: 32 },
    '1.2.840.113549.3.7': { cifra: 'des-ede3-cbc', chave: 24 },
};
const DIGEST = {
    '1.3.14.3.2.26': { nome: 'sha1', u: 20, v: 64 },
    '2.16.840.1.101.3.4.2.1': { nome: 'sha256', u: 32, v: 64 },
    '2.16.840.1.101.3.4.2.2': { nome: 'sha384', u: 48, v: 128 },
    '2.16.840.1.101.3.4.2.3': { nome: 'sha512', u: 64, v: 128 },
};
// ---------------------------------------------------------------- Derivação de chave PKCS#12 (RFC 7292, apêndice B)
/** Senha no formato BMPString (UTF-16 big-endian) terminada em zero. */
function senhaBmp(senha) {
    const b = Buffer.alloc((senha.length + 1) * 2);
    for (let i = 0; i < senha.length; i++)
        b.writeUInt16BE(senha.charCodeAt(i), i * 2);
    return b;
}
export function kdfPkcs12(senha, sal, id, iteracoes, n, hash = 'sha1', u = 20, v = 64) {
    const D = Buffer.alloc(v, id);
    const repetir = (x) => {
        if (!x.length)
            return Buffer.alloc(0);
        const tam = v * Math.ceil(x.length / v);
        const out = Buffer.alloc(tam);
        for (let i = 0; i < tam; i++)
            out[i] = x[i % x.length];
        return out;
    };
    const I = Buffer.concat([repetir(sal), repetir(senha)]);
    const saida = [];
    for (let total = 0; total < n; total += u) {
        let A = createHash(hash).update(D).update(I).digest();
        for (let r = 1; r < iteracoes; r++)
            A = createHash(hash).update(A).digest();
        saida.push(A);
        const B = Buffer.alloc(v);
        for (let i = 0; i < v; i++)
            B[i] = A[i % u];
        // I_j = (I_j + B + 1) mod 2^(8v)
        for (let j = 0; j < I.length; j += v) {
            let vaiUm = 1;
            for (let k = v - 1; k >= 0; k--) {
                const soma = I[j + k] + B[k] + vaiUm;
                I[j + k] = soma & 0xff;
                vaiUm = soma >> 8;
            }
        }
    }
    return Buffer.concat(saida).subarray(0, n);
}
// ---------------------------------------------------------------- RC2 (RFC 2268) — só decifragem
const PI = [
    0xd9, 0x78, 0xf9, 0xc4, 0x19, 0xdd, 0xb5, 0xed, 0x28, 0xe9, 0xfd, 0x79, 0x4a, 0xa0, 0xd8, 0x9d,
    0xc6, 0x7e, 0x37, 0x83, 0x2b, 0x76, 0x53, 0x8e, 0x62, 0x4c, 0x64, 0x88, 0x44, 0x8b, 0xfb, 0xa2,
    0x17, 0x9a, 0x59, 0xf5, 0x87, 0xb3, 0x4f, 0x13, 0x61, 0x45, 0x6d, 0x8d, 0x09, 0x81, 0x7d, 0x32,
    0xbd, 0x8f, 0x40, 0xeb, 0x86, 0xb7, 0x7b, 0x0b, 0xf0, 0x95, 0x21, 0x22, 0x5c, 0x6b, 0x4e, 0x82,
    0x54, 0xd6, 0x65, 0x93, 0xce, 0x60, 0xb2, 0x1c, 0x73, 0x56, 0xc0, 0x14, 0xa7, 0x8c, 0xf1, 0xdc,
    0x12, 0x75, 0xca, 0x1f, 0x3b, 0xbe, 0xe4, 0xd1, 0x42, 0x3d, 0xd4, 0x30, 0xa3, 0x3c, 0xb6, 0x26,
    0x6f, 0xbf, 0x0e, 0xda, 0x46, 0x69, 0x07, 0x57, 0x27, 0xf2, 0x1d, 0x9b, 0xbc, 0x94, 0x43, 0x03,
    0xf8, 0x11, 0xc7, 0xf6, 0x90, 0xef, 0x3e, 0xe7, 0x06, 0xc3, 0xd5, 0x2f, 0xc8, 0x66, 0x1e, 0xd7,
    0x08, 0xe8, 0xea, 0xde, 0x80, 0x52, 0xee, 0xf7, 0x84, 0xaa, 0x72, 0xac, 0x35, 0x4d, 0x6a, 0x2a,
    0x96, 0x1a, 0xd2, 0x71, 0x5a, 0x15, 0x49, 0x74, 0x4b, 0x9f, 0xd0, 0x5e, 0x04, 0x18, 0xa4, 0xec,
    0xc2, 0xe0, 0x41, 0x6e, 0x0f, 0x51, 0xcb, 0xcc, 0x24, 0x91, 0xaf, 0x50, 0xa1, 0xf4, 0x70, 0x39,
    0x99, 0x7c, 0x3a, 0x85, 0x23, 0xb8, 0xb4, 0x7a, 0xfc, 0x02, 0x36, 0x5b, 0x25, 0x55, 0x97, 0x31,
    0x2d, 0x5d, 0xfa, 0x98, 0xe3, 0x8a, 0x92, 0xae, 0x05, 0xdf, 0x29, 0x10, 0x67, 0x6c, 0xba, 0xc9,
    0xd3, 0x00, 0xe6, 0xcf, 0xe1, 0x9e, 0xa8, 0x2c, 0x63, 0x16, 0x01, 0x3f, 0x58, 0xe2, 0x89, 0xa9,
    0x0d, 0x38, 0x34, 0x1b, 0xab, 0x33, 0xff, 0xb0, 0xbb, 0x48, 0x0c, 0x5f, 0xb9, 0xb1, 0xcd, 0x2e,
    0xc5, 0xf3, 0xdb, 0x47, 0xe5, 0xa5, 0x9c, 0x77, 0x0a, 0xa6, 0x20, 0x68, 0xfe, 0x7f, 0xc1, 0xad,
];
function rc2Chave(chave, bitsEfetivos) {
    const L = new Uint8Array(128);
    L.set(chave);
    const T = chave.length;
    for (let i = T; i < 128; i++)
        L[i] = PI[(L[i - 1] + L[i - T]) & 0xff];
    const T8 = (bitsEfetivos + 7) >> 3;
    const TM = 0xff >> (8 * T8 - bitsEfetivos);
    L[128 - T8] = PI[L[128 - T8] & TM];
    for (let i = 127 - T8; i >= 0; i--)
        L[i] = PI[L[i + 1] ^ L[i + T8]];
    const K = new Uint16Array(64);
    for (let i = 0; i < 64; i++)
        K[i] = L[2 * i] | (L[2 * i + 1] << 8);
    return K;
}
function rc2DecifrarBloco(K, bloco) {
    const R = [bloco.readUInt16LE(0), bloco.readUInt16LE(2), bloco.readUInt16LE(4), bloco.readUInt16LE(6)];
    const s = [1, 2, 3, 5];
    let j = 63;
    const mixInverso = () => {
        for (let i = 3; i >= 0; i--) {
            R[i] = ((R[i] >>> s[i]) | (R[i] << (16 - s[i]))) & 0xffff;
            R[i] = (R[i] - K[j] - (R[(i + 3) & 3] & R[(i + 2) & 3]) - (~R[(i + 3) & 3] & R[(i + 1) & 3])) & 0xffff;
            j--;
        }
    };
    const mashInverso = () => {
        for (let i = 3; i >= 0; i--)
            R[i] = (R[i] - K[R[(i + 3) & 3] & 63]) & 0xffff;
    };
    for (let r = 0; r < 5; r++)
        mixInverso();
    mashInverso();
    for (let r = 0; r < 6; r++)
        mixInverso();
    mashInverso();
    for (let r = 0; r < 5; r++)
        mixInverso();
    const out = Buffer.alloc(8);
    R.forEach((w, i) => out.writeUInt16LE(w, i * 2));
    return out;
}
export function rc2CbcDecifrar(dados, chave, iv, bitsEfetivos) {
    if (dados.length % 8)
        throw new Error('Dados RC2 com tamanho inválido.');
    const K = rc2Chave(chave, bitsEfetivos);
    const out = Buffer.alloc(dados.length);
    let anterior = iv;
    for (let p = 0; p < dados.length; p += 8) {
        const bloco = dados.subarray(p, p + 8);
        const d = rc2DecifrarBloco(K, bloco);
        for (let i = 0; i < 8; i++)
            out[p + i] = d[i] ^ anterior[i];
        anterior = bloco;
    }
    return removerPreenchimento(out);
}
function removerPreenchimento(b) {
    const n = b[b.length - 1];
    if (n < 1 || n > 16 || n > b.length)
        throw new ErroSenha();
    for (let i = b.length - n; i < b.length; i++)
        if (b[i] !== n)
            throw new ErroSenha();
    return b.subarray(0, b.length - n);
}
// ---------------------------------------------------------------- Decifragem dos conteúdos
export class ErroSenha extends Error {
    constructor() {
        super('Senha do certificado incorreta.');
    }
}
/** Decifra com o algoritmo indicado em AlgorithmIdentifier. */
function decifrar(alg, dados, senha) {
    const id = oid(alg.filhos[0]);
    const params = alg.filhos[1];
    const pkcs12 = PBE_PKCS12[id];
    try {
        if (pkcs12) {
            const sal = octetos(params.filhos[0]);
            const iter = inteiro(params.filhos[1]);
            const pw = senhaBmp(senha);
            const chave = kdfPkcs12(pw, sal, 1, iter, pkcs12.chave);
            const iv = kdfPkcs12(pw, sal, 2, iter, pkcs12.iv);
            if (pkcs12.cifra === 'rc2')
                return rc2CbcDecifrar(dados, chave, iv, pkcs12.rc2Bits);
            const d = createDecipheriv(pkcs12.cifra, chave, iv);
            return Buffer.concat([d.update(dados), d.final()]);
        }
        if (id === OID.pbes2) {
            const kdf = params.filhos[0];
            const esquema = params.filhos[1];
            if (oid(kdf.filhos[0]) !== OID.pbkdf2)
                throw new Error('Derivação de chave não suportada no certificado.');
            const kp = kdf.filhos[1].filhos;
            const sal = octetos(kp[0]);
            const iter = inteiro(kp[1]);
            let prf = 'sha1';
            for (const extra of kp.slice(2))
                if (extra.tag === 0x30)
                    prf = PRF[oid(extra.filhos[0])] ?? '';
            if (!prf)
                throw new Error('Função de derivação (PRF) não suportada no certificado.');
            const c = CIFRA_PBES2[oid(esquema.filhos[0])];
            if (!c)
                throw new Error('Cifra do certificado não suportada.');
            const iv = octetos(esquema.filhos[1]);
            const chave = pbkdf2Sync(Buffer.from(senha, 'utf8'), sal, iter, c.chave, prf);
            const d = createDecipheriv(c.cifra, chave, iv);
            return Buffer.concat([d.update(dados), d.final()]);
        }
    }
    catch (e) {
        if (e instanceof ErroSenha || /bad decrypt/i.test(String(e.message)))
            throw new ErroSenha();
        throw e;
    }
    throw new Error(`Algoritmo de proteção do certificado não suportado (${id}).`);
}
function conferirMac(pfx, conteudoAuth, senha) {
    const macData = pfx.filhos[2];
    if (!macData)
        return;
    const digestInfo = macData.filhos[0];
    const alg = DIGEST[oid(digestInfo.filhos[0].filhos[0])];
    if (!alg)
        return; // MAC com algoritmo novo (ex.: PBMAC1): a senha será conferida na decifragem
    const esperado = octetos(digestInfo.filhos[1]);
    const sal = octetos(macData.filhos[1]);
    const iter = macData.filhos[2] ? inteiro(macData.filhos[2]) : 1;
    const tentar = (pw) => {
        const chave = kdfPkcs12(pw, sal, 3, iter, alg.u, alg.nome, alg.u, alg.v);
        return createHmac(alg.nome, chave).update(conteudoAuth).digest().equals(esperado);
    };
    // Senha vazia pode ter sido gravada com ou sem o terminador
    if (tentar(senhaBmp(senha)))
        return;
    if (senha === '' && tentar(Buffer.alloc(0)))
        return;
    throw new ErroSenha();
}
const pem = (tipo, b) => `-----BEGIN ${tipo}-----\n${b.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${tipo}-----\n`;
export function lerPfx(arquivo, senha) {
    let pfx;
    try {
        pfx = der(arquivo);
    }
    catch {
        throw new Error('O arquivo não parece ser um certificado .pfx/.p12 válido.');
    }
    if (pfx.tag !== 0x30 || pfx.filhos.length < 2 || inteiro(pfx.filhos[0]) !== 3) {
        throw new Error('O arquivo não parece ser um certificado .pfx/.p12 válido.');
    }
    const authSafe = pfx.filhos[1];
    if (oid(authSafe.filhos[0]) !== OID.data)
        throw new Error('Certificado assinado por chave pública não é suportado.');
    const conteudoAuth = octetos(explicito(authSafe.filhos[1]));
    conferirMac(pfx, conteudoAuth, senha);
    const chaves = [];
    const certs = [];
    const lerSafeContents = (buf) => {
        for (const bag of der(buf).filhos) {
            const tipo = oid(bag.filhos[0]);
            const valor = explicito(bag.filhos[1]);
            if (tipo === OID.keyBag)
                chaves.push(Buffer.from(valorDer(valor)));
            else if (tipo === OID.shroudedKeyBag)
                chaves.push(decifrar(valor.filhos[0], octetos(valor.filhos[1]), senha));
            else if (tipo === OID.certBag) {
                if (oid(valor.filhos[0]) === OID.x509)
                    certs.push(octetos(explicito(valor.filhos[1])));
            }
            else if (tipo === OID.safeContentsBag)
                lerSafeContents(valorDer(valor));
        }
    };
    for (const ci of der(conteudoAuth).filhos) {
        const tipo = oid(ci.filhos[0]);
        if (tipo === OID.data) {
            lerSafeContents(octetos(explicito(ci.filhos[1])));
        }
        else if (tipo === OID.encryptedData) {
            const encData = explicito(ci.filhos[1]);
            const eci = encData.filhos[1];
            const alg = eci.filhos[1];
            const conteudo = eci.filhos[2];
            if (!conteudo)
                continue;
            lerSafeContents(decifrar(alg, octetos(conteudo), senha));
        }
    }
    if (!chaves.length)
        throw new Error('O certificado não contém a chave privada. Exporte o .pfx incluindo a chave privada.');
    if (!certs.length)
        throw new Error('O arquivo não contém o certificado.');
    const chave = createPrivateKey({ key: chaves[0], format: 'der', type: 'pkcs8' });
    return {
        chavePem: chave.export({ type: 'pkcs8', format: 'pem' }).toString(),
        certificadosPem: certs.map((c) => new X509Certificate(c).toString()).map((s) => s.endsWith('\n') ? s : s + '\n'),
    };
}
/** Bytes DER completos de um nó (tag + comprimento + conteúdo). */
function valorDer(no) {
    const len = no.conteudo.length;
    let cab;
    if (len < 0x80)
        cab = [no.tag, len];
    else {
        const bytes = [];
        for (let l = len; l > 0; l = Math.floor(l / 256))
            bytes.unshift(l & 0xff);
        cab = [no.tag, 0x80 | bytes.length, ...bytes];
    }
    return Buffer.concat([Buffer.from(cab), no.conteudo]);
}
export { pem as paraPem };
