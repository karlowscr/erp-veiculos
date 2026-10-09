import { api, sessao, pode } from '../api.js';
import { html, montar, moeda, num, placa, cabecalhoPagina } from '../ui.js';
import { icone } from '../icones.js';
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export async function render(el) {
    const p = await api.get('/api/painel');
    const maxVenda = Math.max(1, ...p.vendas_por_mes.map((m) => m.valor));
    const hojeTxt = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    const primeiroNome = sessao.usuario.nome.split(' ')[0];
    const cob = p.cobrancas;
    const pendencias = [
        [cob.atrasados > 0, 'alerta', 'vermelho', `${cob.atrasados} cobrança${cob.atrasados === 1 ? '' : 's'} em atraso`, '#/cobrancas?situacao=atrasado'],
        [p.contratos_pendentes.qtd > 0, 'caneta', 'laranja', `${p.contratos_pendentes.qtd} contrato${p.contratos_pendentes.qtd === 1 ? '' : 's'} aguardando assinatura`, '#/assinaturas'],
        [p.pagar_7d.qtd > 0, 'dolar', 'amarelo', `${p.pagar_7d.qtd} conta${p.pagar_7d.qtd === 1 ? '' : 's'} a pagar até daqui a 7 dias (${moeda(p.pagar_7d.valor)})`, '#/financeiro/titulos?tipo=pagar'],
        [cob.vencendo_7_dias > 0, 'relogio', 'amarelo', `${cob.vencendo_7_dias} parcela${cob.vencendo_7_dias === 1 ? '' : 's'} vencendo nos próximos 7 dias`, '#/cobrancas'],
        [p.renave_pendente.qtd > 0, 'escudo', 'azul', `${p.renave_pendente.qtd} veículo${p.renave_pendente.qtd === 1 ? '' : 's'} sem entrada no RENAVE`, '#/renave'],
        [p.nfe_pendente.qtd > 0, 'nota', 'azul', `${p.nfe_pendente.qtd} nota${p.nfe_pendente.qtd === 1 ? '' : 's'} fiscal${p.nfe_pendente.qtd === 1 ? '' : 'is'} não autorizada${p.nfe_pendente.qtd === 1 ? '' : 's'}`, '#/notas'],
    ];
    const ativas = pendencias.filter(([s]) => s);
    montar(el, html `
  ${cabecalhoPagina(`Olá, ${primeiroNome}`, hojeTxt.charAt(0).toUpperCase() + hojeTxt.slice(1), html `
    ${pode('veiculos.criar') ? html `<a class="botao sec" href="#/veiculos/entrada">${icone('camera')}Entrada de veículo</a>` : ''}${pode('negociacoes.vender') ? html `<a class="botao" href="#/negociacoes/nova/venda">${icone('tendencia')}Registrar venda</a>` : ''}`)}
  <section class="stats">
    <a class="stat" href="#/veiculos"><span class="tile laranja">${icone('carro')}</span><div><span>Veículos no pátio</span><b>${num(p.estoque.qtd)}</b><small>${Math.round(p.estoque.dias_medio)} dias em média</small></div></a>
    <a class="stat" href="#/veiculos"><span class="tile azul">${icone('dinheiro')}</span><div><span>Estoque a preço de venda</span><b>${moeda(p.estoque.valor_venda)}</b><small>${p.estoque.custo === null ? 'preço anunciado' : html `custo ${moeda(p.estoque.custo)}`}</small></div></a>
    <a class="stat" href="#/negociacoes?tipo=venda"><span class="tile verde">${icone('tendencia')}</span><div><span>${p.minhas_vendas ? 'Minhas vendas no mês' : 'Vendas no mês'}</span><b>${moeda(p.vendas_mes.valor)}</b><small>${num(p.vendas_mes.qtd)} veículo${p.vendas_mes.qtd === 1 ? '' : 's'}</small></div></a>
    ${cob.a_receber_mes === null ? '' : html `<a class="stat" href="#/cobrancas"><span class="tile amarelo">${icone('cartao')}</span><div><span>A receber neste mês</span><b>${moeda(cob.a_receber_mes)}</b><small>saldo total ${moeda(cob.saldo_total)}</small></div></a>`}
  </section>

  <div class="grade-2">
    <section class="bloco"><h2>Atenção hoje</h2>
      ${ativas.length ? html `<ul class="pendencias">${ativas.map(([, ic, cor, txt, link]) => html `<li><a href="${link}"><span class="tile ${cor} p">${icone(ic, 16)}</span>${txt}${icone('voltar', 16)}</a></li>`)}</ul>`
        : html `<p class="tudo-certo">${icone('ok', 20)}Nada pendente. Cobranças, contratos, notas e RENAVE em dia.</p>`}
    </section>
    <section class="bloco"><h2>Há mais tempo no pátio</h2>
      ${p.parados.length ? html `<ul class="lista-veiculos">${p.parados.map((v) => html `
        <li><a href="#/veiculos/${v.id}">${placa(v.placa, true)}<span>${v.marca} ${v.modelo} ${v.ano_mod}</span></a><b class="${v.dias > 90 ? 'neg' : ''}">${v.dias} dias</b><small>${moeda(v.preco_venda)}</small></li>`)}</ul>`
        : html `<p class="mudo">Nenhum veículo no estoque. Registre uma compra ou consignação para começar.</p>`}
    </section>
  </div>

  <section class="bloco"><h2>${p.minhas_vendas ? 'Minhas vendas' : 'Vendas'} nos últimos 12 meses</h2>
    ${p.vendas_por_mes.length ? html `<div class="barras" role="list">${p.vendas_por_mes.map((m) => html `
      <div role="listitem" title="${moeda(m.valor)} em ${m.qtd} venda(s)"><b>${m.qtd}</b><span style="height:${Math.max(4, (m.valor / maxVenda) * 100)}%"></span><small>${MESES[Number(m.mes.slice(5)) - 1]}</small></div>`)}</div>`
        : html `<p class="mudo">As vendas registradas em Negociações aparecem aqui mês a mês.</p>`}
  </section>`);
}
