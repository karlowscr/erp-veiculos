import { t, g, ga, dec, limparTexto } from './xml.js';
import { CODIGO_UF, montarChave } from './chave.js';

/** Texto obrigatório no destinatário em homologação (regra da SEFAZ). */
export const NOME_HOMOLOGACAO = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

export interface Endereco {
  xLgr: string; nro: string; xCpl?: string; xBairro: string; cMun: string; xMun: string; UF: string; CEP: string; fone?: string;
}

export interface Emitente {
  cnpj: string; xNome: string; xFant?: string; ie: string; crt: number; end: Endereco;
}

export interface Destinatario {
  doc: string; xNome: string; indIEDest: number; ie?: string; email?: string; end: Endereco;
}

export interface Tributacao {
  origem: number;
  cstIcms: string;      // CST (CRT 3) ou CSOSN (Simples)
  aliqIcms: number;
  redBcPct: number;
  cstPis: string; aliqPis: number;
  cstCofins: string; aliqCofins: number;
  ibscbs?: { cst: string; cClassTrib: string; aliqIbsUf: number; aliqIbsMun: number; aliqCbs: number };
}

/** Grupo de detalhamento de veículo novo (veicProd), exigido na venda de 0 km. */
export interface VeiculoNovo {
  tpOp: number; chassi: string; cCor: string; xCor: string; pot: string; cilin: string; pesoL: string; pesoB: string;
  nSerie: string; tpComb: string; nMotor: string; CMT: string; dist: string; anoMod: number; anoFab: number;
  tpPint: string; tpVeic: string; espVeic: string; VIN: 'R' | 'N'; condVeic: string; cMod: string;
  cCorDENATRAN: string; lota: string; tpRest: string;
}

export interface Item {
  cProd: string; xProd: string; ncm: string; cfop: string; uCom: string; qCom: number; vUnCom: number;
  vDesc?: number; veicProd?: VeiculoNovo; trib: Tributacao; infAdProd?: string;
}

export interface Pagamento {
  tPag: string; vPag: number; xPag?: string; indPag?: number;
}

export interface DadosNFe {
  ambiente: 1 | 2;
  serie: number;
  numero: number;
  dhEmi: string;
  tipoNF: 0 | 1;
  natOp: string;
  finNFe?: 1 | 2 | 3 | 4;
  refNFe?: string[];
  emitente: Emitente;
  destinatario: Destinatario;
  itens: Item[];
  pagamentos: Pagamento[];
  infCpl?: string;
  respTec?: { cnpj: string; xContato: string; email: string; fone: string };
  cNF?: string;
  verProc?: string;
}

export interface ResultadoMontagem {
  xml: string;
  chave: string;
  totais: { vProd: number; vDesc: number; vNF: number; vICMS: number; vBC: number; vPIS: number; vCOFINS: number; vIBS: number; vCBS: number };
}

const doc = (d: string) => (d.length === 11 ? t('CPF', d) : t('CNPJ', d));

function endereco(nome: string, e: Endereco): string {
  return g(nome,
    t('xLgr', limparTexto(e.xLgr, 60)), t('nro', limparTexto(e.nro, 60)), t('xCpl', limparTexto(e.xCpl, 60)),
    t('xBairro', limparTexto(e.xBairro, 60)), t('cMun', e.cMun), t('xMun', limparTexto(e.xMun, 60)), t('UF', e.UF),
    t('CEP', e.CEP), t('cPais', '1058'), t('xPais', 'Brasil'), t('fone', (e.fone ?? '').replace(/\D/g, '') || undefined),
  );
}

const SIMPLES = (crt: number) => crt === 1 || crt === 2 || crt === 4;

