import { api, pode } from '../api.js';
import { html, montar, $, acoes, campos, aoEnviar, modal, aviso, moeda, dataHora, selo, vazio } from '../ui.js';

export async function render(el: HTMLElement, params: string[]) {
  if (params[0]) return detalhe(el, Number(params[0]));
  const st = new URLSearchParams(location.hash.split('?')[1] ?? '').get('status') ?? '';
  const [lista, empresa] = await Promise.all([api.get(`/api/nfes?status=${st}`), api.get('/api/empresa')]);
  montar(el, html`
  <header class="topo-pagina"><h1>Notas fiscais</h1>
    <div class="botoes">${pode('notas.ver') ? html`<button class="sec" data-acao="status">Verificar SEFAZ</button>` : ''}</div></header>
  ${empresa.nfe_ambiente === 2 ? html`<p class="alerta-caixa">Emitindo em <b>homologação</b>${empresa.nfe_simulado ? ' com SEFAZ simulada' : ''}: as notas não têm valor fiscal. Mude para produção em Configurações quando os testes terminarem.</p>` : ''}
  <form class="filtros" id="f-st"><select name="status" aria-label="Situação">${[['', 'Todas'], ['autorizada', 'Autorizadas'], ['rejeitada', 'Rejeitadas'], ['erro', 'Falha no envio'], ['assinada', 'Não transmitidas'], ['cancelada', 'Canceladas']].map(([v, t]) => html`<option value="${v}" ${v === st ? 'selected' : ''}>${t}</option>`)}</select><button class="sec">Filtrar</button></form>
  ${lista.length ? html`<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Nº</th><th>Emissão</th><th>Tipo</th><th>Destinatário</th><th>Veículo</th><th class="n">Valor</th><th>Situação</th></tr></thead>
  <tbody>${lista.map((n: any) => html`<tr data-acao="abrir" data-id="${n.id}" tabindex="0"><td><b>${n.numero}</b>/${n.serie}${n.ambiente === 2 ? html` <small>homolog.</small>` : ''}</td><td>${dataHora(n.emitida_em)}</td><td>${n.tipo_nf === 0 ? 'Entrada' : 'Saída'}</td>
  <td>${n.pessoa_nome ?? ''}</td><td>${n.marca ?? ''} ${n.modelo ?? ''} ${n.placa ?? ''}</td><td class="n">${moeda(n.valor)}</td><td>${selo(n.status)}${n.status === 'rejeitada' ? html`<br><small>${n.cstat} ${n.xmotivo}</small>` : ''}</td></tr>`)}</tbody></table></div>`
    : vazio('Nenhuma nota. As notas são emitidas a partir das negociações.', html`<a class="botao sec" href="#/negociacoes">Ver negociações</a>`)}`);
  $<HTMLFormElement>('#f-st', el).addEventListener('submit', (e) => { e.preventDefault(); location.hash = `#/notas?status=${new FormData(e.target as HTMLFormElement).get('status')}`; });
  acoes(el, {
    abrir: (t) => (location.hash = `#/notas/${t.dataset.id}`),
    status: async () => { const r = await api.get('/api/sefaz/status'); aviso(`SEFAZ: ${r.cStat} — ${r.xMotivo}`, r.cStat === '107' ? 'ok' : 'erro'); },
  });
}

