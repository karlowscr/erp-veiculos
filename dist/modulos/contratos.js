import { createHash, randomInt } from 'node:crypto';
import { falhar, texto, numero, r2, hoje } from '../util/comum.js';
import { limparDoc } from '../util/validacao.js';
import { valorPorExtenso } from '../util/extenso.js';
import { auditar } from './auth.js';
import { pagina, cabecalho, esc, moeda, dataBr, dataExtenso, docFmt, telFmt, nomeLoja, enderecoLoja } from '../impressao/base.js';
const empresa = (b) => b.one('SELECT * FROM empresa WHERE id = 1');
function novoNumero(b, tipo) {
    const pre = tipo === 'venda' ? 'CV' : 'CC';
    for (;;) {
        const n = `${pre}-${String(randomInt(0, 100000)).padStart(5, '0')}`;
        if (!b.one('SELECT 1 FROM contratos WHERE numero = ?', [n]))
            return n;
    }
}
const enderecoPessoa = (p) => [[p.logradouro, p.numero].filter(Boolean).join(', '), p.complemento, p.bairro, [p.municipio, p.uf].filter(Boolean).join('/')].filter(Boolean).join(', ');
/** Campos padrão de um contrato novo, a partir das configurações da loja. */
export function modeloContrato(b, tipo) {
    const e = empresa(b);
    return {
        tipo, data: hoje(), cidade: e.cidade_contrato || e.municipio, loja_doc: e.cnpj, loja_endereco: enderecoLoja(e),
        clausulas: tipo === 'venda' ? e.clausulas_venda : e.clausulas_compra,
        garantia_texto: tipo === 'venda' ? e.garantia_texto : '',
    };
}
function lerCampos(b, c, atual) {
    const tipo = (c.tipo ?? atual?.tipo) === 'compra' ? 'compra' : 'venda';
    const d = {
        tipo, data: texto(c.data) || atual?.data || hoje(), cidade: texto(c.cidade),
        pessoa_id: c.pessoa_id ? numero(c.pessoa_id) : null, veiculo_id: c.veiculo_id ? numero(c.veiculo_id) : null,
        cliente_nome: texto(c.cliente_nome), cliente_doc: limparDoc(c.cliente_doc), cliente_rg: texto(c.cliente_rg),
        cliente_endereco: texto(c.cliente_endereco), cliente_telefone: texto(c.cliente_telefone),
        loja_doc: texto(c.loja_doc), loja_endereco: texto(c.loja_endereco),
        veiculo_marca: texto(c.veiculo_marca), veiculo_modelo: texto(c.veiculo_modelo), veiculo_ano: texto(c.veiculo_ano),
        veiculo_cor: texto(c.veiculo_cor), veiculo_placa: limparDoc(c.veiculo_placa), veiculo_chassi: limparDoc(c.veiculo_chassi),
        veiculo_renavam: texto(c.veiculo_renavam), veiculo_km: texto(c.veiculo_km),
        valor: r2(numero(c.valor)), forma_pagamento: texto(c.forma_pagamento), clausulas: String(c.clausulas ?? '').trim(),
        garantia_texto: String(c.garantia_texto ?? '').trim(), obs: texto(c.obs),
    };
    // Preenche com o cadastro do cliente/veículo o que não veio no formulário
    if (d.pessoa_id) {
        const p = b.one('SELECT * FROM pessoas WHERE id = ?', [d.pessoa_id]) ?? falhar('Cliente não encontrado.');
        d.cliente_nome ||= p.nome;
        d.cliente_doc ||= p.cpf_cnpj ?? '';
        d.cliente_rg ||= p.rg;
        d.cliente_endereco ||= enderecoPessoa(p);
        d.cliente_telefone ||= p.telefone;
    }
    if (d.veiculo_id) {
        const v = b.one('SELECT * FROM veiculos WHERE id = ?', [d.veiculo_id]) ?? falhar('Veículo não encontrado.');
        d.veiculo_marca ||= v.marca;
        d.veiculo_modelo ||= [v.modelo, v.versao].filter(Boolean).join(' ');
        d.veiculo_ano ||= `${v.ano_fab}/${v.ano_mod}`;
        d.veiculo_cor ||= v.cor;
        d.veiculo_placa ||= v.placa;
        d.veiculo_chassi ||= v.chassi;
        d.veiculo_renavam ||= v.renavam;
        d.veiculo_km ||= String(v.km);
    }
    if (!d.cliente_nome)
        falhar(tipo === 'venda' ? 'Informe o comprador.' : 'Informe o vendedor.');
    if (!d.veiculo_modelo)
        falhar('Informe o veículo.');
    return d;
}
/** Texto canônico do contrato: o hash dele vai junto com a assinatura e prova que o conteúdo não mudou. */
function conteudoParaHash(c) {
    const campos = ['numero', 'tipo', 'data', 'cliente_nome', 'cliente_doc', 'veiculo_marca', 'veiculo_modelo', 'veiculo_ano',
        'veiculo_placa', 'veiculo_chassi', 'valor', 'forma_pagamento', 'clausulas', 'garantia_texto'];
    return campos.map((k) => `${k}=${c[k] ?? ''}`).join('\n');
}
export function criarContratoDeNegociacao(b, negId, usuarioId) {
    const n = b.one('SELECT * FROM negociacoes WHERE id = ?', [negId]) ?? falhar('Negociação não encontrada.', 404);
    if (!['venda', 'compra'].includes(n.tipo))
        falhar('Contrato só para compra ou venda.');
    const existente = b.one('SELECT id FROM contratos WHERE negociacao_id = ?', [negId]);
    if (existente)
        return existente.id;
    const pags = b.all('SELECT * FROM negociacao_pagamentos WHERE negociacao_id = ?', [negId]);
    const nomes = { pix: 'PIX', dinheiro: 'dinheiro', transferencia: 'transferência', cartao_debito: 'cartão de débito',
        cartao_credito: 'cartão de crédito', financiamento: 'financiamento bancário', boleto: 'boleto', promissoria: 'nota promissória', cheque: 'cheque', troca: 'veículo na troca' };
    const forma = pags.map((p) => `${moeda(p.valor)} em ${nomes[p.forma] ?? p.forma}${p.parcelas > 1 ? ` (${p.parcelas}x)` : ''}`).join(' + ');
    const m = modeloContrato(b, n.tipo);
    const dados = lerCampos(b, { ...m, tipo: n.tipo, data: n.data, pessoa_id: n.pessoa_id, veiculo_id: n.veiculo_id, valor: n.valor_final, forma_pagamento: forma, veiculo_km: n.km_entrega ?? '' });
    return b.inserir('contratos', { ...dados, numero: novoNumero(b, n.tipo), negociacao_id: negId, criado_por: usuarioId });
}
// ---------------------------------------------------------------- Impressão
function blocoPartes(c, e) {
    const loja = `<div class="s2"><span>Razão social</span><b>${esc(e.razao_social || nomeLoja(e))}</b></div>
    <div><span>CNPJ</span><b>${esc(docFmt(c.loja_doc || e.cnpj))}</b></div><div><span>Telefone</span><b>${esc(telFmt(e.telefone || e.whatsapp))}</b></div>
    <div class="s4"><span>Endereço</span><b>${esc(c.loja_endereco || enderecoLoja(e))}</b></div>`;
    const cli = `<div class="s2"><span>Nome</span><b>${esc(c.cliente_nome)}</b></div>
    <div><span>CPF/CNPJ</span><b>${esc(docFmt(c.cliente_doc))}</b></div><div><span>RG</span><b>${esc(c.cliente_rg)}</b></div>
    <div class="s3"><span>Endereço</span><b>${esc(c.cliente_endereco)}</b></div><div><span>Telefone</span><b>${esc(telFmt(c.cliente_telefone))}</b></div>`;
    const [vend, comp] = c.tipo === 'venda' ? [loja, cli] : [cli, loja];
    return `<h2>Vendedor</h2><div class="grade">${vend}</div><h2>Comprador</h2><div class="grade">${comp}</div>`;
}
function blocoVeiculo(c) {
    return `<h2>Veículo</h2><div class="grade">
    <div><span>Marca</span><b>${esc(c.veiculo_marca)}</b></div><div class="s2"><span>Modelo</span><b>${esc(c.veiculo_modelo)}</b></div><div><span>Ano</span><b>${esc(c.veiculo_ano)}</b></div>
    <div><span>Cor</span><b>${esc(c.veiculo_cor)}</b></div><div><span>Placa</span><b>${esc(c.veiculo_placa)}</b></div>
    <div><span>RENAVAM</span><b>${esc(c.veiculo_renavam)}</b></div><div><span>Quilometragem</span><b>${c.veiculo_km ? esc(Number(c.veiculo_km).toLocaleString('pt-BR')) + ' km' : ''}</b></div>
    <div class="s4"><span>Chassi</span><b>${esc(c.veiculo_chassi)}</b></div></div>`;
}
function blocoAssinaturas(c, e) {
    const lojaAss = e.assinatura_loja ? `<img src="${esc(e.assinatura_loja)}" alt="">` : '<div class="vazio"></div>';
    const cliAss = c.assinatura ? `<img src="${esc(c.assinatura)}" alt="">` : '<div class="vazio"></div>';
    const loja = `${lojaAss}<div class="linha"><b>${esc(e.razao_social || nomeLoja(e))}</b><br>CNPJ ${esc(docFmt(c.loja_doc || e.cnpj))}</div>`;
    const cli = `${cliAss}<div class="linha"><b>${esc(c.cliente_nome)}</b><br>CPF/CNPJ ${esc(docFmt(c.cliente_doc))}</div>`;
    const [vend, comp] = c.tipo === 'venda' ? [loja, cli] : [cli, loja];
    return `<div class="assinaturas"><div>${vend}<small>Vendedor</small></div><div>${comp}<small>Comprador</small></div></div>
  <div class="assinaturas testemunhas"><div><div class="vazio"></div><div class="linha">Testemunha 1<br>CPF:</div></div><div><div class="vazio"></div><div class="linha">Testemunha 2<br>CPF:</div></div></div>
  ${c.assinado_em ? `<div class="selo-dig">Assinado eletronicamente pelo cliente em ${esc(new Date(c.assinado_em).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }))}${c.assinatura_ip ? ` · IP ${esc(c.assinatura_ip)}` : ''} · código de verificação (SHA-256 do conteúdo): ${esc(c.assinatura_hash)}</div>` : ''}`;
}
export function htmlContrato(c, e) {
    const titulo = c.tipo === 'venda' ? 'Contrato de compra e venda de veículo' : 'Contrato de compra de veículo';
    const valorTxt = `${moeda(c.valor)} (${valorPorExtenso(c.valor)})`;
    const local = `${esc(c.cidade || e.municipio)}, ${dataExtenso(c.data)}.`;
    const corpo = `<div class="folha">${cabecalho(e, titulo, `Nº ${c.numero}`)}
  <p class="texto">Pelo presente instrumento particular, as partes abaixo qualificadas têm entre si justo e contratado a ${c.tipo === 'venda' ? 'venda' : 'compra'} do veículo descrito a seguir, nas condições estabelecidas neste contrato.</p>
  ${blocoPartes(c, e)}${blocoVeiculo(c)}
  <h2>Preço e forma de pagamento</h2><div class="grade"><div class="s4"><span>Valor total</span><b>${esc(valorTxt)}</b></div>
  <div class="s4"><span>Forma de pagamento</span><b>${esc(c.forma_pagamento || 'Conforme acordado entre as partes')}</b></div></div>
  <h2>Cláusulas</h2><div class="texto">${esc(c.clausulas)}</div>
  ${c.obs ? `<h2>Observações</h2><div class="texto">${esc(c.obs)}</div>` : ''}
  <p style="margin-top:18px">${local}</p>
  ${blocoAssinaturas(c, e)}</div>`;
    return pagina(`Contrato ${c.numero}`, corpo);
}
export function htmlGarantia(c, e) {
    const textoG = (c.garantia_texto || e.garantia_texto || '').replaceAll('{LOJA}', e.razao_social || nomeLoja(e));
    const corpo = `<div class="folha">${cabecalho(e, 'Termo de garantia', `Contrato Nº ${c.numero}`)}
  <h2>Comprador</h2><div class="grade"><div class="s2"><span>Nome</span><b>${esc(c.cliente_nome)}</b></div><div><span>CPF/CNPJ</span><b>${esc(docFmt(c.cliente_doc))}</b></div><div><span>Telefone</span><b>${esc(telFmt(c.cliente_telefone))}</b></div>
  <div class="s4"><span>Endereço</span><b>${esc(c.cliente_endereco)}</b></div></div>
  ${blocoVeiculo(c)}
  <h2>Condições da garantia</h2><div class="texto">${esc(textoG)}</div>
  <p class="texto" style="margin-top:12px">Data de aquisição: <b>${dataBr(c.data)}</b>. A garantia perde a validade em caso de uso inadequado, competições, alterações no veículo ou manutenção em oficina não autorizada pela loja sem prévia comunicação.</p>
  <p style="margin-top:18px">${esc(c.cidade || e.municipio)}, ${dataExtenso(c.data)}.</p>
  <div class="assinaturas"><div>${e.assinatura_loja ? `<img src="${esc(e.assinatura_loja)}" alt="">` : '<div class="vazio"></div>'}<div class="linha"><b>${esc(e.razao_social || nomeLoja(e))}</b></div></div>
  <div>${c.assinatura ? `<img src="${esc(c.assinatura)}" alt="">` : '<div class="vazio"></div>'}<div class="linha"><b>${esc(c.cliente_nome)}</b><br>Comprador</div></div></div></div>`;
    return pagina(`Garantia ${c.numero}`, corpo);
}
// ---------------------------------------------------------------- Rotas
export function registrarContratos(app, b) {
    app.get('/api/contratos/modelo', (req) => modeloContrato(b, req.query.get('tipo') === 'compra' ? 'compra' : 'venda'));
    app.get('/api/contratos', (req) => {
        const where = [];
        const p = [];
        const tipo = req.query.get('tipo');
        if (tipo === 'venda' || tipo === 'compra') {
            where.push('tipo = ?');
            p.push(tipo);
        }
        const st = req.query.get('status');
        if (st === 'pendente')
            where.push('assinado_em IS NULL');
        if (st === 'assinado')
            where.push('assinado_em IS NOT NULL');
        const q = texto(req.query.get('q'));
        if (q) {
            where.push('(cliente_nome LIKE ? OR numero LIKE ? OR veiculo_modelo LIKE ? OR veiculo_placa LIKE ? OR cliente_doc LIKE ?)');
            p.push(...Array(5).fill(`%${q}%`));
        }
        return b.all(`SELECT id, numero, tipo, data, cliente_nome, veiculo_marca, veiculo_modelo, veiculo_ano, veiculo_placa, valor, assinado_em,
              garantia_texto <> '' AS tem_garantia, negociacao_id
       FROM contratos ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY data DESC, id DESC LIMIT 1000`, p);
    });
    app.get('/api/contratos/:id', (req) => {
        const c = b.one('SELECT * FROM contratos WHERE id = ?', [Number(req.params.id)]) ?? falhar('Contrato não encontrado.', 404);
        return c;
    });
    app.post('/api/contratos', (req) => {
        const d = lerCampos(b, req.corpo);
        const id = b.inserir('contratos', { ...d, numero: novoNumero(b, d.tipo), criado_por: req.usuario.id });
        auditar(b, req.usuario.id, 'criar', 'contratos', id);
        return { id };
    });
    app.post('/api/negociacoes/:id/contrato', (req) => ({ id: criarContratoDeNegociacao(b, Number(req.params.id), req.usuario.id) }));
    app.put('/api/contratos/:id', (req) => {
        const id = Number(req.params.id);
        const atual = b.one('SELECT * FROM contratos WHERE id = ?', [id]) ?? falhar('Contrato não encontrado.', 404);
        if (atual.assinado_em) {
            b.atualizar('contratos', id, { obs: texto(req.corpo.obs) });
        }
        else {
            b.atualizar('contratos', id, lerCampos(b, req.corpo, atual));
        }
        auditar(b, req.usuario.id, 'alterar', 'contratos', id);
        return { ok: true, somente_obs: !!atual.assinado_em };
    });
    app.delete('/api/contratos/:id', (req) => {
        const id = Number(req.params.id);
        const c = b.one('SELECT * FROM contratos WHERE id = ?', [id]) ?? falhar('Contrato não encontrado.', 404);
        if (c.assinado_em && !req.usuario.admin)
            falhar('Contrato assinado só pode ser excluído pelo administrador.');
        b.run('DELETE FROM contratos WHERE id = ?', [id]);
        auditar(b, req.usuario.id, 'excluir', 'contratos', id, { numero: c.numero });
        return { ok: true };
    });
    // Assinatura eletrônica do cliente (desenhada na tela)
    app.post('/api/contratos/:id/assinar', (req) => {
        const id = Number(req.params.id);
        const c = b.one('SELECT * FROM contratos WHERE id = ?', [id]) ?? falhar('Contrato não encontrado.', 404);
        if (c.assinado_em)
            falhar('Este contrato já foi assinado.');
        const ass = String(req.corpo.assinatura ?? '');
        if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(ass) || ass.length < 400)
            falhar('Faça a assinatura no quadro antes de confirmar.');
        if (ass.length > 600_000)
            falhar('Assinatura muito grande.');
        if (!req.corpo.aceite)
            falhar('O cliente precisa confirmar que leu e concorda com o contrato.');
        const hash = createHash('sha256').update(conteudoParaHash(c), 'utf8').digest('hex');
        const ip = String(req.bruto.headers['x-forwarded-for'] ?? req.bruto.socket.remoteAddress ?? '').split(',')[0].trim();
        b.atualizar('contratos', id, { assinatura: ass, assinado_em: new Date().toISOString(), assinatura_ip: ip, assinatura_hash: hash });
        auditar(b, req.usuario.id, 'assinar', 'contratos', id, { hash });
        return { ok: true, hash };
    });
    app.post('/api/contratos/:id/remover-assinatura', (req) => {
        const id = Number(req.params.id);
        const motivo = texto(req.corpo.motivo);
        if (motivo.length < 5)
            falhar('Informe o motivo.');
        b.atualizar('contratos', id, { assinatura: null, assinado_em: null, assinatura_ip: null, assinatura_hash: null });
        auditar(b, req.usuario.id, 'remover_assinatura', 'contratos', id, { motivo });
        return { ok: true };
    });
    app.get('/api/contratos/:id/imprimir', (req) => {
        const c = b.one('SELECT * FROM contratos WHERE id = ?', [Number(req.params.id)]) ?? falhar('Contrato não encontrado.', 404);
        return { corpo: htmlContrato(c, empresa(b)), tipo: 'text/html; charset=utf-8' };
    });
    app.get('/api/contratos/:id/garantia', (req) => {
        const c = b.one('SELECT * FROM contratos WHERE id = ?', [Number(req.params.id)]) ?? falhar('Contrato não encontrado.', 404);
        if (!c.garantia_texto && !empresa(b).garantia_texto)
            falhar('Este contrato não tem termo de garantia.');
        return { corpo: htmlGarantia(c, empresa(b)), tipo: 'text/html; charset=utf-8' };
    });
}
