import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { falhar, texto, numero, r2 } from '../util/comum.js';
import { cnpjValido, limparDoc, soDigitos } from '../util/validacao.js';
import { obterCertificado, limparCacheCertificado, carregarPfx } from '../fiscal/certificado.js';
import { assinarXml } from '../fiscal/assinatura.js';
import { montarNFe, TPAG } from '../fiscal/nfe.js';
import { dataHoraNFe } from '../fiscal/chave.js';
import { ClienteSefaz, montarNfeProc, transporteHttps } from '../fiscal/sefaz.js';
import { transporteSimulado, certificadoSimulado } from '../fiscal/simulador.js';
import { gerarDanfe } from '../fiscal/danfe.js';
import { urlLogo } from '../impressao/base.js';
import { pendenciasEnderecoNFe } from './pessoas.js';
import { auditar } from './auth.js';
import { cifrar, decifrar } from '../util/cripto.js';
import { salvarDataUrl, apagarArquivo } from '../util/arquivos.js';
import { enviarNuvem } from '../util/nuvem.js';
const simulado = () => process.env.NFE_SIMULADO === '1';
/** Luminância relativa (0 = preto, 1 = branco) de uma cor #rrggbb. */
export function luminancia(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function empresa(b) {
    return b.one('SELECT * FROM empresa WHERE id = 1');
}
export function certificadoDaEmpresa(b, cfg) {
    const e = empresa(b);
    if (simulado() && e.nfe_ambiente === 2 && !e.cert_arquivo) {
        return obterCertificado(certificadoSimulado(cfg.pastaCertificados), '');
    }
    if (!e.cert_arquivo)
        falhar('Envie o certificado digital A1 em Configurações > Empresa antes de emitir notas.');
    const c = obterCertificado(e.cert_arquivo, decifrar(e.cert_senha));
    if (c.validoAte < new Date())
        falhar(`O certificado digital venceu em ${c.validoAte.toLocaleDateString('pt-BR')}.`);
    return c;
}
function cliente(b, cfg) {
    const e = empresa(b);
    const transporte = cfg.transporte ?? (simulado() && e.nfe_ambiente === 2 ? transporteSimulado : transporteHttps);
    return new ClienteSefaz(e.uf, e.nfe_ambiente, certificadoDaEmpresa(b, cfg), transporte);
}
/** Perfil fiscal padrão para cada tipo de negociação. */
export function perfilPadrao(neg, veiculo) {
    switch (neg.tipo) {
        case 'venda': return veiculo.origem === 'consignacao' ? 'venda_consignado' : veiculo.condicao === 'novo' ? 'venda_novo' : 'venda_usado';
        case 'compra': return 'compra_usado';
        case 'consignacao': return 'entrada_consignacao';
        case 'devolucao_consignacao': return 'devolucao_consignacao';
        default: return falhar('Tipo de negociação sem NF-e.');
    }
}
const TPCOMB = { etanol: '01', gasolina: '02', diesel: '03', flex: '16' };
function veicProd(v) {
    const d = JSON.parse(v.dados_novo || '{}');
    const req = (k, nome) => {
        const val = texto(d[k]);
        if (!val)
            falhar(`Veículo novo: preencha "${nome}" nos dados técnicos (exigido no grupo de veículo da NF-e).`);
        return val;
    };
    return {
        tpOp: numero(d.tpOp, 1), chassi: v.chassi, cCor: req('cCor', 'código da cor da montadora'), xCor: v.cor || req('xCor', 'cor'),
        pot: soDigitos(v.potencia) || req('pot', 'potência (cv)'), cilin: soDigitos(v.cilindrada) || req('cilin', 'cilindrada (cc)'),
        pesoL: req('pesoL', 'peso líquido'), pesoB: req('pesoB', 'peso bruto'), nSerie: req('nSerie', 'número de série'),
        tpComb: texto(d.tpComb) || TPCOMB[v.combustivel] || req('tpComb', 'código do combustível (DENATRAN)'),
        nMotor: v.motor || req('nMotor', 'número do motor'), CMT: req('CMT', 'capacidade máxima de tração'), dist: req('dist', 'distância entre eixos'),
        anoMod: v.ano_mod, anoFab: v.ano_fab, tpPint: req('tpPint', 'tipo de pintura'), tpVeic: req('tpVeic', 'tipo de veículo (DENATRAN)'),
        espVeic: req('espVeic', 'espécie do veículo'), VIN: d.VIN === 'N' ? 'N' : 'R', condVeic: texto(d.condVeic) || '1',
        cMod: v.cod_marca_modelo || req('cMod', 'código marca/modelo DENATRAN'), cCorDENATRAN: v.cod_cor_denatran || req('cCorDENATRAN', 'código da cor DENATRAN'),
        lota: req('lota', 'lotação'), tpRest: texto(d.tpRest) || '0',
    };
}
const descricaoVeiculo = (v) => (`${v.marca} ${v.modelo}${v.versao ? ' ' + v.versao : ''} ${v.ano_fab}/${v.ano_mod} COR ${v.cor || 'N/I'} CHASSI ${v.chassi}` +
    `${v.placa ? ' PLACA ' + v.placa : ''}${v.renavam ? ' RENAVAM ' + v.renavam : ''}`).toUpperCase();
/** Monta os dados da NF-e de uma negociação. */
export function dadosNFeNegociacao(b, negId, perfilCodigo, extra) {
    const e = empresa(b);
    const neg = b.one('SELECT * FROM negociacoes WHERE id = ?', [negId]) ?? falhar('Negociação não encontrada.', 404);
    if (neg.status !== 'concluida')
        falhar('Negociação cancelada não emite NF-e.');
    const v = b.one('SELECT * FROM veiculos WHERE id = ?', [neg.veiculo_id]);
    const pessoa = b.one('SELECT * FROM pessoas WHERE id = ?', [neg.pessoa_id]);
    const codigo = perfilCodigo || perfilPadrao(neg, v);
    const perfil = b.one('SELECT * FROM perfis_fiscais WHERE codigo = ?', [codigo]) ?? falhar(`Perfil fiscal "${codigo}" não encontrado.`);
    // Conferências do emitente
    const faltaEmp = [];
    if (!cnpjValido(e.cnpj))
        faltaEmp.push('CNPJ');
    if (!e.ie)
        faltaEmp.push('inscrição estadual');
    if (!e.razao_social)
        faltaEmp.push('razão social');
    for (const [c, n] of [['logradouro', 'logradouro'], ['numero', 'número'], ['bairro', 'bairro'], ['cod_municipio', 'código IBGE do município'], ['municipio', 'município'], ['cep', 'CEP']])
        if (!e[c])
            faltaEmp.push(n);
    if (faltaEmp.length)
        falhar(`Complete os dados da empresa: ${faltaEmp.join(', ')}.`);
    const faltaDest = pendenciasEnderecoNFe(pessoa);
    if (faltaDest.length)
        falhar(`Complete o cadastro de ${pessoa.nome}: ${faltaDest.join(', ')}.`);
    const interestadual = pessoa.uf !== e.uf;
    const cfop = interestadual ? perfil.cfop_interestadual : perfil.cfop_interno;
    const valor = neg.tipo === 'devolucao_consignacao'
        ? (b.one("SELECT valor FROM negociacoes WHERE veiculo_id = ? AND tipo = 'consignacao' AND status = 'concluida' ORDER BY id DESC LIMIT 1", [v.id])?.valor ?? 0)
        : neg.valor;
    if (valor <= 0)
        falhar('Valor da operação inválido para a NF-e.');
    const desconto = neg.tipo === 'venda' ? neg.desconto : 0;
    let pagamentos = [];
    if (perfil.tipo_nf === 1 && neg.tipo === 'venda') {
        const pags = b.all('SELECT * FROM negociacao_pagamentos WHERE negociacao_id = ?', [negId]);
        const nomes = { financiamento: 'Financiamento bancario', promissoria: 'Nota promissoria', troca: 'Veiculo usado recebido na troca' };
        pagamentos = pags.map((p) => ({
            tPag: TPAG[p.forma] ?? '99', vPag: p.valor, xPag: nomes[p.forma] ?? p.forma,
            indPag: ['dinheiro', 'pix', 'cartao_debito', 'transferencia', 'troca'].includes(p.forma) || p.parcelas === 1 ? 0 : 1,
        }));
    }
    const kmTexto = neg.km_entrega != null ? ` KM ${neg.km_entrega}` : '';
    const obs = [];
    if ([1, 2, 4].includes(e.crt))
        obs.push('DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL. NAO GERA DIREITO A CREDITO FISCAL DE IPI.');
    obs.push(`VEICULO: ${descricaoVeiculo(v)}${kmTexto}.`);
    if (neg.tipo === 'venda' && v.origem === 'consignacao') {
        const dono = b.one('SELECT nome, cpf_cnpj FROM pessoas WHERE id = ?', [v.proprietario_id]);
        if (dono)
            obs.push(`VEICULO RECEBIDO EM CONSIGNACAO DE ${dono.nome} (${dono.cpf_cnpj}).`);
    }
    if (neg.tipo === 'venda' && neg.valor_troca > 0)
        obs.push(`PARTE DO PAGAMENTO EM VEICULO USADO: R$ ${neg.valor_troca.toFixed(2)}.`);
    if (perfil.info_complementar)
        obs.push(perfil.info_complementar);
    const refNFe = [];
    const chaveRef = limparDoc(extra.chaveReferencia ?? '');
    if (chaveRef) {
        if (chaveRef.length !== 44)
            falhar('Chave de referência deve ter 44 caracteres.');
        refNFe.push(chaveRef);
    }
    else if (neg.tipo === 'devolucao_consignacao') {
        const entrada = b.one(`SELECT f.chave FROM nfes f JOIN negociacoes n ON n.id = f.negociacao_id
       WHERE n.veiculo_id = ? AND n.tipo = 'consignacao' AND f.status = 'autorizada' ORDER BY f.id DESC LIMIT 1`, [v.id]);
        if (!entrada)
            falhar('Informe a chave da NF-e de entrada da consignação para referenciar na devolução.');
        refNFe.push(entrada.chave);
    }
    const ibs = e.ibscbs_ativo
        ? { cst: perfil.cst_ibscbs, cClassTrib: perfil.cclass_trib, aliqIbsUf: perfil.aliq_ibs_uf, aliqIbsMun: perfil.aliq_ibs_mun, aliqCbs: perfil.aliq_cbs }
        : undefined;
    const dados = {
        ambiente: e.nfe_ambiente, serie: e.nfe_serie, numero: extra.numero, cNF: extra.cNF, dhEmi: dataHoraNFe(new Date()),
        tipoNF: perfil.tipo_nf, natOp: perfil.natureza, finNFe: neg.tipo === 'devolucao_consignacao' ? 4 : 1, refNFe,
        emitente: {
            cnpj: limparDoc(e.cnpj), xNome: e.razao_social, xFant: e.nome_fantasia, ie: soDigitos(e.ie), crt: e.crt,
            end: { xLgr: e.logradouro, nro: e.numero, xCpl: e.complemento, xBairro: e.bairro, cMun: e.cod_municipio, xMun: e.municipio, UF: e.uf, CEP: e.cep, fone: e.telefone },
        },
        destinatario: {
            doc: pessoa.cpf_cnpj, xNome: pessoa.nome, indIEDest: pessoa.ind_ie_dest, ie: pessoa.ie, email: pessoa.email,
            end: { xLgr: pessoa.logradouro, nro: pessoa.numero, xCpl: pessoa.complemento, xBairro: pessoa.bairro, cMun: pessoa.cod_municipio, xMun: pessoa.municipio, UF: pessoa.uf, CEP: pessoa.cep, fone: pessoa.telefone },
        },
        itens: [{
                cProd: `V${v.id}`, xProd: descricaoVeiculo(v), ncm: v.ncm, cfop, uCom: 'UN', qCom: 1, vUnCom: valor, vDesc: desconto,
                veicProd: v.condicao === 'novo' && perfil.tipo_nf === 1 ? veicProd(v) : undefined,
                trib: {
                    origem: perfil.origem, cstIcms: perfil.cst_icms, aliqIcms: perfil.aliq_icms, redBcPct: perfil.red_bc_pct,
                    cstPis: perfil.cst_pis, aliqPis: perfil.aliq_pis, cstCofins: perfil.cst_cofins, aliqCofins: perfil.aliq_cofins, ibscbs: ibs,
                },
            }],
        pagamentos,
        infCpl: obs.join(' '),
        respTec: e.resp_tec_cnpj ? { cnpj: limparDoc(e.resp_tec_cnpj), xContato: e.resp_tec_contato, email: e.resp_tec_email, fone: e.resp_tec_fone } : undefined,
    };
    return { dados, perfil, valor: r2(valor - desconto) };
}
/** Gera, assina, grava e transmite a NF-e de uma negociação. */
export async function emitirNFe(b, cfg, u, negId, op = {}) {
    const ativa = b.one("SELECT * FROM nfes WHERE negociacao_id = ? AND status IN ('autorizada','assinada','erro') ORDER BY id DESC LIMIT 1", [negId]);
    if (ativa?.status === 'autorizada')
        falhar(`Esta negociação já tem a NF-e nº ${ativa.numero} autorizada.`);
    if (ativa)
        return transmitir(b, cfg, ativa.id); // reenvia a mesma nota (evita duplicidade)
    const cert = certificadoDaEmpresa(b, cfg);
    const e = empresa(b);
    if (cert.cnpj && cert.cnpj !== '00000000000000' && limparDoc(e.cnpj).slice(0, 8) !== cert.cnpj.slice(0, 8)) {
        falhar(`O certificado é do CNPJ ${cert.cnpj}, diferente do CNPJ da empresa.`);
    }
    // Reaproveita o número de uma nota rejeitada desta negociação (a SEFAZ não guarda rejeitadas)
    const rejeitada = b.one("SELECT * FROM nfes WHERE negociacao_id = ? AND status = 'rejeitada' AND ambiente = ? ORDER BY id DESC LIMIT 1", [negId, e.nfe_ambiente]);
    const nfeId = b.tx(() => {
        const numero = rejeitada ? rejeitada.numero : empresa(b).nfe_proximo_numero;
        const { dados, perfil, valor } = dadosNFeNegociacao(b, negId, op.perfil, { chaveReferencia: op.chaveReferencia, numero });
        const { xml, chave } = montarNFe(dados);
        const assinado = assinarXml(xml, 'infNFe', 'NFe', cert);
        if (rejeitada) {
            b.atualizar('nfes', rejeitada.id, {
                perfil_codigo: perfil.codigo, tipo_nf: perfil.tipo_nf, chave, status: 'assinada', valor, xml: assinado,
                xml_proc: null, protocolo: null, cstat: null, xmotivo: null, emitida_em: new Date().toISOString(), criado_por: u.id,
            });
            return rejeitada.id;
        }
        b.run('UPDATE empresa SET nfe_proximo_numero = nfe_proximo_numero + 1 WHERE id = 1');
        return b.inserir('nfes', {
            negociacao_id: negId, perfil_codigo: perfil.codigo, tipo_nf: perfil.tipo_nf, serie: dados.serie, numero, chave,
            ambiente: dados.ambiente, status: 'assinada', valor, xml: assinado, criado_por: u.id,
        });
    });
    auditar(b, u.id, 'emitir', 'nfes', nfeId);
    return transmitir(b, cfg, nfeId);
}
/** Transmite (ou retransmite) uma NF-e já assinada. Antes de reenviar, consulta a chave. */
export async function transmitir(b, cfg, nfeId) {
    const n = b.one('SELECT * FROM nfes WHERE id = ?', [nfeId]) ?? falhar('NF-e não encontrada.', 404);
    if (n.status === 'autorizada' || n.status === 'cancelada')
        return situacao(b, nfeId);
    const sefaz = cliente(b, cfg);
    try {
        if (n.status === 'erro') {
            // Pode ter sido autorizada e a resposta se perdido: consulta primeiro
            const c = await sefaz.consultar(n.chave);
            if (c.situacao === 'autorizada' && c.protNFe) {
                registrarAutorizacao(b, nfeId, n.xml, c.protNFe, c.protocolo, c.cStat, c.xMotivo);
                return situacao(b, nfeId);
            }
        }
        const r = await sefaz.autorizar(n.xml, String(nfeId).padStart(15, '0'));
        if (r.situacao === 'autorizada') {
            registrarAutorizacao(b, nfeId, n.xml, r.protNFe, r.protocolo, r.cStat, r.xMotivo);
        }
        else if (r.cStat === '204' || r.cStat === '539') {
            // Duplicidade: a nota já foi autorizada antes; recupera o protocolo
            const c = await sefaz.consultar(n.chave);
            if (c.situacao === 'autorizada' && c.protNFe)
                registrarAutorizacao(b, nfeId, n.xml, c.protNFe, c.protocolo, c.cStat, c.xMotivo);
            else
                b.atualizar('nfes', nfeId, { status: 'rejeitada', cstat: r.cStat, xmotivo: r.xMotivo });
        }
        else if (r.situacao === 'processando') {
            b.atualizar('nfes', nfeId, { status: 'erro', cstat: r.cStat, xmotivo: `Em processamento na SEFAZ (recibo ${r.nRec}). Clique em transmitir novamente em alguns minutos.` });
        }
        else {
            b.atualizar('nfes', nfeId, { status: r.situacao === 'denegada' ? 'denegada' : 'rejeitada', cstat: r.cStat, xmotivo: r.xMotivo, protocolo: r.protocolo ?? null });
        }
    }
    catch (e) {
        b.atualizar('nfes', nfeId, { status: 'erro', xmotivo: e.message });
    }
    return situacao(b, nfeId);
}
function registrarAutorizacao(b, id, xml, protNFe, protocolo, cStat, xMotivo) {
    b.atualizar('nfes', id, {
        status: 'autorizada', xml_proc: montarNfeProc(xml, protNFe), protocolo, cstat: cStat, xmotivo: xMotivo,
        autorizada_em: new Date().toISOString(),
    });
}
function situacao(b, id) {
    return b.one('SELECT id, negociacao_id, numero, serie, chave, status, cstat, xmotivo, protocolo, ambiente, valor FROM nfes WHERE id = ?', [id]);
}
export function registrarFiscal(app, b, cfg) {
    // ---- Empresa ----
    app.get('/api/empresa', () => {
        const { cert_senha, ...e } = empresa(b);
        return { ...e, cert_configurado: !!e.cert_arquivo, nfe_simulado: simulado(), tem_senha: !!cert_senha };
    });
    app.put('/api/empresa', (req) => {
        // Atualização parcial: campos que não vieram mantêm o valor atual
        const c = { ...empresa(b), cert_senha: undefined, ...req.corpo };
        const cnpj = limparDoc(c.cnpj);
        if (cnpj && !cnpjValido(cnpj))
            falhar('CNPJ inválido.');
        const amb = numero(c.nfe_ambiente, 2);
        if (amb === 1 && simulado())
            falhar('Desligue o modo simulado (NFE_SIMULADO) antes de usar produção.');
        const atual = empresa(b);
        if (amb === 1 && atual.nfe_ambiente === 2 && !c.confirmar_producao)
            falhar('Para mudar para produção, confirme a alteração (as notas passam a ter valor fiscal).');
        const crt = numero(c.crt, 1);
        if (![1, 2, 3, 4].includes(crt))
            falhar('CRT inválido.');
        const renaveModo = ['simulado', 'homologacao', 'producao'].includes(c.renave_modo) ? c.renave_modo : 'simulado';
        b.atualizar('empresa', 1, {
            cnpj, razao_social: texto(c.razao_social), nome_fantasia: texto(c.nome_fantasia), ie: soDigitos(c.ie), crt,
            logradouro: texto(c.logradouro), numero: texto(c.numero), complemento: texto(c.complemento), bairro: texto(c.bairro),
            cod_municipio: soDigitos(c.cod_municipio), municipio: texto(c.municipio), uf: texto(c.uf, 'CE').toUpperCase(), cep: soDigitos(c.cep),
            telefone: texto(c.telefone), email: texto(c.email), nfe_ambiente: amb === 1 ? 1 : 2,
            nfe_serie: Math.max(0, Math.min(889, Math.round(numero(c.nfe_serie, 1)))),
            nfe_proximo_numero: Math.max(1, Math.round(numero(c.nfe_proximo_numero, atual.nfe_proximo_numero))),
            resp_tec_cnpj: limparDoc(c.resp_tec_cnpj), resp_tec_contato: texto(c.resp_tec_contato), resp_tec_email: texto(c.resp_tec_email), resp_tec_fone: texto(c.resp_tec_fone),
            ibscbs_ativo: !!c.ibscbs_ativo, renave_modo: renaveModo, renave_url_base: texto(c.renave_url_base),
            comissao_padrao_pct: numero(c.comissao_padrao_pct, 1), consignacao_taxa_pct: numero(c.consignacao_taxa_pct, 8),
            whatsapp: soDigitos(c.whatsapp), chave_pix: texto(c.chave_pix), cidade_contrato: texto(c.cidade_contrato),
            clausulas_venda: String(c.clausulas_venda ?? '').trim(), clausulas_compra: String(c.clausulas_compra ?? '').trim(),
            garantia_texto: String(c.garantia_texto ?? '').trim(),
            instagram: texto(c.instagram).replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/[^\w.]/g, '').slice(0, 60),
            horario: texto(c.horario).slice(0, 200), catalogo_titulo: texto(c.catalogo_titulo).slice(0, 120),
            catalogo_sobre: String(c.catalogo_sobre ?? '').trim().slice(0, 2000),
            cor_marca: /^#[0-9a-fA-F]{6}$/.test(texto(c.cor_marca)) ? texto(c.cor_marca) : '',
            cor_faixa: /^#[0-9a-fA-F]{6}$/.test(texto(c.cor_faixa)) ? texto(c.cor_faixa) : '',
            // Fundo precisa ser claro, senão o texto escuro do site fica ilegível
            cor_fundo: /^#[0-9a-fA-F]{6}$/.test(texto(c.cor_fundo)) && luminancia(texto(c.cor_fundo)) >= 0.75 ? texto(c.cor_fundo) : '',
            catalogo_taxa_mes: Math.min(10, Math.max(0, numero(c.catalogo_taxa_mes, 1.99))),
            catalogo_entrada_pct: Math.min(90, Math.max(0, numero(c.catalogo_entrada_pct, 30))),
        });
        auditar(b, req.usuario.id, 'alterar', 'empresa', 1);
        return { ok: true };
    });
    // Upload do certificado A1 (.pfx em base64)
    app.post('/api/empresa/certificado', async (req) => {
        const b64 = String(req.corpo.arquivo ?? '').replace(/^data:[^,]*,/, '');
        const senha = String(req.corpo.senha ?? '');
        if (!b64)
            falhar('Selecione o arquivo do certificado (.pfx ou .p12).');
        mkdirSync(cfg.pastaCertificados, { recursive: true });
        const tmp = join(cfg.pastaCertificados, 'envio.pfx');
        writeFileSync(tmp, Buffer.from(b64, 'base64'), { mode: 0o600 });
        let cert;
        try {
            cert = carregarPfx(tmp, senha);
        }
        catch (e) {
            falhar(e.message);
        }
        if (cert.validoAte < new Date())
            falhar(`Este certificado venceu em ${cert.validoAte.toLocaleDateString('pt-BR')}.`);
        const destino = join(cfg.pastaCertificados, 'empresa.pfx');
        writeFileSync(destino, Buffer.from(b64, 'base64'), { mode: 0o600 });
        chmodSync(destino, 0o600);
        await enviarNuvem(destino);
        limparCacheCertificado();
        b.atualizar('empresa', 1, { cert_arquivo: destino, cert_senha: cifrar(senha), cert_validade: cert.validoAte.toISOString(), cert_titular: cert.titular });
        auditar(b, req.usuario.id, 'certificado', 'empresa', 1, { titular: cert.titular });
        const e = empresa(b);
        const aviso = e.cnpj && cert.cnpj && limparDoc(e.cnpj) !== cert.cnpj ? `Atenção: o certificado é do CNPJ ${cert.cnpj}, diferente do cadastrado.` : '';
        return { titular: cert.titular, cnpj: cert.cnpj, validade: cert.validoAte, aviso };
    });
    // Logo da loja (aparece no sistema, contratos, carnês e documentos impressos)
    app.post('/api/empresa/logo', async (req) => {
        const pasta = join(cfg.pastaArquivos, '');
        const atual = empresa(b).logo;
        const s = await salvarDataUrl(pasta, 'logo', req.corpo.imagem, { maxMb: 4 });
        b.atualizar('empresa', 1, { logo: s.arquivo });
        if (atual)
            await apagarArquivo(pasta, atual);
        auditar(b, req.usuario.id, 'logo', 'empresa', 1);
        return { logo: s.arquivo };
    });
    app.delete('/api/empresa/logo', async (req) => {
        const atual = empresa(b).logo;
        b.atualizar('empresa', 1, { logo: '' });
        if (atual)
            await apagarArquivo(cfg.pastaArquivos, atual);
        auditar(b, req.usuario.id, 'logo_removida', 'empresa', 1);
        return { ok: true };
    });
    // Assinatura do representante da loja, usada em todos os contratos
    app.post('/api/empresa/assinatura', (req) => {
        const a = String(req.corpo.assinatura ?? '');
        if (a && (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(a) || a.length > 600_000))
            falhar('Assinatura inválida.');
        b.atualizar('empresa', 1, { assinatura_loja: a });
        auditar(b, req.usuario.id, a ? 'assinatura' : 'assinatura_removida', 'empresa', 1);
        return { ok: true };
    });
    // ---- Perfis fiscais ----
    app.get('/api/perfis-fiscais', () => b.all('SELECT * FROM perfis_fiscais ORDER BY tipo_nf DESC, descricao'));
    app.put('/api/perfis-fiscais/:id', (req) => {
        const c = req.corpo;
        const cfop = (s) => { const v = soDigitos(String(s ?? '')); if (v.length !== 4)
            falhar('CFOP deve ter 4 dígitos.'); return v; };
        b.atualizar('perfis_fiscais', Number(req.params.id), {
            descricao: texto(c.descricao), natureza: texto(c.natureza), cfop_interno: cfop(c.cfop_interno), cfop_interestadual: cfop(c.cfop_interestadual),
            origem: numero(c.origem), cst_icms: soDigitos(c.cst_icms), aliq_icms: numero(c.aliq_icms), red_bc_pct: numero(c.red_bc_pct),
            cst_pis: soDigitos(c.cst_pis).padStart(2, '0'), aliq_pis: numero(c.aliq_pis), cst_cofins: soDigitos(c.cst_cofins).padStart(2, '0'), aliq_cofins: numero(c.aliq_cofins),
            cst_ibscbs: soDigitos(c.cst_ibscbs).padStart(3, '0'), cclass_trib: soDigitos(c.cclass_trib).padStart(6, '0'),
            aliq_ibs_uf: numero(c.aliq_ibs_uf), aliq_ibs_mun: numero(c.aliq_ibs_mun), aliq_cbs: numero(c.aliq_cbs), info_complementar: texto(c.info_complementar),
        });
        auditar(b, req.usuario.id, 'alterar', 'perfis_fiscais', Number(req.params.id));
        return { ok: true };
    });
    // ---- NF-e ----
    app.get('/api/nfes', (req) => {
        const st = req.query.get('status');
        return b.all(`SELECT f.id, f.numero, f.serie, f.chave, f.status, f.cstat, f.xmotivo, f.valor, f.tipo_nf, f.ambiente, f.emitida_em, f.perfil_codigo, f.negociacao_id,
              p.nome AS pessoa_nome, v.marca, v.modelo, v.placa
       FROM nfes f LEFT JOIN negociacoes n ON n.id = f.negociacao_id LEFT JOIN pessoas p ON p.id = n.pessoa_id LEFT JOIN veiculos v ON v.id = n.veiculo_id
       ${st ? 'WHERE f.status = ?' : ''} ORDER BY f.id DESC LIMIT 500`, st ? [st] : []);
    });
    app.get('/api/nfes/:id', (req) => {
        const n = b.one('SELECT id, negociacao_id, numero, serie, chave, status, cstat, xmotivo, protocolo, valor, tipo_nf, ambiente, emitida_em, autorizada_em, perfil_codigo FROM nfes WHERE id = ?', [Number(req.params.id)])
            ?? falhar('NF-e não encontrada.', 404);
        return { ...n, eventos: b.all('SELECT id, tipo, sequencia, texto, status, protocolo, cstat, xmotivo, criado_em FROM nfe_eventos WHERE nfe_id = ? ORDER BY id', [n.id]) };
    });
    app.get('/api/negociacoes/:id/nfe/previa', (req) => {
        const proximo = empresa(b).nfe_proximo_numero;
        const { dados, perfil } = dadosNFeNegociacao(b, Number(req.params.id), req.query.get('perfil') ?? undefined, { numero: proximo, cNF: '00000000' });
        const { totais } = montarNFe(dados);
        return { perfil: perfil.codigo, natureza: dados.natOp, cfop: dados.itens[0].cfop, destinatario: dados.destinatario.xNome, totais, infCpl: dados.infCpl, ambiente: dados.ambiente, numero: proximo };
    });
    app.post('/api/negociacoes/:id/nfe', (req) => emitirNFe(b, cfg, req.usuario, Number(req.params.id), { perfil: texto(req.corpo.perfil) || undefined, chaveReferencia: texto(req.corpo.chave_referencia) || undefined }));
    app.post('/api/nfes/:id/transmitir', (req) => transmitir(b, cfg, Number(req.params.id)));
    app.post('/api/nfes/:id/consultar', async (req) => {
        const n = b.one('SELECT * FROM nfes WHERE id = ?', [Number(req.params.id)]) ?? falhar('NF-e não encontrada.', 404);
        const c = await cliente(b, cfg).consultar(n.chave);
        if (c.situacao === 'autorizada' && c.protNFe && n.status !== 'autorizada' && n.status !== 'cancelada') {
            registrarAutorizacao(b, n.id, n.xml, c.protNFe, c.protocolo, c.cStat, c.xMotivo);
        }
        if (c.cancelada && n.status !== 'cancelada')
            b.atualizar('nfes', n.id, { status: 'cancelada' });
        return { cStat: c.cStat, xMotivo: c.xMotivo, nfe: situacao(b, n.id) };
    });
    app.post('/api/nfes/:id/cancelar', async (req) => {
        const n = b.one('SELECT * FROM nfes WHERE id = ?', [Number(req.params.id)]) ?? falhar('NF-e não encontrada.', 404);
        if (n.status !== 'autorizada')
            falhar('Só NF-e autorizada pode ser cancelada.');
        const just = texto(req.corpo.justificativa);
        if (just.length < 15)
            falhar('A justificativa precisa ter pelo menos 15 caracteres.');
        const r = await cliente(b, cfg).cancelar({ cnpj: limparDoc(empresa(b).cnpj), chave: n.chave, protocolo: n.protocolo, justificativa: just });
        b.inserir('nfe_eventos', { nfe_id: n.id, tipo: '110111', sequencia: 1, texto: just, status: r.ok ? 'registrado' : 'rejeitado', protocolo: r.protocolo ?? null, cstat: r.cStat, xmotivo: r.xMotivo, xml: r.xml ?? null });
        if (r.ok)
            b.atualizar('nfes', n.id, { status: 'cancelada' });
        auditar(b, req.usuario.id, 'cancelar', 'nfes', n.id, { cStat: r.cStat });
        if (!r.ok)
            falhar(`SEFAZ recusou o cancelamento: ${r.cStat} — ${r.xMotivo}`);
        return { ok: true, protocolo: r.protocolo };
    });
    app.post('/api/nfes/:id/carta-correcao', async (req) => {
        const n = b.one('SELECT * FROM nfes WHERE id = ?', [Number(req.params.id)]) ?? falhar('NF-e não encontrada.', 404);
        if (n.status !== 'autorizada')
            falhar('Carta de correção só para NF-e autorizada.');
        const seq = b.one("SELECT COALESCE(MAX(sequencia),0) AS s FROM nfe_eventos WHERE nfe_id = ? AND tipo = '110110' AND status = 'registrado'", [n.id]).s + 1;
        if (seq > 20)
            falhar('Limite de 20 cartas de correção atingido.');
        const correcao = texto(req.corpo.correcao);
        if (correcao.length < 15)
            falhar('A correção precisa ter pelo menos 15 caracteres.');
        const r = await cliente(b, cfg).cartaCorrecao({ cnpj: limparDoc(empresa(b).cnpj), chave: n.chave, seq, correcao });
        b.inserir('nfe_eventos', { nfe_id: n.id, tipo: '110110', sequencia: seq, texto: correcao, status: r.ok ? 'registrado' : 'rejeitado', protocolo: r.protocolo ?? null, cstat: r.cStat, xmotivo: r.xMotivo, xml: r.xml ?? null });
        if (!r.ok)
            falhar(`SEFAZ recusou a carta de correção: ${r.cStat} — ${r.xMotivo}`);
        return { ok: true, protocolo: r.protocolo, sequencia: seq };
    });
    app.get('/api/nfes/:id/xml', (req) => {
        const n = b.one('SELECT * FROM nfes WHERE id = ?', [Number(req.params.id)]) ?? falhar('NF-e não encontrada.', 404);
        return { corpo: n.xml_proc ?? n.xml, tipo: 'application/xml; charset=utf-8', headers: { 'Content-Disposition': `attachment; filename="${n.chave}-nfe.xml"` } };
    });
    app.get('/api/nfes/:id/eventos/:eid/xml', (req) => {
        const ev = b.one('SELECT e.*, f.chave FROM nfe_eventos e JOIN nfes f ON f.id = e.nfe_id WHERE e.id = ? AND e.nfe_id = ?', [Number(req.params.eid), Number(req.params.id)]);
        if (!ev?.xml)
            falhar('XML do evento não disponível.', 404);
        return { corpo: ev.xml, tipo: 'application/xml; charset=utf-8', headers: { 'Content-Disposition': `attachment; filename="${ev.chave}-evento-${ev.tipo}-${ev.sequencia}.xml"` } };
    });
    app.get('/api/nfes/:id/danfe', (req) => {
        const n = b.one('SELECT * FROM nfes WHERE id = ?', [Number(req.params.id)]) ?? falhar('NF-e não encontrada.', 404);
        const simuladaNota = n.ambiente === 2 && simulado();
        return { corpo: gerarDanfe(n.xml_proc ?? n.xml, { cancelada: n.status === 'cancelada', simulada: simuladaNota, logo: urlLogo(b.one('SELECT logo FROM empresa WHERE id = 1')) }), tipo: 'text/html; charset=utf-8' };
    });
    app.get('/api/sefaz/status', async () => {
        const r = await cliente(b, cfg).status();
        return { cStat: r.cStat, xMotivo: r.xMotivo, ambiente: empresa(b).nfe_ambiente, simulado: simulado() && empresa(b).nfe_ambiente === 2 };
    });
}