function grupoIcms(crt: number, tr: Tributacao, vItem: number): { xml: string; vBC: number; vICMS: number } {
  const orig = t('orig', tr.origem);
  const c = tr.cstIcms;
  const base = Math.round(vItem * (1 - tr.redBcPct / 100) * 100) / 100;
  const vICMS = Math.round(base * tr.aliqIcms) / 100;
  if (SIMPLES(crt)) {
    if (['102', '103', '300', '400'].includes(c)) return { xml: g('ICMS', g('ICMSSN102', orig, t('CSOSN', c))), vBC: 0, vICMS: 0 };
    if (c === '500') return { xml: g('ICMS', g('ICMSSN500', orig, t('CSOSN', c))), vBC: 0, vICMS: 0 };
    if (c === '900') {
      return {
        xml: g('ICMS', g('ICMSSN900', orig, t('CSOSN', c), t('modBC', 3), t('vBC', dec(base)),
          tr.redBcPct ? t('pRedBC', dec(tr.redBcPct, 4)) : '', t('pICMS', dec(tr.aliqIcms, 4)), t('vICMS', dec(vICMS)))),
        vBC: base, vICMS,
      };
    }
    throw new Error(`CSOSN ${c} não suportado. Use 102, 103, 300, 400, 500 ou 900.`);
  }
  switch (c) {
    case '00':
      return { xml: g('ICMS', g('ICMS00', orig, t('CST', c), t('modBC', 3), t('vBC', dec(base)), t('pICMS', dec(tr.aliqIcms, 4)), t('vICMS', dec(vICMS)))), vBC: base, vICMS };
    case '20':
      return { xml: g('ICMS', g('ICMS20', orig, t('CST', c), t('modBC', 3), t('pRedBC', dec(tr.redBcPct, 4)), t('vBC', dec(base)), t('pICMS', dec(tr.aliqIcms, 4)), t('vICMS', dec(vICMS)))), vBC: base, vICMS };
    case '40': case '41': case '50':
      return { xml: g('ICMS', g('ICMS40', orig, t('CST', c))), vBC: 0, vICMS: 0 };
    case '60':
      return { xml: g('ICMS', g('ICMS60', orig, t('CST', c))), vBC: 0, vICMS: 0 };
    case '90':
      return {
        xml: g('ICMS', g('ICMS90', orig, t('CST', c), t('modBC', 3), t('vBC', dec(base)),
          tr.redBcPct ? t('pRedBC', dec(tr.redBcPct, 4)) : '', t('pICMS', dec(tr.aliqIcms, 4)), t('vICMS', dec(vICMS)))),
        vBC: base, vICMS,
      };
    default:
      throw new Error(`CST de ICMS ${c} não suportado. Use 00, 20, 40, 41, 50, 60 ou 90.`);
  }
}

function grupoPisCofins(nome: 'PIS' | 'COFINS', cst: string, aliq: number, vItem: number): { xml: string; v: number } {
  const v = Math.round(vItem * aliq) / 100;
  const sufixo = nome === 'PIS' ? 'PIS' : 'COFINS';
  if (['01', '02'].includes(cst)) {
    return { xml: g(nome, g(`${nome}Aliq`, t('CST', cst), t('vBC', dec(vItem)), t(`p${sufixo}`, dec(aliq, 4)), t(`v${sufixo}`, dec(v)))), v };
  }
  if (['04', '05', '06', '07', '08', '09'].includes(cst)) return { xml: g(nome, g(`${nome}NT`, t('CST', cst))), v: 0 };
  const base = aliq ? vItem : 0;
  return { xml: g(nome, g(`${nome}Outr`, t('CST', cst), t('vBC', dec(base)), t(`p${sufixo}`, dec(aliq, 4)), t(`v${sufixo}`, dec(v)))), v };
}

/**
 * Grupo IBS/CBS da Reforma Tributária (NT 2025.002). Opcional: só é
 * gerado quando ativado nas configurações. Confira o leiaute vigente da
 * NT antes de ativar em produção.
 */
function grupoIbsCbs(i: NonNullable<Tributacao['ibscbs']>, vItem: number) {
  const vIBSUF = Math.round(vItem * i.aliqIbsUf) / 100;
  const vIBSMun = Math.round(vItem * i.aliqIbsMun) / 100;
  const vCBS = Math.round(vItem * i.aliqCbs) / 100;
  const vIBS = Math.round((vIBSUF + vIBSMun) * 100) / 100;
  const xml = g('IBSCBS', t('CST', i.cst), t('cClassTrib', i.cClassTrib),
    g('gIBSCBS', t('vBC', dec(vItem)),
      g('gIBSUF', t('pIBSUF', dec(i.aliqIbsUf, 4)), t('vIBSUF', dec(vIBSUF))),
      g('gIBSMun', t('pIBSMun', dec(i.aliqIbsMun, 4)), t('vIBSMun', dec(vIBSMun))),
      t('vIBS', dec(vIBS)),
      g('gCBS', t('pCBS', dec(i.aliqCbs, 4)), t('vCBS', dec(vCBS))),
    ));
  return { xml, vBC: vItem, vIBSUF, vIBSMun, vIBS, vCBS };
}

