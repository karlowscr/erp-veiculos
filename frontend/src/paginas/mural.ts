import { api } from '../api.js';
import type { Campo } from '../ui.js';
import { html, montar, acoes, aviso, cabecalhoPagina, vazio, dataHora, telefone, modal, campos, aoEnviar, confirmar, arquivoParaEnvio, $ } from '../ui.js';
import { icone } from '../icones.js';

/** Mural dos clientes: fotos publicadas pela loja (o cliente compartilha pelo site). */
export async function render(el: HTMLElement) {
  const { lista } = await api.get('/api/mural?status=aprovado');
  montar(el, html`
  ${cabecalhoPagina('Mural dos clientes', 'Fotos de clientes com o carro novo. No site, cada foto pode ser compartilhada.',
    html`<a class="botao sec" href="/mural" target="_blank" rel="noopener">${icone('olho', 16)}Ver no site</a><button data-acao="nova">${icone('camera', 16)}Publicar foto</button>`)}
  ${lista.length ? html`<div class="grade-mural">${lista.map((m: any) => html`<article class="cartao mural-cartao">
      <a class="mural-miniatura" href="${m.url}" target="_blank" rel="noopener"><img src="${m.url}" alt="Foto de ${m.nome}" loading="lazy">
        ${m.destaque ? html`<span class="selo laranja">Destaque</span>` : ''}</a>
      <div class="mural-dados">
        <b>${m.nome}</b>
        <small>${[m.veiculo, m.cidade].filter(Boolean).join(', ') || 'Sem carro informado'}</small>
        ${m.mensagem ? html`<q>${m.mensagem}</q>` : ''}
        <small class="mudo">Publicada em ${dataHora(m.criado_em)}${m.instagram ? html` · Instagram @${m.instagram}` : ''}</small>
        ${m.telefone ? html`<a class="pequeno" href="https://wa.me/${m.telefone.length <= 11 ? '55' + m.telefone : m.telefone}" target="_blank" rel="noopener">${icone('mensagem', 14)} ${telefone(m.telefone)}</a>` : ''}
      </div>
      <footer class="cartao-acoes">
        ${m.status !== 'aprovado' ? html`<button class="verde cresce" data-acao="status" data-id="${m.id}" data-status="aprovado">${icone('ok', 16)}Aprovar</button>` : html`<a class="botao sec cresce" href="/mural/${m.id}" target="_blank" rel="noopener">${icone('link', 16)}Abrir</a>`}
        ${m.status === 'pendente' ? html`<button class="sec" data-acao="status" data-id="${m.id}" data-status="recusado">Recusar</button>` : ''}
        ${m.status === 'aprovado' ? html`<button class="sec" data-acao="destaque" data-id="${m.id}" data-destaque="${m.destaque ? 0 : 1}">${m.destaque ? 'Tirar destaque' : 'Destacar'}</button>` : ''}
        <button class="sec icone-so" data-acao="editar" data-id="${m.id}" aria-label="Editar">${icone('lapis', 16)}</button>
        <button class="sec perigo icone-so" data-acao="excluir" data-id="${m.id}" aria-label="Excluir">${icone('lixeira', 16)}</button>
      </footer>
    </article>`)}</div>`
    : vazio('Nenhuma foto no mural ainda. Toque em "Publicar foto" para adicionar a primeira.')}`);

  const buscar = (id: string) => lista.find((m: any) => String(m.id) === id);
  const atualizar = () => { window.dispatchEvent(new Event('contadores')); render(el); };

  acoes(el, {
    status: async (b) => {
      await api.put(`/api/mural/${b.dataset.id}`, { status: b.dataset.status });
      aviso(b.dataset.status === 'aprovado' ? 'Foto aprovada e publicada no mural.' : 'Foto recusada.');
      atualizar();
    },
    destaque: async (b) => {
      await api.put(`/api/mural/${b.dataset.id}`, { destaque: b.dataset.destaque === '1' });
      aviso(b.dataset.destaque === '1' ? 'Foto destacada: aparece primeiro no mural.' : 'Destaque removido.');
      atualizar();
    },
    excluir: async (b) => {
      if (!(await confirmar('Excluir esta foto do mural? Não dá para desfazer.', 'Excluir'))) return;
      await api.del(`/api/mural/${b.dataset.id}`);
      aviso('Foto excluída.');
      atualizar();
    },
    editar: (b) => editar(buscar(b.dataset.id!), atualizar),
    nova: () => publicar(atualizar),
  });
}

const CAMPOS_TEXTO: Campo[] = [
  { nome: 'nome', rotulo: 'Nome do cliente', obrigatorio: true, largura: 2, attrs: 'maxlength="60"' },
  { nome: 'veiculo', rotulo: 'Carro que comprou', largura: 2, attrs: 'maxlength="60" placeholder="Ex.: Honda HR-V"' },
  { nome: 'cidade', rotulo: 'Cidade', largura: 2, attrs: 'maxlength="60"' },
  { nome: 'instagram', rotulo: 'Instagram do cliente', largura: 2, attrs: 'maxlength="40" placeholder="@perfil"' },
  { nome: 'mensagem', rotulo: 'Recado', largura: 4, attrs: 'maxlength="200"' },
];

function editar(m: any, depois: () => void) {
  const { el, fechar } = modal('Editar foto do mural', html`<form id="f-mural-ed"><div class="grade-form">${campos(CAMPOS_TEXTO, m)}</div>
    <label class="check"><input type="checkbox" name="destaque" ${m.destaque ? 'checked' : ''}> Destacar (aparece primeiro)</label>
    <div class="acoes-form"><button type="submit">Salvar</button></div></form>`);
  aoEnviar($<HTMLFormElement>('#f-mural-ed', el), async (d) => {
    await api.put(`/api/mural/${m.id}`, { ...d, destaque: !!d.destaque });
    fechar();
    aviso('Foto atualizada.');
    depois();
  });
}

function publicar(depois: () => void) {
  const { el, fechar } = modal('Publicar foto no mural', html`<form id="f-mural-novo">
    <label class="soltar">${icone('camera', 22)}<span id="mural-arq">Escolher foto</span><input type="file" name="foto" accept="image/jpeg,image/png,image/webp" required hidden></label>
    <p class="mudo pequeno">Envie a foto já editada do jeito que quer que apareça. Publique só fotos que o cliente autorizou.</p>
    <div class="grade-form">${campos(CAMPOS_TEXTO)}</div>
    <label class="check"><input type="checkbox" name="destaque"> Destacar (aparece primeiro)</label>
    <div class="acoes-form"><button type="submit">Publicar</button></div></form>`);
  const f = $<HTMLFormElement>('#f-mural-novo', el);
  const arq = f.querySelector<HTMLInputElement>('input[name=foto]')!;
  arq.addEventListener('change', () => { $('#mural-arq', el).textContent = arq.files?.[0]?.name ?? 'Escolher foto'; });
  aoEnviar(f, async (d) => {
    const foto = arq.files?.[0];
    if (!foto) throw new Error('Escolha a foto.');
    await api.post('/api/mural', { ...d, foto: undefined, destaque: !!d.destaque, imagem: await arquivoParaEnvio(foto, 1600) });
    fechar();
    aviso('Foto publicada no mural.');
    depois();
  });
}
