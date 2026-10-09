import { extrair, extrairElemento, desescapar } from './xml.js';
/** Padrões de barras do Code 128 (largura dos módulos: barra, espaço, barra...). */
const C128 = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232',
];
const STOP = '2331112';
export const PADROES_CODE128 = C128; // exportado para teste
/** Código de barras Code 128 subconjunto C (só dígitos, número par) em SVG. */
export function code128C(digitos, altura = 50) {
    if (!/^(\d\d)+$/.test(digitos))
        throw new Error('Code 128C exige quantidade par de dígitos.');
    const valores = [105];
    for (let i = 0; i < digitos.length; i += 2)
        valores.push(Number(digitos.slice(i, i + 2)));
    const soma = valores.reduce((s, v, i) => s + v * (i === 0 ? 1 : i), 0);
    valores.push(soma % 103);
    const padrao = valores.map((v) => C128[v]).join('') + STOP;
    let x = 10; // zona de silêncio
    let rects = '';
    [...padrao].forEach((w, i) => {
        const l = Number(w);
        if (i % 2 === 0)
            rects += `<rect x="${x}" y="0" width="${l}" height="${altura}"/>`;
        x += l;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + 10} ${altura}" preserveAspectRatio="none" style="width:100%;height:${altura}px">${rects}</svg>`;
}
const esc = (s) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const txt = (xml, tag) => esc(desescapar(extrair(xml, tag) ?? ''));
const moeda = (v) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const docFmt = (d) => d.length === 14
    ? d.replace(/^(\w{2})(\w{3})(\w{3})(\w{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
const dataFmt = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
const horaFmt = (iso) => (iso ? iso.slice(11, 19) : '');
const cepFmt = (c) => c.replace(/^(\d{5})(\d{3})$/, '$1-$2');
/** DANFE em HTML pronto para imprimir em A4 (ou salvar em PDF pelo navegador). */
export function gerarDanfe(xmlNFe, op = {}) {
    const inf = extrairElemento(xmlNFe, 'infNFe');
    const chave = /Id="NFe(\w{44})"/.exec(inf)[1];
    const ide = extrairElemento(inf, 'ide');
    const emit = extrairElemento(inf, 'emit');
    const ee = extrairElemento(emit, 'enderEmit');
    const dest = extrairElemento(inf, 'dest');
    const ed = extrairElemento(dest, 'enderDest') ?? '';
    const tot = extrairElemento(inf, 'ICMSTot');
    const prot = extrairElemento(xmlNFe, 'infProt');
    const homolog = extrair(ide, 'tpAmb') === '2';
    const dets = [...inf.matchAll(/<det nItem="\d+">([\s\S]*?)<\/det>/g)].map((m) => m[1]);
    const chaveFmt = chave.replace(/(.{4})/g, '$1 ').trim();
    const destDoc = extrair(dest, 'CNPJ') ?? extrair(dest, 'CPF') ?? '';
    const marca = op.cancelada ? 'CANCELADA' : op.simulada ? 'SIMULAÇÃO — SEM VALOR FISCAL' : homolog ? 'SEM VALOR FISCAL' : '';
    const linhas = dets.map((d) => {
        const p = extrairElemento(d, 'prod');
        const icms = extrairElemento(d, 'ICMS') ?? '';
        const cst = (extrair(icms, 'orig') ?? '0') + (extrair(icms, 'CST') ?? extrair(icms, 'CSOSN') ?? '');
        return `<tr><td>${txt(p, 'cProd')}</td><td class="desc">${txt(p, 'xProd')}${d.includes('<infAdProd>') ? '<br><small>' + txt(d, 'infAdProd') + '</small>' : ''}</td>
      <td>${txt(p, 'NCM')}</td><td>${cst}</td><td>${txt(p, 'CFOP')}</td><td>${txt(p, 'uCom')}</td>
      <td class="n">${Number(extrair(p, 'qCom')).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</td>
      <td class="n">${moeda(extrair(p, 'vUnCom'))}</td><td class="n">${moeda(extrair(p, 'vProd'))}</td>
      <td class="n">${moeda(extrair(icms, 'vBC'))}</td><td class="n">${moeda(extrair(icms, 'vICMS'))}</td><td class="n">${extrair(icms, 'pICMS') ? Number(extrair(icms, 'pICMS')).toFixed(2) : '0,00'}</td></tr>`;
    }).join('');
    const campo = (rotulo, valor, cls = '') => `<div class="c ${cls}"><span>${rotulo}</span><b>${valor || '&nbsp;'}</b></div>`;
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>DANFE ${txt(ide, 'nNF')}</title>
<style>
@page{size:A4;margin:8mm}*{box-sizing:border-box}body{font:9px Arial,Helvetica,sans-serif;color:#000;margin:0;padding:8px;max-width:800px;margin:auto}
.b{border:1px solid #000}.row{display:flex}.row>*{flex:1}.c{border:1px solid #000;padding:2px 4px;min-height:24px;margin:-1px 0 0 -1px}
.c span{display:block;font-size:6.5px;text-transform:uppercase}.c b{font-size:9px;font-weight:600}h3{font-size:8px;margin:6px 0 1px;text-transform:uppercase}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:2px;font-size:7.5px;vertical-align:top}th{font-size:6.5px}td.n{text-align:right}td.desc{width:34%}
.topo{display:grid;grid-template-columns:2.2fr 1fr 2.6fr;margin-bottom:4px}.topo>div{border:1px solid #000;padding:4px;margin-left:-1px}
.danfe{text-align:center}.danfe h1{font-size:15px;margin:0}.tp{display:inline-block;border:1px solid #000;padding:2px 8px;font-size:14px;font-weight:bold;margin:3px}
.marca{position:fixed;top:40%;left:0;right:0;text-align:center;font-size:56px;color:rgba(200,0,0,.18);transform:rotate(-25deg);font-weight:bold;pointer-events:none}
.canhoto{display:grid;grid-template-columns:4fr 1fr;margin-bottom:6px;border-bottom:1px dashed #000;padding-bottom:6px}
@media print{.noprint{display:none}}
.emit{display:flex;gap:6px;align-items:center}.emit img{max-width:90px;max-height:60px;object-fit:contain}
.noprint{text-align:right;margin-bottom:8px}.noprint button{font-size:13px;padding:6px 14px}
</style></head><body>
<div class="noprint"><button data-acao="imprimir">Imprimir / Salvar PDF</button></div><script src="/s/impressao.js"></script>
${marca ? `<div class="marca">${marca}</div>` : ''}
<div class="canhoto"><div class="c">RECEBEMOS DE ${txt(emit, 'xNome')} OS PRODUTOS/SERVIÇOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO<div class="row" style="margin-top:12px"><div>DATA DE RECEBIMENTO</div><div>IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR</div></div></div>
<div class="c" style="text-align:center"><b style="font-size:12px">NF-e</b><br>Nº ${txt(ide, 'nNF').padStart(9, '0').replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3')}<br>SÉRIE ${txt(ide, 'serie')}</div></div>
<div class="topo">
 <div class="emit">${op.logo ? `<img src="${esc(op.logo)}" alt="">` : ''}<div><b style="font-size:11px">${txt(emit, 'xNome')}</b><br>${txt(ee, 'xLgr')}, ${txt(ee, 'nro')} ${txt(ee, 'xCpl')}<br>${txt(ee, 'xBairro')} — ${txt(ee, 'xMun')}/${txt(ee, 'UF')}<br>CEP ${cepFmt(txt(ee, 'CEP'))} ${extrair(ee, 'fone') ? '— Fone ' + txt(ee, 'fone') : ''}</div></div>
 <div class="danfe"><h1>DANFE</h1>Documento Auxiliar da Nota Fiscal Eletrônica<br>0 - ENTRADA<br>1 - SAÍDA <span class="tp">${txt(ide, 'tpNF')}</span><br><b>Nº ${txt(ide, 'nNF').padStart(9, '0').replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3')}<br>SÉRIE ${txt(ide, 'serie')}</b></div>
 <div>${code128C(chave, 42)}<div class="c" style="margin-top:3px"><span>Chave de acesso</span><b>${chaveFmt}</b></div>
 <div style="text-align:center;padding-top:3px">Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora</div></div>
</div>
<div class="row">${campo('Natureza da operação', txt(ide, 'natOp'), '')}${campo('Protocolo de autorização de uso', prot ? `${txt(prot, 'nProt')} — ${dataFmt(extrair(prot, 'dhRecbto'))} ${horaFmt(extrair(prot, 'dhRecbto'))}` : 'NÃO AUTORIZADA')}</div>
<div class="row">${campo('Inscrição estadual', txt(emit, 'IE'))}${campo('Insc. est. do subst. trib.', '')}${campo('CNPJ', docFmt(extrair(emit, 'CNPJ') ?? ''))}</div>
<h3>Destinatário / Remetente</h3>
<div class="row" style="flex:none">${campo('Nome / Razão social', txt(dest, 'xNome'), '')}${campo('CNPJ / CPF', docFmt(destDoc))}${campo('Data da emissão', dataFmt(extrair(ide, 'dhEmi')))}</div>
<div class="row">${campo('Endereço', `${txt(ed, 'xLgr')}, ${txt(ed, 'nro')} ${txt(ed, 'xCpl')}`)}${campo('Bairro / Distrito', txt(ed, 'xBairro'))}${campo('CEP', cepFmt(txt(ed, 'CEP')))}${campo('Data da saída/entrada', dataFmt(extrair(ide, 'dhSaiEnt') ?? extrair(ide, 'dhEmi')))}</div>
<div class="row">${campo('Município', txt(ed, 'xMun'))}${campo('UF', txt(ed, 'UF'))}${campo('Fone / Fax', txt(ed, 'fone'))}${campo('Inscrição estadual', txt(dest, 'IE'))}${campo('Hora da saída/entrada', horaFmt(extrair(ide, 'dhSaiEnt') ?? extrair(ide, 'dhEmi')))}</div>
<h3>Cálculo do imposto</h3>
<div class="row">${campo('Base de cálc. do ICMS', moeda(extrair(tot, 'vBC')))}${campo('Valor do ICMS', moeda(extrair(tot, 'vICMS')))}${campo('Base de cálc. ICMS ST', moeda(extrair(tot, 'vBCST')))}${campo('Valor do ICMS ST', moeda(extrair(tot, 'vST')))}${campo('Valor total dos produtos', moeda(extrair(tot, 'vProd')))}</div>
<div class="row">${campo('Valor do frete', moeda(extrair(tot, 'vFrete')))}${campo('Valor do seguro', moeda(extrair(tot, 'vSeg')))}${campo('Desconto', moeda(extrair(tot, 'vDesc')))}${campo('Outras despesas', moeda(extrair(tot, 'vOutro')))}${campo('Valor do IPI', moeda(extrair(tot, 'vIPI')))}${campo('Valor total da nota', moeda(extrair(tot, 'vNF')))}</div>
<h3>Transportador / Volumes transportados</h3>
<div class="row">${campo('Frete por conta', '9 - Sem ocorrência de transporte')}${campo('Razão social', '')}${campo('Placa do veículo', '')}</div>
<h3>Dados dos produtos / serviços</h3>
<table><thead><tr><th>Código</th><th>Descrição</th><th>NCM/SH</th><th>CST</th><th>CFOP</th><th>Un</th><th>Qtd</th><th>V. unit.</th><th>V. total</th><th>BC ICMS</th><th>V. ICMS</th><th>Alíq. ICMS</th></tr></thead><tbody>${linhas}</tbody></table>
<h3>Dados adicionais</h3>
<div class="row"><div class="c" style="flex:2;min-height:70px"><span>Informações complementares</span>${txt(inf, 'infCpl')}</div><div class="c"><span>Reservado ao fisco</span></div></div>
</body></html>`;
}
