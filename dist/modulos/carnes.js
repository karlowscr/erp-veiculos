import { join } from 'node:path';
import { falhar, texto, numero, r2 } from '../util/comum.js';
import { limparDoc } from '../util/validacao.js';
import { salvarDataUrl, apagarArquivo } from '../util/arquivos.js';
import { pixCopiaECola, normalizarChavePix } from '../util/pix.js';
import { qrSvg } from '../util/qrcode.js';
import { auditar } from './auth.js';
import { situacao, vencimentoParcela } from './cobrancas.js';
import { pagina, esc, moeda, dataBr, docFmt, nomeLoja, telFmt, siglaLoja, estiloCor } from '../impressao/base.js';
const FORMAS = { pix: 'Pix', boleto: 'Boleto', dinheiro: 'Dinheiro', transferencia: 'Transferência', cartao: 'Cartão' };
function lerCampos(b, c) {
    const pessoaId = c.pessoa_id ? numero(c.pessoa_id) : null;
    const d = {
        pessoa_id: pessoaId, cliente_nome: texto(c.cliente_nome), cliente_doc: limparDoc(c.cliente_doc), cliente_nascimento: texto(c.cliente_nascimento),
        cliente_endereco: texto(c.cliente_endereco), veiculo_tipo: c.veiculo_tipo === 'moto' ? 'moto' : c.veiculo_tipo === 'outro' ? 'outro' : 'carro',
        veiculo_marca: texto(c.veiculo_marca), veiculo_modelo: texto(c.veiculo_modelo), veiculo_placa: limparDoc(c.veiculo_placa),
        veiculo_chassi: limparDoc(c.veiculo_chassi), descricao: texto(c.descricao),
        forma_pagamento: FORMAS[c.forma_pagamento] ? c.forma_pagamento : 'pix', chave_pix: texto(c.chave_pix), obs: texto(c.obs),
    };
    if (pessoaId) {
        const p = b.one('SELECT * FROM pessoas WHERE id = ?', [pessoaId]) ?? falhar('Cliente não encontrado.');
        d.cliente_nome ||= p.nome;
        d.cliente_doc ||= p.cpf_cnpj ?? '';
        d.cliente_nascimento ||= p.nascimento;
        d.cliente_endereco ||= [[p.logradouro, p.numero].filter(Boolean).join(', '), p.bairro, [p.municipio, p.uf].filter(Boolean).join('/')].filter(Boolean).join(', ');
    }
    if (!d.cliente_nome)
        falhar('Selecione o cliente.');
    const total = Math.round(numero(c.total_parcelas));
    if (total < 1 || total > 240)
        falhar('Número de parcelas inválido.');
    const valorParcela = r2(numero(c.valor_parcela));
    if (valorParcela <= 0)
        falhar('Informe o valor da parcela.');
    const primeiro = texto(c.primeiro_vencimento);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(primeiro))
        falhar('Informe a data do primeiro vencimento.');
    if (d.forma_pagamento === 'pix' && !d.chave_pix) {
        d.chave_pix = b.one('SELECT chave_pix FROM empresa WHERE id = 1').chave_pix;
    }
    return { ...d, total_parcelas: total, valor_parcela: valorParcela, valor_total: r2(valorParcela * total), primeiro_vencimento: primeiro, dia_vencimento: Number(primeiro.slice(8, 10)) };
}
function htmlCarne(c, e, pago) {
    const loja = esc(e.razao_social || nomeLoja(e));
    const logo = e.logo ? `<img src="/arquivos/${esc(e.logo)}" alt="">` : `<div class="lt">${esc(siglaLoja(e))}</div>`;
    const veiculo = [c.veiculo_marca, c.veiculo_modelo, c.veiculo_placa].filter(Boolean).join(' ');
    const parcela = (n) => {
        const venc = c.primeiro_vencimento ? vencimentoParcela(c, n) : '';
        let pix = '';
        if (c.forma_pagamento === 'pix' && c.chave_pix) {
            try {
                const codigo = pixCopiaECola({ chave: c.chave_pix, nome: e.razao_social || nomeLoja(e), cidade: e.municipio || 'BRASIL', valor: c.valor_parcela, txid: `C${c.id}P${n}` });
                pix = `<div class="qr">${qrSvg(codigo, 104)}<small>Pague com Pix: aponte a câmera do app do banco</small></div>`;
            }
            catch { /* chave inválida: mostra só o texto */ }
        }
        else if (c.qr_pix) {
            const src = /^https?:/.test(c.qr_pix) ? c.qr_pix : `/arquivos/${c.qr_pix}`;
            pix = `<div class="qr"><img src="${esc(src)}" alt="QR Code Pix"></div>`;
        }
        const pagaMarca = n <= pago ? '<div class="pago">PAGO</div>' : '';
        return `<section class="parcela">
      <div class="canhoto"><b>${loja}</b><dl><dt>Parcela</dt><dd>${n}/${c.total_parcelas}</dd><dt>Vencimento</dt><dd>${dataBr(venc)}</dd><dt>Valor</dt><dd>${moeda(c.valor_parcela)}</dd>
      <dt>Cliente</dt><dd>${esc(c.cliente_nome)}</dd></dl><div class="ass">Recebido em ___/___/______</div></div>
      <div class="recibo">${pagaMarca}<header>${logo}<div><b>${loja}</b><span>${esc(e.cnpj ? 'CNPJ ' + docFmt(e.cnpj) : '')} ${esc(telFmt(e.whatsapp || e.telefone))}</span></div>
        <div class="num"><span>Parcela</span><b>${n}/${c.total_parcelas}</b></div></header>
        <div class="corpo"><dl>
          <dt>Cliente</dt><dd>${esc(c.cliente_nome)}${c.cliente_doc ? ' · CPF/CNPJ ' + esc(docFmt(c.cliente_doc)) : ''}</dd>
          ${veiculo ? `<dt>Veículo</dt><dd>${esc(veiculo)}</dd>` : ''}
          ${c.descricao ? `<dt>Referente a</dt><dd>${esc(c.descricao)}</dd>` : ''}
          <dt>Forma</dt><dd>${esc(FORMAS[c.forma_pagamento] ?? c.forma_pagamento)}${c.chave_pix ? ' · chave ' + esc(c.chave_pix) : ''}</dd></dl>
          <div class="valores"><div><span>Vencimento</span><b>${dataBr(venc)}</b></div><div><span>Valor da parcela</span><b class="v">${moeda(c.valor_parcela)}</b></div></div>
          ${pix}</div>
        <footer>Após o vencimento, entre em contato com a loja. Guarde este comprovante.<span>Recebido por: ______________________ em ___/___/______</span></footer></div></section>`;
    };
    const css = `
  .folha{padding:8mm 10mm}.parcela{display:grid;grid-template-columns:44mm 1fr;border:1px solid #c9d0db;border-radius:6px;margin-bottom:5mm;height:84mm;overflow:hidden;page-break-inside:avoid;position:relative}
  .parcela:nth-of-type(3n){page-break-after:always}
  .canhoto{border-right:1.5px dashed #9aa3b2;padding:8px;font-size:8pt;display:flex;flex-direction:column}
  .canhoto b{font-size:8.5pt;margin-bottom:6px}.canhoto dl{margin:0;display:grid;gap:1px}.canhoto dt{color:#6b7487;font-size:7pt;margin-top:3px}.canhoto dd{margin:0;font-weight:600}
  .canhoto .ass{margin-top:auto;font-size:7pt;color:#6b7487}
  .recibo{padding:8px 12px;display:flex;flex-direction:column;position:relative}
  .recibo header{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;border-bottom:2px solid var(--cor,#f97316);padding-bottom:6px}
  .recibo header img{max-height:34px;max-width:90px;object-fit:contain}.lt{width:34px;height:34px;border-radius:8px;background:var(--cor,#f97316);color:#fff;display:grid;place-items:center;font-weight:700}
  .recibo header b{display:block;font-size:9.5pt}.recibo header span{font-size:7.5pt;color:#5a6478}
  .num{text-align:right}.num span{display:block;font-size:7pt;color:#6b7487}.num b{font-size:14pt}
  .corpo{display:grid;grid-template-columns:1fr auto;grid-template-rows:auto auto;gap:4px 12px;padding-top:6px;flex:1}
  .corpo dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:8.5pt}.corpo dt{color:#6b7487}.corpo dd{margin:0;font-weight:500}
  .valores{display:flex;gap:18px}.valores span{display:block;font-size:7.5pt;color:#6b7487}.valores b{font-size:11pt}.valores .v{color:#c2410c;font-size:13pt}
  .qr{grid-row:1/3;grid-column:2;text-align:center;width:118px}.qr img{width:104px;height:104px;object-fit:contain}.qr small{display:block;font-size:6.5pt;color:#6b7487;line-height:1.2}
  footer{font-size:7pt;color:#6b7487;border-top:1px solid #e3e7ee;padding-top:4px;display:flex;justify-content:space-between;gap:8px}
  .pago{position:absolute;right:140px;top:44%;transform:rotate(-14deg);border:3px solid #17703f;color:#17703f;font-weight:800;font-size:20pt;padding:0 10px;border-radius:6px;opacity:.75}
  @media print{.folha{padding:0}}`;
    const corpo = `<div class="folha">${Array.from({ length: c.total_parcelas }, (_, i) => parcela(i + 1)).join('')}</div>`;
    return pagina(`Carnê ${c.cliente_nome}`, estiloCor(e) + corpo, css);
}
export function registrarCarnes(app, b, pastaArquivos) {
    const empresa = () => b.one('SELECT * FROM empresa WHERE id = 1');
    app.get('/api/carnes', (req) => {
        const q = `%${texto(req.query.get('q'))}%`;
        const lista = b.all(`SELECT c.*, co.parcelas_pagas AS cob_pagas, co.total_parcelas AS cob_total, co.primeiro_vencimento AS cob_primeiro, co.valor_parcela AS cob_valor
       FROM carnes c LEFT JOIN cobrancas co ON co.id = c.cobranca_id
       WHERE c.cliente_nome LIKE ? OR c.veiculo_placa LIKE ? OR c.descricao LIKE ? ORDER BY c.id DESC LIMIT 1000`, [q, q, q]);
        return lista.map((c) => {
            const s = c.cobranca_id ? situacao({ parcelas_pagas: c.cob_pagas, total_parcelas: c.cob_total, primeiro_vencimento: c.cob_primeiro, valor_parcela: c.cob_valor }) : null;
            return { ...c, situacao: s?.situacao ?? null, parcelas_pagas: s ? c.cob_pagas : null };
        });
    });
    app.get('/api/carnes/:id', (req) => b.one('SELECT * FROM carnes WHERE id = ?', [Number(req.params.id)]) ?? falhar('Carnê não encontrado.', 404));
    app.post('/api/carnes', async (req) => {
        const d = lerCampos(b, req.corpo);
        if (d.forma_pagamento === 'pix' && d.chave_pix && !normalizarChavePix(d.chave_pix))
            falhar('Chave Pix inválida.');
        let qr = '';
        if (req.corpo.qr_imagem)
            qr = (await salvarDataUrl(join(pastaArquivos, 'carnes'), 'qr', req.corpo.qr_imagem, { maxMb: 4 })).arquivo;
        const id = b.tx(() => {
            let cobrancaId = null;
            if (req.corpo.criar_cobranca) {
                cobrancaId = b.inserir('cobrancas', {
                    pessoa_id: d.pessoa_id, cliente_nome: d.cliente_nome, cliente_telefone: d.pessoa_id ? b.one('SELECT telefone FROM pessoas WHERE id = ?', [d.pessoa_id]).telefone : '',
                    descricao: d.descricao || `Carnê ${[d.veiculo_marca, d.veiculo_modelo].filter(Boolean).join(' ')}`.trim(),
                    veiculo_info: [d.veiculo_marca, d.veiculo_modelo, d.veiculo_placa].filter(Boolean).join(' '),
                    valor_total: d.valor_total, valor_parcela: d.valor_parcela, total_parcelas: d.total_parcelas,
                    dia_vencimento: d.dia_vencimento, primeiro_vencimento: d.primeiro_vencimento, obs: d.obs,
                });
            }
            return b.inserir('carnes', { ...d, qr_pix: qr ? 'carnes/' + qr : '', cobranca_id: cobrancaId });
        });
        auditar(b, req.usuario.id, 'criar', 'carnes', id);
        return { id };
    });
    app.put('/api/carnes/:id', async (req) => {
        const id = Number(req.params.id);
        const atual = b.one('SELECT * FROM carnes WHERE id = ?', [id]) ?? falhar('Carnê não encontrado.', 404);
        const d = lerCampos(b, { ...atual, ...req.corpo });
        if (req.corpo.qr_imagem) {
            const novo = await salvarDataUrl(join(pastaArquivos, 'carnes'), 'qr', req.corpo.qr_imagem, { maxMb: 4 });
            if (atual.qr_pix?.startsWith('carnes/'))
                await apagarArquivo(join(pastaArquivos, 'carnes'), atual.qr_pix.slice(7));
            d.qr_pix = 'carnes/' + novo.arquivo;
        }
        b.atualizar('carnes', id, d);
        auditar(b, req.usuario.id, 'alterar', 'carnes', id);
        return { ok: true };
    });
    app.delete('/api/carnes/:id', async (req) => {
        const id = Number(req.params.id);
        const c = b.one('SELECT * FROM carnes WHERE id = ?', [id]) ?? falhar('Carnê não encontrado.', 404);
        b.run('DELETE FROM carnes WHERE id = ?', [id]);
        if (c.qr_pix?.startsWith('carnes/'))
            await apagarArquivo(join(pastaArquivos, 'carnes'), c.qr_pix.slice(7));
        auditar(b, req.usuario.id, 'excluir', 'carnes', id);
        return { ok: true };
    });
    app.get('/api/carnes/:id/imprimir', (req) => {
        const c = b.one('SELECT * FROM carnes WHERE id = ?', [Number(req.params.id)]) ?? falhar('Carnê não encontrado.', 404);
        const pago = c.cobranca_id ? (b.one('SELECT parcelas_pagas FROM cobrancas WHERE id = ?', [c.cobranca_id])?.parcelas_pagas ?? 0) : 0;
        return { corpo: htmlCarne(c, empresa(), pago), tipo: 'text/html; charset=utf-8' };
    });
}
