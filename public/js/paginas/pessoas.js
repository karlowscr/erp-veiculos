import { api, pode } from '../api.js';
import { html, montar, $, acoes, campos, aoEnviar, modal, aviso, confirmar, doc, data, moeda, rotulo, selo, buscarCep, vazio, UFS, cabecalhoPagina, segmentos, primeiraLetra, telefone, linkWhatsapp } from '../ui.js';
import { icone } from '../icones.js';
const camposPessoa = () => [
    { nome: 'cpf_cnpj', rotulo: 'CPF ou CNPJ', largura: 1, attrs: 'inputmode="numeric"', dica: 'Obrigatório para nota fiscal e RENAVE.' },
    { nome: 'nome', rotulo: 'Nome ou razão social', obrigatorio: true, largura: 3 },
    { nome: 'rg', rotulo: 'RG', largura: 1 },
    { nome: 'ie', rotulo: 'Inscrição estadual', largura: 1, dica: 'Só empresas. Escreva ISENTO se for o caso.' },
    { nome: 'telefone', rotulo: 'Telefone', largura: 1, attrs: 'inputmode="tel"' },
    { nome: 'email', rotulo: 'E-mail', tipo: 'email', largura: 1, dica: 'Exigido pelo RENAVE na venda.' },
    { nome: 'cep', rotulo: 'CEP', largura: 1, attrs: 'inputmode="numeric" data-cep' },
    { nome: 'logradouro', rotulo: 'Logradouro', largura: 2 },
    { nome: 'numero', rotulo: 'Número', largura: 1 },
    { nome: 'complemento', rotulo: 'Complemento', largura: 1 },
    { nome: 'bairro', rotulo: 'Bairro', largura: 1 },
    { nome: 'municipio', rotulo: 'Município', largura: 1 },
    { nome: 'uf', rotulo: 'UF', tipo: 'select', opcoes: [['', ''], ...UFS], largura: 1 },
    { nome: 'cod_municipio', rotulo: 'Código IBGE do município', largura: 1, dica: 'Preenchido pelo CEP.' },
    { nome: 'nascimento', rotulo: 'Nascimento', tipo: 'data', largura: 1 },
    { nome: 'cliente', rotulo: 'Cliente', tipo: 'check', largura: 1 },
    { nome: 'fornecedor', rotulo: 'Fornecedor / banco / financeira', tipo: 'check', largura: 2 },
    { nome: 'obs', rotulo: 'Observações', tipo: 'area', largura: 4 },
];
/** Abre o cadastro (novo ou edição). Resolve com o id salvo. */
export function editarPessoa(p = { cliente: true }) {
    return new Promise((ok) => {
        const m = modal(p.id ? 'Editar cadastro' : 'Novo cadastro', html `<form id="f-pessoa"><div class="grade-form">${campos(camposPessoa(), p)}</div>
      <div class="acoes-form"><button class="sec" type="button" data-fechar>Voltar</button><button type="submit">Salvar cadastro</button></div></form>`, { largo: true });
        const f = $('#f-pessoa', m.el);
        f.querySelector('[data-cep]').addEventListener('blur', () => buscarCep(f));
        aoEnviar(f, async (d) => {
            let id = p.id;
            if (id)
                await api.put(`/api/pessoas/${id}`, d);
            else
                id = (await api.post('/api/pessoas', d)).id;
            aviso('Cadastro salvo.');
            m.fechar();
            ok(id);
        });
        m.el.addEventListener('close', () => ok(undefined));
    });
}
/**
 * Campo de escolha de pessoa com busca. Grava o id num input hidden `nome`.
 */
