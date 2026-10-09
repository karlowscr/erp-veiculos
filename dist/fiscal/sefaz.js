import { request } from 'node:https';
import { readFileSync } from 'node:fs';
import { assinarXml } from './assinatura.js';
import { CODIGO_UF, dataHoraNFe } from './chave.js';
import { t, ga, extrair, extrairElemento, desescapar, limparTexto } from './xml.js';
/** SEFAZ Virtual do RS — autoriza NF-e do CE e de vários outros estados. */
const SVRS = {
    1: {
        autorizacao: 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
        retAutorizacao: 'https://nfe.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
        consulta: 'https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
        status: 'https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
        evento: 'https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
    },
    2: {
        autorizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
        retAutorizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
        consulta: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
        status: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
        evento: 'https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
    },
};
/** UFs cuja NF-e (modelo 55) é autorizada pela SVRS. */
const UFS_SVRS = ['AC', 'AL', 'AP', 'CE', 'DF', 'ES', 'PA', 'PB', 'PI', 'RJ', 'RN', 'RO', 'RR', 'SC', 'SE', 'TO'];
const WSDL = {
    autorizacao: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4',
    retAutorizacao: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4',
    consulta: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4',
    status: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4',
    evento: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4',
};
const NS = 'http://www.portalfiscal.inf.br/nfe';
/**
 * Endereços do web service. Para estados fora da SVRS, defina a variável
 * SEFAZ_URLS com um JSON no formato {"1": {"autorizacao": "..."}, "2": {...}}.
 */
