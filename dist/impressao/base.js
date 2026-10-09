export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const moeda = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const dataBr = (iso) => {
    const s = String(iso ?? '');
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s;
};
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const dataExtenso = (iso) => `${Number(iso.slice(8, 10))} de ${MESES[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`;
export const docFmt = (d) => {
    const s = String(d ?? '').replace(/[^0-9A-Za-z]/g, '');
    if (s.length === 11)
        return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    if (s.length === 14)
        return s.replace(/^(\w{2})(\w{3})(\w{3})(\w{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    return String(d ?? '');
};
export const telFmt = (t) => {
    let d = String(t ?? '').replace(/\D/g, '');
    if ((d.length === 12 || d.length === 13) && d.startsWith('55'))
        d = d.slice(2);
    if (d.length === 11)
        return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
    if (d.length === 10)
        return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
    return String(t ?? '');
};
export const siglaLoja = (e) => (e.nome_fantasia || e.razao_social || 'Loja').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
/** Endereço público da logo (a versão no nome evita cache antigo após trocar a logo). */
export const urlLogo = (e) => (e?.logo ? `/marca/logo?v=${encodeURIComponent(String(e.logo).slice(0, 24))}` : '');
export function nomeLoja(e) {
    return e.nome_fantasia || e.razao_social || 'Loja';
}
export function enderecoLoja(e) {
    const partes = [
        [e.logradouro, e.numero].filter(Boolean).join(', '),
        e.bairro,
        [e.municipio, e.uf].filter(Boolean).join('/'),
        e.cep ? 'CEP ' + String(e.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2') : '',
    ].filter(Boolean);
    return partes.join(' · ');
}
/** Cabeçalho com a identidade da loja, usado em todos os documentos impressos. */
export function cabecalho(e, titulo, sub = '') {
    const logo = e.logo ? `<img class="logo" src="${esc(urlLogo(e))}" alt="">` : `<div class="logo-texto">${esc(siglaLoja(e))}</div>`;
    const contato = [e.cnpj ? 'CNPJ ' + docFmt(e.cnpj) : '', telFmt(e.telefone || e.whatsapp)].filter(Boolean).join(' · ');
    return `<header class="doc-topo">${logo}<div class="loja"><b>${esc(e.razao_social || nomeLoja(e))}</b><span>${esc(enderecoLoja(e))}</span><span>${esc(contato)}</span></div>
  <div class="doc-titulo"><h1>${esc(titulo)}</h1>${sub ? `<span>${esc(sub)}</span>` : ''}</div></header>`;
}
/** Página HTML pronta para imprimir ou salvar em PDF pelo navegador. */
export function pagina(titulo, corpo, cssExtra = '') {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
@page{size:A4;margin:14mm 14mm 16mm}*{box-sizing:border-box}
body{margin:0;background:#e9ecf1;font:10.5pt/1.5 Inter,Arial,sans-serif;color:#1d2433}
.folha{background:#fff;max-width:210mm;margin:16px auto;padding:14mm;box-shadow:0 2px 14px rgba(0,0,0,.12)}
.barra{position:sticky;top:0;background:#141b2b;padding:10px 16px;display:flex;gap:10px;justify-content:flex-end;z-index:5}
.barra button{font:600 13px Inter,sans-serif;border:0;border-radius:8px;padding:8px 16px;background:#f97316;color:#fff;cursor:pointer}
.barra button.sec{background:#2a3347}
.doc-topo{display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center;padding-bottom:12px;border-bottom:2.5px solid #f97316;margin-bottom:16px}
.logo{max-height:58px;max-width:150px;object-fit:contain}
.logo-texto{width:52px;height:52px;border-radius:12px;background:#f97316;color:#fff;display:grid;place-items:center;font-weight:700;font-size:18px}
.loja b{display:block;font-size:12pt}.loja span{display:block;font-size:8.5pt;color:#5a6478}
.doc-titulo{text-align:right}.doc-titulo h1{margin:0;font-size:13pt;letter-spacing:.01em}.doc-titulo span{font-size:9pt;color:#5a6478}
h2{font-size:10pt;margin:16px 0 6px;padding:4px 8px;background:#f3f5f8;border-left:3px solid #f97316}
.grade{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #d5dbe5;border-radius:6px;overflow:hidden}
.grade>div{padding:5px 8px;border-right:1px solid #e3e7ee;border-bottom:1px solid #e3e7ee}
.grade>div span{display:block;font-size:7.5pt;color:#6b7487}.grade>div b{font-weight:600}
.s2{grid-column:span 2}.s3{grid-column:span 3}.s4{grid-column:span 4}
.texto{white-space:pre-wrap;text-align:justify}
.assinaturas{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40px;page-break-inside:avoid}
.assinaturas div{text-align:center;font-size:9pt}.assinaturas .linha{border-top:1px solid #1d2433;padding-top:4px}
.assinaturas img{height:62px;max-width:100%;object-fit:contain;display:block;margin:0 auto -4px}
.assinaturas .vazio{height:62px}
.testemunhas{margin-top:34px}
.selo-dig{margin-top:18px;font-size:7.5pt;color:#5a6478;border:1px dashed #c4cbd6;border-radius:6px;padding:6px 8px;word-break:break-all}
.rodape{margin-top:20px;font-size:8pt;color:#6b7487;text-align:center}
table{width:100%;border-collapse:collapse;font-size:9pt}th,td{border-bottom:1px solid #e3e7ee;padding:5px 6px;text-align:left}th{font-size:8pt;color:#5a6478;background:#f6f7f9}
td.n,th.n{text-align:right}
@media print{body{background:#fff}.folha{box-shadow:none;margin:0;padding:0;max-width:none}.barra{display:none}}
${cssExtra}
</style></head><body><div class="barra"><button class="sec" data-acao="fechar">Fechar</button><button data-acao="imprimir">Imprimir ou salvar PDF</button></div>${corpo}<script src="/s/impressao.js"></script></body></html>`;
}
