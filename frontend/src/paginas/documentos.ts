import { api, pode } from '../api.js';
import { html, montar, $, acoes, campos, aoEnviar, modal, aviso, confirmar, cabecalhoPagina, vazio, lerForm, arquivoParaEnvio } from '../ui.js';
import { icone } from '../icones.js';
import { seletorPessoa } from './pessoas.js';

const miniatura = (a: any, grande = false) => a.tipo === 'application/pdf'
  ? html`<a class="mini pdf${grande ? ' grande' : ''}" href="${a.url}" target="_blank" rel="noopener">${icone('pdf', grande ? 40 : 24)}<span>PDF</span></a>`
  : html`<a class="mini${grande ? ' grande' : ''}" href="${a.url}" target="_blank" rel="noopener"><img src="${a.url}" alt="" loading="lazy"></a>`;

export async function render(el: HTMLElement) {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '').get('q') ?? '';
  const lista = await api.get(`/api/documentos?q=${encodeURIComponent(q)}`);
  montar(el, html`
  ${cabecalhoPagina('Documentos', `${lista.length} documento${lista.length === 1 ? '' : 's'} salvo${lista.length === 1 ? '' : 's'}`, html`${pode('documentos.criar') ? html`<button data-acao="novo">${icone('mais')}Novo documento</button>` : ''}`)}
  <div class="filtros"><label class="busca">${icone('busca')}<input type="search" id="q" value="${q}" placeholder="Buscar por nome, número, tipo…" aria-label="Buscar documentos"></label></div>
  ${lista.length ? html`<div class="grade-cartoes">${lista.map((d: any) => html`<article class="cartao">
    <div class="cartao-topo"><span class="tile laranja">${icone('arquivo')}</span>
      <div class="cartao-titulo"><span class="selo neutro">${d.tipo}</span><b>${d.nome}</b>${d.numero ? html`<small>Nº ${d.numero}</small>` : ''}</div></div>
    ${d.arquivos.length ? html`<div class="miniaturas">${d.arquivos.slice(0, 4).map((a: any) => miniatura(a))}${d.arquivos.length > 4 ? html`<span class="mini mais">+${d.arquivos.length - 4}</span>` : ''}</div>` : html`<p class="mudo pequeno">Sem arquivos anexados.</p>`}
    <footer class="cartao-acoes fim">
      <button class="icone-btn" data-acao="ver" data-id="${d.id}" title="Ver" aria-label="Ver documento">${icone('olho')}</button>
      ${pode('documentos.editar') ? html`<button class="icone-btn" data-acao="editar" data-id="${d.id}" title="Editar" aria-label="Editar documento">${icone('lapis')}</button>` : ''}
      ${pode('documentos.excluir') ? html`<button class="icone-btn perigo" data-acao="excluir" data-id="${d.id}" title="Excluir" aria-label="Excluir documento">${icone('lixeira')}</button>` : ''}
    </footer></article>`)}</div>`
    : vazio(q ? 'Nenhum documento encontrado.' : 'Guarde aqui CNH, RG, CRLV e comprovantes dos clientes, com foto pelo celular.', html`${pode('documentos.criar') ? html`<button data-acao="novo">${icone('mais')}Novo documento</button>` : ''}`)}`);

  let tempo: number | undefined;
  $<HTMLInputElement>('#q', el).addEventListener('input', (e) => { clearTimeout(tempo); tempo = window.setTimeout(() => (location.hash = `#/documentos?q=${encodeURIComponent((e.target as HTMLInputElement).value)}`), 350); });
  const recarregar = () => render(el);
  const porId = (id?: string) => lista.find((d: any) => String(d.id) === id);
  acoes(el, {
    novo: () => formulario(undefined, recarregar),
    editar: (b) => formulario(porId(b.dataset.id), recarregar),
    ver: (b) => {
      const d = porId(b.dataset.id);
      modal(`${d.tipo}: ${d.nome}`, html`${d.numero ? html`<p>Número: <b>${d.numero}</b></p>` : ''}${d.obs ? html`<p>${d.obs}</p>` : ''}
        <div class="galeria">${d.arquivos.map((a: any) => miniatura(a, true))}</div>${d.arquivos.length ? '' : html`<p class="mudo">Sem arquivos.</p>`}`, { largo: true });
    },
    excluir: async (b) => {
      if (!(await confirmar('Excluir este documento e os arquivos anexados?', 'Excluir documento'))) return;
      await api.del(`/api/documentos/${b.dataset.id}`);
      aviso('Documento excluído.');
      recarregar();
    },
  });
}