export function urlServico(uf, ambiente, s) {
    if (process.env.SEFAZ_URLS) {
        const custom = JSON.parse(process.env.SEFAZ_URLS);
        const u = custom?.[ambiente]?.[s];
        if (u)
            return u;
    }
    if (!UFS_SVRS.includes(uf)) {
        throw new Error(`A UF ${uf} não usa a SVRS. Configure os endereços do autorizador na variável SEFAZ_URLS.`);
    }
    return SVRS[ambiente][s];
}
/** Transporte real: SOAP 1.2 sobre HTTPS com autenticação mútua (certificado A1). */
export const transporteHttps = {
    enviar(url, servico, envelope, cert) {
        const ca = process.env.SEFAZ_CA_FILE ? readFileSync(process.env.SEFAZ_CA_FILE) : undefined;
        return new Promise((resolve, reject) => {
            const req = request(url, {
                method: 'POST',
                key: cert.chavePem,
                cert: cert.certPem,
                ca,
                timeout: 30_000,
                headers: {
                    'Content-Type': `application/soap+xml; charset=utf-8; action="${WSDL[servico]}"`,
                    'Content-Length': Buffer.byteLength(envelope),
                },
            }, (res) => {
                const partes = [];
                res.on('data', (c) => partes.push(c));
                res.on('end', () => {
                    const corpo = Buffer.concat(partes).toString('utf8');
                    if ((res.statusCode ?? 500) >= 400 && !corpo.includes('Envelope')) {
                        reject(new Error(`SEFAZ respondeu HTTP ${res.statusCode}: ${corpo.slice(0, 300)}`));
                    }
                    else
                        resolve(corpo);
                });
            });
            req.on('timeout', () => req.destroy(new Error('Tempo esgotado aguardando a SEFAZ (30s).')));
            req.on('error', (e) => {
                const dica = /issuer certificate|self.signed|UNABLE_TO_VERIFY/i.test(String(e.message))
                    ? ' Instale a cadeia de certificados ICP-Brasil e aponte SEFAZ_CA_FILE (ou NODE_EXTRA_CA_CERTS) para ela.'
                    : '';
                reject(new Error(`Falha de comunicação com a SEFAZ: ${e.message}.${dica}`));
            });
            req.end(envelope);
        });
    },
};
function envelope(servico, corpo) {
    return '<?xml version="1.0" encoding="utf-8"?>' +
        '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<soap12:Body><nfeDadosMsg xmlns="${WSDL[servico]}">${corpo}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
}
function ler(bruto, raiz) {
    const r = extrairElemento(bruto, raiz) ?? bruto;
    const cStat = extrair(r, 'cStat');
    if (!cStat) {
        const falha = extrair(bruto, 'Text') ?? extrair(bruto, 'faultstring') ?? bruto.slice(0, 300);
        throw new Error('Resposta inesperada da SEFAZ: ' + desescapar(falha));
    }
    return { cStat, xMotivo: desescapar(extrair(r, 'xMotivo') ?? ''), bruto };
}
const DENEGACAO = ['110', '205', '301', '302', '303'];
function lerProtocolo(bruto, base) {
    const protNFe = extrairElemento(bruto, 'protNFe');
    if (!protNFe)
        return { ...base, situacao: 'rejeitada' };
    const cStat = extrair(protNFe, 'cStat');
    const xMotivo = desescapar(extrair(protNFe, 'xMotivo') ?? '');
    const situacao = cStat === '100' || cStat === '150' ? 'autorizada' : DENEGACAO.includes(cStat) ? 'denegada' : 'rejeitada';
    return { cStat, xMotivo, bruto, situacao, protNFe, protocolo: extrair(protNFe, 'nProt'), dhRecbto: extrair(protNFe, 'dhRecbto') };
}
export class ClienteSefaz {
    uf;
    ambiente;
    cert;
    transporte;
    constructor(uf, ambiente, cert, transporte = transporteHttps) {
        this.uf = uf;
        this.ambiente = ambiente;
        this.cert = cert;
        this.transporte = transporte;
    }
    chamar(s, corpo) {
        return this.transporte.enviar(urlServico(this.uf, this.ambiente, s), s, envelope(s, corpo), this.cert);
    }
    async status() {
        const corpo = ga('consStatServ', { xmlns: NS, versao: '4.00' }, t('tpAmb', this.ambiente), t('cUF', CODIGO_UF[this.uf]), t('xServ', 'STATUS'));
        return ler(await this.chamar('status', corpo), 'retConsStatServ');
    }
    /** Envia uma NF-e assinada em modo síncrono; se a SEFAZ processar em lote, consulta o recibo. */
    async autorizar(nfeAssinada, idLote) {
        const semDecl = nfeAssinada.replace(/^<\?xml[^>]*\?>/, '');
        const corpo = ga('enviNFe', { xmlns: NS, versao: '4.00' }, t('idLote', idLote), t('indSinc', 1)).replace('</enviNFe>', semDecl + '</enviNFe>');
        const bruto = await this.chamar('autorizacao', corpo);
        const base = ler(bruto, 'retEnviNFe');
        if (base.cStat === '104')
            return lerProtocolo(bruto, base);
        if (base.cStat === '103') {
            const nRec = extrair(bruto, 'nRec');
            for (let i = 0; i < 4; i++) {
                await new Promise((r) => setTimeout(r, 2000 + i * 1500));
                const ret = await this.consultarRecibo(nRec);
                if (ret.situacao !== 'processando')
                    return ret;
            }
            return { ...base, situacao: 'processando', nRec };
        }
        return { ...base, situacao: 'rejeitada' };
    }
    async consultarRecibo(nRec) {
        const corpo = ga('consReciNFe', { xmlns: NS, versao: '4.00' }, t('tpAmb', this.ambiente), t('nRec', nRec));
        const bruto = await this.chamar('retAutorizacao', corpo);
        const base = ler(bruto, 'retConsReciNFe');
        if (base.cStat === '105')
            return { ...base, situacao: 'processando', nRec };
        return lerProtocolo(bruto, base);
    }
    /** Consulta a situação atual da NF-e pela chave (recupera protocolo e cancelamento). */
    async consultar(chave) {
        const corpo = ga('consSitNFe', { xmlns: NS, versao: '4.00' }, t('tpAmb', this.ambiente), t('xServ', 'CONSULTAR'), t('chNFe', chave));
        const bruto = await this.chamar('consulta', corpo);
        const base = ler(bruto, 'retConsSitNFe');
        const prot = lerProtocolo(bruto, base);
        const cancelada = base.cStat === '101' || base.cStat === '151' || /<tpEvento>110111<\/tpEvento>[\s\S]*?<cStat>(135|155)<\/cStat>/.test(bruto);
        return { ...prot, cStat: base.cStat, xMotivo: base.xMotivo, cancelada };
    }
    async cancelar(p) {
        const just = limparTexto(p.justificativa, 255);
        if (just.length < 15)
            throw new Error('A justificativa do cancelamento precisa ter pelo menos 15 caracteres.');
        return this.evento({ ...p, tpEvento: '110111', seq: 1, det: [t('descEvento', 'Cancelamento'), t('nProt', p.protocolo), t('xJust', just)] });
    }
    async cartaCorrecao(p) {
        const txt = limparTexto(p.correcao, 1000);
        if (txt.length < 15)
            throw new Error('A correção precisa ter pelo menos 15 caracteres.');
        return this.evento({
            ...p, tpEvento: '110110', det: [t('descEvento', 'Carta de Correcao'), t('xCorrecao', txt), t('xCondUso', CONDICAO_USO_CCE)],
        });
    }
    async evento(p) {
        const id = `ID${p.tpEvento}${p.chave}${String(p.seq).padStart(2, '0')}`;
        const docTag = p.cnpj.length === 11 ? 'CPF' : 'CNPJ';
        const evento = ga('evento', { xmlns: NS, versao: '1.00' }, ga('infEvento', { Id: id }, t('cOrgao', CODIGO_UF[this.uf]), t('tpAmb', this.ambiente), t(docTag, p.cnpj), t('chNFe', p.chave), t('dhEvento', dataHoraNFe(new Date())), t('tpEvento', p.tpEvento), t('nSeqEvento', p.seq), t('verEvento', '1.00'), ga('detEvento', { versao: '1.00' }, ...p.det)));
        const assinado = assinarXml(evento, 'infEvento', 'evento', this.cert);
        const corpo = ga('envEvento', { xmlns: NS, versao: '1.00' }, t('idLote', Date.now() % 1e15)).replace('</envEvento>', assinado + '</envEvento>');
        const bruto = await this.chamar('evento', corpo);
        const base = ler(bruto, 'retEnvEvento');
        const ret = extrairElemento(bruto, 'retEvento');
        const cStat = ret ? extrair(ret, 'cStat') : base.cStat;
        const xMotivo = ret ? desescapar(extrair(ret, 'xMotivo') ?? '') : base.xMotivo;
        const ok = ['135', '136', '155'].includes(cStat);
        // procEventoNFe: evento assinado + retorno, para guardar
        const proc = ok && ret ? ga('procEventoNFe', { xmlns: NS, versao: '1.00' }, assinado, ret) : undefined;
        return { ok, cStat, xMotivo, protocolo: ret ? extrair(ret, 'nProt') : undefined, xml: proc, bruto };
    }
}
/** Monta o nfeProc (NF-e assinada + protocolo), que é o XML a guardar e enviar ao cliente. */
export function montarNfeProc(nfeAssinada, protNFe) {
    const nfe = nfeAssinada.replace(/^<\?xml[^>]*\?>/, '');
    return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="${NS}" versao="4.00">${nfe}${protNFe}</nfeProc>`;
}
export const CONDICAO_USO_CCE = 'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.';
