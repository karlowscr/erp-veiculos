import { writeFile, unlink, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Limitador, type App, type Usuario } from '../http/app.js';
import { tem } from '../http/permissoes.js';
import { lerDataUrl } from '../util/arquivos.js';
import { enviarNuvem, apagarNuvem, trazerDaNuvem } from '../util/nuvem.js';
import { Fipe, atualizarFipeVeiculo, registrarFipe } from './fipe.js';
import { lerDocumentoVeiculo, leituraDisponivel } from './leitor-documento.js';
import { comprar, consignar, inserirVeiculo } from './negociacoes.js';
import { validarPessoa } from './pessoas.js';
import type { Banco, Linha } from '../db/database.js';
import { falhar, texto, numero, r2, hoje } from '../util/comum.js';
import { chassiValido, placaValida, renavamValido, limparDoc, soDigitos, docValido } from '../util/validacao.js';
import { auditar } from './auth.js';

const TIPOS = ['automovel', 'moto', 'caminhonete', 'caminhao', 'utilitario', 'outro'];
const COMBUSTIVEIS = ['flex', 'gasolina', 'etanol', 'diesel', 'eletrico', 'hibrido', 'gnv'];

export function validarVeiculo(c: Linha): Linha {
  const chassi = limparDoc(c.chassi);
  if (!chassiValido(chassi)) falhar('Chassi inválido: precisa ter 17 caracteres, sem as letras I, O e Q.');
  const placa = limparDoc(c.placa);
  const condicao = c.condicao === 'novo' ? 'novo' : 'usado';
  if (placa && !placaValida(placa)) falhar('Placa inválida (use ABC1234 ou ABC1D23).');
  if (condicao === 'usado' && !placa) falhar('Veículo usado precisa de placa.');
  const renavam = soDigitos(c.renavam);
  if (renavam && !renavamValido(renavam)) falhar('RENAVAM inválido (dígito verificador não confere).');
  if (condicao === 'usado' && !renavam) falhar('Veículo usado precisa do RENAVAM.');
  const marca = texto(c.marca), modelo = texto(c.modelo);
  if (!marca || !modelo) falhar('Informe marca e modelo.');
  const anoFab = numero(c.ano_fab), anoMod = numero(c.ano_mod);
  const anoAtual = new Date().getFullYear();
  if (anoFab < 1950 || anoFab > anoAtual + 1) falhar('Ano de fabricação inválido.');
  if (anoMod < anoFab || anoMod > anoFab + 1) falhar('Ano modelo deve ser igual ou um ano depois do ano de fabricação.');
  const tipo = TIPOS.includes(c.tipo) ? c.tipo : 'automovel';
  const combustivel = COMBUSTIVEIS.includes(c.combustivel) ? c.combustivel : 'flex';
  const ncm = soDigitos(c.ncm) || '87032310';
  if (ncm.length !== 8) falhar('NCM deve ter 8 dígitos.');
  let dadosNovo: Linha = {};
  try {
    dadosNovo = typeof c.dados_novo === 'string' ? JSON.parse(c.dados_novo || '{}') : (c.dados_novo ?? {});
  } catch { falhar('Dados técnicos do veículo novo inválidos.'); }
  return {
    tipo, condicao, marca, modelo, versao: texto(c.versao), ano_fab: anoFab, ano_mod: anoMod, cor: texto(c.cor),
    combustivel, cambio: texto(c.cambio, 'manual'), placa, chassi, renavam: renavam.padStart(renavam ? 11 : 0, '0'), motor: texto(c.motor),
    km: Math.max(0, Math.round(numero(c.km))), portas: c.portas ? numero(c.portas) : null, potencia: texto(c.potencia),
    cilindrada: texto(c.cilindrada), ncm, cod_marca_modelo: texto(c.cod_marca_modelo), cod_cor_denatran: texto(c.cod_cor_denatran),
    dados_novo: JSON.stringify(condicao === 'novo' ? dadosNovo : {}),
    opcionais: texto(c.opcionais), preco_venda: r2(numero(c.preco_venda)), preco_minimo: r2(numero(c.preco_minimo)), obs: texto(c.obs),
  };
}