async function formulario(d: any | undefined, aoTerminar: () => void) {
  const editando = !!d;
  const tipos: string[] = await api.get('/api/documentos/tipos');
  const remover = new Set<number>();
  const m = modal(editando ? 'Editar documento' : 'Novo documento', html`
  <form id="f-doc"><div class="grade-form">
    ${campos([{ nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: tipos.map((t) => [t, t] as [string, string]), largura: 1 }], d ?? { tipo: 'CNH' })}
    <div class="l3" id="sel-cli"></div>
    ${campos([
      { nome: 'nome', rotulo: 'Nome do titular', obrigatorio: true, largura: 2 },
      { nome: 'numero', rotulo: 'Número do documento', largura: 2 },
      { nome: 'obs', rotulo: 'Observações', tipo: 'area', largura: 4 },
    ], d ?? {})}
    ${editando && d.arquivos.length ? html`<div class="l4"><label>Arquivos atuais</label><div class="miniaturas editaveis">${d.arquivos.map((a: any) => html`<span class="mini-ed" data-arq="${a.id}">${miniatura(a)}<button type="button" class="icone-btn perigo" data-rem="${a.id}" aria-label="Remover arquivo">${icone('x', 14)}</button></span>`)}</div></div>` : ''}
    <div class="campo l4"><label for="f_arqs">Adicionar fotos ou PDF</label>
      <label class="soltar">${icone('camera', 22)}<span>Tirar foto ou escolher arquivos</span><input id="f_arqs" type="file" accept="image/*,application/pdf" multiple data-ignorar></label>
      <div class="miniaturas" id="previa"></div></div>
  </div>
  <div class="acoes-form"><button type="button" class="sec" data-fechar>Cancelar</button><button type="submit">${editando ? 'Salvar documento' : 'Salvar documento'}</button></div></form>`, { largo: true });
  const f = $<HTMLFormElement>('#f-doc', m.el);
  const sel = $('#sel-cli', m.el);
  seletorPessoa(sel, 'pessoa_id', 'Cliente (opcional)', { inicial: d?.pessoa_id ? { id: d.pessoa_id, nome: d.nome } : undefined });
  sel.addEventListener('escolhido', async (e) => {
    const p = await api.get(`/api/pessoas/${(e as CustomEvent).detail}`);
    (f.elements.namedItem('nome') as HTMLInputElement).value = p.nome;
  });
  const input = $<HTMLInputElement>('#f_arqs', m.el);
  input.addEventListener('change', () => {
    $('#previa', m.el).innerHTML = [...(input.files ?? [])].map((a) => a.type === 'application/pdf'
      ? html`<span class="mini pdf">${icone('pdf', 24)}<span>PDF</span></span>`.s
      : html`<span class="mini"><img src="${URL.createObjectURL(a)}" alt=""></span>`.s).join('');
  });
  m.el.querySelectorAll<HTMLButtonElement>('[data-rem]').forEach((b) => b.addEventListener('click', () => {
    remover.add(Number(b.dataset.rem));
    b.closest('.mini-ed')!.remove();
  }));
  aoEnviar(f, async () => {
    const dados: Record<string, any> = lerForm(f);
    dados.arquivos = await Promise.all([...(input.files ?? [])].map((a) => arquivoParaEnvio(a)));
    if (editando) await api.put(`/api/documentos/${d.id}`, { ...dados, remover: [...remover] });
    else await api.post('/api/documentos', dados);
    aviso('Documento salvo.');
    m.fechar();
    aoTerminar();
  });
}
