import { api, pode } from '../api.js';
import {
  html, montar, $, acoes, campos, aoEnviar, modal, aviso, confirmar, moeda, data, doc, selo, cabecalhoPagina, vazio, abrirImpressao, lerForm,
  lerArquivoBase64, hoje,
} from '../ui.js';
import { icone } from '../icones.js';
import { seletorPessoa } from './pessoas.js';

const FORMAS: [string, string][] = [['pix', 'Pix'], ['boleto', 'Boleto'], ['dinheiro', 'Dinheiro'], ['transferencia', 'Transferência'], ['cartao', 'Cartão']];
const nomeForma = (f: string) => FORMAS.find(([v]) => v === f)?.[1] ?? f;

export async function render(el: HTMLElement) {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '').get('q') ?? '';
  const lista = await api.get(`/api/carnes?q=${encodeURIComponent(q)}`);
  montar(el, html`
  ${cabecalhoPagina('Carnês de pagamento', `${lista.length} carnê${lista.length === 1 ? '' : 's'} registrado${lista.length === 1 ? '' : 's'}`, html`${pode('carnes.criar') ? html`<button data-acao="novo">${icone('mais')}Novo carnê</button>` : ''}`)}
  <div class="filtros"><label class="busca">${icone('busca')}<input type="search" id="q" value="${q}" placeholder="Buscar cliente, placa…" aria-label="Buscar carnês"></label></div>
  ${lista.length ? html`<div class="grade-cartoes">${lista.map((c: any) => {
    const veiculo = [c.veiculo_marca, c.veiculo_modelo].filter(Boolean).join(' ');
    return html`<article class="cartao">
      <div class="cartao-topo"><span class="tile laranja">${icone('recibo')}</span>
        <div class="cartao-titulo"><b>${c.cliente_nome}</b><small>${c.cliente_doc ? 'CPF/CNPJ ' + doc(c.cliente_doc) : 'Sem CPF'}</small></div>
        <div class="selos">${c.situacao ? selo(c.situacao) : html`<span class="selo neutro" title="Sem acompanhamento em Cobranças">Avulso</span>`}</div></div>
      ${veiculo || c.veiculo_placa ? html`<p class="chip">${icone('carro', 15)}${veiculo}${c.veiculo_placa ? html` — ${c.veiculo_placa}` : ''}</p>` : ''}
      ${c.descricao ? html`<p class="descricao">${c.descricao}</p>` : ''}
      <ul class="info">
        <li>${icone('recibo', 16)}${c.total_parcelas}x de ${moeda(c.valor_parcela)}${c.parcelas_pagas !== null ? html` <span class="mudo">(${c.parcelas_pagas} paga${c.parcelas_pagas === 1 ? '' : 's'})</span>` : ''}</li>
        <li>${icone('calendario', 16)}Todo dia ${c.dia_vencimento} • a partir de ${data(c.primeiro_vencimento)}</li>
        <li>${icone(c.forma_pagamento === 'pix' ? 'qr' : 'dinheiro', 16)}${nomeForma(c.forma_pagamento)}${c.forma_pagamento === 'pix' && !c.chave_pix && !c.qr_pix ? html` <span class="neg">sem chave Pix</span>` : ''}</li>
      </ul>
      <p class="valor">Total: ${moeda(c.valor_total)}</p>
      <footer class="cartao-acoes"><button data-acao="imprimir" data-id="${c.id}" class="cresce">${icone('impressora', 16)}Imprimir carnê</button>
        ${pode('carnes.editar') ? html`<button class="icone-btn" data-acao="editar" data-id="${c.id}" title="Editar" aria-label="Editar carnê">${icone('lapis')}</button>` : ''}
        ${pode('carnes.excluir') ? html`<button class="icone-btn perigo" data-acao="excluir" data-id="${c.id}" title="Excluir" aria-label="Excluir carnê">${icone('lixeira')}</button>` : ''}</footer>
    </article>`;
  })}</div>` : vazio(q ? 'Nenhum carnê encontrado.' : 'Nenhum carnê ainda. Crie um para imprimir as parcelas com QR Code Pix.', html`${pode('carnes.criar') ? html`<button data-acao="novo">${icone('mais')}Novo carnê</button>` : ''}`)}`);

  let tempo: number | undefined;
  $<HTMLInputElement>('#q', el).addEventListener('input', (e) => { clearTimeout(tempo); tempo = window.setTimeout(() => (location.hash = `#/carnes?q=${encodeURIComponent((e.target as HTMLInputElement).value)}`), 350); });
  const recarregar = () => render(el);
  acoes(el, {
    novo: () => formulario(undefined, recarregar),
    imprimir: (b) => abrirImpressao(`/api/carnes/${b.dataset.id}/imprimir`),
    editar: async (b) => formulario(await api.get(`/api/carnes/${b.dataset.id}`), recarregar),
    excluir: async (b) => {
      if (!(await confirmar('Excluir este carnê? A cobrança vinculada (se houver) continua em Cobranças.', 'Excluir carnê'))) return;
      await api.del(`/api/carnes/${b.dataset.id}`);
      aviso('Carnê excluído.');
      recarregar();
    },
  });
}