export function custoTotal(b: Banco, veiculoId: number): number {
  const v = b.one('SELECT preco_compra FROM veiculos WHERE id = ?', [veiculoId]);
  const c = b.one('SELECT COALESCE(SUM(valor), 0) AS t FROM veiculo_custos WHERE veiculo_id = ?', [veiculoId]);
  return r2((v?.preco_compra ?? 0) + (c?.t ?? 0));
}

/** Esconde custo e margem de quem não tem a permissão "Ver e lançar custos". */
function semCustos<T extends Linha>(u: Usuario | undefined, v: T): T {
  if (tem(u, 'veiculos.custos')) return v;
  const { preco_compra, custo_total, custos, ...resto } = v as Linha;
  void preco_compra; void custo_total; void custos;
  if (Array.isArray(resto.negociacoes)) resto.negociacoes = resto.negociacoes.map((n: Linha) => (n.tipo === 'compra' ? { ...n, valor_final: null } : n));
  return resto as T;
}

/** Leituras de documento por usuário: 40 por hora (cada leitura tem custo na API). */
const limiteLeitura = new Limitador(40, 60 * 60_000, 60 * 60_000);
const NOME_DOC = /^docveic-[0-9a-f]{16}\.(jpg|png|webp|pdf)$/;

export interface OpcoesVeiculos { pastaFotos: string; pastaArquivos: string; fipe?: Fipe; leitor?: typeof lerDocumentoVeiculo }

