import type { App } from '../http/app.js';
import type { Banco, Linha } from '../db/database.js';
import { falhar, texto, numero, r2, hoje, somarMeses } from '../util/comum.js';
import { auditar } from './auth.js';
import { reciboTitulo } from './financeiro.js';
import { pagina, cabecalho, esc, moeda, dataBr, telFmt } from '../impressao/base.js';

export type SituacaoCobranca = 'quitado' | 'atrasado' | 'em_dia';

/** Data de vencimento da parcela `n` (1 = primeira). */
export const vencimentoParcela = (c: Linha, n: number) => somarMeses(c.primeiro_vencimento, n - 1);

/** Acrescenta à cobrança a situação calculada (não fica gravada: muda com o tempo). */
export function situacao(c: Linha, hj = hoje()): Linha {
  const quitado = c.parcelas_pagas >= c.total_parcelas;
  const proximo = quitado ? null : vencimentoParcela(c, c.parcelas_pagas + 1);
  let atrasadas = 0;
  if (!quitado) for (let i = c.parcelas_pagas + 1; i <= c.total_parcelas && vencimentoParcela(c, i) < hj; i++) atrasadas++;
  const st: SituacaoCobranca = quitado ? 'quitado' : atrasadas ? 'atrasado' : 'em_dia';
  const diasAtraso = proximo && proximo < hj ? Math.round((Date.parse(hj) - Date.parse(proximo)) / 86400000) : 0;
  return {
    ...c, situacao: st, proximo_vencimento: proximo, parcelas_atrasadas: atrasadas, dias_atraso: diasAtraso,
    ultimo_vencimento: vencimentoParcela(c, c.total_parcelas),
    saldo: r2(Math.max(0, c.total_parcelas - c.parcelas_pagas) * c.valor_parcela),
  };
}

function lerCampos(b: Banco, c: Linha): Linha {
  const pessoaId = c.pessoa_id ? numero(c.pessoa_id) : null;
  let nome = texto(c.cliente_nome), tel = texto(c.cliente_telefone);
  if (pessoaId) {
    const p = b.one('SELECT nome, telefone FROM pessoas WHERE id = ?', [pessoaId]) ?? falhar('Cliente não encontrado.');
    nome ||= p.nome; tel ||= p.telefone;
  }
  if (!nome) falhar('Selecione o cliente.');
  const descricao = texto(c.descricao);
  if (!descricao) falhar('Informe a descrição (ex.: Financiamento Titan 150 2020).');
  const total = Math.round(numero(c.total_parcelas));
  if (total < 1 || total > 240) falhar('Número de parcelas inválido.');
  let valorParcela = r2(numero(c.valor_parcela));
  const valorTotal = c.valor_total !== undefined && c.valor_total !== '' ? r2(numero(c.valor_total)) : r2(valorParcela * total);
  if (!valorParcela && valorTotal) valorParcela = r2(valorTotal / total);
  if (valorParcela <= 0) falhar('Informe o valor da parcela.');
  const primeiro = texto(c.primeiro_vencimento);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(primeiro)) falhar('Informe a data do primeiro vencimento.');
  const pagas = Math.round(numero(c.parcelas_pagas));
  if (pagas < 0 || pagas > total) falhar('Parcelas pagas não pode passar do total.');
  return {
    pessoa_id: pessoaId, cliente_nome: nome, cliente_telefone: tel, descricao, veiculo_info: texto(c.veiculo_info),
    valor_total: valorTotal, valor_parcela: valorParcela, total_parcelas: total, parcelas_pagas: pagas,
    dia_vencimento: Number(primeiro.slice(8, 10)), primeiro_vencimento: primeiro, obs: texto(c.obs),
  };
}

