import { createHash, createSign, createVerify, X509Certificate } from 'node:crypto';
const NS_DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const ALG_C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ALG_ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const ALG_RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const ALG_SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';
const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
/**
 * Assina um documento fiscal (NF-e, evento, inutilização) no padrão
 * XMLDSig exigido pela SEFAZ: RSA-SHA1, digest SHA1, transformações
 * enveloped-signature + C14N, assinatura inserida como último filho do
 * elemento-pai do elemento referenciado.
 *
 * @param xml       documento gerado por `fiscal/xml.ts` (já canônico)
 * @param tagRef    elemento assinado (ex.: 'infNFe', 'infEvento')
 * @param tagPai    elemento que recebe a <Signature> (ex.: 'NFe', 'evento')
 */
export function assinarXml(xml, tagRef, tagPai, cert) {
    const m = new RegExp(`<${tagRef}\\s[^>]*Id="([^"]+)"[^>]*>[\\s\\S]*?</${tagRef}>`).exec(xml);
    if (!m)
        throw new Error(`Elemento ${tagRef} com atributo Id não encontrado.`);
    const id = m[1];
    // Forma canônica do subconjunto: o elemento herda o namespace padrão da NF-e do ancestral
    const canon = herdarNamespace(m[0], tagRef, NS_NFE);
    const digest = createHash('sha1').update(canon, 'utf8').digest('base64');
    const signedInfo = `<SignedInfo xmlns="${NS_DSIG}">` +
        `<CanonicalizationMethod Algorithm="${ALG_C14N}"></CanonicalizationMethod>` +
        `<SignatureMethod Algorithm="${ALG_RSA_SHA1}"></SignatureMethod>` +
        `<Reference URI="#${id}"><Transforms>` +
        `<Transform Algorithm="${ALG_ENVELOPED}"></Transform>` +
        `<Transform Algorithm="${ALG_C14N}"></Transform>` +
        `</Transforms><DigestMethod Algorithm="${ALG_SHA1}"></DigestMethod>` +
        `<DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
    const valor = createSign('RSA-SHA1').update(signedInfo, 'utf8').sign(cert.chavePem, 'base64');
    // Dentro da <Signature>, o SignedInfo herda o xmlns de lá; por isso aqui ele vai sem xmlns
    const signature = `<Signature xmlns="${NS_DSIG}">${signedInfo.replace(` xmlns="${NS_DSIG}"`, '')}` +
        `<SignatureValue>${valor}</SignatureValue>` +
        `<KeyInfo><X509Data><X509Certificate>${cert.certBase64}</X509Certificate></X509Data></KeyInfo></Signature>`;
    const fim = `</${tagPai}>`;
    const pos = xml.lastIndexOf(fim);
    if (pos < 0)
        throw new Error(`Elemento ${tagPai} não encontrado.`);
    return xml.slice(0, pos) + signature + xml.slice(pos);
}
/** Acrescenta o xmlns herdado ao elemento, se ele não declarar o seu próprio. */
function herdarNamespace(el, tag, ns) {
    if (new RegExp(`^<${tag}\\s[^>]*xmlns=`).test(el))
        return el;
    return el.replace(`<${tag}`, `<${tag} xmlns="${ns}"`);
}
/**
 * Confere uma assinatura gerada por `assinarXml` (usado nos testes e para
 * validar XMLs antes de reenviar). Não é um validador XMLDSig genérico.
 */
export function verificarAssinatura(xml, tagRef) {
    const sig = /<Signature xmlns="[^"]+">([\s\S]*?)<\/Signature>/.exec(xml);
    if (!sig)
        return { ok: false, motivo: 'Sem assinatura' };
    const semAssinatura = xml.replace(sig[0], '');
    const m = new RegExp(`<${tagRef}\\s[^>]*>[\\s\\S]*?</${tagRef}>`).exec(semAssinatura);
    if (!m)
        return { ok: false, motivo: `${tagRef} não encontrado` };
    const digest = createHash('sha1').update(herdarNamespace(m[0], tagRef, NS_NFE), 'utf8').digest('base64');
    const digestXml = /<DigestValue>([^<]+)<\/DigestValue>/.exec(sig[1])?.[1];
    if (digest !== digestXml)
        return { ok: false, motivo: 'Digest não confere' };
    const si = /<SignedInfo>[\s\S]*?<\/SignedInfo>/.exec(sig[1])[0].replace('<SignedInfo>', `<SignedInfo xmlns="${NS_DSIG}">`);
    const valor = /<SignatureValue>([^<]+)<\/SignatureValue>/.exec(sig[1])[1];
    const certB64 = /<X509Certificate>([^<]+)<\/X509Certificate>/.exec(sig[1])[1];
    const cert = new X509Certificate(Buffer.from(certB64, 'base64'));
    const ok = createVerify('RSA-SHA1').update(si, 'utf8').verify(cert.publicKey, valor, 'base64');
    return ok ? { ok } : { ok, motivo: 'Valor da assinatura não confere' };
}
