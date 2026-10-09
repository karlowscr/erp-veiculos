import { api, pode } from '../api.js';
import { html, montar, $, acoes, campos, aoEnviar, modal, aviso, confirmar, moeda, data, selo, cabecalhoPagina, segmentos, vazio, abrirImpressao, lerForm, pedirTexto, } from '../ui.js';
import { icone } from '../icones.js';
import { seletorPessoa } from './pessoas.js';
/** Cartão de contrato, usado aqui e na assinatura digital. */
export function cartaoContrato(c, rodape) {
    const venda = c.tipo === 'venda';
    const veiculo = [c.veiculo_marca, c.veiculo_modelo, c.veiculo_ano].filter(Boolean).join(' ');
    return html `<article class="cartao${c.assinado_em ? '' : ' pendente'}">
    <div class="cartao-topo">
      <span class="tile ${venda ? 'laranja' : 'azul'}">${icone(venda ? 'tendencia' : 'carrinho')}</span>
      <div class="cartao-titulo"><small>Nº ${c.numero}</small><b>${c.cliente_nome}</b></div>
      <div class="selos">${selo(venda ? 'venda' : 'compra', venda ? 'Venda' : 'Compra')}${c.assinado_em ? selo('assinado') : selo('aguardando', 'Pendente')}</div>
    </div>
    <ul class="info">
      ${veiculo ? html `<li>${icone('carro', 16)}${veiculo}${c.veiculo_placa ? html ` <span class="mudo">${c.veiculo_placa}</span>` : ''}</li>` : ''}
      <li>${icone('calendario', 16)}${data(c.data)}</li>
    </ul>
    <p class="valor">${moeda(c.valor)}</p>
    <footer class="cartao-acoes">${rodape}</footer>
  </article>`;
}
export async function render(el) {
    const f = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const tipo = f.get('tipo') ?? '';
    const q = f.get('q') ?? '';
    const lista = await api.get(`/api/contratos?tipo=${tipo}&q=${encodeURIComponent(q)}`);
    const total = lista.length;
    montar(el, html `
  ${cabecalhoPagina('Contratos', `${total} contrato${total === 1 ? '' : 's'}${q || tipo ? ' encontrados' : ' emitidos'}`, html `${pode('contratos.criar') ? html `<button data-acao="novo">${icone('mais')}Novo contrato</button>` : ''}`)}
  <div class="filtros">
    <label class="busca">${icone('busca')}<input type="search" id="q" value="${q}" placeholder="Buscar por nome, número, veículo…" aria-label="Buscar contratos"></label>
    ${segmentos('tipo', [['', 'Todos'], ['venda', 'Venda'], ['compra', 'Compra']], tipo)}
  </div>
  ${lista.length ? html `<div class="grade-cartoes">${lista.map((c) => cartaoContrato(c, html `
      ${c.assinado_em ? html `<span class="assinado-em">${icone('ok', 16)}Assinado</span>` : html `<a class="botao" href="#/assinaturas?id=${c.id}">${icone('caneta', 16)}Assinar</a>`}
      <button class="sec" data-acao="pdf" data-id="${c.id}" title="Abrir para imprimir ou salvar em PDF">${icone('download', 16)}PDF</button>
      ${c.tem_garantia ? html `<button class="sec verde" data-acao="garantia" data-id="${c.id}">${icone('garantia', 16)}Garantia</button>` : ''}
      <span class="espaco"></span>
      ${pode('contratos.editar') ? html `<button class="icone-btn" data-acao="editar" data-id="${c.id}" title="Editar" aria-label="Editar contrato ${c.numero}">${icone('lapis')}</button>` : ''}
      ${pode('contratos.excluir') ? html `<button class="icone-btn perigo" data-acao="excluir" data-id="${c.id}" data-num="${c.numero}" title="Excluir" aria-label="Excluir contrato ${c.numero}">${icone('lixeira')}</button>` : ''}`))}</div>`
        : vazio(q || tipo ? 'Nenhum contrato encontrado com esses filtros.' : 'Nenhum contrato ainda. Crie o primeiro ou gere a partir de uma venda em Negociações.', html `${pode('contratos.criar') ? html `<button data-acao="novo">${icone('mais')}Novo contrato</button>` : ''}`)}`);
    const ir = (nq = q, nt = tipo) => (location.hash = `#/contratos?tipo=${nt}&q=${encodeURIComponent(nq)}`);
    let tempo;
    $('#q', el).addEventListener('input', (e) => { clearTimeout(tempo); tempo = window.setTimeout(() => ir(e.target.value), 350); });
    acoes(el, {
        novo: () => formularioContrato(),
        pdf: (b) => abrirImpressao(`/api/contratos/${b.dataset.id}/imprimir`),
        garantia: (b) => abrirImpressao(`/api/contratos/${b.dataset.id}/garantia`),
        editar: async (b) => formularioContrato(await api.get(`/api/contratos/${b.dataset.id}`)),
        excluir: async (b) => {
            if (!(await confirmar(`Excluir o contrato ${b.dataset.num}? Esta ação não pode ser desfeita.`, 'Excluir contrato')))
                return;
            await api.del(`/api/contratos/${b.dataset.id}`);
            aviso('Contrato excluído.');
            render(el);
        },
    });
    el.querySelectorAll('[data-seg="tipo"]').forEach((bt) => bt.addEventListener('click', () => ir(q, bt.dataset.valor)));
}
/** Formulário de contrato (novo ou edição). */
export async function formularioContrato(c) {
    const editando = !!c;
    const assinado = !!c?.assinado_em;
    const base = c ?? await api.get('/api/contratos/modelo?tipo=venda');
    const veiculos = await api.get('/api/veiculos');
    const m = modal(editando ? `Contrato ${c.numero}` : 'Novo contrato', html `
  <form id="f-contrato" class="form-secoes">
    ${assinado ? html `<p class="alerta-caixa">Este contrato já foi assinado. Só as observações podem ser alteradas; para mudar o conteúdo, remova a assinatura (gerente) e assine de novo.</p>` : ''}
    <fieldset ${assinado ? 'disabled' : ''}>
      <div class="grade-form">${campos([
        { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: [['venda', 'Venda (a loja vende)'], ['compra', 'Compra (a loja compra)']], largura: 2 },
        { nome: 'data', rotulo: 'Data', tipo: 'data', obrigatorio: true, largura: 1 },
        { nome: 'cidade', rotulo: 'Cidade', largura: 1 },
    ], base)}</div>
      <h3 data-rotulo-cliente>${base.tipo === 'compra' ? 'Vendedor (cliente)' : 'Comprador (cliente)'}</h3>
      <div class="grade-form"><div class="l4" id="sel-cliente"></div>${campos([
        { nome: 'cliente_nome', rotulo: 'Nome completo', obrigatorio: true, largura: 2 },
        { nome: 'cliente_doc', rotulo: 'CPF/CNPJ', largura: 1 },
        { nome: 'cliente_rg', rotulo: 'RG', largura: 1 },
        { nome: 'cliente_endereco', rotulo: 'Endereço', largura: 3 },
        { nome: 'cliente_telefone', rotulo: 'Telefone', largura: 1 },
    ], base)}</div>
      <h3>Veículo</h3>
      <div class="grade-form">
        <div class="campo l4"><label for="f_veic">Puxar dados de um veículo cadastrado</label><select id="f_veic" name="veiculo_id"><option value="">Não vincular</option>
          ${veiculos.map((v) => html `<option value="${v.id}" ${String(v.id) === String(base.veiculo_id ?? '') ? 'selected' : ''}>${v.placa || '0 km'} — ${v.marca} ${v.modelo} ${v.ano_mod}</option>`)}</select></div>
        ${campos([
        { nome: 'veiculo_marca', rotulo: 'Marca', largura: 1 },
        { nome: 'veiculo_modelo', rotulo: 'Modelo', obrigatorio: true, largura: 2 },
        { nome: 'veiculo_ano', rotulo: 'Ano', largura: 1 },
        { nome: 'veiculo_cor', rotulo: 'Cor', largura: 1 },
        { nome: 'veiculo_placa', rotulo: 'Placa', largura: 1 },
        { nome: 'veiculo_renavam', rotulo: 'RENAVAM', largura: 1 },
        { nome: 'veiculo_km', rotulo: 'Km', largura: 1 },
        { nome: 'veiculo_chassi', rotulo: 'Chassi', largura: 4 },
    ], base)}
      </div>
      <h3>Valores</h3>
      <div class="grade-form">${campos([
        { nome: 'valor', rotulo: 'Valor total', tipo: 'moeda', obrigatorio: true, largura: 1 },
        { nome: 'forma_pagamento', rotulo: 'Forma de pagamento', largura: 3, dica: 'Ex.: R$ 8.000 de entrada no Pix + 10x de R$ 1.000 no carnê' },
    ], base)}</div>
      <h3>Cláusulas e garantia</h3>
      <div class="grade-form">${campos([
        { nome: 'clausulas', rotulo: 'Cláusulas', tipo: 'area', largura: 4, attrs: 'rows="8"' },
        { nome: 'garantia_texto', rotulo: 'Termo de garantia (deixe vazio se não houver)', tipo: 'area', largura: 4, attrs: 'rows="4"', dica: 'Use {LOJA} para inserir o nome da loja.' },
    ], base)}</div>
    </fieldset>
    <div class="grade-form">${campos([{ nome: 'obs', rotulo: 'Observações', tipo: 'area', largura: 4 }], base)}</div>
    <div class="acoes-form">${assinado && pode('contratos.excluir') ? html `<button type="button" class="sec perigo" data-remover-ass>Remover assinatura</button><span class="espaco"></span>` : ''}
      <button type="button" class="sec" data-fechar>Cancelar</button><button type="submit">${editando ? 'Salvar contrato' : 'Criar contrato'}</button></div>
  </form>`, { largo: true });
    const f = $('#f-contrato', m.el);
    const sel = $('#sel-cliente', m.el);
    if (!assinado) {
        seletorPessoa(sel, 'pessoa_id', 'Buscar cliente cadastrado', { inicial: base.pessoa_id ? { id: base.pessoa_id, nome: base.cliente_nome } : undefined });
        sel.addEventListener('escolhido', async (e) => {
            const p = await api.get(`/api/pessoas/${e.detail}`);
            const end = [[p.logradouro, p.numero].filter(Boolean).join(', '), p.complemento, p.bairro, [p.municipio, p.uf].filter(Boolean).join('/')].filter(Boolean).join(', ');
            const set = (n, v) => { f.elements.namedItem(n).value = v ?? ''; };
            set('cliente_nome', p.nome);
            set('cliente_doc', p.cpf_cnpj ?? '');
            set('cliente_rg', p.rg);
            set('cliente_endereco', end);
            set('cliente_telefone', p.telefone);
        });
    }
    const tipoSel = f.elements.namedItem('tipo');
    tipoSel.addEventListener('change', async () => {
        $('[data-rotulo-cliente]', m.el).textContent = tipoSel.value === 'compra' ? 'Vendedor (cliente)' : 'Comprador (cliente)';
        if (!editando) {
            const mod = await api.get(`/api/contratos/modelo?tipo=${tipoSel.value}`);
            f.elements.namedItem('clausulas').value = mod.clausulas;
            f.elements.namedItem('garantia_texto').value = mod.garantia_texto;
        }
    });
    $('#f_veic', m.el).addEventListener('change', async (e) => {
        const id = e.target.value;
        if (!id)
            return;
        const v = await api.get(`/api/veiculos/${id}`);
        const set = (n, val) => { f.elements.namedItem(n).value = String(val ?? ''); };
        set('veiculo_marca', v.marca);
        set('veiculo_modelo', [v.modelo, v.versao].filter(Boolean).join(' '));
        set('veiculo_ano', `${v.ano_fab}/${v.ano_mod}`);
        set('veiculo_cor', v.cor);
        set('veiculo_placa', v.placa);
        set('veiculo_renavam', v.renavam);
        set('veiculo_km', v.km);
        set('veiculo_chassi', v.chassi);
        if (!f.elements.namedItem('valor').value)
            set('valor', v.preco_venda);
    });
    m.el.querySelector('[data-remover-ass]')?.addEventListener('click', async () => {
        const motivo = await pedirTexto('Remover assinatura', 'Motivo (fica registrado na auditoria)', 'Remover assinatura');
        if (!motivo)
            return;
        await api.post(`/api/contratos/${c.id}/remover-assinatura`, { motivo });
        aviso('Assinatura removida. O contrato voltou para pendente.');
        m.fechar();
        window.dispatchEvent(new Event('hashchange'));
    });
    aoEnviar(f, async () => {
        const d = lerForm(f);
        if (editando)
            await api.put(`/api/contratos/${c.id}`, d);
        else
            await api.post('/api/contratos', d);
        aviso(editando ? 'Contrato salvo.' : 'Contrato criado.');
        m.fechar();
        window.dispatchEvent(new Event('hashchange'));
    });
}