export function resumoCobrancas(b: Banco, hj = hoje()) {
  const lista = b.all('SELECT * FROM cobrancas').map((c) => situacao(c, hj));
  const ini = hj.slice(0, 8) + '01', fim = somarMeses(ini, 1);
  const em7 = new Date(Date.parse(hj) + 7 * 86400000).toISOString().slice(0, 10);
  let aReceberMes = 0, vencendo7 = 0;
  for (const c of lista) {
    if (c.situacao === 'quitado') continue;
    for (let i = c.parcelas_pagas + 1; i <= c.total_parcelas; i++) {
      const v = vencimentoParcela(c, i);
      if (v >= fim) break;
      if (v >= ini) aReceberMes += c.valor_parcela;
    }
    if (c.proximo_vencimento >= hj && c.proximo_vencimento <= em7) vencendo7++;
  }
  return {
    a_receber_mes: r2(aReceberMes),
    atrasados: lista.filter((c) => c.situacao === 'atrasado').length,
    vencendo_7_dias: vencendo7,
    saldo_total: r2(lista.reduce((s, c) => s + c.saldo, 0)),
    total: lista.length,
  };
}

function htmlExtrato(c: Linha, pags: Linha[], e: Linha): string {
  const s = situacao(c);
  const linhas = Array.from({ length: c.total_parcelas }, (_, i) => {
    const n = i + 1;
    const pg = pags.find((p) => p.parcela === n);
    const venc = vencimentoParcela(c, n);
    const st = n <= c.parcelas_pagas ? 'Paga' : venc < hoje() ? 'Em atraso' : 'A vencer';
    return `<tr><td>${n}/${c.total_parcelas}</td><td>${dataBr(venc)}</td><td class="n">${moeda(c.valor_parcela)}</td><td>${st}</td><td>${pg ? dataBr(pg.data) + ' · ' + moeda(pg.valor) : ''}</td></tr>`;
  }).join('');
  const corpo = `<div class="folha">${cabecalho(e, 'Extrato de parcelamento', `Emitido em ${dataBr(hoje())}`)}
  <h2>Cliente</h2><div class="grade"><div class="s2"><span>Nome</span><b>${esc(c.cliente_nome)}</b></div><div><span>Telefone</span><b>${esc(telFmt(c.cliente_telefone))}</b></div><div><span>Situação</span><b>${s.situacao === 'quitado' ? 'Quitado' : s.situacao === 'atrasado' ? 'Em atraso' : 'Em dia'}</b></div>
  <div class="s2"><span>Descrição</span><b>${esc(c.descricao)}</b></div><div class="s2"><span>Veículo</span><b>${esc(c.veiculo_info)}</b></div>
  <div><span>Valor total</span><b>${moeda(c.valor_total)}</b></div><div><span>Parcelas</span><b>${c.total_parcelas}x ${moeda(c.valor_parcela)}</b></div><div><span>Pagas</span><b>${c.parcelas_pagas}</b></div><div><span>Saldo devedor</span><b>${moeda(s.saldo)}</b></div></div>
  <h2>Parcelas</h2><table><thead><tr><th>Parcela</th><th>Vencimento</th><th class="n">Valor</th><th>Situação</th><th>Pagamento</th></tr></thead><tbody>${linhas}</tbody></table>
  ${c.obs ? `<h2>Observações</h2><div class="texto">${esc(c.obs)}</div>` : ''}</div>`;
  return pagina(`Extrato ${c.cliente_nome}`, corpo);
}

function htmlRelatorio(lista: Linha[], e: Linha, resumo: Linha): string {
  const nomes: Record<string, string> = { quitado: 'Quitado', atrasado: 'Em atraso', em_dia: 'Em dia' };
  const linhas = lista.map((c) => `<tr><td><b>${esc(c.cliente_nome)}</b><br><small>${esc(telFmt(c.cliente_telefone))}</small></td><td>${esc(c.descricao)}<br><small>${esc(c.veiculo_info)}</small></td>
    <td>${c.parcelas_pagas}/${c.total_parcelas}</td><td class="n">${moeda(c.valor_parcela)}</td><td>${c.proximo_vencimento ? dataBr(c.proximo_vencimento) : '—'}</td>
    <td>${nomes[c.situacao]}${c.dias_atraso ? ` (${c.dias_atraso} dias)` : ''}</td><td class="n">${moeda(c.saldo)}</td></tr>`).join('');
  const corpo = `<div class="folha">${cabecalho(e, 'Relatório de cobranças', `Posição em ${dataBr(hoje())}`)}
  <div class="grade" style="margin-bottom:12px"><div><span>A receber neste mês</span><b>${moeda(resumo.a_receber_mes)}</b></div><div><span>Em atraso</span><b>${resumo.atrasados} cobrança(s)</b></div>
  <div><span>Vencendo em 7 dias</span><b>${resumo.vencendo_7_dias}</b></div><div><span>Saldo total a receber</span><b>${moeda(resumo.saldo_total)}</b></div></div>
  <table><thead><tr><th>Cliente</th><th>Descrição</th><th>Pagas</th><th class="n">Parcela</th><th>Próx. venc.</th><th>Situação</th><th class="n">Saldo</th></tr></thead><tbody>${linhas}</tbody></table></div>`;
  return pagina('Relatório de cobranças', corpo, '@page{size:A4 landscape}');
}

