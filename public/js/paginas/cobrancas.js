import { api, pode } from '../api.js';
import { html, montar, $, acoes, campos, aoEnviar, modal, aviso, confirmar, moeda, data, selo, cabecalhoPagina, vazio, abrirImpressao, primeiraLetra, linkWhatsapp, mesAno, hoje, lerForm, telefone, } from '../ui.js';
import { icone } from '../icones.js';
import { seletorPessoa } from './pessoas.js';
let nomeLoja = '';
function mensagemWhatsapp(c) {
    const primeiro = String(c.cliente_nome).trim().split(/\s+/)[0];
    const nome = primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
    const parcela = `${c.parcelas_pagas + 1}/${c.total_parcelas}`;
    if (c.situacao === 'atrasado') {
        return `Olá, ${nome}! Aqui é da ${nomeLoja}. Consta em aberto a parcela ${parcela} de ${moeda(c.valor_parcela)} (${c.descricao}), vencida em ${data(c.proximo_vencimento)}. Pode nos enviar o comprovante ou combinar o pagamento por aqui?`;
    }
    return `Olá, ${nome}! Aqui é da ${nomeLoja}. Lembrete: a parcela ${parcela} de ${moeda(c.valor_parcela)} (${c.descricao}) vence em ${data(c.proximo_vencimento)}. Qualquer dúvida, estamos à disposição.`;
}
function linha(c) {
    const pct = Math.round((c.parcelas_pagas / c.total_parcelas) * 100);
    const atrasado = c.situacao === 'atrasado';
    const detalheVenc = c.situacao === 'quitado'
        ? html `<span>Quitado ${mesAno(c.primeiro_vencimento)} → ${mesAno(c.ultimo_vencimento)}</span>`
        : atrasado
            ? html `<span class="atraso">${icone('alerta', 14)}Venceu em ${data(c.proximo_vencimento)}, ${c.dias_atraso} dia${c.dias_atraso === 1 ? '' : 's'} em atraso${c.parcelas_atrasadas > 1 ? ` (${c.parcelas_atrasadas} parcelas)` : ''}</span>`
            : html `<span>Próx. venc. ${data(c.proximo_vencimento)}, ${mesAno(c.primeiro_vencimento)} → ${mesAno(c.ultimo_vencimento)}</span>`;
    return html `<article class="linha-cobranca ${atrasado ? 'atrasada' : ''}" data-id="${c.id}">
    <span class="avatar-letra">${primeiraLetra(c.cliente_nome)}</span>
    <div class="lc-info">
      <div class="lc-nome"><b>${c.cliente_nome}</b>${selo(c.situacao)}</div>
      <small>${[c.descricao, c.veiculo_info].filter(Boolean).join(' • ')}</small>
      ${detalheVenc}
    </div>
    <div class="lc-num"><span>Parcela</span><b>${moeda(c.valor_parcela)}</b></div>
    <div class="lc-prog"><span>Progresso</span><b>${c.parcelas_pagas}/${c.total_parcelas}</b><i class="barra-prog"><i style="width:${pct}%"></i></i></div>
    <div class="lc-acoes">
      ${c.situacao !== 'quitado' ? html `${pode('cobrancas.editar') ? html `<button class="icone-btn verde" data-acao="pagar" data-id="${c.id}" title="Registrar pagamento" aria-label="Registrar pagamento de ${c.cliente_nome}">${icone('check')}</button>` : ''}` : ''}
      <button class="icone-btn azul" data-acao="imprimir" data-id="${c.id}" title="Extrato para imprimir" aria-label="Imprimir extrato">${icone('impressora')}</button>
      ${c.cliente_telefone && c.situacao !== 'quitado' ? html `<a class="icone-btn verde" href="${linkWhatsapp(c.cliente_telefone, mensagemWhatsapp(c))}" target="_blank" rel="noopener" title="Cobrar pelo WhatsApp" aria-label="Enviar mensagem no WhatsApp">${icone('mensagem')}</a>` : ''}
      ${pode('cobrancas.editar') ? html `<button class="icone-btn" data-acao="editar" data-id="${c.id}" title="Editar" aria-label="Editar cobrança">${icone('lapis')}</button>` : ''}
      ${pode('cobrancas.excluir') ? html `<button class="icone-btn perigo" data-acao="excluir" data-id="${c.id}" title="Excluir" aria-label="Excluir cobrança">${icone('lixeira')}</button>` : ''}
    </div>
  </article>`;
}
export async function render(el) {
    const f = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const q = f.get('q') ?? '';
    const sit = f.get('situacao') ?? '';
    const [r, empresa] = await Promise.all([api.get(`/api/cobrancas?q=${encodeURIComponent(q)}&situacao=${sit}`), api.get('/api/empresa')]);
    nomeLoja = empresa.nome_fantasia || empresa.razao_social || 'loja';
    const { resumo, itens } = r;
    montar(el, html `
  ${cabecalhoPagina('Cobranças e parcelamentos', `${resumo.total} parcelamento${resumo.total === 1 ? '' : 's'} cadastrado${resumo.total === 1 ? '' : 's'}`, html `
    <button class="sec" data-acao="relatorio">${icone('download')}Relatório PDF</button>${pode('cobrancas.criar') ? html `<button data-acao="nova">${icone('mais')}Nova cobrança</button>` : ''}`)}
  <section class="stats">
    <div class="stat"><span class="tile laranja">${icone('cartao')}</span><div><span>A receber neste mês</span><b>${moeda(resumo.a_receber_mes)}</b></div></div>
    <button class="stat" data-filtro="atrasado"><span class="tile vermelho">${icone('alerta')}</span><div><span>Atrasados</span><b class="${resumo.atrasados ? 'neg' : ''}">${resumo.atrasados}</b></div></button>
    <div class="stat"><span class="tile amarelo">${icone('relogio')}</span><div><span>Vencendo em 7 dias</span><b>${resumo.vencendo_7_dias}</b></div></div>
    <div class="stat"><span class="tile verde">${icone('dinheiro')}</span><div><span>Saldo total a receber</span><b>${moeda(resumo.saldo_total)}</b></div></div>
  </section>
  <div class="filtros">
    <label class="busca">${icone('busca')}<input type="search" id="q" value="${q}" placeholder="Buscar cliente, descrição, veículo…" aria-label="Buscar cobranças"></label>
    <select id="sit" aria-label="Situação">${[['', 'Todas as situações'], ['atrasado', 'Atrasadas'], ['em_dia', 'Em dia'], ['quitado', 'Quitadas']].map(([v, t]) => html `<option value="${v}" ${v === sit ? 'selected' : ''}>${t}</option>`)}</select>
  </div>
  ${itens.length ? html `<div class="lista-cobrancas">${itens.map(linha)}</div>`
        : vazio(q || sit ? 'Nenhuma cobrança com esses filtros.' : 'Nenhum parcelamento cadastrado.', html `${pode('cobrancas.criar') ? html `<button data-acao="nova">${icone('mais')}Nova cobrança</button>` : ''}`)}`);
    const ir = (nq = q, ns = sit) => (location.hash = `#/cobrancas?q=${encodeURIComponent(nq)}&situacao=${ns}`);
    let tempo;
    $('#q', el).addEventListener('input', (e) => { clearTimeout(tempo); tempo = window.setTimeout(() => ir(e.target.value), 350); });
    $('#sit', el).addEventListener('change', (e) => ir(q, e.target.value));
    el.querySelector('[data-filtro]')?.addEventListener('click', () => ir(q, sit === 'atrasado' ? '' : 'atrasado'));
    const recarregar = () => { render(el); window.dispatchEvent(new Event('contadores')); };
    const porId = (id) => itens.find((c) => String(c.id) === id);
    acoes(el, {
        nova: () => formulario(undefined, recarregar),
        relatorio: () => abrirImpressao(`/api/cobrancas/relatorio?q=${encodeURIComponent(q)}&situacao=${sit}`),
        imprimir: (b) => abrirImpressao(`/api/cobrancas/${b.dataset.id}/imprimir`),
        editar: async (b) => formulario(await api.get(`/api/cobrancas/${b.dataset.id}`), recarregar),
        excluir: async (b) => {
            const c = porId(b.dataset.id);
            if (!(await confirmar(`Excluir a cobrança de ${c.cliente_nome} (${c.descricao})? Os recebimentos já lançados no financeiro continuam lá.`, 'Excluir cobrança')))
                return;
            await api.del(`/api/cobrancas/${b.dataset.id}`);
            aviso('Cobrança excluída.');
            recarregar();
        },
        pagar: (b) => pagamento(porId(b.dataset.id), recarregar),
    });
}
function pagamento(c, aoTerminar) {
    const restantes = c.total_parcelas - c.parcelas_pagas;
    const m = modal('Registrar pagamento', html `
    <p><b>${c.cliente_nome}</b><br><span class="mudo">${c.descricao}. Próxima parcela: ${c.parcelas_pagas + 1}/${c.total_parcelas}, vencimento ${data(c.proximo_vencimento)}.</span></p>
    <form id="f-pag"><div class="grade-form">${campos([
        { nome: 'quantidade', rotulo: 'Parcelas pagas agora', tipo: 'numero', obrigatorio: true, largura: 1, attrs: `min="1" max="${restantes}" step="1"` },
        { nome: 'valor', rotulo: 'Valor recebido', tipo: 'moeda', obrigatorio: true, largura: 1 },
        { nome: 'data', rotulo: 'Data', tipo: 'data', obrigatorio: true, largura: 1 },
        { nome: 'forma', rotulo: 'Forma', tipo: 'select', opcoes: [['pix', 'PIX'], ['dinheiro', 'Dinheiro'], ['transferencia', 'Transferência'], ['boleto', 'Boleto'], ['cartao_debito', 'Cartão de débito'], ['cartao_credito', 'Cartão de crédito']], largura: 1 },
    ], { quantidade: 1, valor: c.valor_parcela, data: hoje(), forma: 'pix' })}</div>
    <p class="mudo pequeno">O recebimento é lançado no Financeiro como conta recebida.</p>
    <div class="acoes-form"><button type="button" class="sec" data-fechar>Cancelar</button><button type="submit">${icone('check', 16)}Registrar pagamento</button></div></form>`);
    const f = $('#f-pag', m.el);
    const qtd = f.elements.namedItem('quantidade');
    qtd.addEventListener('input', () => { f.elements.namedItem('valor').value = String(Math.round(c.valor_parcela * Number(qtd.value || 1) * 100) / 100); });
    aoEnviar(f, async (d) => {
        const r = await api.post(`/api/cobrancas/${c.id}/pagar`, d);
        m.fechar();
        aviso(r.situacao === 'quitado' ? `${c.cliente_nome}: parcelamento quitado.` : 'Pagamento registrado.');
        aoTerminar();
        // Oferece o recibo com a logo da loja das parcelas que acabaram de ser pagas
        const det = await api.get(`/api/cobrancas/${c.id}`);
        const novos = (det.pagamentos ?? []).filter((p) => p.titulo_id).slice(-Number(d.quantidade || 1));
        if (novos.length) {
            modal('Recibo do pagamento', html `<p>Pagamento de <b>${c.cliente_nome}</b> registrado. Imprima ou salve o recibo em PDF para enviar ao cliente.</p>
        <div class="botoes">${novos.map((p) => html `<a class="botao" href="/api/cobrancas/${c.id}/recibo/${p.id}" target="_blank" rel="noopener">${icone('impressora', 16)}Recibo parcela ${p.parcela}</a>`)}</div>
        <div class="acoes-form"><button type="button" class="sec" data-fechar>Fechar</button></div>`);
        }
    });
}
async function formulario(c, aoTerminar) {
    const editando = !!c;
    const base = c ?? { total_parcelas: 1, parcelas_pagas: 0 };
    const m = modal(editando ? 'Editar cobrança' : 'Nova cobrança', html `
  <form id="f-cob">
    <div class="grade-form"><div class="l4" id="sel-cli"></div>${campos([
        { nome: 'cliente_telefone', rotulo: 'WhatsApp / telefone do cliente', largura: 2, attrs: 'inputmode="tel"' },
        { nome: 'veiculo_info', rotulo: 'Veículo (modelo, placa)', largura: 2 },
        { nome: 'descricao', rotulo: 'Descrição', obrigatorio: true, largura: 4, dica: 'Ex.: Financiamento Titan 150 2020' },
        { nome: 'total_parcelas', rotulo: 'Nº de parcelas', tipo: 'numero', obrigatorio: true, largura: 1, attrs: 'min="1" step="1"' },
        { nome: 'valor_parcela', rotulo: 'Valor da parcela', tipo: 'moeda', obrigatorio: true, largura: 1 },
        { nome: 'primeiro_vencimento', rotulo: '1º vencimento', tipo: 'data', obrigatorio: true, largura: 1, dica: 'As demais vencem no mesmo dia dos meses seguintes.' },
        { nome: 'parcelas_pagas', rotulo: 'Parcelas já pagas', tipo: 'numero', largura: 1, attrs: 'min="0" step="1"' },
        { nome: 'obs', rotulo: 'Observações', tipo: 'area', largura: 4 },
    ], base)}</div>
    <p class="total-calc" aria-live="polite"></p>
    ${editando && c.pagamentos?.length ? html `<h3>Pagamentos registrados no sistema</h3><table class="tabela compacta"><tbody>${c.pagamentos.map((p) => html `<tr><td>Parcela ${p.parcela}</td><td>${data(p.data)}</td><td class="n">${moeda(p.valor)}</td><td class="n">${p.titulo_id ? html `<a class="link" href="/api/cobrancas/${c.id}/recibo/${p.id}" target="_blank" rel="noopener">Recibo</a>` : ''}</td></tr>`)}</tbody></table>
      ${pode('cobrancas.excluir') ? html `<button type="button" class="sec" data-estornar>${icone('estorno', 16)}Estornar último pagamento</button>` : ''}` : ''}
    <div class="acoes-form"><button type="button" class="sec" data-fechar>Cancelar</button><button type="submit">${editando ? 'Salvar' : 'Criar cobrança'}</button></div>
  </form>`, { largo: true });
    const f = $('#f-cob', m.el);
    const sel = $('#sel-cli', m.el);
    seletorPessoa(sel, 'pessoa_id', 'Cliente', { obrigatorio: true, inicial: base.pessoa_id ? { id: base.pessoa_id, nome: base.cliente_nome } : undefined });
    sel.addEventListener('escolhido', async (e) => {
        const p = await api.get(`/api/pessoas/${e.detail}`);
        const tel = f.elements.namedItem('cliente_telefone');
        if (!tel.value)
            tel.value = telefone(p.telefone);
    });
    const total = () => {
        const n = Number(f.elements.namedItem('total_parcelas').value || 0);
        const v = Number(f.elements.namedItem('valor_parcela').value || 0);
        $('.total-calc', m.el).innerHTML = n && v ? html `Total: <b>${moeda(n * v)}</b> em ${n}x de ${moeda(v)}`.s : '';
    };
    f.addEventListener('input', total);
    total();
    m.el.querySelector('[data-estornar]')?.addEventListener('click', async () => {
        if (!(await confirmar('Estornar o último pagamento registrado? O recebimento lançado no financeiro será cancelado.', 'Estornar')))
            return;
        await api.post(`/api/cobrancas/${c.id}/estornar`);
        aviso('Pagamento estornado.');
        m.fechar();
        aoTerminar();
    });
    aoEnviar(f, async () => {
        const d = lerForm(f);
        if (!d.pessoa_id && !editando)
            throw new Error('Selecione o cliente (ou cadastre um novo).');
        if (editando)
            await api.put(`/api/cobrancas/${c.id}`, d);
        else
            await api.post('/api/cobrancas', d);
        aviso(editando ? 'Cobrança salva.' : 'Cobrança criada.');
        m.fechar();
        aoTerminar();
    });
}