async function formulario(c: any | undefined, aoTerminar: () => void) {
  const editando = !!c;
  const empresa = await api.get('/api/empresa');
  const veiculos = await api.get('/api/veiculos');
  const base = c ?? { total_parcelas: 10, forma_pagamento: 'pix', veiculo_tipo: 'carro', chave_pix: empresa.chave_pix, primeiro_vencimento: hoje() };
  const m = modal(editando ? 'Editar carnê' : 'Novo carnê', html`
  <form id="f-carne">
    <h3>Cliente</h3>
    <div class="grade-form"><div class="l4" id="sel-cli"></div>${campos([
      { nome: 'cliente_nome', rotulo: 'Nome no carnê', obrigatorio: true, largura: 2 },
      { nome: 'cliente_doc', rotulo: 'CPF/CNPJ', largura: 1 },
      { nome: 'cliente_nascimento', rotulo: 'Nascimento', tipo: 'data', largura: 1 },
      { nome: 'cliente_endereco', rotulo: 'Endereço', largura: 4 },
    ], base)}</div>
    <h3>Veículo</h3>
    <div class="grade-form">
      <div class="campo l4"><label for="f_v">Puxar de um veículo cadastrado</label><select id="f_v"><option value="">Escolher…</option>${veiculos.map((v: any) => html`<option value="${v.id}">${v.placa || '0 km'} — ${v.marca} ${v.modelo} ${v.ano_mod}</option>`)}</select></div>
      ${campos([
        { nome: 'veiculo_tipo', rotulo: 'Tipo', tipo: 'select', opcoes: [['carro', 'Carro'], ['moto', 'Moto'], ['outro', 'Outro']], largura: 1 },
        { nome: 'veiculo_marca', rotulo: 'Marca', largura: 1 },
        { nome: 'veiculo_modelo', rotulo: 'Modelo', largura: 1 },
        { nome: 'veiculo_placa', rotulo: 'Placa', largura: 1 },
        { nome: 'veiculo_chassi', rotulo: 'Chassi', largura: 2 },
        { nome: 'descricao', rotulo: 'Descrição', largura: 2, dica: 'Ex.: Financiamento com entrada de uma Hilux' },
      ], base)}
    </div>
    <h3>Parcelas</h3>
    <div class="grade-form">${campos([
      { nome: 'total_parcelas', rotulo: 'Nº de parcelas', tipo: 'numero', obrigatorio: true, largura: 1, attrs: 'min="1" step="1"' },
      { nome: 'valor_parcela', rotulo: 'Valor da parcela', tipo: 'moeda', obrigatorio: true, largura: 1 },
      { nome: 'primeiro_vencimento', rotulo: '1º vencimento', tipo: 'data', obrigatorio: true, largura: 1 },
      { nome: 'forma_pagamento', rotulo: 'Forma de pagamento', tipo: 'select', opcoes: FORMAS, largura: 1 },
      { nome: 'chave_pix', rotulo: 'Chave Pix', largura: 2, dica: 'CNPJ, CPF, e-mail, telefone (+55…) ou chave aleatória. Cada parcela sai com QR Code no valor exato.' },
    ], base)}
      <div class="campo l2"><label for="f_qr">Imagem do QR Pix (opcional)</label><input id="f_qr" type="file" accept="image/png,image/jpeg,image/webp" data-ignorar><small>Só é usada se não houver chave Pix.</small></div>
      ${campos([{ nome: 'obs', rotulo: 'Observações', tipo: 'area', largura: 4 }], base)}
    </div>
    <p class="total-calc" aria-live="polite"></p>
    ${editando ? '' : html`<label class="check"><input type="checkbox" name="criar_cobranca" checked> Acompanhar os pagamentos em Cobranças (lembrete no WhatsApp, atrasos e baixa das parcelas)</label>`}
    <div class="acoes-form"><button type="button" class="sec" data-fechar>Cancelar</button><button type="submit">${editando ? 'Salvar carnê' : 'Criar carnê'}</button></div>
  </form>`, { largo: true });
  const f = $<HTMLFormElement>('#f-carne', m.el);
  const set = (n: string, v: unknown) => { const i = f.elements.namedItem(n) as HTMLInputElement | null; if (i) i.value = String(v ?? ''); };
  const sel = $('#sel-cli', m.el);
  seletorPessoa(sel, 'pessoa_id', 'Buscar cliente cadastrado', { inicial: base.pessoa_id ? { id: base.pessoa_id, nome: base.cliente_nome } : undefined });
  sel.addEventListener('escolhido', async (e) => {
    const p = await api.get(`/api/pessoas/${(e as CustomEvent).detail}`);
    set('cliente_nome', p.nome); set('cliente_doc', p.cpf_cnpj ?? ''); set('cliente_nascimento', p.nascimento);
    set('cliente_endereco', [[p.logradouro, p.numero].filter(Boolean).join(', '), p.bairro, [p.municipio, p.uf].filter(Boolean).join('/')].filter(Boolean).join(', '));
  });
  $<HTMLSelectElement>('#f_v', m.el).addEventListener('change', async (e) => {
    const id = (e.target as HTMLSelectElement).value;
    if (!id) return;
    const v = await api.get(`/api/veiculos/${id}`);
    set('veiculo_tipo', v.tipo === 'moto' ? 'moto' : 'carro'); set('veiculo_marca', v.marca); set('veiculo_modelo', v.modelo);
    set('veiculo_placa', v.placa); set('veiculo_chassi', v.chassi);
  });
  const total = () => {
    const n = Number((f.elements.namedItem('total_parcelas') as HTMLInputElement).value || 0);
    const v = Number((f.elements.namedItem('valor_parcela') as HTMLInputElement).value || 0);
    $('.total-calc', m.el).innerHTML = n && v ? html`Total do carnê: <b>${moeda(n * v)}</b>`.s : '';
  };
  f.addEventListener('input', total);
  total();
  aoEnviar(f, async () => {
    const d: Record<string, any> = lerForm(f);
    const arq = $<HTMLInputElement>('#f_qr', m.el).files?.[0];
    if (arq) d.qr_imagem = await lerArquivoBase64(arq);
    if (editando) await api.put(`/api/carnes/${c.id}`, d);
    else await api.post('/api/carnes', d);
    aviso(editando ? 'Carnê salvo.' : 'Carnê criado. Use Imprimir carnê para gerar as folhas.');
    m.fechar();
    aoTerminar();
  });
}