export function registrarCobrancas(app: App, b: Banco): void {
  const listar = (q: string, st: string) => {
    let lista = b.all('SELECT * FROM cobrancas ORDER BY cliente_nome COLLATE NOCASE').map((c) => situacao(c));
    if (q) {
      const t = q.toLowerCase();
      lista = lista.filter((c) => [c.cliente_nome, c.descricao, c.veiculo_info, c.cliente_telefone].join(' ').toLowerCase().includes(t));
    }
    if (st) lista = lista.filter((c) => c.situacao === st);
    // Atrasados primeiro, depois por próximo vencimento; quitados por último
    const ordem = { atrasado: 0, em_dia: 1, quitado: 2 } as const;
    return lista.sort((a, z) => ordem[a.situacao as SituacaoCobranca] - ordem[z.situacao as SituacaoCobranca] || String(a.proximo_vencimento).localeCompare(String(z.proximo_vencimento)));
  };

  app.get('/api/cobrancas', (req) => ({ resumo: resumoCobrancas(b), itens: listar(texto(req.query.get('q')), texto(req.query.get('situacao'))) }));

  app.get('/api/cobrancas/relatorio', (req) => ({
    corpo: htmlRelatorio(listar(texto(req.query.get('q')), texto(req.query.get('situacao'))), b.one('SELECT * FROM empresa WHERE id = 1')!, resumoCobrancas(b)),
    tipo: 'text/html; charset=utf-8',
  }));

  app.get('/api/cobrancas/:id', (req) => {
    const c = b.one('SELECT * FROM cobrancas WHERE id = ?', [Number(req.params.id)]) ?? falhar('Cobrança não encontrada.', 404);
    return { ...situacao(c), pagamentos: b.all('SELECT * FROM cobranca_pagamentos WHERE cobranca_id = ? ORDER BY parcela', [c.id]) };
  });

  app.post('/api/cobrancas', (req) => {
    const id = b.inserir('cobrancas', lerCampos(b, req.corpo));
    auditar(b, req.usuario!.id, 'criar', 'cobrancas', id);
    return { id };
  });

  app.put('/api/cobrancas/:id', (req) => {
    const id = Number(req.params.id);
    const atual = b.one('SELECT * FROM cobrancas WHERE id = ?', [id]) ?? falhar('Cobrança não encontrada.', 404);
    const d = lerCampos(b, { ...atual, ...req.corpo });
    const registradas = b.one('SELECT COALESCE(MAX(parcela),0) AS m FROM cobranca_pagamentos WHERE cobranca_id = ?', [id])!.m as number;
    if (d.parcelas_pagas < registradas) falhar(`Há ${registradas} pagamento(s) registrado(s) no sistema. Estorne-os em vez de diminuir as parcelas pagas.`);
    b.atualizar('cobrancas', id, d);
    auditar(b, req.usuario!.id, 'alterar', 'cobrancas', id);
    return { ok: true };
  });

  app.delete('/api/cobrancas/:id', (req) => {
    const id = Number(req.params.id);
    b.tx(() => {
      if (b.one('SELECT 1 FROM carnes WHERE cobranca_id = ?', [id])) b.run('UPDATE carnes SET cobranca_id = NULL WHERE cobranca_id = ?', [id]);
      b.run('DELETE FROM cobrancas WHERE id = ?', [id]);
    });
    auditar(b, req.usuario!.id, 'excluir', 'cobrancas', id);
    return { ok: true };
  });

  // Registra o pagamento de uma ou mais parcelas e lança o recebimento no financeiro
  app.post('/api/cobrancas/:id/pagar', (req) => {
    const id = Number(req.params.id);
    const c = b.one('SELECT * FROM cobrancas WHERE id = ?', [id]) ?? falhar('Cobrança não encontrada.', 404);
    const qtd = Math.max(1, Math.round(numero(req.corpo.quantidade, 1)));
    if (c.parcelas_pagas + qtd > c.total_parcelas) falhar('Não há tantas parcelas em aberto.');
    const valorTotal = req.corpo.valor !== undefined && req.corpo.valor !== '' ? r2(numero(req.corpo.valor)) : r2(c.valor_parcela * qtd);
    if (valorTotal <= 0) falhar('Valor inválido.');
    const data = texto(req.corpo.data) || hoje();
    const forma = texto(req.corpo.forma) || 'pix';
    const porParcela = r2(valorTotal / qtd);
    b.tx(() => {
      for (let i = 1; i <= qtd; i++) {
        const n = c.parcelas_pagas + i;
        const valor = i === qtd ? r2(valorTotal - porParcela * (qtd - 1)) : porParcela;
        const tid = b.inserir('titulos', {
          tipo: 'receber', descricao: `${c.descricao} — parcela ${n}/${c.total_parcelas} (${c.cliente_nome})`, categoria: 'cobranca',
          pessoa_id: c.pessoa_id, negociacao_id: c.negociacao_id, forma, valor, vencimento: vencimentoParcela(c, n),
          parcela: n, total_parcelas: c.total_parcelas, status: 'pago', pago_em: data, valor_pago: valor,
        });
        b.inserir('cobranca_pagamentos', { cobranca_id: id, parcela: n, valor, data, forma, titulo_id: tid, criado_por: req.usuario!.id });
      }
      b.run('UPDATE cobrancas SET parcelas_pagas = parcelas_pagas + ? WHERE id = ?', [qtd, id]);
    });
    auditar(b, req.usuario!.id, 'pagamento', 'cobrancas', id, { qtd, valorTotal });
    return situacao(b.one('SELECT * FROM cobrancas WHERE id = ?', [id])!);
  });

  app.post('/api/cobrancas/:id/estornar', (req) => {
    const id = Number(req.params.id);
    const c = b.one('SELECT * FROM cobrancas WHERE id = ?', [id]) ?? falhar('Cobrança não encontrada.', 404);
    const ultimo = b.one('SELECT * FROM cobranca_pagamentos WHERE cobranca_id = ? ORDER BY parcela DESC LIMIT 1', [id]);
    if (!ultimo || ultimo.parcela !== c.parcelas_pagas) falhar('O último pagamento desta cobrança não foi registrado no sistema; ajuste as parcelas pagas editando a cobrança.');
    b.tx(() => {
      if (ultimo!.titulo_id) b.run("UPDATE titulos SET status = 'cancelado' WHERE id = ?", [ultimo!.titulo_id]);
      b.run('DELETE FROM cobranca_pagamentos WHERE id = ?', [ultimo!.id]);
      b.run('UPDATE cobrancas SET parcelas_pagas = parcelas_pagas - 1 WHERE id = ?', [id]);
    });
    auditar(b, req.usuario!.id, 'estorno', 'cobrancas', id, { parcela: ultimo!.parcela });
    return { ok: true };
  });

  app.get('/api/cobrancas/:id/recibo/:pagamentoId', (req) => {
    const p = b.one('SELECT titulo_id FROM cobranca_pagamentos WHERE id = ? AND cobranca_id = ?', [Number(req.params.pagamentoId), Number(req.params.id)])
      ?? falhar('Pagamento não encontrado.', 404);
    if (!p.titulo_id) falhar('Este pagamento foi importado sem lançamento no financeiro; não há recibo.');
    return reciboTitulo(b, p.titulo_id, req.usuario!.nome);
  });

  app.get('/api/cobrancas/:id/imprimir', (req) => {
    const c = b.one('SELECT * FROM cobrancas WHERE id = ?', [Number(req.params.id)]) ?? falhar('Cobrança não encontrada.', 404);
    const pags = b.all('SELECT * FROM cobranca_pagamentos WHERE cobranca_id = ?', [c.id]);
    return { corpo: htmlExtrato(c, pags, b.one('SELECT * FROM empresa WHERE id = 1')!), tipo: 'text/html; charset=utf-8' };
  });
}