export function registrarVeiculos(app: App, b: Banco, op: OpcoesVeiculos): void {
  const { pastaFotos } = op;
  const pastaDocs = join(op.pastaArquivos, 'documentos-veiculos');
  const fipe = registrarFipe(app, b, op.fipe);
  const ler = op.leitor ?? lerDocumentoVeiculo;

  app.get('/api/veiculos', (req) => {
    const where: string[] = [];
    const p: any[] = [];
    const q = texto(req.query.get('q'));
    if (q) {
      where.push('(v.marca LIKE ? OR v.modelo LIKE ? OR v.placa LIKE ? OR v.chassi LIKE ? OR v.renavam LIKE ?)');
      const l = `%${q}%`, d = `%${limparDoc(q)}%`;
      p.push(l, l, d, d, d);
    }
    const sit = req.query.get('situacao');
    if (sit) { where.push('v.situacao = ?'); p.push(sit); }
    const orig = req.query.get('origem');
    if (orig) { where.push('v.origem = ?'); p.push(orig); }
    if (req.query.get('publicado') === '1') where.push('v.publicado = 1');
    const lista = b.all(
      `SELECT v.id, v.tipo, v.condicao, v.marca, v.modelo, v.versao, v.ano_fab, v.ano_mod, v.cor, v.placa, v.chassi, v.km, v.combustivel, v.cambio,
              v.preco_compra, v.preco_venda, v.preco_minimo, v.situacao, v.origem, v.data_entrada, v.data_saida, v.renave_status,
              v.publicado, v.destaque, v.fipe_valor, v.fipe_referencia,
              v.preco_compra + COALESCE((SELECT SUM(valor) FROM veiculo_custos c WHERE c.veiculo_id = v.id), 0) AS custo_total,
              CAST(julianday(COALESCE(v.data_saida, date('now'))) - julianday(v.data_entrada) AS INTEGER) AS dias_estoque,
              (SELECT arquivo FROM veiculo_fotos f WHERE f.veiculo_id = v.id ORDER BY ordem, id LIMIT 1) AS foto,
              (SELECT COUNT(*) FROM veiculo_fotos f WHERE f.veiculo_id = v.id) AS qtd_fotos,
              p.nome AS proprietario_nome
       FROM veiculos v LEFT JOIN pessoas p ON p.id = v.proprietario_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY CASE v.situacao WHEN 'estoque' THEN 0 WHEN 'reservado' THEN 1 ELSE 2 END, v.data_entrada DESC, v.id DESC LIMIT 500`, p);
    return lista.map((v) => semCustos(req.usuario, v));
  });

  app.get('/api/veiculos/:id', (req) => {
    const id = Number(req.params.id);
    const v = b.one(
      `SELECT v.*, p.nome AS proprietario_nome FROM veiculos v LEFT JOIN pessoas p ON p.id = v.proprietario_id WHERE v.id = ?`, [id],
    ) ?? falhar('Veículo não encontrado.', 404);
    return semCustos(req.usuario, {
      ...v,
      custos: b.all('SELECT * FROM veiculo_custos WHERE veiculo_id = ? ORDER BY data, id', [id]),
      fotos: b.all('SELECT * FROM veiculo_fotos WHERE veiculo_id = ? ORDER BY ordem, id', [id]),
      negociacoes: b.all(
        `SELECT n.id, n.tipo, n.data, n.valor_final, n.status, p.nome AS pessoa_nome FROM negociacoes n
         JOIN pessoas p ON p.id = n.pessoa_id WHERE n.veiculo_id = ? OR n.troca_veiculo_id = ? ORDER BY n.id`, [id, id]),
      renave: b.all('SELECT id, tipo, modo, status, protocolo, mensagem, criado_em FROM renave_operacoes WHERE veiculo_id = ? ORDER BY id DESC', [id]),
      custo_total: custoTotal(b, id),
      leitura_documento: leituraDisponivel(),
    });
  });

  // Edição de dados cadastrais e preços
  app.put('/api/veiculos/:id', (req) => {
    const id = Number(req.params.id);
    const atual = b.one('SELECT * FROM veiculos WHERE id = ?', [id]) ?? falhar('Veículo não encontrado.', 404);
    const dados = validarVeiculo({ ...atual, ...req.corpo });
    if (atual.situacao === 'vendido') {
      // Após a venda só se ajustam observações, para não divergir da NF-e
      b.atualizar('veiculos', id, { obs: dados.obs });
    } else {
      const extra: Linha = {};
      // O valor pago só é editável aqui quando o veículo entrou sem negociação de compra
      const temCompra = b.one("SELECT 1 FROM negociacoes WHERE veiculo_id = ? AND tipo IN ('compra','consignacao') AND status = 'concluida'", [id]);
      if (req.corpo.preco_compra !== undefined && tem(req.usuario, 'veiculos.custos') && !temCompra) extra.preco_compra = Math.max(0, r2(numero(req.corpo.preco_compra)));
      b.atualizar('veiculos', id, { ...dados, ...extra });
    }
    auditar(b, req.usuario!.id, 'alterar', 'veiculos', id);
    return { ok: true };
  });

  app.delete('/api/veiculos/:id', async (req) => {
    const id = Number(req.params.id);
    const v = b.one('SELECT * FROM veiculos WHERE id = ?', [id]) ?? falhar('Veículo não encontrado.', 404);
    if (b.one("SELECT 1 FROM negociacoes WHERE (veiculo_id = ? OR troca_veiculo_id = ?) AND status = 'concluida'", [id, id])) {
      falhar('Este veículo tem compra, venda ou consignação registrada. Cancele a negociação antes de excluir.');
    }
    if (b.one('SELECT 1 FROM nfes n JOIN negociacoes g ON g.id = n.negociacao_id WHERE g.veiculo_id = ?', [id])) falhar('Este veículo tem nota fiscal emitida e não pode ser excluído.');
    if (b.one("SELECT 1 FROM renave_operacoes WHERE veiculo_id = ? AND status = 'sucesso'", [id])) falhar('Este veículo tem registro no RENAVE. Cancele a entrada no RENAVE antes.');
    if (b.one("SELECT 1 FROM veiculo_custos c JOIN titulos t ON t.id = c.titulo_id WHERE c.veiculo_id = ? AND t.status = 'pago'", [id])) {
      falhar('Há custos deste veículo já pagos no financeiro. Estorne-os antes de excluir.');
    }
    const fotos = b.all('SELECT arquivo FROM veiculo_fotos WHERE veiculo_id = ?', [id]);
    b.tx(() => {
      b.run("UPDATE titulos SET status = 'cancelado' WHERE veiculo_id = ? AND status = 'aberto'", [id]);
      b.run('UPDATE titulos SET veiculo_id = NULL WHERE veiculo_id = ?', [id]);
      b.run('DELETE FROM veiculo_custos WHERE veiculo_id = ?', [id]);
      b.run('DELETE FROM veiculo_fotos WHERE veiculo_id = ?', [id]);
      b.run('DELETE FROM renave_operacoes WHERE veiculo_id = ?', [id]);
      b.run('DELETE FROM negociacao_pagamentos WHERE negociacao_id IN (SELECT id FROM negociacoes WHERE veiculo_id = ? OR troca_veiculo_id = ?)', [id, id]);
      b.run('DELETE FROM comissoes WHERE negociacao_id IN (SELECT id FROM negociacoes WHERE veiculo_id = ? OR troca_veiculo_id = ?)', [id, id]);
      b.run('UPDATE titulos SET negociacao_id = NULL WHERE negociacao_id IN (SELECT id FROM negociacoes WHERE veiculo_id = ? OR troca_veiculo_id = ?)', [id, id]);
      b.run('UPDATE contratos SET negociacao_id = NULL WHERE negociacao_id IN (SELECT id FROM negociacoes WHERE veiculo_id = ? OR troca_veiculo_id = ?)', [id, id]);
      b.run('UPDATE cobrancas SET negociacao_id = NULL WHERE negociacao_id IN (SELECT id FROM negociacoes WHERE veiculo_id = ? OR troca_veiculo_id = ?)', [id, id]);
      b.run('UPDATE contratos SET veiculo_id = NULL WHERE veiculo_id = ?', [id]);
      b.run('DELETE FROM negociacoes WHERE veiculo_id = ? OR troca_veiculo_id = ?', [id, id]);
      b.run('DELETE FROM veiculos WHERE id = ?', [id]);
    });
    for (const f of fotos) {
      await unlink(join(pastaFotos, f.arquivo)).catch(() => undefined);
      await apagarNuvem(join(pastaFotos, f.arquivo));
    }
    if (v.documento_arquivo && NOME_DOC.test(v.documento_arquivo)) {
      await unlink(join(pastaDocs, v.documento_arquivo)).catch(() => undefined);
      await apagarNuvem(join(pastaDocs, v.documento_arquivo));
    }
    auditar(b, req.usuario!.id, 'excluir', 'veiculos', id, { placa: v.placa, chassi: v.chassi, modelo: `${v.marca} ${v.modelo}` });
    return { ok: true };
  });

  app.post('/api/veiculos/:id/reserva', (req) => {
    const id = Number(req.params.id);
    const v = b.one('SELECT situacao FROM veiculos WHERE id = ?', [id]) ?? falhar('Veículo não encontrado.', 404);
    const reservar = !!req.corpo.reservar;
    if (reservar && v.situacao !== 'estoque') falhar('Só é possível reservar veículos em estoque.');
    if (!reservar && v.situacao !== 'reservado') falhar('Veículo não está reservado.');
    b.run('UPDATE veiculos SET situacao = ? WHERE id = ?', [reservar ? 'reservado' : 'estoque', id]);
    auditar(b, req.usuario!.id, reservar ? 'reservar' : 'liberar', 'veiculos', id);
    return { ok: true };
  });

  // ---- Catálogo público ----
  app.post('/api/veiculos/:id/catalogo', (req) => {
    const id = Number(req.params.id);
    const v = b.one('SELECT * FROM veiculos WHERE id = ?', [id]) ?? falhar('Veículo não encontrado.', 404);
    const c = req.corpo;
    const publicar = c.publicado === undefined ? !!v.publicado : !!c.publicado;
    if (publicar && !['estoque', 'reservado'].includes(v.situacao)) falhar('Só veículos no estoque podem ir para o catálogo.');
    if (publicar && !b.one('SELECT 1 FROM veiculo_fotos WHERE veiculo_id = ?', [id])) falhar('Adicione pelo menos uma foto antes de publicar no catálogo.');
    b.atualizar('veiculos', id, {
      publicado: publicar,
      destaque: c.destaque === undefined ? undefined : !!c.destaque,
      mostrar_preco: c.mostrar_preco === undefined ? undefined : !!c.mostrar_preco,
      descricao_catalogo: c.descricao_catalogo === undefined ? undefined : texto(c.descricao_catalogo).slice(0, 3000),
    });
    auditar(b, req.usuario!.id, publicar ? 'publicar' : 'despublicar', 'veiculos', id);
    return { ok: true };
  });

  // ---- FIPE ----
  app.post('/api/veiculos/:id/fipe', async (req) => {
    const v = b.one('SELECT * FROM veiculos WHERE id = ?', [Number(req.params.id)]) ?? falhar('Veículo não encontrado.', 404);
    const c = req.corpo;
    return atualizarFipeVeiculo(b, fipe, v, c.marca ? { tipo: texto(c.tipo), marca: texto(c.marca), modelo: texto(c.modelo), ano: texto(c.ano) } : undefined);
  });

  // ---- Leitura do documento (foto do CRV/CRLV ou PDF do CRLV-e) ----
  app.post('/api/veiculos/ler-documento', async (req) => {
    const chave = `u${req.usuario!.id}`;
    const espera = limiteLeitura.bloqueado(chave);
    if (espera) falhar(`Limite de leituras por hora atingido. Tente de novo em ${Math.ceil(espera / 60)} min.`, 429);
    const arq = lerDataUrl(String(req.corpo.arquivo ?? ''), { pdf: true, maxMb: 10 });
    // Guarda a imagem do documento junto ao cadastro (fica só para usuários logados)
    await mkdir(pastaDocs, { recursive: true });
    const documento = `docveic-${randomBytes(8).toString('hex')}.${arq.ext}`;
    await writeFile(join(pastaDocs, documento), arq.buf);
    await enviarNuvem(join(pastaDocs, documento), arq.buf);
    limiteLeitura.registrar(chave);
    const r = await ler(arq);
    const d = r.dados;
    const existente = d.chassi ? b.one('SELECT id, situacao, marca, modelo, placa FROM veiculos WHERE chassi = ?', [d.chassi]) : undefined;
    const proprietario = d.proprietario_doc ? b.one('SELECT id, nome, cpf_cnpj FROM pessoas WHERE cpf_cnpj = ?', [d.proprietario_doc]) : undefined;
    auditar(b, req.usuario!.id, 'ler_documento', 'veiculos', undefined, { placa: d.placa, modelo: r.modelo });
    return { ...r, documento, existente, proprietario };
  });

  /** Anexa ao cadastro a imagem do documento já lida (venda com troca, compra, consignação). */
  app.post('/api/veiculos/:id/documento', async (req) => {
    const id = Number(req.params.id);
    if (!b.one('SELECT 1 FROM veiculos WHERE id = ?', [id])) falhar('Veículo não encontrado.', 404);
    const documento = texto(req.corpo.documento);
    if (!NOME_DOC.test(documento) || !(await trazerDaNuvem(join(pastaDocs, documento)))) falhar('Documento não encontrado; leia o documento de novo.');
    b.atualizar('veiculos', id, { documento_arquivo: documento });
    auditar(b, req.usuario!.id, 'anexar_documento', 'veiculos', id);
    return { ok: true };
  });

  /**
   * Entrada rápida no estoque (pelo celular): dados do documento + valores + fotos.
   * - compra: gera a negociação de compra e a conta a pagar ao antigo dono;
   * - consignacao: gera a consignação (repasse ao dono na venda);
   * - estoque: só cadastra (veículo que já era da loja / sem fornecedor).
   */
  app.post('/api/veiculos/entrada', async (req) => {
    const c = req.corpo;
    const u = req.usuario!;
    const origem = ['compra', 'consignacao', 'estoque'].includes(c.origem) ? c.origem : 'compra';
    if (origem === 'compra' && !tem(u, 'negociacoes.comprar')) falhar('Você não tem permissão para registrar compra. Use "Só cadastrar no estoque" ou peça ao administrador.', 403);
    if (origem === 'consignacao' && !tem(u, 'negociacoes.consignar')) falhar('Você não tem permissão para registrar consignação.', 403);
    const custo = r2(numero(c.custo));
    const veiculo = { ...(c.veiculo ?? {}), preco_venda: c.preco_venda ?? c.veiculo?.preco_venda, preco_minimo: c.preco_minimo ?? c.veiculo?.preco_minimo };
    validarVeiculo(veiculo); // valida antes de criar a pessoa
    const documento = texto(c.documento);
    if (documento && (!NOME_DOC.test(documento) || !(await trazerDaNuvem(join(pastaDocs, documento))))) falhar('Documento enviado não encontrado; leia o documento de novo.');

    const id = b.tx(() => {
      let pessoaId = c.pessoa_id ? numero(c.pessoa_id) : 0;
      if (origem !== 'estoque' && !pessoaId) {
        const p = c.proprietario ?? {};
        const doc = limparDoc(p.cpf_cnpj);
        if (doc && !docValido(doc)) falhar('CPF/CNPJ do proprietário inválido.');
        const achado = doc ? b.one('SELECT id FROM pessoas WHERE cpf_cnpj = ?', [doc]) : undefined;
        if (achado) pessoaId = achado.id;
        else {
          if (!texto(p.nome)) falhar(origem === 'compra' ? 'Informe de quem a loja comprou (nome do proprietário).' : 'Informe o dono do veículo consignado.');
          pessoaId = b.inserir('pessoas', validarPessoa({ nome: p.nome, cpf_cnpj: doc, municipio: p.municipio, uf: p.uf, telefone: p.telefone, cliente: false, fornecedor: true }));
          auditar(b, u.id, 'criar', 'pessoas', pessoaId, { via: 'entrada_veiculo' });
        }
      }
      let veiculoId: number;
      let negociacaoId: number | null = null;
      if (origem === 'compra') {
        if (custo <= 0) falhar('Informe quanto a loja pagou pelo veículo.');
        const pago = c.forma_pagamento ? [{ forma: texto(c.forma_pagamento), valor: custo, parcelas: 1, primeiro_vencimento: texto(c.vencimento) || undefined }] : [];
        negociacaoId = comprar(b, u, { pessoa_id: pessoaId, valor: custo, data: texto(c.data) || hoje(), pagamentos: pago, veiculo, obs: texto(c.obs) });
        veiculoId = b.one('SELECT veiculo_id FROM negociacoes WHERE id = ?', [negociacaoId])!.veiculo_id;
      } else if (origem === 'consignacao') {
        const repasse = r2(numero(c.valor_repasse) || custo);
        negociacaoId = consignar(b, u, { pessoa_id: pessoaId, valor_repasse: repasse, data: texto(c.data) || hoje(), veiculo, obs: texto(c.obs) });
        veiculoId = b.one('SELECT veiculo_id FROM negociacoes WHERE id = ?', [negociacaoId])!.veiculo_id;
      } else {
        veiculoId = inserirVeiculo(b, veiculo, { origem: 'compra', preco_compra: Math.max(0, custo), data_entrada: texto(c.data) || hoje(), proprietario_id: null });
        auditar(b, u.id, 'entrada', 'veiculos', veiculoId);
      }
      const f = c.fipe ?? {};
      b.atualizar('veiculos', veiculoId, {
        documento_arquivo: documento || undefined,
        fipe_codigo: f.fipe_codigo ? texto(f.fipe_codigo) : undefined,
        fipe_modelo: f.fipe_modelo ? texto(f.fipe_modelo) : undefined,
        fipe_valor: f.fipe_valor ? r2(numero(f.fipe_valor)) : undefined,
        fipe_referencia: f.fipe_referencia ? texto(f.fipe_referencia) : undefined,
        descricao_catalogo: c.descricao_catalogo ? texto(c.descricao_catalogo).slice(0, 3000) : undefined,
      });
      if (f.fipe_valor) b.run("UPDATE veiculos SET fipe_consultado_em = datetime('now') WHERE id = ?", [veiculoId]);
      return { id: veiculoId, negociacao_id: negociacaoId };
    });
    return id;
  });

  // ---- Custos de preparação (funilaria, mecânica, documentação...) ----
  app.post('/api/veiculos/:id/custos', (req) => {
    const id = Number(req.params.id);
    const v = b.one('SELECT id, placa, modelo FROM veiculos WHERE id = ?', [id]) ?? falhar('Veículo não encontrado.', 404);
    const descricao = texto(req.corpo.descricao);
    const valor = r2(numero(req.corpo.valor));
    if (!descricao || valor <= 0) falhar('Informe descrição e valor do custo.');
    const data = texto(req.corpo.data) || hoje();
    return b.tx(() => {
      let tituloId: number | null = null;
      if (req.corpo.gerar_conta_pagar) {
        tituloId = b.inserir('titulos', {
          tipo: 'pagar', descricao: `${descricao} — ${v.modelo} ${v.placa}`, categoria: 'preparacao_veiculo',
          pessoa_id: req.corpo.fornecedor_id ? numero(req.corpo.fornecedor_id) : null, veiculo_id: id, valor,
          vencimento: texto(req.corpo.vencimento) || data,
        });
      }
      const cid = b.inserir('veiculo_custos', { veiculo_id: id, descricao, valor, data, titulo_id: tituloId });
      auditar(b, req.usuario!.id, 'custo', 'veiculos', id, { descricao, valor });
      return { id: cid };
    });
  });

  app.delete('/api/veiculos/:id/custos/:custoId', (req) => {
    const c = b.one('SELECT * FROM veiculo_custos WHERE id = ? AND veiculo_id = ?', [Number(req.params.custoId), Number(req.params.id)])
      ?? falhar('Custo não encontrado.', 404);
    b.tx(() => {
      if (c.titulo_id) {
        const t = b.one('SELECT status FROM titulos WHERE id = ?', [c.titulo_id]);
        if (t?.status === 'pago') falhar('A conta a pagar deste custo já foi paga; estorne o pagamento antes.');
        b.run("UPDATE titulos SET status = 'cancelado' WHERE id = ?", [c.titulo_id]);
      }
      b.run('DELETE FROM veiculo_custos WHERE id = ?', [c.id]);
    });
    auditar(b, req.usuario!.id, 'excluir_custo', 'veiculos', c.veiculo_id, c);
    return { ok: true };
  });

  // ---- Fotos (enviadas como data URL base64; o tipo é conferido pelo conteúdo) ----
  app.post('/api/veiculos/:id/fotos', async (req) => {
    const id = Number(req.params.id);
    if (!b.one('SELECT 1 FROM veiculos WHERE id = ?', [id])) falhar('Veículo não encontrado.', 404);
    if ((b.one('SELECT COUNT(*) AS q FROM veiculo_fotos WHERE veiculo_id = ?', [id])!.q as number) >= 40) falhar('Limite de 40 fotos por veículo.');
    const { buf, ext } = lerDataUrl(String(req.corpo.imagem ?? ''), { maxMb: 8 });
    await mkdir(pastaFotos, { recursive: true });
    const arquivo = `${id}-${randomBytes(8).toString('hex')}.${ext}`;
    await writeFile(join(pastaFotos, arquivo), buf);
    await enviarNuvem(join(pastaFotos, arquivo), buf);
    const ordem = (b.one('SELECT COALESCE(MAX(ordem), -1) + 1 AS o FROM veiculo_fotos WHERE veiculo_id = ?', [id])!).o;
    return { id: b.inserir('veiculo_fotos', { veiculo_id: id, arquivo, ordem }), arquivo };
  });

  // Nova ordem das fotos (a primeira é a capa no catálogo)
  app.put('/api/veiculos/:id/fotos/ordem', (req) => {
    const id = Number(req.params.id);
    const ids: number[] = Array.isArray(req.corpo.ids) ? req.corpo.ids.map(Number) : [];
    const atuais = new Set(b.all('SELECT id FROM veiculo_fotos WHERE veiculo_id = ?', [id]).map((f) => f.id));
    if (ids.length !== atuais.size || ids.some((f) => !atuais.has(f))) falhar('Lista de fotos não confere; recarregue a página.');
    b.tx(() => ids.forEach((f, i) => b.run('UPDATE veiculo_fotos SET ordem = ? WHERE id = ?', [i, f])));
    return { ok: true };
  });

  app.delete('/api/veiculos/:id/fotos/:fotoId', async (req) => {
    const f = b.one('SELECT * FROM veiculo_fotos WHERE id = ? AND veiculo_id = ?', [Number(req.params.fotoId), Number(req.params.id)])
      ?? falhar('Foto não encontrada.', 404);
    b.run('DELETE FROM veiculo_fotos WHERE id = ?', [f.id]);
    await unlink(join(pastaFotos, f.arquivo)).catch(() => undefined);
    await apagarNuvem(join(pastaFotos, f.arquivo));
    if (!b.one('SELECT 1 FROM veiculo_fotos WHERE veiculo_id = ?', [f.veiculo_id])) b.run('UPDATE veiculos SET publicado = 0 WHERE id = ?', [f.veiculo_id]);
    return { ok: true };
  });
}