async function detalhe(el: HTMLElement, id: number) {
  const n = await api.get(`/api/nfes/${id}`);
  const autorizada = n.status === 'autorizada';
  montar(el, html`
  <header class="topo-pagina"><div><a href="#/notas" class="voltar">Notas fiscais</a><h1>NF-e ${n.numero} série ${n.serie} ${selo(n.status)}</h1>
    <p class="mudo">${n.tipo_nf === 0 ? 'Entrada' : 'Saída'}, ${moeda(n.valor)}, ${n.ambiente === 2 ? 'homologação' : 'produção'}</p></div>
    <div class="botoes"><a class="botao sec" href="/api/nfes/${id}/danfe" target="_blank" rel="noopener">Abrir DANFE</a><a class="botao sec" href="/api/nfes/${id}/xml">Baixar XML</a></div></header>
  <section class="bloco"><dl class="dados">
    <dt>Chave de acesso</dt><dd class="mono">${n.chave.replace(/(.{4})/g, '$1 ')}</dd>
    <dt>Protocolo</dt><dd>${n.protocolo ?? '—'}</dd>
    <dt>Retorno da SEFAZ</dt><dd>${n.cstat ? `${n.cstat} — ${n.xmotivo}` : n.xmotivo ?? '—'}</dd>
    <dt>Emitida em</dt><dd>${dataHora(n.emitida_em)}</dd>
    ${n.negociacao_id ? html`<dt>Negociação</dt><dd><a href="#/negociacoes/${n.negociacao_id}">nº ${n.negociacao_id}</a></dd>` : ''}
  </dl>
  <div class="botoes">
    ${['assinada', 'erro'].includes(n.status) && pode('notas.emitir') ? html`<button data-acao="transmitir">Transmitir novamente</button>` : ''}
    ${pode('notas.ver') ? html`<button class="sec" data-acao="consultar">Consultar na SEFAZ</button>` : ''}
    ${autorizada && pode('notas.emitir') ? html`<button class="sec" data-acao="cce">Carta de correção</button>` : ''}
    ${autorizada && pode('notas.cancelar') ? html`<button class="sec perigo" data-acao="cancelar">Cancelar NF-e</button>` : ''}
  </div>
  ${n.status === 'rejeitada' ? html`<p class="mudo">Corrija o cadastro indicado no retorno e emita de novo pela negociação. O mesmo número será reaproveitado.</p>` : ''}
  </section>
  <section class="bloco"><h2>Eventos</h2>
  ${n.eventos.length ? html`<ul class="historico">${n.eventos.map((e: any) => html`<li>${selo(e.status === 'registrado' ? 'ok' : 'erro', e.status === 'registrado' ? 'Registrado' : 'Recusado')} <b>${e.tipo === '110111' ? 'Cancelamento' : `Carta de correção ${e.sequencia}`}</b> ${e.texto}
    <small>${dataHora(e.criado_em)}, ${e.cstat} ${e.xmotivo}${e.protocolo ? ', protocolo ' + e.protocolo : ''}</small>${e.status === 'registrado' ? html` <a href="/api/nfes/${id}/eventos/${e.id}/xml">XML</a>` : ''}</li>`)}</ul>` : html`<p class="mudo">Sem eventos.</p>`}
  </section>`);
  const recarregar = () => detalhe(el, id);
  acoes(el, {
    transmitir: async () => { const r = await api.post(`/api/nfes/${id}/transmitir`); aviso(r.status === 'autorizada' ? 'NF-e autorizada.' : `${r.cstat ?? ''} ${r.xmotivo ?? ''}`, r.status === 'autorizada' ? 'ok' : 'erro'); recarregar(); },
    consultar: async () => { const r = await api.post(`/api/nfes/${id}/consultar`); aviso(`SEFAZ: ${r.cStat} — ${r.xMotivo}`); recarregar(); },
    cancelar: () => {
      const m = modal('Cancelar NF-e', html`<form id="f-c"><p>O cancelamento só é aceito dentro do prazo da SEFAZ (em geral 24 horas da autorização) e se a mercadoria não circulou.</p>
        <div class="grade-form">${campos([{ nome: 'justificativa', rotulo: 'Justificativa (mínimo 15 caracteres)', tipo: 'area', obrigatorio: true, largura: 4, attrs: 'minlength="15" maxlength="255"' }])}</div>
        <div class="acoes-form"><button type="button" class="sec" data-fechar>Voltar</button><button type="submit" class="perigo">Cancelar NF-e</button></div></form>`);
      aoEnviar($('#f-c', m.el), async (d) => { await api.post(`/api/nfes/${id}/cancelar`, d); m.fechar(); aviso('NF-e cancelada.'); recarregar(); });
    },
    cce: () => {
      const m = modal('Carta de correção', html`<form id="f-cce"><p>Não pode alterar valores, impostos, quantidade, destinatário/remetente nem datas. Cada nova carta substitui a anterior, então escreva todas as correções.</p>
        <div class="grade-form">${campos([{ nome: 'correcao', rotulo: 'Correção (mínimo 15 caracteres)', tipo: 'area', obrigatorio: true, largura: 4, attrs: 'minlength="15" maxlength="1000"' }])}</div>
        <div class="acoes-form"><button type="button" class="sec" data-fechar>Voltar</button><button type="submit">Enviar carta de correção</button></div></form>`);
      aoEnviar($('#f-cce', m.el), async (d) => { await api.post(`/api/nfes/${id}/carta-correcao`, d); m.fechar(); aviso('Carta de correção registrada.'); recarregar(); });
    },
  });
}