function grupoVeiculo(v: VeiculoNovo): string {
  return g('veicProd',
    t('tpOp', v.tpOp), t('chassi', v.chassi), t('cCor', v.cCor), t('xCor', limparTexto(v.xCor, 40)), t('pot', v.pot),
    t('cilin', v.cilin), t('pesoL', v.pesoL), t('pesoB', v.pesoB), t('nSerie', v.nSerie), t('tpComb', v.tpComb),
    t('nMotor', v.nMotor), t('CMT', v.CMT), t('dist', v.dist), t('anoMod', v.anoMod), t('anoFab', v.anoFab),
    t('tpPint', v.tpPint), t('tpVeic', v.tpVeic), t('espVeic', v.espVeic), t('VIN', v.VIN), t('condVeic', v.condVeic),
    t('cMod', v.cMod), t('cCorDENATRAN', v.cCorDENATRAN), t('lota', v.lota), t('tpRest', v.tpRest),
  );
}

/** Monta o XML da NF-e 4.00 (sem assinatura). */
export function montarNFe(d: DadosNFe): ResultadoMontagem {
  const e = d.emitente, de = d.destinatario;
  const { chave, cNF, cDV } = montarChave({ uf: e.end.UF, dhEmi: d.dhEmi, cnpj: e.cnpj, serie: d.serie, numero: d.numero, cNF: d.cNF });
  const homolog = d.ambiente === 2;
  const idDest = e.end.UF === de.end.UF ? 1 : 2;
  const indFinal = de.indIEDest === 9 ? 1 : 0;

  const ide = g('ide',
    t('cUF', CODIGO_UF[e.end.UF]), t('cNF', cNF), t('natOp', limparTexto(d.natOp, 60)), t('mod', 55), t('serie', d.serie),
    t('nNF', d.numero), t('dhEmi', d.dhEmi), d.tipoNF === 1 ? t('dhSaiEnt', d.dhEmi) : '', t('tpNF', d.tipoNF), t('idDest', idDest),
    t('cMunFG', e.end.cMun), t('tpImp', 1), t('tpEmis', 1), t('cDV', cDV), t('tpAmb', d.ambiente), t('finNFe', d.finNFe ?? 1),
    t('indFinal', indFinal), t('indPres', 1), t('indIntermed', 0), t('procEmi', 0), t('verProc', d.verProc ?? 'ERP Veiculos 1.0'),
    ...(d.refNFe ?? []).map((ch) => g('NFref', t('refNFe', ch))),
  );

  const emit = g('emit', t('CNPJ', e.cnpj), t('xNome', limparTexto(e.xNome, 60)), t('xFant', limparTexto(e.xFant, 60)),
    endereco('enderEmit', e.end), t('IE', e.ie), t('CRT', e.crt));

  const dest = g('dest', doc(de.doc), t('xNome', homolog ? NOME_HOMOLOGACAO : limparTexto(de.xNome, 60)),
    endereco('enderDest', de.end), t('indIEDest', de.indIEDest), de.indIEDest === 1 ? t('IE', de.ie) : '',
    t('email', limparTexto(de.email, 60) || undefined));

  const tot = { vProd: 0, vDesc: 0, vBC: 0, vICMS: 0, vPIS: 0, vCOFINS: 0, vBCIBSCBS: 0, vIBSUF: 0, vIBSMun: 0, vIBS: 0, vCBS: 0 };
  let temIbsCbs = false;
  const dets = d.itens.map((it, idx) => {
    const vProd = Math.round(it.qCom * it.vUnCom * 100) / 100;
    const vDesc = it.vDesc ?? 0;
    const vItem = Math.round((vProd - vDesc) * 100) / 100;
    const icms = grupoIcms(e.crt, it.trib, vItem);
    const pis = grupoPisCofins('PIS', it.trib.cstPis, it.trib.aliqPis, vItem);
    const cofins = grupoPisCofins('COFINS', it.trib.cstCofins, it.trib.aliqCofins, vItem);
    const ibs = it.trib.ibscbs ? grupoIbsCbs(it.trib.ibscbs, vItem) : null;
    tot.vProd += vProd; tot.vDesc += vDesc; tot.vBC += icms.vBC; tot.vICMS += icms.vICMS; tot.vPIS += pis.v; tot.vCOFINS += cofins.v;
    if (ibs) {
      temIbsCbs = true;
      tot.vBCIBSCBS += ibs.vBC; tot.vIBSUF += ibs.vIBSUF; tot.vIBSMun += ibs.vIBSMun; tot.vIBS += ibs.vIBS; tot.vCBS += ibs.vCBS;
    }
    const prod = g('prod',
      t('cProd', it.cProd), t('cEAN', 'SEM GTIN'), t('xProd', limparTexto(it.xProd, 120)),
      t('NCM', it.ncm), t('CFOP', it.cfop), t('uCom', it.uCom), t('qCom', dec(it.qCom, 4)), t('vUnCom', dec(it.vUnCom, 2)),
      t('vProd', dec(vProd)), t('cEANTrib', 'SEM GTIN'), t('uTrib', it.uCom), t('qTrib', dec(it.qCom, 4)), t('vUnTrib', dec(it.vUnCom, 2)),
      vDesc ? t('vDesc', dec(vDesc)) : '', t('indTot', 1), it.veicProd ? grupoVeiculo(it.veicProd) : '',
    );
    const imposto = g('imposto', icms.xml, pis.xml, cofins.xml, ibs?.xml ?? '');
    return ga('det', { nItem: idx + 1 }, prod, imposto, t('infAdProd', limparTexto(it.infAdProd, 500) || undefined));
  });

  const r = (v: number) => Math.round(v * 100) / 100;
  const vNF = r(tot.vProd - tot.vDesc);
  const icmsTot = g('ICMSTot',
    t('vBC', dec(tot.vBC)), t('vICMS', dec(tot.vICMS)), t('vICMSDeson', '0.00'), t('vFCP', '0.00'), t('vBCST', '0.00'),
    t('vST', '0.00'), t('vFCPST', '0.00'), t('vFCPSTRet', '0.00'), t('vProd', dec(tot.vProd)), t('vFrete', '0.00'),
    t('vSeg', '0.00'), t('vDesc', dec(tot.vDesc)), t('vII', '0.00'), t('vIPI', '0.00'), t('vIPIDevol', '0.00'),
    t('vPIS', dec(tot.vPIS)), t('vCOFINS', dec(tot.vCOFINS)), t('vOutro', '0.00'), t('vNF', dec(vNF)),
  );
  const ibsTot = temIbsCbs
    ? g('IBSCBSTot', t('vBCIBSCBS', dec(tot.vBCIBSCBS)),
      g('gIBS',
        g('gIBSUF', t('vDif', '0.00'), t('vDevTrib', '0.00'), t('vIBSUF', dec(tot.vIBSUF))),
        g('gIBSMun', t('vDif', '0.00'), t('vDevTrib', '0.00'), t('vIBSMun', dec(tot.vIBSMun))),
        t('vIBS', dec(tot.vIBS)), t('vCredPres', '0.00'), t('vCredPresCondSus', '0.00')),
      g('gCBS', t('vDif', '0.00'), t('vDevTrib', '0.00'), t('vCBS', dec(tot.vCBS)), t('vCredPres', '0.00'), t('vCredPresCondSus', '0.00')))
    : '';
  const total = g('total', icmsTot, ibsTot);

  const pagamentos = d.pagamentos.length ? d.pagamentos : [{ tPag: '90', vPag: 0 }];
  const pag = g('pag', ...pagamentos.map((p) => g('detPag',
    p.indPag !== undefined ? t('indPag', p.indPag) : '', t('tPag', p.tPag),
    p.tPag === '99' ? t('xPag', limparTexto(p.xPag || 'Outros', 60)) : '', t('vPag', dec(p.vPag)),
    ['03', '04'].includes(p.tPag) ? g('card', t('tpIntegra', 2)) : '')));

  const infAdic = g('infAdic', t('infCpl', limparTexto(d.infCpl, 5000) || undefined));
  const respTec = d.respTec && d.respTec.cnpj
    ? g('infRespTec', t('CNPJ', d.respTec.cnpj), t('xContato', limparTexto(d.respTec.xContato, 60)), t('email', d.respTec.email), t('fone', d.respTec.fone.replace(/\D/g, '')))
    : '';

  const infNFe = ga('infNFe', { Id: `NFe${chave}`, versao: '4.00' },
    ide, emit, dest, ...dets, total, g('transp', t('modFrete', 9)), pag, infAdic, respTec);
  const xml = ga('NFe', { xmlns: 'http://www.portalfiscal.inf.br/nfe' }, infNFe);

  return {
    xml, chave,
    totais: { vProd: r(tot.vProd), vDesc: r(tot.vDesc), vNF, vICMS: r(tot.vICMS), vBC: r(tot.vBC), vPIS: r(tot.vPIS), vCOFINS: r(tot.vCOFINS), vIBS: r(tot.vIBS), vCBS: r(tot.vCBS) },
  };
}

/** Códigos de meio de pagamento (tPag) da NF-e. */
export const TPAG: Record<string, string> = {
  dinheiro: '01', cheque: '02', cartao_credito: '03', cartao_debito: '04', boleto: '15', pix: '17',
  transferencia: '18', financiamento: '99', promissoria: '99', troca: '99',
};
