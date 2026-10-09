import { api } from '../api.js';
import { html, montar, acoes, data, dataHora, placa, selo } from '../ui.js';

export async function render(el: HTMLElement) {
  const [pend, ops, empresa] = await Promise.all([api.get('/api/renave/pendencias'), api.get('/api/renave/operacoes'), api.get('/api/empresa')]);
  montar(el, html`
  <header class="topo-pagina"><h1>RENAVE</h1></header>
  ${empresa.renave_modo === 'simulado' ? html`<p class="alerta-caixa">Modo simulado: os registros ficam só no sistema e não vão ao RENAVE. Quando o credenciamento da loja sair, mude o modo em Configurações e informe os endereços fornecidos pelo Serpro.</p>` : ''}
  <div class="grade-2">
    <section class="bloco"><h2>Aguardando entrada</h2>
      ${pend.entradas.length ? html`<ul class="lista-veiculos">${pend.entradas.map((v: any) => html`<li><a href="#/veiculos/${v.id}">${placa(v.placa, true)}<span>${v.marca} ${v.modelo}</span></a>${selo(v.renave_status)}<small>entrou em ${data(v.data_entrada)}</small></li>`)}</ul>`
        : html`<p class="mudo">Todos os veículos do pátio estão registrados.</p>`}
    </section>
    <section class="bloco"><h2>Vendidos aguardando saída</h2>
      ${pend.saidas.length ? html`<ul class="lista-veiculos">${pend.saidas.map((v: any) => html`<li><a href="#/negociacoes/${v.negociacao_id}">${placa(v.placa, true)}<span>${v.marca} ${v.modelo}</span></a><small>vendido em ${data(v.data)}</small></li>`)}</ul>`
        : html`<p class="mudo">Nenhuma saída pendente.</p>`}
    </section>
  </div>
  <section class="bloco"><h2>Histórico de operações</h2>
    ${ops.length ? html`<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Quando</th><th>Veículo</th><th>Operação</th><th>Modo</th><th>Resultado</th><th>Protocolo</th><th>Usuário</th></tr></thead>
    <tbody>${ops.map((o: any) => html`<tr data-acao="abrir" data-id="${o.veiculo_id}" tabindex="0"><td>${dataHora(o.criado_em)}</td><td>${placa(o.placa, true)} ${o.modelo}</td><td>${o.tipo.replace('_', ' ')}</td><td>${o.modo}</td>
    <td>${selo(o.status)}<br><small>${o.mensagem}</small></td><td>${o.protocolo ?? ''}</td><td>${o.usuario_nome ?? ''}</td></tr>`)}</tbody></table></div>` : html`<p class="mudo">Nenhuma operação ainda.</p>`}
  </section>`);
  acoes(el, { abrir: (t) => (location.hash = `#/veiculos/${t.dataset.id}`) });
}