export function seletorPessoa(alvo, nome, rotuloCampo, op = {}) {
    montar(alvo, html `<div class="seletor"><label>${rotuloCampo}${op.obrigatorio ? html `<span class="obr" aria-hidden="true">*</span>` : ''}</label>
    <div class="seletor-linha"><input type="search" placeholder="Digite nome ou CPF/CNPJ" autocomplete="off" aria-label="${rotuloCampo}" value="${op.inicial?.nome ?? ''}">
    <button type="button" class="sec" data-novo>Cadastrar</button></div>
    <input type="hidden" name="${nome}" value="${op.inicial?.id ?? ''}"><ul class="sugestoes" hidden role="listbox"></ul></div>`);
    const busca = alvo.querySelector('input[type=search]');
    const oculto = alvo.querySelector('input[type=hidden]');
    const lista = alvo.querySelector('.sugestoes');
    let tempo;
    busca.addEventListener('input', () => {
        oculto.value = '';
        clearTimeout(tempo);
        tempo = window.setTimeout(async () => {
            if (busca.value.trim().length < 2) {
                lista.hidden = true;
                return;
            }
            const r = await api.get(`/api/pessoas?q=${encodeURIComponent(busca.value)}&papel=${op.papel ?? ''}`);
            lista.innerHTML = r.length
                ? r.slice(0, 8).map((p) => html `<li role="option" tabindex="0" data-id="${p.id}" data-nome="${p.nome}"><b>${p.nome}</b> <small>${doc(p.cpf_cnpj)} ${p.municipio ? '— ' + p.municipio + '/' + p.uf : ''}</small></li>`.s).join('')
                : '<li class="mudo">Ninguém encontrado. Use Cadastrar.</li>';
            lista.hidden = false;
        }, 250);
    });
    const escolher = (li) => {
        oculto.value = li.dataset.id;
        busca.value = li.dataset.nome;
        lista.hidden = true;
        alvo.dispatchEvent(new CustomEvent('escolhido', { detail: Number(li.dataset.id) }));
    };
    lista.addEventListener('click', (e) => { const li = e.target.closest('li[data-id]'); if (li)
        escolher(li); });
    lista.addEventListener('keydown', (e) => { const li = e.target.closest('li[data-id]'); if (li && e.key === 'Enter') {
        e.preventDefault();
        escolher(li);
    } });
    alvo.querySelector('[data-novo]').addEventListener('click', async () => {
        const id = await editarPessoa({ cliente: op.papel !== 'fornecedor', fornecedor: op.papel === 'fornecedor' });
        if (!id)
            return;
        const p = await api.get(`/api/pessoas/${id}`);
        oculto.value = String(id);
        busca.value = p.nome;
        alvo.dispatchEvent(new CustomEvent('escolhido', { detail: id }));
    });
}
export async function render(el, params) {
    if (params[0])
        return detalhe(el, Number(params[0]));
    const filtro = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const q = filtro.get('q') ?? '';
    const papel = filtro.get('papel') ?? '';
    const lista = await api.get(`/api/pessoas?q=${encodeURIComponent(q)}&papel=${papel}`);
    const local = (p) => [p.logradouro && !p.municipio ? p.logradouro : '', p.municipio, p.uf].filter(Boolean).join(', ');
    montar(el, html `
  ${cabecalhoPagina('Clientes', `${lista.length} cadastro${lista.length === 1 ? '' : 's'}${q || papel ? ' encontrados' : ''}`, html `${pode('clientes.criar') ? html `<button data-acao="novo">${icone('mais')}Novo cliente</button>` : ''}`)}
  <div class="filtros">
    <label class="busca">${icone('busca')}<input type="search" id="q" value="${q}" placeholder="Buscar por nome, CPF, telefone…" aria-label="Buscar clientes"></label>
    ${segmentos('papel', [['', 'Todos'], ['cliente', 'Clientes'], ['fornecedor', 'Fornecedores']], papel)}
  </div>
  ${lista.length ? html `<div class="grade-cartoes">${lista.map((p) => html `<article class="cartao clicavel" data-acao="abrir" data-id="${p.id}" tabindex="0">
    <div class="cartao-topo"><span class="tile laranja letra">${primeiraLetra(p.nome)}</span>
      <div class="cartao-titulo"><b>${p.nome}</b><small>${p.cpf_cnpj ? (p.tipo === 'PJ' ? 'CNPJ ' : 'CPF ') + doc(p.cpf_cnpj) : 'Sem CPF/CNPJ'}</small></div>
      <div class="acoes-topo">
        ${pode('clientes.editar') ? html `<button class="icone-btn" data-acao="editar" data-id="${p.id}" title="Editar" aria-label="Editar ${p.nome}">${icone('lapis')}</button>` : ''}
        ${pode('clientes.excluir') ? html `<button class="icone-btn perigo" data-acao="excluir" data-id="${p.id}" title="Excluir" aria-label="Excluir ${p.nome}">${icone('lixeira')}</button>` : ''}
      </div></div>
    <ul class="info">
      ${p.telefone ? html `<li>${icone('telefone', 16)}${telefone(p.telefone)}</li>` : ''}
      ${p.email ? html `<li>${icone('email', 16)}<span class="corta">${p.email}</span></li>` : ''}
      ${local(p) ? html `<li>${icone('local', 16)}${local(p)}</li>` : ''}
    </ul>
    ${p.fornecedor ? html `<div class="selos rodape-selos">${p.cliente ? selo('ok', 'Cliente') : ''}${selo('azul', 'Fornecedor')}</div>` : ''}
  </article>`)}</div>`
        : vazio(q ? 'Nenhum cadastro encontrado.' : 'Nenhum cliente cadastrado.', html `${pode('clientes.criar') ? html `<button data-acao="novo">${icone('mais')}Novo cliente</button>` : ''}`)}`);
    const ir = (nq = q, np = papel) => (location.hash = `#/pessoas?q=${encodeURIComponent(nq)}&papel=${np}`);
    let tempo;
    $('#q', el).addEventListener('input', (e) => { clearTimeout(tempo); tempo = window.setTimeout(() => ir(e.target.value), 350); });
    el.querySelectorAll('[data-seg="papel"]').forEach((b) => b.addEventListener('click', () => ir(q, b.dataset.valor)));
    const recarregar = () => render(el, params);
    acoes(el, {
        novo: async () => { if (await editarPessoa())
            recarregar(); },
        abrir: (t) => (location.hash = `#/pessoas/${t.dataset.id}`),
        editar: async (t, ev) => { ev.stopPropagation(); if (await editarPessoa(await api.get(`/api/pessoas/${t.dataset.id}`)))
            recarregar(); },
        excluir: async (t, ev) => {
            ev.stopPropagation();
            const p = lista.find((x) => String(x.id) === t.dataset.id);
            if (!(await confirmar(`Excluir o cadastro de ${p.nome}?`, 'Excluir')))
                return;
            await api.del(`/api/pessoas/${t.dataset.id}`);
            aviso('Cadastro excluído.');
            recarregar();
        },
    });
    el.onkeydown = (e) => {
        const c = e.target.closest('.cartao.clicavel');
        if (c && e.key === 'Enter' && e.target === c)
            location.hash = `#/pessoas/${c.dataset.id}`;
    };
}
async function detalhe(el, id) {
    const p = await api.get(`/api/pessoas/${id}`);
    const endereco = [[p.logradouro, p.numero].filter(Boolean).join(', '), p.complemento, p.bairro, [p.municipio, p.uf].filter(Boolean).join('/'), p.cep ? 'CEP ' + p.cep : ''].filter(Boolean).join(' — ');
    montar(el, html `
  <a href="#/pessoas" class="voltar">${icone('voltar', 16)}Clientes</a>
  ${cabecalhoPagina(p.nome, p.cpf_cnpj ? (p.tipo === 'PJ' ? 'CNPJ ' : 'CPF ') + doc(p.cpf_cnpj) : 'Sem CPF/CNPJ cadastrado', html `
    ${p.telefone ? html `<a class="botao sec" href="${linkWhatsapp(p.telefone, '')}" target="_blank" rel="noopener">${icone('mensagem')}WhatsApp</a>` : ''}
    ${pode('clientes.editar') ? html `<button data-acao="editar">${icone('lapis')}Editar cadastro</button>` : ''}${pode('clientes.excluir') ? html `<button class="sec perigo" data-acao="excluir">${icone('lixeira')}Excluir</button>` : ''}`)}
  <div class="grade-2">
    <section class="bloco"><h2>Contato</h2><ul class="info grande">
      <li>${icone('telefone', 16)}${p.telefone ? telefone(p.telefone) : html `<span class="mudo">Sem telefone</span>`}</li>
      <li>${icone('email', 16)}${p.email || html `<span class="mudo">Sem e-mail (exigido pelo RENAVE na venda)</span>`}</li>
      <li>${icone('local', 16)}${endereco || html `<span class="mudo">Endereço não cadastrado. A NF-e exige endereço completo.</span>`}</li>
    </ul>${p.obs ? html `<p class="obs">${p.obs}</p>` : ''}</section>
    <section class="bloco"><h2>Cobranças</h2>
      ${p.cobrancas.length ? html `<ul class="lista-simples">${p.cobrancas.map((c) => html `<li><a href="#/cobrancas?q=${encodeURIComponent(p.nome)}">${c.descricao}</a><b>${c.parcelas_pagas}/${c.total_parcelas}</b><small>${moeda(c.valor_parcela)} por parcela</small></li>`)}</ul>` : html `<p class="mudo">Nenhuma cobrança.</p>`}
    </section>
  </div>
  <div class="grade-2">
    <section class="bloco"><h2>Contratos</h2>
      ${p.contratos.length ? html `<ul class="lista-simples">${p.contratos.map((c) => html `<li><a href="/api/contratos/${c.id}/imprimir" target="_blank" rel="noopener">${c.numero} — ${rotulo(c.tipo)}</a><b>${moeda(c.valor)}</b><small>${data(c.data)}, ${c.assinado_em ? 'assinado' : 'aguardando assinatura'}</small></li>`)}</ul>` : html `<p class="mudo">Nenhum contrato.</p>`}
    </section>
    <section class="bloco"><h2>Documentos</h2>
      ${p.documentos.length ? html `<ul class="lista-simples">${p.documentos.map((d) => html `<li><a href="#/documentos?q=${encodeURIComponent(p.nome)}">${d.tipo}</a><b>${d.numero}</b></li>`)}</ul>` : html `<p class="mudo">Nenhum documento salvo.</p>`}
    </section>
  </div>
  <section class="bloco"><h2>Negociações</h2>
  ${p.negociacoes.length ? html `<table class="tabela compacta"><tbody>${p.negociacoes.map((n) => html `<tr data-acao="neg" data-id="${n.id}" tabindex="0"><td>${data(n.data)}</td><td>${rotulo(n.tipo)}</td><td>${n.marca} ${n.modelo} ${n.placa}</td><td class="n">${moeda(n.valor_final)}</td><td>${selo(n.status)}</td></tr>`)}</tbody></table>` : html `<p class="mudo">Nenhuma negociação registrada no sistema.</p>`}
  </section>`);
    acoes(el, {
        editar: async () => { if (await editarPessoa(p))
            detalhe(el, id); },
        excluir: async () => {
            if (!(await confirmar(`Excluir o cadastro de ${p.nome}?`, 'Excluir')))
                return;
            await api.del(`/api/pessoas/${id}`);
            aviso('Cadastro excluído.');
            location.hash = '#/pessoas';
        },
        neg: (t) => (location.hash = `#/negociacoes/${t.dataset.id}`),
    });
}
