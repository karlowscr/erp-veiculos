import { api, pode, sessao } from '../api.js';
import { html, montar, $, $$, acoes, campos, aoEnviar, lerForm, modal, aviso, moeda, data, doc, placa, selo, rotulo, hoje, vazio, } from '../ui.js';
import { seletorPessoa } from './pessoas.js';
import { formVeiculoHtml, extrairDadosVeiculo, leitorDocumentoHtml, ligarLeitorDocumento, emitirNotaAgora } from './veiculos.js';
const FORMAS = [
    ['pix', 'PIX'], ['dinheiro', 'Dinheiro'], ['transferencia', 'Transferência'], ['cartao_debito', 'Cartão de débito'],
    ['cartao_credito', 'Cartão de crédito'], ['financiamento', 'Financiamento'], ['boleto', 'Boleto'], ['promissoria', 'Promissória'], ['cheque', 'Cheque'],
];
export async function render(el, params) {
    if (params[0] === 'nova') {
        if (params[1]?.startsWith('venda'))
            return novaVenda(el);
        if (params[1]?.startsWith('compra'))
            return novaEntrada(el, 'compra');
        if (params[1]?.startsWith('consignacao'))
            return novaEntrada(el, 'consignacao');
    }
    if (params[0])
        return detalhe(el, Number(params[0]));
    const filtro = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const tipo = filtro.get('tipo') ?? '';
    const de = filtro.get('de') ?? hoje().slice(0, 8) + '01';
    const ate = filtro.get('ate') ?? hoje();
    const lista = await api.get(`/api/negociacoes?tipo=${tipo}&de=${de}&ate=${ate}`);
    const total = lista.filter((n) => n.status === 'concluida' && n.tipo === 'venda').reduce((s, n) => s + n.valor_final, 0);
    montar(el, html `
  <header class="topo-pagina"><h1>Negociações</h1>
    <div class="botoes">${pode('negociacoes.vender') ? html `<a class="botao" href="#/negociacoes/nova/venda">Registrar venda</a>` : ''}${pode('negociacoes.comprar') ? html `<a class="botao sec" href="#/negociacoes/nova/compra">Registrar compra</a>` : ''}${pode('negociacoes.consignar') ? html `<a class="botao sec" href="#/negociacoes/nova/consignacao">Receber em consignação</a>` : ''}</div></header>
  <form class="filtros" id="f-filtro">
    <select name="tipo" aria-label="Tipo">${[['', 'Todos os tipos'], ['venda', 'Vendas'], ['compra', 'Compras'], ['consignacao', 'Consignações'], ['devolucao_consignacao', 'Devoluções']].map(([v, t]) => html `<option value="${v}" ${v === tipo ? 'selected' : ''}>${t}</option>`)}</select>
    <label>De <input type="date" name="de" value="${de}"></label><label>até <input type="date" name="ate" value="${ate}"></label>
    <button class="sec" type="submit">Filtrar</button>
  </form>
  ${lista.length ? html `<p class="mudo">${lista.length} negociação(ões) no período. Vendas concluídas: <b>${moeda(total)}</b>.</p>
  <div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Data</th><th>Tipo</th><th>Veículo</th><th>Pessoa</th><th>Vendedor</th><th class="n">Valor</th><th>NF-e</th><th>Situação</th></tr></thead>
  <tbody>${lista.map((n) => html `<tr data-acao="abrir" data-id="${n.id}" tabindex="0"><td>${data(n.data)}</td><td>${rotulo(n.tipo)}</td><td>${placa(n.placa, true)} ${n.marca} ${n.modelo}</td>
  <td>${n.pessoa_nome}</td><td>${n.vendedor_nome ?? ''}</td><td class="n">${moeda(n.valor_final)}</td><td>${n.nfe_status ? selo(n.nfe_status) : html `<span class="mudo">sem nota</span>`}</td><td>${selo(n.status)}</td></tr>`)}</tbody></table></div>`
        : vazio('Nenhuma negociação no período.')}`);
    $('#f-filtro', el).addEventListener('submit', (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        location.hash = `#/negociacoes?tipo=${f.get('tipo')}&de=${f.get('de')}&ate=${f.get('ate')}`;
    });
    acoes(el, { abrir: (t) => (location.hash = `#/negociacoes/${t.dataset.id}`) });
}
// ---------- Pagamentos (linhas dinâmicas) ----------
function linhaPagamento(i, forma = 'pix', valor = '') {
    return html `<div class="pagamento" data-i="${i}">
    <select name="forma" aria-label="Forma de pagamento">${FORMAS.map(([v, t]) => html `<option value="${v}" ${v === forma ? 'selected' : ''}>${t}</option>`)}</select>
    <input name="valor" type="number" step="0.01" min="0.01" placeholder="Valor" value="${valor}" aria-label="Valor" required>
    <input name="parcelas" type="number" min="1" max="120" value="1" aria-label="Parcelas" title="Parcelas">
    <input name="primeiro_vencimento" type="date" aria-label="Primeiro vencimento" title="Primeiro vencimento (vazio = padrão)">
    <div class="banco" hidden></div>
    <button type="button" class="link" data-rem-pag>Remover</button></div>`;
}
function ligarPagamentos(raiz, papelBanco, aoMudar, restante = () => 0) {
    let n = 0;
    const area = $('.pagamentos', raiz);
    const ajustar = (div) => {
        const forma = div.querySelector('[name=forma]').value;
        const banco = div.querySelector('.banco');
        const precisa = papelBanco && forma === 'financiamento';
        banco.hidden = !precisa;
        if (precisa && !banco.dataset.ok) {
            seletorPessoa(banco, 'banco_' + div.dataset.i, 'Banco / financeira', { papel: 'fornecedor', obrigatorio: true });
            banco.dataset.ok = '1';
        }
    };
    // Linha nova já vem com o que falta receber (o usuário pode mudar)
    const adicionar = (forma, valor) => {
        const falta = restante();
        const auto = valor === undefined;
        area.insertAdjacentHTML('beforeend', linhaPagamento(n++, forma, valor ?? (falta > 0 ? falta.toFixed(2) : '')).s);
        const nova = area.lastElementChild;
        if (auto)
            nova.dataset.auto = '1';
        ajustar(nova);
        aoMudar();
    };
    raiz.querySelector('[data-add-pag]').addEventListener('click', () => adicionar());
    // "Completar com o que falta": soma o que falta na última linha sem valor, ou cria uma linha
    raiz.addEventListener('click', (e) => {
        if (!e.target.closest('[data-completar]'))
            return;
        const falta = restante();
        if (falta <= 0)
            return;
        const vazia = $$('.pagamento [name=valor]', area).reverse().find((i) => !Number(i.value));
        if (vazia) {
            vazia.value = falta.toFixed(2);
            aoMudar();
        }
        else
            adicionar();
    });
    area.addEventListener('click', (e) => {
        if (e.target.matches('[data-rem-pag]')) {
            e.target.closest('.pagamento').remove();
            aoMudar();
        }
    });
    area.addEventListener('change', (e) => { const d = e.target.closest('.pagamento'); if (d)
        ajustar(d); aoMudar(); });
    area.addEventListener('input', (e) => { e.target.closest('.pagamento')?.removeAttribute('data-auto'); aoMudar(); });
    return { adicionar };
}
function lerPagamentos(raiz) {
    return $$('.pagamento', raiz).map((d) => {
        const v = (n) => d.querySelector(`[name=${n}]`)?.value;
        return {
            forma: v('forma'), valor: Number(v('valor')), parcelas: Number(v('parcelas') || 1), primeiro_vencimento: v('primeiro_vencimento'),
            pessoa_id: d.querySelector('.banco input[type=hidden]')?.value || null,
        };
    });
}
/** Quadro que explica a conta: preço, abatimentos, quanto falta ou passou. */
function resumoPagamento(alvo, partes, total, pago, quem) {
    const dif = Math.round((total - pago) * 100) / 100;
    const estado = total <= 0 ? (pago ? html `<p class="conta-status falta">Informe o preço para conferir os pagamentos.</p>` : '') : dif === 0
        ? html `<p class="conta-status ok">Tudo certo: os pagamentos fecham o valor.</p>`
        : dif > 0
            ? html `<p class="conta-status falta">Falta informar ${moeda(dif)}. <button type="button" class="link" data-completar>Completar com o que falta</button></p>`
            : html `<p class="conta-status passou">Os pagamentos passaram ${moeda(-dif)} do total. Diminua algum valor ou confira o preço${partes.length > 1 ? ' e a troca' : ''}.</p>`;
    alvo.innerHTML = html `<div class="conta">
    ${partes.map(([r, v]) => html `<div class="conta-linha"><span>${r}</span><b>${v < 0 ? '− ' + moeda(-v) : moeda(v)}</b></div>`)}
    <div class="conta-linha total"><span>${quem}</span><b>${moeda(Math.max(0, total))}</b></div>
    <div class="conta-linha"><span>Pagamentos informados</span><b>${moeda(pago)}</b></div>
  </div>${estado}`.s;
}
// ---------- Nova venda ----------
async function novaVenda(el) {
    const sel = new URLSearchParams(location.hash.split('?')[1] ?? '').get('veiculo');
    const [estoque, reservados, usuarios] = await Promise.all([
        api.get('/api/veiculos?situacao=estoque'), api.get('/api/veiculos?situacao=reservado'),
        pode('negociacoes.ver_todas') ? api.get('/api/usuarios/vendedores') : Promise.resolve([sessao.usuario]),
    ]);
    const veiculos = [...estoque, ...reservados];
    if (!veiculos.length)
        return montar(el, vazio('Não há veículos disponíveis para venda.', html `<a class="botao" href="#/negociacoes/nova/compra">Registrar compra</a>`));
    montar(el, html `
  <header class="topo-pagina"><div><a href="#/negociacoes" class="voltar">Negociações</a><h1>Registrar venda</h1></div></header>
  <form id="f-venda" class="form-venda">
    <section class="bloco"><h2>Veículo e cliente</h2>
      <div class="grade-form">
        <div class="campo l2"><label for="f_veic">Veículo<span class="obr">*</span></label><select id="f_veic" name="veiculo_id" required>
          <option value="">Selecione</option>${veiculos.map((v) => html `<option value="${v.id}" data-preco="${v.preco_venda}" data-km="${v.km}" data-origem="${v.origem}" ${String(v.id) === sel ? 'selected' : ''}>${v.placa || '0 km'} — ${v.marca} ${v.modelo} ${v.ano_mod} (${moeda(v.preco_venda)})${v.situacao === 'reservado' ? ' [reservado]' : ''}</option>`)}</select></div>
        <div class="l2" id="sel-cliente"></div>
        ${campos([
        { nome: 'vendedor_id', rotulo: 'Vendedor', tipo: 'select', opcoes: usuarios.filter((u) => u.ativo !== 0).map((u) => [String(u.id), u.nome]), largura: 1 },
        { nome: 'data', rotulo: 'Data', tipo: 'data', largura: 1 },
        { nome: 'km_entrega', rotulo: 'Km na entrega', tipo: 'numero', largura: 1 },
        { nome: 'comissao_pct', rotulo: 'Comissão (%)', tipo: 'numero', largura: 1, dica: 'Vazio usa a do vendedor.' },
    ], { vendedor_id: String(sessao.usuario.id), data: hoje() })}
      </div>
    </section>
    <section class="bloco"><h2>Valores</h2>
      <div class="grade-form">${campos([
        { nome: 'valor', rotulo: 'Preço de venda', tipo: 'moeda', obrigatorio: true, largura: 1 },
        { nome: 'desconto', rotulo: 'Desconto', tipo: 'moeda', largura: 1 },
    ])}<div class="campo l2 consig" hidden><label for="f_rep">Repasse ao proprietário</label><input id="f_rep" type="number" step="0.01" name="repasse_valor"><small>Vazio usa o valor combinado na consignação.</small></div></div>
      <label class="check"><input type="checkbox" id="tem-troca"> Cliente vai dar um veículo na troca</label>
      <div id="troca" hidden data-ignorar><h3>Veículo da troca</h3>
        ${leitorDocumentoHtml('Fotografe o documento do carro da troca')}
        <div class="grade-form">${campos([{ nome: 'valor_troca', rotulo: 'Valor de avaliação', tipo: 'moeda', largura: 1 }])}</div>
        <div data-troca>${formVeiculoHtml()}</div></div>
    </section>
    <section class="bloco"><h2>Pagamento</h2>
      <div class="pagamentos" data-ignorar><div class="pagamento-cab" aria-hidden="true"><span>Forma</span><span>Valor</span><span>Parcelas</span><span>1º vencimento</span><span></span></div></div>
      <button type="button" class="sec" data-add-pag>Adicionar forma de pagamento</button>
      <p class="conferencia" aria-live="polite"></p>
      ${campos([{ nome: 'obs', rotulo: 'Observações', tipo: 'area', largura: 4 }])}
      ${pode('notas.emitir') ? html `<label class="nota-auto"><input type="checkbox" id="emitir-notas" checked><span><b>Emitir as notas fiscais ao concluir</b><small>NF-e de venda e, se houver troca, a NF-e de entrada do veículo recebido.</small></span></label>` : ''}
    </section>
    <div class="acoes-form"><a class="botao sec" href="#/negociacoes">Voltar</a><button type="submit">Concluir venda</button></div>
  </form>`);
    const f = $('#f-venda', el);
    seletorPessoa($('#sel-cliente', el), 'pessoa_id', 'Cliente', { obrigatorio: true });
    let docTroca = '';
    ligarLeitorDocumento($('#troca [data-leitor]', el), $('[data-troca]', el), (l) => { docTroca = l.documento; });
    const selVeic = $('#f_veic', el);
    const valores = () => {
        const d = lerForm(f);
        const preco = Number(d.valor || 0), desconto = Number(d.desconto || 0);
        const troca = $('#tem-troca', el).checked ? Number($('[name=valor_troca]', el).value || 0) : 0;
        const receber = Math.round((preco - desconto - troca) * 100) / 100;
        return { preco, desconto, troca, receber };
    };
    const restante = () => {
        const pago = lerPagamentos(el).reduce((s, p) => s + (p.valor || 0), 0);
        return Math.max(0, Math.round((valores().receber - pago) * 100) / 100);
    };
    const conferir = () => {
        const { preco, desconto, troca, receber } = valores();
        // Uma única linha preenchida automaticamente acompanha o valor da venda
        const linhas = $$('.pagamento', el);
        if (linhas.length === 1 && linhas[0].dataset.auto && receber > 0)
            linhas[0].querySelector('[name=valor]').value = receber.toFixed(2);
        const pago = lerPagamentos(el).reduce((s, p) => s + (p.valor || 0), 0);
        resumoPagamento($('.conferencia', el), [
            ['Preço do veículo', preco], ...(desconto ? [['Desconto', -desconto]] : []), ...(troca ? [['Carro da troca', -troca]] : []),
        ], receber, pago, 'O cliente paga');
    };
    const pags = ligarPagamentos(el, true, conferir, restante);
    const aoVeiculo = () => {
        const o = selVeic.selectedOptions[0];
        if (!o?.value)
            return;
        $('[name=valor]', el).value = o.dataset.preco ?? '';
        $('[name=km_entrega]', el).value = o.dataset.km ?? '';
        $('.consig', el).hidden = o.dataset.origem !== 'consignacao';
        conferir();
    };
    selVeic.addEventListener('change', aoVeiculo);
    aoVeiculo();
    pags.adicionar('pix');
    f.addEventListener('input', conferir);
    $('#tem-troca', el).addEventListener('change', (e) => { $('#troca', el).hidden = !e.target.checked; conferir(); });
    f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const btn = f.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
            const d = lerForm(f);
            const corpo = { ...d, pagamentos: lerPagamentos(el) };
            if ($('#tem-troca', el).checked) {
                const t = {};
                for (const i of $$('[data-troca] [name]', el))
                    t[i.name] = i.type === 'checkbox' ? i.checked : i.value;
                corpo.troca = { valor: $('[name=valor_troca]', el).value, veiculo: extrairDadosVeiculo(t) };
            }
            const r = await api.post('/api/negociacoes/venda', corpo);
            if (r.troca_veiculo_id && docTroca)
                await api.post(`/api/veiculos/${r.troca_veiculo_id}/documento`, { documento: docTroca }).catch(() => undefined);
            const msgs = ['Venda registrada.'];
            if (document.querySelector('#emitir-notas')?.checked) {
                btn.textContent = 'Emitindo notas…';
                if (r.troca_negociacao_id)
                    msgs.push(await emitirNotaAgora(r.troca_negociacao_id, 'de entrada da troca'));
                msgs.push(await emitirNotaAgora(r.id, 'de venda'));
            }
            aviso(msgs.join(' '), msgs.some((m) => /não emitida|rejeit|erro/i.test(m)) ? 'erro' : 'ok');
            location.hash = `#/negociacoes/${r.id}`;
        }
        catch (e) {
            aviso(e.message, 'erro');
        }
        finally {
            btn.disabled = false;
        }
    });
}
// ---------- Nova compra / consignação ----------
async function novaEntrada(el, tipo) {
    const compra = tipo === 'compra';
    montar(el, html `
  <header class="topo-pagina"><div><a href="#/negociacoes" class="voltar">Negociações</a><h1>${compra ? 'Registrar compra' : 'Receber veículo em consignação'}</h1></div></header>
  <form id="f-ent">
    <section class="bloco"><h2>${compra ? 'De quem a loja está comprando' : 'Proprietário do veículo'}</h2>
      <div class="grade-form"><div class="l2" id="sel-pessoa"></div>
      ${campos([
        compra ? { nome: 'valor', rotulo: 'Valor da compra', tipo: 'moeda', obrigatorio: true, largura: 1 } : { nome: 'valor_repasse', rotulo: 'Valor líquido para o proprietário', tipo: 'moeda', obrigatorio: true, largura: 1, dica: 'O que ele recebe quando o carro for vendido.' },
        { nome: 'data', rotulo: 'Data', tipo: 'data', largura: 1 },
    ], { data: hoje() })}</div>
    </section>
    <section class="bloco"><h2>Veículo</h2>${leitorDocumentoHtml()}<div data-veic>${formVeiculoHtml()}</div></section>
    ${compra ? html `<section class="bloco"><h2>Pagamento ao vendedor</h2><p class="mudo">Sem formas de pagamento, o sistema gera uma conta a pagar com vencimento na data da compra.</p>
      <div class="pagamentos" data-ignorar><div class="pagamento-cab" aria-hidden="true"><span>Forma</span><span>Valor</span><span>Parcelas</span><span>1º vencimento</span><span></span></div></div><button type="button" class="sec" data-add-pag>Adicionar forma de pagamento</button><p class="conferencia"></p></section>` : ''}
    <section class="bloco">${campos([{ nome: 'obs', rotulo: 'Observações', tipo: 'area', largura: 4 }])}
      ${pode('notas.emitir') ? html `<label class="nota-auto"><input type="checkbox" id="emitir-notas" checked><span><b>Emitir a NF-e de entrada ao concluir</b><small>${compra ? 'Nota de compra do veículo usado.' : 'Nota de entrada em consignação.'}</small></span></label>` : ''}</section>
    <div class="acoes-form"><a class="botao sec" href="#/negociacoes">Voltar</a><button type="submit">${compra ? 'Concluir compra' : 'Concluir consignação'}</button></div>
  </form>`);
    seletorPessoa($('#sel-pessoa', el), 'pessoa_id', compra ? 'Vendedor' : 'Proprietário', { obrigatorio: true });
    const f = $('#f-ent', el);
    let docVeic = '';
    ligarLeitorDocumento($('[data-leitor]', el), $('[data-veic]', el), (l) => { docVeic = l.documento; });
    if (compra) {
        const restanteCompra = () => {
            const valor = Number($('[name=valor]', el).value || 0);
            const pago = lerPagamentos(el).reduce((s, p) => s + (p.valor || 0), 0);
            return Math.max(0, Math.round((valor - pago) * 100) / 100);
        };
        const conferir = () => {
            const valor = Number($('[name=valor]', el).value || 0);
            const pago = lerPagamentos(el).reduce((s, p) => s + (p.valor || 0), 0);
            if (pago)
                return resumoPagamento($('.conferencia', el), [['Valor da compra', valor]], valor, pago, 'A loja paga');
            const falta = Math.round((valor - pago) * 100) / 100;
            $('.conferencia', el).textContent = pago ? (falta === 0 ? 'Pagamentos fecham com o valor da compra.' : `${falta > 0 ? 'Falta' : 'Sobra'} ${moeda(Math.abs(falta))}.`) : '';
        };
        ligarPagamentos(el, false, conferir, restanteCompra);
        f.addEventListener('input', conferir);
    }
    f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const btn = f.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
            const v = {};
            for (const i of $$('[data-veic] [name]', el))
                v[i.name] = i.value;
            const g = (n) => f.elements.namedItem(n)?.value;
            const corpo = {
                pessoa_id: g('pessoa_id'), data: g('data'), obs: g('obs'), veiculo: extrairDadosVeiculo(v),
                ...(compra ? { valor: g('valor'), pagamentos: lerPagamentos(el) } : { valor_repasse: g('valor_repasse') }),
            };
            const r = await api.post(`/api/negociacoes/${tipo}`, corpo);
            if (docVeic) {
                const n = await api.get(`/api/negociacoes/${r.id}`);
                await api.post(`/api/veiculos/${n.veiculo.id}/documento`, { documento: docVeic }).catch(() => undefined);
            }
            const msgs = [compra ? 'Compra registrada. Veículo no estoque.' : 'Consignação registrada. Veículo no estoque.'];
            if (document.querySelector('#emitir-notas')?.checked) {
                btn.textContent = 'Emitindo nota…';
                msgs.push(await emitirNotaAgora(r.id, 'de entrada'));
            }
            aviso(msgs.join(' '), msgs.some((m) => /não emitida|rejeit|erro/i.test(m)) ? 'erro' : 'ok');
            location.hash = `#/negociacoes/${r.id}`;
        }
        catch (e) {
            aviso(e.message, 'erro');
        }
        finally {
            btn.disabled = false;
        }
    });
}
// ---------- Detalhe ----------
async function detalhe(el, id) {
    const n = await api.get(`/api/negociacoes/${id}`);
    const v = n.veiculo;
    const ativa = n.status === 'concluida';
    const nfeOk = n.nfes.find((f) => f.status === 'autorizada');
    const nfePendente = n.nfes.find((f) => ['assinada', 'erro'].includes(f.status));
    const temNfe = ativa;
    montar(el, html `
  <header class="topo-pagina"><div><a href="#/negociacoes" class="voltar">Negociações</a>
    <h1>${rotulo(n.tipo)} nº ${n.id} ${selo(n.status)}</h1>
    <p class="mudo">${data(n.data)}, ${n.pessoa_nome} (${doc(n.pessoa_doc)})${n.vendedor_nome ? ', vendedor ' + n.vendedor_nome : ''}</p></div>
    <div class="botoes">${ativa && pode('negociacoes.cancelar') ? html `<button class="sec perigo" data-acao="cancelar">Cancelar negociação</button>` : ''}</div>
  </header>

  <a class="cartao-veiculo" href="#/veiculos/${v.id}">${placa(v.placa)}<span><b>${v.marca} ${v.modelo} ${v.versao}</b><br>${v.ano_fab}/${v.ano_mod}, chassi ${v.chassi}</span></a>

  <section class="faixa-numeros">
    <div><span>Valor</span><b>${moeda(n.valor)}</b>${n.desconto ? html `<small>desconto ${moeda(n.desconto)}</small>` : ''}</div>
    <div><span>Valor final</span><b>${moeda(n.valor_final)}</b>${n.valor_troca ? html `<small>troca ${moeda(n.valor_troca)}</small>` : ''}</div>
    ${n.tipo === 'venda' ? html `
      <div><span>Comissão</span><b>${moeda(n.comissao_valor)}</b><small>${n.comissao_pct}%</small></div>
      <div><span>Resultado da venda</span><b class="${n.resultado < 0 ? 'neg' : ''}">${moeda(n.resultado)}</b><small>${v.origem === 'consignacao' ? `repasse ${moeda(n.repasse_valor)}` : `custo ${moeda(n.custo_veiculo)}`}, já descontada a comissão</small></div>` : ''}
    ${n.tipo === 'consignacao' ? html `<div><span>Repasse combinado</span><b>${moeda(n.repasse_valor)}</b></div>` : ''}
  </section>
  ${n.troca ? html `<p>Veículo recebido na troca: <a href="#/veiculos/${n.troca.id}">${n.troca.marca} ${n.troca.modelo} ${n.troca.ano_mod} ${n.troca.placa}</a>${n.troca.negociacao_id ? html ` · <a href="#/negociacoes/${n.troca.negociacao_id}">entrada da troca e NF-e de entrada</a>` : ''}</p>` : ''}

  <div class="grade-2">
    <section class="bloco"><h2>Nota fiscal</h2>
      ${n.nfes.length ? html `<ul class="historico">${n.nfes.map((f) => html `<li>${selo(f.status)} <b>NF-e ${f.numero}</b> série ${f.serie} ${f.tipo_nf === 0 ? '(entrada)' : '(saída)'}
        ${f.cstat ? html `<small>${f.cstat} — ${f.xmotivo}</small>` : ''}
        <span class="botoes-mini"><a href="#/notas/${f.id}">Detalhes</a> <a href="/api/nfes/${f.id}/danfe" target="_blank" rel="noopener">DANFE</a> <a href="/api/nfes/${f.id}/xml">XML</a></span></li>`)}</ul>` : html `<p class="mudo">Nenhuma nota emitida.</p>`}
      ${temNfe && !nfeOk && pode('notas.emitir') ? html `<button data-acao="emitir">${nfePendente ? 'Transmitir NF-e novamente' : n.nfes.length ? 'Emitir NF-e corrigida' : 'Emitir NF-e'}</button>` : ''}
    </section>
    <section class="bloco"><h2>RENAVE</h2>
      <p>${selo(v.renave_status)}</p>
      ${ativa && n.tipo === 'venda' && v.renave_status === 'em_estoque' && pode('renave.operar') ? html `<button data-acao="renave-saida" ${nfeOk ? '' : 'disabled'}>Registrar saída por venda</button>${nfeOk ? '' : html `<p class="mudo">Autorize a NF-e de venda primeiro.</p>`}` : ''}
      ${ativa && ['compra', 'consignacao'].includes(n.tipo) && ['pendente', 'erro'].includes(v.renave_status) && ['estoque', 'reservado'].includes(v.situacao) ? html `<a class="botao sec" href="#/veiculos/${v.id}">Registrar entrada no veículo</a>` : ''}
      ${n.tipo === 'venda' && v.renave_status === 'pendente' ? html `<p class="mudo">A entrada deste veículo não foi registrada no RENAVE. Registre a entrada antes da saída.</p>` : ''}
    </section>
  </div>

  <section class="bloco"><h2>Pagamentos e títulos</h2>
    ${n.pagamentos.length ? html `<p>${n.pagamentos.map((p) => html `<span class="etiqueta">${rotulo(p.forma)} ${moeda(p.valor)}${p.parcelas > 1 ? ` em ${p.parcelas}x` : ''}</span> `)}</p>` : ''}
    ${n.titulos.length ? html `<table class="tabela compacta"><thead><tr><th>Tipo</th><th>Descrição</th><th>Vencimento</th><th class="n">Valor</th><th>Situação</th></tr></thead>
    <tbody>${n.titulos.map((t) => html `<tr><td>${rotulo(t.tipo)}</td><td>${t.descricao}</td><td>${data(t.vencimento)}</td><td class="n">${moeda(t.valor)}</td><td>${selo(t.status)}</td></tr>`)}</tbody></table>` : html `<p class="mudo">Sem títulos financeiros.</p>`}
  </section>
  ${n.obs ? html `<section class="bloco"><h2>Observações</h2><p>${n.obs}</p></section>` : ''}`);
    const recarregar = () => detalhe(el, id);
    acoes(el, {
        cancelar: () => {
            const m = modal('Cancelar negociação', html `<form id="f-canc"><p>O veículo volta ao estoque (venda) ou sai dele (compra/consignação), e os títulos em aberto são cancelados.</p>
        <div class="grade-form">${campos([{ nome: 'motivo', rotulo: 'Motivo', tipo: 'area', obrigatorio: true, largura: 4 }])}</div>
        <div class="acoes-form"><button type="button" class="sec" data-fechar>Voltar</button><button type="submit" class="perigo">Cancelar negociação</button></div></form>`);
            aoEnviar($('#f-canc', m.el), async (d) => { await api.post(`/api/negociacoes/${id}/cancelar`, d); m.fechar(); aviso('Negociação cancelada.'); recarregar(); });
        },
        emitir: async () => {
            if (nfePendente) {
                const r = await api.post(`/api/nfes/${nfePendente.id}/transmitir`);
                aviso(r.status === 'autorizada' ? `NF-e ${r.numero} autorizada.` : `${rotulo(r.status)}: ${r.xmotivo ?? ''}`, r.status === 'autorizada' ? 'ok' : 'erro');
                return recarregar();
            }
            const p = await api.get(`/api/negociacoes/${id}/nfe/previa`);
            const m = modal('Emitir NF-e', html `
        ${p.ambiente === 2 ? html `<p class="alerta-caixa">Ambiente de homologação: a nota não tem valor fiscal.</p>` : ''}
        <dl class="dados"><dt>Número</dt><dd>${p.numero}</dd><dt>Natureza</dt><dd>${p.natureza}</dd><dt>CFOP</dt><dd>${p.cfop}</dd><dt>Destinatário</dt><dd>${p.destinatario}</dd>
        <dt>Valor da nota</dt><dd>${moeda(p.totais.vNF)}</dd><dt>ICMS</dt><dd>${moeda(p.totais.vICMS)}</dd></dl>
        <p class="mudo">${p.infCpl}</p>
        <form id="f-nfe">${n.tipo === 'devolucao_consignacao' ? campos([{ nome: 'chave_referencia', rotulo: 'Chave da NF-e de entrada (se não foi emitida aqui)', largura: 4 }]) : ''}
        <div class="acoes-form"><button type="button" class="sec" data-fechar>Voltar</button><button type="submit">Emitir e transmitir</button></div></form>`, { largo: true });
            aoEnviar($('#f-nfe', m.el), async (d) => {
                const r = await api.post(`/api/negociacoes/${id}/nfe`, d);
                m.fechar();
                aviso(r.status === 'autorizada' ? `NF-e ${r.numero} autorizada.` : `${rotulo(r.status)}: ${r.cstat ?? ''} ${r.xmotivo ?? ''}`, r.status === 'autorizada' ? 'ok' : 'erro');
                recarregar();
            });
        },
        'renave-saida': () => {
            const m = modal('Registrar saída no RENAVE', html `<form id="f-rs"><p>Com a saída registrada, o RENAVE comunica a transferência ao DETRAN e gera a ATPV-e para o comprador.</p>
        <div class="grade-form">${campos([
                { nome: 'km', rotulo: 'Km na entrega', tipo: 'numero', obrigatorio: true, largura: 2 },
                { nome: 'email', rotulo: 'E-mail do comprador', tipo: 'email', largura: 2, dica: 'Vazio usa o do cadastro.' },
            ], { km: n.km_entrega })}</div>
        <div class="acoes-form"><button type="button" class="sec" data-fechar>Voltar</button><button type="submit">Registrar saída</button></div></form>`);
            aoEnviar($('#f-rs', m.el), async (d) => { const r = await api.post(`/api/negociacoes/${id}/renave/saida`, d); m.fechar(); aviso(r.mensagem); recarregar(); });
        },
    });
}
