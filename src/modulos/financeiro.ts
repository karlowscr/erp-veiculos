import type { App } from '../http/app.js';
import { tem } from '../http/permissoes.js';
import { htmlRecibo } from '../impressao/recibo.js';
import type { Banco, Linha } from '../db/database.js';
import { falhar, texto, numero, r2, hoje, somarMeses, parcelar } from '../util/comum.js';
import { auditar } from './auth.js';
import { resumoCobrancas } from './cobrancas.js';

export function registrarFinanceiro(app: App, b: Banco): void {

  app.get('/api/titulos', (req) => {
    const where: string[] = [];
    const p: any[] = [];
    const tipo = req.query.get('tipo');
    if (tipo) { where.push('t.tipo = ?'); p.push(tipo); }
    const status = req.query.get('status');
    if (status === 'vencido') { where.push("t.status = 'aberto' AND t.vencimento < date('now')"); }
    else if (status) { where.push('t.status = ?'); p.push(status); }
    const de = req.query.get('de'), ate = req.query.get('ate');
    if (de) { where.push('t.vencimento >= ?'); p.push(de); }
    if (ate) { where.push('t.vencimento <= ?'); p.push(ate); }
    const q = texto(req.query.get('q'));
    if (q) { where.push('(t.descricao LIKE ? OR p.nome LIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
    return b.all(
      `SELECT t.*, p.nome AS pessoa_nome FROM titulos t LEFT JOIN pessoas p ON p.id = t.pessoa_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY CASE t.status WHEN 'aberto' THEN 0 ELSE 1 END, t.vencimento LIMIT 1000`, p);
  });

  // Lançamento avulso (aluguel, salários, impostos, outras receitas...)
  app.post('/api/titulos', (req) => {
    const c = req.corpo;
    const tipo = c.tipo === 'receber' ? 'receber' : c.tipo === 'pagar' ? 'pagar' : falhar('Tipo inválido.');
    const descricao = texto(c.descricao);
    const valor = r2(numero(c.valor));
    if (!descricao || valor <= 0) falhar('Informe descrição e valor.');
    const venc = texto(c.vencimento) || hoje();
    const n = Math.max(1, Math.min(120, Math.round(numero(c.parcelas, 1))));
    const ids = b.tx(() => parcelar(valor, n).map((v, i) => b.inserir('titulos', {
      tipo, descricao: n > 1 ? `${descricao} (${i + 1}/${n})` : descricao, categoria: texto(c.categoria, 'outros') || 'outros',
      pessoa_id: c.pessoa_id ? numero(c.pessoa_id) : null, veiculo_id: c.veiculo_id ? numero(c.veiculo_id) : null,
      valor: v, vencimento: somarMeses(venc, i), parcela: i + 1, total_parcelas: n, forma: texto(c.forma),
    })));
    auditar(b, req.usuario!.id, 'criar', 'titulos', ids[0], { n });
    return { ids };
  });

  app.post('/api/titulos/:id/baixar', (req) => {
    const id = Number(req.params.id);
    const t = b.one('SELECT * FROM titulos WHERE id = ?', [id]) ?? falhar('Título não encontrado.', 404);
    if (t.status !== 'aberto') falhar('Só títulos em aberto podem ser baixados.');
    const valorPago = req.corpo.valor_pago !== undefined && req.corpo.valor_pago !== '' ? r2(numero(req.corpo.valor_pago)) : t.valor;
    if (valorPago <= 0) falhar('Valor pago inválido.');
    b.atualizar('titulos', id, {
      status: 'pago', pago_em: texto(req.corpo.data) || hoje(), valor_pago: valorPago,
      forma: texto(req.corpo.forma) || t.forma,
    });
    auditar(b, req.usuario!.id, 'baixar', 'titulos', id, { valorPago });
    return { ok: true };
  });

  // Recibo (conta recebida) ou comprovante (conta paga), com a logo da loja
  app.get('/api/titulos/:id/recibo', (req) => reciboTitulo(b, Number(req.params.id), req.usuario!.nome));

  app.post('/api/titulos/:id/estornar', (req) => {
    const id = Number(req.params.id);
    const t = b.one('SELECT * FROM titulos WHERE id = ?', [id]) ?? falhar('Título não encontrado.', 404);
    if (t.status !== 'pago') falhar('Só títulos pagos podem ser estornados.');
    if (t.categoria === 'comissao') {
      b.run("UPDATE comissoes SET status = 'pendente', pago_em = NULL, titulo_id = NULL WHERE titulo_id = ?", [id]);
      b.run("UPDATE titulos SET status = 'cancelado' WHERE id = ?", [id]);
    } else {
      b.run("UPDATE titulos SET status = 'aberto', pago_em = NULL, valor_pago = NULL WHERE id = ?", [id]);
    }
    auditar(b, req.usuario!.id, 'estornar', 'titulos', id);
    return { ok: true };
  });

  app.post('/api/titulos/:id/cancelar', (req) => {
    const id = Number(req.params.id);
    const t = b.one('SELECT * FROM titulos WHERE id = ?', [id]) ?? falhar('Título não encontrado.', 404);
    if (t.status !== 'aberto') falhar('Só títulos em aberto podem ser cancelados.');
    if (t.negociacao_id) falhar('Este título pertence a uma negociação; cancele a negociação.');
    b.run("UPDATE titulos SET status = 'cancelado' WHERE id = ?", [id]);
    auditar(b, req.usuario!.id, 'cancelar', 'titulos', id);
    return { ok: true };
  });

  app.get('/api/financeiro/resumo', (req) => {
    const de = texto(req.query.get('de')) || hoje().slice(0, 8) + '01';
    const ate = texto(req.query.get('ate')) || hoje();
    const soma = (sql: string, p: any[]) => r2((b.one(sql, p)?.v as number) ?? 0);
    return {
      periodo: { de, ate },
      recebido: soma("SELECT SUM(valor_pago) v FROM titulos WHERE tipo='receber' AND status='pago' AND pago_em BETWEEN ? AND ?", [de, ate]),
      pago: soma("SELECT SUM(valor_pago) v FROM titulos WHERE tipo='pagar' AND status='pago' AND pago_em BETWEEN ? AND ?", [de, ate]),
      a_receber: soma("SELECT SUM(valor) v FROM titulos WHERE tipo='receber' AND status='aberto'", []),
      a_pagar: soma("SELECT SUM(valor) v FROM titulos WHERE tipo='pagar' AND status='aberto'", []),
      vencidos_receber: soma("SELECT SUM(valor) v FROM titulos WHERE tipo='receber' AND status='aberto' AND vencimento < date('now')", []),
      vencidos_pagar: soma("SELECT SUM(valor) v FROM titulos WHERE tipo='pagar' AND status='aberto' AND vencimento < date('now')", []),
      por_categoria: b.all(
        `SELECT tipo, categoria, SUM(valor_pago) AS total FROM titulos WHERE status='pago' AND pago_em BETWEEN ? AND ?
         GROUP BY tipo, categoria ORDER BY tipo, total DESC`, [de, ate]),
    };
  });

  // ---- Comissões ----
  app.get('/api/comissoes', (req) => {
    const where: string[] = [];
    const p: any[] = [];
    if (!tem(req.usuario, 'comissoes.ver_todas')) { where.push('c.usuario_id = ?'); p.push(req.usuario!.id); }
    const status = req.query.get('status');
    if (status) { where.push('c.status = ?'); p.push(status); }
    return b.all(
      `SELECT c.*, u.nome AS vendedor_nome, n.data, n.valor_final, v.marca, v.modelo, v.placa
       FROM comissoes c JOIN usuarios u ON u.id = c.usuario_id JOIN negociacoes n ON n.id = c.negociacao_id
       JOIN veiculos v ON v.id = n.veiculo_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY c.status, n.data DESC LIMIT 1000`, p);
  });

  app.post('/api/comissoes/pagar', (req) => {
    const ids: number[] = Array.isArray(req.corpo.ids) ? req.corpo.ids.map(Number) : [];
    if (!ids.length) falhar('Selecione as comissões a pagar.');
    const data = texto(req.corpo.data) || hoje();
    return b.tx(() => {
      const lista = b.all(`SELECT c.*, u.nome FROM comissoes c JOIN usuarios u ON u.id = c.usuario_id WHERE c.id IN (${ids.map(() => '?').join(',')})`, ids);
      if (lista.length !== ids.length || lista.some((c) => c.status !== 'pendente')) falhar('Só comissões pendentes podem ser pagas.');
      // Um título por vendedor
      const porVendedor = new Map<number, typeof lista>();
      for (const c of lista) porVendedor.set(c.usuario_id, [...(porVendedor.get(c.usuario_id) ?? []), c]);
      for (const [, itens] of porVendedor) {
        const total = r2(itens.reduce((s, c) => s + c.valor, 0));
        const tid = b.inserir('titulos', {
          tipo: 'pagar', descricao: `Comissões ${itens[0].nome} (${itens.length} venda${itens.length > 1 ? 's' : ''})`,
          categoria: 'comissao', valor: total, vencimento: data, status: 'pago', pago_em: data, valor_pago: total, forma: texto(req.corpo.forma) || 'pix',
        });
        for (const c of itens) b.run("UPDATE comissoes SET status = 'paga', pago_em = ?, titulo_id = ? WHERE id = ?", [data, tid, c.id]);
      }
      auditar(b, req.usuario!.id, 'pagar_comissoes', 'comissoes', undefined, { ids });
      return { ok: true };
    });
  });

  app.get('/api/contadores', (req) => ({
    contratos_pendentes: tem(req.usuario, 'contratos.ver', 'contratos.assinar') ? (b.one('SELECT COUNT(*) AS q FROM contratos WHERE assinado_em IS NULL')!.q as number) : 0,
    cobrancas_atrasadas: tem(req.usuario, 'cobrancas.ver') ? resumoCobrancas(b).atrasados : 0,
    contatos_novos: tem(req.usuario, 'site.contatos') ? (b.one("SELECT COUNT(*) AS q FROM contatos_site WHERE status = 'novo'")!.q as number) : 0,
    mural_pendentes: tem(req.usuario, 'site.mural') ? (b.one("SELECT COUNT(*) AS q FROM mural_fotos WHERE status = 'pendente'")!.q as number) : 0,
  }));

  // ---- Painel ----
  app.get('/api/painel', (req) => {
    const u = req.usuario;
    const inicioMes = hoje().slice(0, 8) + '01';
    const um = (sql: string, p: any[] = []): Linha => b.one(sql, p) ?? {};
    const p: Record<string, any> = {
      estoque: um(`SELECT COUNT(*) AS qtd, COALESCE(SUM(preco_venda),0) AS valor_venda,
                   COALESCE(SUM(preco_compra + COALESCE((SELECT SUM(valor) FROM veiculo_custos c WHERE c.veiculo_id = v.id),0)),0) AS custo,
                   COALESCE(AVG(julianday('now') - julianday(data_entrada)),0) AS dias_medio
                   FROM veiculos v WHERE situacao IN ('estoque','reservado')`),
      vendas_mes: um("SELECT COUNT(*) AS qtd, COALESCE(SUM(valor_final),0) AS valor FROM negociacoes WHERE tipo='venda' AND status='concluida' AND data >= ?", [inicioMes]),
      compras_mes: um("SELECT COUNT(*) AS qtd, COALESCE(SUM(valor_final),0) AS valor FROM negociacoes WHERE tipo='compra' AND status='concluida' AND data >= ?", [inicioMes]),
      receber_7d: um("SELECT COUNT(*) AS qtd, COALESCE(SUM(valor),0) AS valor FROM titulos WHERE tipo='receber' AND status='aberto' AND vencimento <= date('now','+7 days')"),
      pagar_7d: um("SELECT COUNT(*) AS qtd, COALESCE(SUM(valor),0) AS valor FROM titulos WHERE tipo='pagar' AND status='aberto' AND vencimento <= date('now','+7 days')"),
      renave_pendente: um("SELECT COUNT(*) AS qtd FROM veiculos WHERE situacao IN ('estoque','reservado') AND renave_status IN ('pendente','erro')"),
      nfe_pendente: um("SELECT COUNT(*) AS qtd FROM nfes WHERE status IN ('assinada','rejeitada','erro')"),
      contratos_pendentes: um('SELECT COUNT(*) AS qtd FROM contratos WHERE assinado_em IS NULL'),
      cobrancas: resumoCobrancas(b),
      vendas_por_mes: b.all(
        `SELECT substr(data,1,7) AS mes, COUNT(*) AS qtd, SUM(valor_final) AS valor FROM negociacoes
         WHERE tipo='venda' AND status='concluida' AND data >= date('now','start of month','-11 months') GROUP BY mes ORDER BY mes`),
      parados: b.all(
        `SELECT id, marca, modelo, placa, ano_mod, preco_venda, CAST(julianday(date('now')) - julianday(date(data_entrada)) AS INTEGER) AS dias
         FROM veiculos WHERE situacao IN ('estoque','reservado') ORDER BY data_entrada LIMIT 5`),
    };
    // Cada um só vê no painel o que tem permissão de ver
    const vazio = { qtd: 0, valor: 0 };
    if (!tem(u, 'veiculos.custos')) p.estoque.custo = null;
    if (!tem(u, 'negociacoes.ver_todas')) {
      p.vendas_mes = um("SELECT COUNT(*) AS qtd, COALESCE(SUM(valor_final),0) AS valor FROM negociacoes WHERE tipo='venda' AND status='concluida' AND data >= ? AND vendedor_id = ?", [inicioMes, u!.id]);
      p.vendas_por_mes = b.all(
        `SELECT substr(data,1,7) AS mes, COUNT(*) AS qtd, SUM(valor_final) AS valor FROM negociacoes
         WHERE tipo='venda' AND status='concluida' AND vendedor_id = ? AND data >= date('now','start of month','-11 months') GROUP BY mes ORDER BY mes`, [u!.id]);
    }
    if (!tem(u, 'financeiro.ver')) { p.receber_7d = vazio; p.pagar_7d = vazio; p.compras_mes = vazio; }
    if (!tem(u, 'renave.ver')) p.renave_pendente = { qtd: 0 };
    if (!tem(u, 'notas.ver')) p.nfe_pendente = { qtd: 0 };
    if (!tem(u, 'contratos.ver', 'contratos.assinar')) p.contratos_pendentes = { qtd: 0 };
    if (!tem(u, 'cobrancas.ver')) p.cobrancas = { ...p.cobrancas, atrasados: 0, vencendo_7_dias: 0, a_receber_mes: null, saldo_total: null };
    if (!tem(u, 'veiculos.ver')) p.parados = [];
    return { ...p, minhas_vendas: !tem(u, 'negociacoes.ver_todas') };
  });
}

export function reciboTitulo(b: Banco, id: number, emitidoPor: string, unicaVia = false) {
  const t = b.one('SELECT * FROM titulos WHERE id = ?', [id]) ?? falhar('Conta não encontrada.', 404);
  if (t.status !== 'pago') falhar('O recibo só existe depois de registrado o pagamento.');
  const pessoa = t.pessoa_id ? b.one('SELECT nome, cpf_cnpj FROM pessoas WHERE id = ?', [t.pessoa_id]) : undefined;
  const cob = b.one('SELECT c.cliente_nome FROM cobranca_pagamentos p JOIN cobrancas c ON c.id = p.cobranca_id WHERE p.titulo_id = ?', [id]);
  const numero = `${String(t.pago_em ?? '').slice(0, 4)}-${String(id).padStart(6, '0')}`;
  return {
    corpo: htmlRecibo({ ...t, cliente_nome: cob?.cliente_nome }, b.one('SELECT * FROM empresa WHERE id = 1')!, pessoa, { numero, emitidoPor, unicaVia }),
    tipo: 'text/html; charset=utf-8',
  };
}
