import { api } from '../api.js';
import { html, montar, acoes, aviso, cabecalhoPagina, vazio, segmentos, dataHora, telefone } from '../ui.js';
import { icone } from '../icones.js';

const TIPOS: Record<string, [string, string]> = {
  interesse: ['Interesse', 'azul'], visita: ['Agendar visita', 'verde'], troca: ['Avaliar troca', 'laranja'], financiamento: ['Financiamento', 'amarelo'],
};
const ROTULOS: Record<string, string> = {
  t_modelo: 'Carro do cliente', t_ano: 'Ano', t_km: 'Km', t_quitado: 'Situação', v_dia: 'Dia', v_periodo: 'Período',
  entrada: 'Entrada', prazo: 'Prazo', parcela: 'Parcela estimada', financiado: 'Valor financiado',
};

/** Pedidos feitos pelos clientes no catálogo do site. */
export async function render(el: HTMLElement) {
  const filtro = new URLSearchParams(location.hash.split('?')[1] ?? '').get('status') ?? 'novo';
  const lista = await api.get(`/api/site/contatos?status=${filtro === 'todos' ? '' : filtro}`);
  montar(el, html`
  ${cabecalhoPagina('Contatos do site', 'Pedidos de visita, troca e financiamento feitos pelos clientes no catálogo')}
  <div class="filtros">${segmentos('status', [['novo', 'Para atender'], ['atendido', 'Atendidos'], ['todos', 'Todos']], filtro)}</div>
  ${lista.length ? html`<div class="grade-cartoes">${lista.map((c: any) => {
    const [rot, cor] = TIPOS[c.tipo] ?? [c.tipo, 'neutro'];
    let dados: Record<string, string> = {};
    try { dados = JSON.parse(c.dados || '{}'); } catch { /* vazio */ }
    if (dados.v_dia) dados.v_dia = dados.v_dia.split('-').reverse().join('/');
    const zap = `https://wa.me/${c.telefone.length <= 11 ? '55' + c.telefone : c.telefone}?text=${encodeURIComponent(`Olá, ${c.nome.split(' ')[0]}! Recebemos seu pedido pelo site.`)}`;
    return html`<article class="cartao ${c.status === 'atendido' ? 'inativo' : ''}">
      <div class="cartao-topo"><span class="tile ${cor}">${icone(c.tipo === 'visita' ? 'calendario' : c.tipo === 'troca' ? 'setas' : c.tipo === 'financiamento' ? 'dolar' : 'mensagem')}</span>
        <div class="cartao-titulo"><b>${c.nome}</b><small>${telefone(c.telefone)} · ${dataHora(c.criado_em)}</small></div>
        <div class="selos"><span class="selo ${c.status === 'novo' ? 'aviso' : 'ok'}">${rot}</span></div></div>
      ${c.marca ? html`<p class="chip"><a href="#/veiculos/${c.veiculo_id}">${icone('carro', 15)}${c.marca} ${c.modelo} ${c.ano_mod}${c.placa ? ' — ' + c.placa : ''}</a></p>` : ''}
      ${Object.keys(dados).length ? html`<ul class="info">${Object.entries(dados).map(([k, v]) => html`<li><span class="mudo">${ROTULOS[k] ?? k}:</span> ${v}</li>`)}</ul>` : ''}
      ${c.status === 'atendido' && c.atendido_por_nome ? html`<p class="mudo pequeno">Atendido por ${c.atendido_por_nome}</p>` : ''}
      <footer class="cartao-acoes"><a class="botao verde cresce" href="${zap}" target="_blank" rel="noopener">${icone('mensagem', 16)}Responder no WhatsApp</a>
        <button class="sec" data-acao="status" data-id="${c.id}" data-atendido="${c.status === 'novo' ? 1 : 0}">${c.status === 'novo' ? 'Marcar atendido' : 'Reabrir'}</button></footer>
    </article>`;
  })}</div>` : vazio(filtro === 'novo' ? 'Nenhum pedido esperando. Quando um cliente pedir visita, troca ou financiamento pelo site, ele aparece aqui.' : 'Nada por aqui.')}`);
  el.querySelectorAll<HTMLButtonElement>('[data-seg="status"]').forEach((b) => b.addEventListener('click', () => (location.hash = `#/contatos?status=${b.dataset.valor}`)));
  acoes(el, {
    status: async (b) => {
      await api.post(`/api/site/contatos/${b.dataset.id}/atendido`, { atendido: b.dataset.atendido === '1' });
      aviso(b.dataset.atendido === '1' ? 'Marcado como atendido.' : 'Contato reaberto.');
      window.dispatchEvent(new Event('contadores'));
      render(el);
    },
  });
}
