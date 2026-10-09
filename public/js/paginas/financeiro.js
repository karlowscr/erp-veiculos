import { api, pode } from '../api.js';
import { html, montar, $, acoes, campos, aoEnviar, modal, aviso, confirmar, moeda, data, selo, rotulo, hoje, vazio, abrirImpressao } from '../ui.js';
import { seletorPessoa } from './pessoas.js';
const CATEGORIAS = {
    venda_veiculo: 'Venda de veículo', compra_veiculo: 'Compra de veículo', preparacao_veiculo: 'Preparação de veículo',
    repasse_consignacao: 'Repasse de consignação', comissao: 'Comissões', aluguel: 'Aluguel', salarios: 'Salários',
    impostos: 'Impostos', marketing: 'Marketing', despachante: 'Despachante', outros: 'Outros',
};
export async function render(el, params) {
    const aba = params[0]?.split('?')[0] || (pode('financeiro.ver') ? 'titulos' : 'comissoes');
    const abas = html `<nav class="abas" aria-label="Seções do financeiro">
    ${pode('financeiro.ver') ? html `<a href="#/financeiro/titulos" ${aba === 'titulos' ? 'aria-current' : ''}>Contas a pagar e receber</a><a href="#/financeiro/resumo" ${aba === 'resumo' ? 'aria-current' : ''}>Resumo do período</a>` : ''}
    <a href="#/financeiro/comissoes" ${aba === 'comissoes' ? 'aria-current' : ''}>Comissões</a></nav>`;
    if (aba === 'resumo')
        return resumo(el, abas);
    if (aba === 'comissoes')
        return comissoes(el, abas);
    return titulos(el, abas);
}
async function titulos(el, abas) {
    const f = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const tipo = f.get('tipo') ?? '';
    const status = f.get('status') ?? 'aberto';
    const q = f.get('q') ?? '';
    const lista = await api.get(`/api/titulos?tipo=${tipo}&status=${status === 'todos' ? '' : status}&q=${encodeURIComponent(q)}`);
    const soma = (t) => lista.filter((x) => x.tipo === t).reduce((s, x) => s + (x.status === 'pago' ? x.valor_pago : x.valor), 0);
    const hj = hoje();
    montar(el, html `
  <header class="topo-pagina"><h1>Financeiro</h1><div class="botoes">${pode('financeiro.lancar') ? html `<button data-acao="novo">Novo lançamento</button>` : ''}</div></header>
  ${abas}
  <form class="filtros" id="f-filtro">
    <select name="tipo" aria-label="Tipo">${[['', 'Pagar e receber'], ['receber', 'A receber'], ['pagar', 'A pagar']].map(([v, t]) => html `<option value="${v}" ${v === tipo ? 'selected' : ''}>${t}</option>`)}</select>
    <select name="status" aria-label="Situação">${[['aberto', 'Em aberto'], ['vencido', 'Vencidos'], ['pago', 'Pagos'], ['cancelado', 'Cancelados'], ['todos', 'Todos']].map(([v, t]) => html `<option value="${v}" ${v === status ? 'selected' : ''}>${t}</option>`)}</select>
    <input type="search" name="q" value="${q}" placeholder="Descrição ou pessoa" aria-label="Buscar">
    <button class="sec" type="submit">Filtrar</button>
  </form>
  <p class="mudo">A receber: <b>${moeda(soma('receber'))}</b>. A pagar: <b>${moeda(soma('pagar'))}</b>.</p>
  ${lista.length ? html `<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Vencimento</th><th>Tipo</th><th>Descrição</th><th>Pessoa</th><th>Categoria</th><th class="n">Valor</th><th>Situação</th><th></th></tr></thead>
  <tbody>${lista.map((t) => {
        const vencido = t.status === 'aberto' && t.vencimento < hj;
        return html `<tr class="${vencido ? 'vencido' : ''}"><td>${data(t.vencimento)}</td><td>${selo(t.tipo === 'receber' ? 'ok' : 'aviso', rotulo(t.tipo))}</td><td>${t.descricao}</td><td>${t.pessoa_nome ?? ''}</td>
    <td>${CATEGORIAS[t.categoria] ?? t.categoria}</td><td class="n">${moeda(t.status === 'pago' ? t.valor_pago : t.valor)}</td>
    <td>${vencido ? selo('vencido') : selo(t.status)}${t.pago_em ? html `<small> ${data(t.pago_em)}</small>` : ''}</td>
    <td class="n">${t.status === 'aberto' ? html `${pode('financeiro.baixar') ? html `<button class="link" data-acao="baixar" data-id="${t.id}" data-valor="${t.valor}" data-tipo="${t.tipo}">${t.tipo === 'receber' ? 'Receber' : 'Pagar'}</button>` : ''}${t.negociacao_id || !pode('financeiro.estornar') ? '' : html ` <button class="link" data-acao="cancelar" data-id="${t.id}">Cancelar</button>`}` : ''}
    ${t.status === 'pago' ? html `<button class="link" data-acao="recibo" data-id="${t.id}">${t.tipo === 'receber' ? 'Recibo' : 'Comprovante'}</button> ` : ''}
    ${t.status === 'pago' && pode('financeiro.estornar') ? html `<button class="link" data-acao="estornar" data-id="${t.id}">Estornar</button>` : ''}</td></tr>`;
    })}</tbody></table></div>` : vazio('Nenhum título com esses filtros.')}`);
    $('#f-filtro', el).addEventListener('submit', (e) => {
        e.preventDefault();
        const d = new FormData(e.target);
        location.hash = `#/financeiro/titulos?tipo=${d.get('tipo')}&status=${d.get('status')}&q=${encodeURIComponent(String(d.get('q')))}`;
    });
    const recarregar = () => titulos(el, abas);
    acoes(el, {
        recibo: (b) => abrirImpressao(`/api/titulos/${b.dataset.id}/recibo`),
        baixar: (b) => {
            const m = modal(b.dataset.tipo === 'receber' ? 'Registrar recebimento' : 'Registrar pagamento', html `<form id="f-baixa"><div class="grade-form">${campos([
                { nome: 'valor_pago', rotulo: 'Valor', tipo: 'moeda', obrigatorio: true, largura: 2 },
                { nome: 'data', rotulo: 'Data', tipo: 'data', obrigatorio: true, largura: 2 },
                { nome: 'forma', rotulo: 'Forma', tipo: 'select', opcoes: [['pix', 'PIX'], ['dinheiro', 'Dinheiro'], ['transferencia', 'Transferência'], ['boleto', 'Boleto'], ['cartao_credito', 'Cartão de crédito'], ['cartao_debito', 'Cartão de débito'], ['cheque', 'Cheque']], largura: 4 },
            ], { valor_pago: b.dataset.valor, data: hoje() })}</div><div class="acoes-form"><button type="button" class="sec" data-fechar>Voltar</button><button type="submit">Confirmar</button></div></form>`);
            aoEnviar($('#f-baixa', m.el), async (d) => { await api.post(`/api/titulos/${b.dataset.id}/baixar`, d); m.fechar(); aviso('Baixa registrada.'); recarregar(); });
        },
        estornar: async (b) => { if (await confirmar('Estornar esta baixa? O título volta a ficar em aberto.', 'Estornar')) {
            await api.post(`/api/titulos/${b.dataset.id}/estornar`);
            aviso('Baixa estornada.');
            recarregar();
        } },
        cancelar: async (b) => { if (await confirmar('Cancelar este título?', 'Cancelar título')) {
            await api.post(`/api/titulos/${b.dataset.id}/cancelar`);
            recarregar();
        } },
        novo: () => {
            const m = modal('Novo lançamento', html `<form id="f-tit"><div class="grade-form">${campos([
                { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: [['pagar', 'Conta a pagar'], ['receber', 'Conta a receber']], largura: 2 },
                { nome: 'categoria', rotulo: 'Categoria', tipo: 'select', opcoes: Object.entries(CATEGORIAS).filter(([k]) => !['venda_veiculo', 'compra_veiculo', 'repasse_consignacao', 'comissao'].includes(k)), largura: 2 },
                { nome: 'descricao', rotulo: 'Descrição', obrigatorio: true, largura: 4 },
                { nome: 'valor', rotulo: 'Valor total', tipo: 'moeda', obrigatorio: true, largura: 1 },
                { nome: 'parcelas', rotulo: 'Parcelas', tipo: 'numero', largura: 1 },
                { nome: 'vencimento', rotulo: 'Primeiro vencimento', tipo: 'data', obrigatorio: true, largura: 2 },
            ], { parcelas: 1, vencimento: hoje() })}<div class="l4" id="sel-p"></div></div>
      <div class="acoes-form"><button type="button" class="sec" data-fechar>Voltar</button><button type="submit">Lançar</button></div></form>`);
            seletorPessoa($('#sel-p', m.el), 'pessoa_id', 'Pessoa (opcional)');
            aoEnviar($('#f-tit', m.el), async (d) => { await api.post('/api/titulos', d); m.fechar(); aviso('Lançamento criado.'); recarregar(); });
        },
    });
}
async function resumo(el, abas) {
    const f = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const de = f.get('de') ?? hoje().slice(0, 8) + '01';
    const ate = f.get('ate') ?? hoje();
    const r = await api.get(`/api/financeiro/resumo?de=${de}&ate=${ate}`);
    const saldo = r.recebido - r.pago;
    montar(el, html `
  <header class="topo-pagina"><h1>Financeiro</h1></header>${abas}
  <form class="filtros" id="f-per"><label>De <input type="date" name="de" value="${de}"></label><label>até <input type="date" name="ate" value="${ate}"></label><button class="sec" type="submit">Atualizar</button></form>
  <section class="faixa-numeros">
    <div><span>Recebido</span><b>${moeda(r.recebido)}</b></div>
    <div><span>Pago</span><b>${moeda(r.pago)}</b></div>
    <div><span>Saldo do período</span><b class="${saldo < 0 ? 'neg' : ''}">${moeda(saldo)}</b></div>
    <div><span>Vencidos</span><b class="${r.vencidos_receber + r.vencidos_pagar ? 'neg' : ''}">${moeda(r.vencidos_receber)}</b><small>a receber; ${moeda(r.vencidos_pagar)} a pagar</small></div>
  </section>
  <section class="bloco"><h2>Por categoria</h2>
  ${r.por_categoria.length ? html `<table class="tabela compacta"><tbody>${r.por_categoria.map((c) => html `<tr><td>${rotulo(c.tipo)}</td><td>${CATEGORIAS[c.categoria] ?? c.categoria}</td><td class="n">${moeda(c.total)}</td></tr>`)}</tbody></table>` : html `<p class="mudo">Sem movimentação no período.</p>`}
  </section>
  <p class="mudo">Em aberto no total: ${moeda(r.a_receber)} a receber e ${moeda(r.a_pagar)} a pagar.</p>`);
    $('#f-per', el).addEventListener('submit', (e) => {
        e.preventDefault();
        const d = new FormData(e.target);
        location.hash = `#/financeiro/resumo?de=${d.get('de')}&ate=${d.get('ate')}`;
    });
}
async function comissoes(el, abas) {
    const lista = await api.get('/api/comissoes');
    const pend = lista.filter((c) => c.status === 'pendente');
    const podePagar = pode('comissoes.pagar');
    montar(el, html `
  <header class="topo-pagina"><h1>Financeiro</h1></header>${abas}
  <p class="mudo">Pendente: <b>${moeda(pend.reduce((s, c) => s + c.valor, 0))}</b> em ${pend.length} venda(s).</p>
  ${lista.length ? html `<form id="f-com"><div class="tabela-rolagem"><table class="tabela"><thead><tr>${podePagar ? html `<th><span class="oculto">Selecionar</span></th>` : ''}<th>Data da venda</th><th>Vendedor</th><th>Veículo</th><th class="n">Venda</th><th class="n">Comissão</th><th>Situação</th></tr></thead>
  <tbody>${lista.map((c) => html `<tr>${podePagar ? html `<td>${c.status === 'pendente' ? html `<input type="checkbox" name="ids" value="${c.id}" aria-label="Selecionar comissão">` : ''}</td>` : ''}
    <td>${data(c.data)}</td><td>${c.vendedor_nome}</td><td>${c.marca} ${c.modelo} ${c.placa}</td><td class="n">${moeda(c.valor_final)}</td><td class="n">${moeda(c.valor)}</td><td>${selo(c.status)}${c.pago_em ? html `<small> ${data(c.pago_em)}</small>` : ''}</td></tr>`)}</tbody></table></div>
  ${podePagar && pend.length ? html `<div class="acoes-form"><button type="submit">Pagar selecionadas</button></div>` : ''}</form>` : vazio('As comissões aparecem aqui quando as vendas são registradas.')}`);
    $('#f-com', el)?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ids = [...e.target.querySelectorAll('input[name=ids]:checked')].map((i) => Number(i.value));
        if (!ids.length)
            return aviso('Selecione as comissões.', 'erro');
        if (!(await confirmar(`Registrar o pagamento de ${ids.length} comissão(ões)? Será lançada uma despesa paga hoje por vendedor.`, 'Pagar comissões')))
            return;
        try {
            await api.post('/api/comissoes/pagar', { ids });
            aviso('Comissões pagas.');
            comissoes(el, abas);
        }
        catch (er) {
            aviso(er.message, 'erro');
        }
    });
}
