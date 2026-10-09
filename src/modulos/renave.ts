import type { App, Usuario } from '../http/app.js';
import type { Banco, Linha } from '../db/database.js';
import { falhar, texto, numero } from '../util/comum.js';
import { ClienteRenaveSimulado, ClienteRenaveHttp, type ClienteRenave, type RespostaRenave } from '../renave/cliente.js';
import { dataHoraNFe } from '../fiscal/chave.js';
import { certificadoDaEmpresa, type ConfigFiscal } from './fiscal.js';
import { auditar } from './auth.js';

export function clienteRenave(b: Banco, cfg: ConfigFiscal, injetado?: ClienteRenave): ClienteRenave {
  if (injetado) return injetado;
  const e = b.one('SELECT * FROM empresa WHERE id = 1')!;
  if (e.renave_modo === 'simulado') return new ClienteRenaveSimulado();
  return new ClienteRenaveHttp(e.renave_modo, e.renave_url_base, ClienteRenaveHttp.endpointsDoAmbiente(), certificadoDaEmpresa(b, cfg));
}

function registrar(b: Banco, u: Usuario, veiculoId: number, negId: number | null, tipo: string, modo: string, req: unknown, r: RespostaRenave) {
  return b.inserir('renave_operacoes', {
    veiculo_id: veiculoId, negociacao_id: negId, tipo, modo, status: r.ok ? 'sucesso' : 'erro', protocolo: r.protocolo ?? null,
    mensagem: r.mensagem, requisicao: JSON.stringify(req), resposta: JSON.stringify(r.bruto ?? null), criado_por: u.id,
  });
}

/** NF-e autorizada da negociação (exigida pelo RENAVE na entrada e na saída). */
function nfeAutorizada(b: Banco, negId: number): Linha | undefined {
  return b.one("SELECT chave FROM nfes WHERE negociacao_id = ? AND status = 'autorizada' ORDER BY id DESC LIMIT 1", [negId]);
}

export async function renaveEntrada(b: Banco, cfg: ConfigFiscal, u: Usuario, veiculoId: number, c: Linha, injetado?: ClienteRenave) {
  const v = b.one('SELECT * FROM veiculos WHERE id = ?', [veiculoId]) ?? falhar('Veículo não encontrado.', 404);
  if (!['estoque', 'reservado'].includes(v.situacao)) falhar('Veículo não está no estoque.');
  if (v.renave_status === 'em_estoque') falhar('Entrada já registrada no RENAVE.');
  if (v.condicao === 'novo') falhar('A entrada de veículo 0 km (fluxo de concessionária/montadora) não está implementada nesta versão. Registre pelo canal do RENAVE.');
  const neg = b.one(
    "SELECT * FROM negociacoes WHERE veiculo_id = ? AND tipo IN ('compra','consignacao') AND status = 'concluida' ORDER BY id DESC LIMIT 1", [v.id],
  ) ?? falhar('Não há negociação de entrada (compra, troca ou consignação) para este veículo.');
  const nfe = texto(c.chave_nfe) ? { chave: texto(c.chave_nfe) } : nfeAutorizada(b, neg.id);
  if (!nfe) falhar('Emita e autorize a NF-e de entrada antes de registrar no RENAVE (ou informe a chave da nota).');
  const vendedor = b.one('SELECT * FROM pessoas WHERE id = ?', [neg.pessoa_id])!;
  const e = b.one('SELECT email FROM empresa WHERE id = 1')!;
  const dados = {
    chassi: v.chassi, placa: v.placa, renavam: v.renavam, docVendedor: vendedor.cpf_cnpj, valor: neg.valor_final,
    chaveNFeEntrada: nfe!.chave, km: numero(c.km, v.km), dataHoraMedicaoKm: texto(c.data_medicao) || dataHoraNFe(new Date()),
    emailEstabelecimento: e.email, tipo: (neg.tipo === 'consignacao' ? 'consignacao' : 'compra') as 'compra' | 'consignacao',
    numeroAtpve: texto(c.numero_atpve) || undefined,
  };
  const cli = clienteRenave(b, cfg, injetado);
  const r = await cli.entrada(dados);
  b.tx(() => {
    registrar(b, u, v.id, neg.id, 'entrada', cli.modo, dados, r);
    b.atualizar('veiculos', v.id, r.ok ? { renave_status: 'em_estoque', renave_id: r.idEstoque ?? '', km: dados.km } : { renave_status: 'erro' });
  });
  auditar(b, u.id, 'renave_entrada', 'veiculos', v.id, { ok: r.ok });
  if (!r.ok) falhar(r.mensagem);
  return r;
}

export async function renaveSaida(b: Banco, cfg: ConfigFiscal, u: Usuario, negId: number, c: Linha, injetado?: ClienteRenave) {
  const neg = b.one('SELECT * FROM negociacoes WHERE id = ?', [negId]) ?? falhar('Negociação não encontrada.', 404);
  if (neg.tipo !== 'venda' || neg.status !== 'concluida') falhar('Saída no RENAVE é feita a partir de uma venda concluída.');
  const v = b.one('SELECT * FROM veiculos WHERE id = ?', [neg.veiculo_id])!;
  if (v.renave_status === 'saida') falhar('Saída já registrada no RENAVE.');
  if (v.renave_status !== 'em_estoque') falhar('Registre primeiro a entrada deste veículo no RENAVE.');
  const nfe = nfeAutorizada(b, neg.id) ?? falhar('Emita e autorize a NF-e de venda antes de registrar a saída no RENAVE.');
  const p = b.one('SELECT * FROM pessoas WHERE id = ?', [neg.pessoa_id])!;
  const dados = {
    idEstoque: v.renave_id, chassi: v.chassi, docComprador: p.cpf_cnpj, nomeComprador: p.nome, emailComprador: texto(c.email) || p.email,
    enderecoComprador: { logradouro: p.logradouro, numero: p.numero, complemento: p.complemento, bairro: p.bairro, codMunicipioIbge: p.cod_municipio, uf: p.uf, cep: p.cep },
    valor: neg.valor_final, chaveNFeVenda: nfe.chave, km: numero(c.km, neg.km_entrega ?? v.km), dataHoraMedicaoKm: texto(c.data_medicao) || dataHoraNFe(new Date()),
  };
  const cli = clienteRenave(b, cfg, injetado);
  const r = await cli.saida(dados);
  b.tx(() => {
    registrar(b, u, v.id, neg.id, 'saida', cli.modo, dados, r);
    if (r.ok) b.atualizar('veiculos', v.id, { renave_status: 'saida' });
  });
  auditar(b, u.id, 'renave_saida', 'veiculos', v.id, { ok: r.ok });
  if (!r.ok) falhar(r.mensagem);
  return r;
}

export function registrarRenave(app: App, b: Banco, cfg: ConfigFiscal, injetado?: ClienteRenave): void {

  app.get('/api/renave/operacoes', () => b.all(
    `SELECT o.id, o.veiculo_id, o.negociacao_id, o.tipo, o.modo, o.status, o.protocolo, o.mensagem, o.criado_em,
            v.marca, v.modelo, v.placa, v.chassi, u.nome AS usuario_nome
     FROM renave_operacoes o JOIN veiculos v ON v.id = o.veiculo_id LEFT JOIN usuarios u ON u.id = o.criado_por
     ORDER BY o.id DESC LIMIT 500`));

  app.get('/api/renave/pendencias', () => ({
    entradas: b.all(
      `SELECT v.id, v.marca, v.modelo, v.placa, v.chassi, v.renave_status, v.data_entrada FROM veiculos v
       WHERE v.situacao IN ('estoque','reservado') AND v.renave_status IN ('pendente','erro') ORDER BY v.data_entrada`),
    saidas: b.all(
      `SELECT n.id AS negociacao_id, v.id, v.marca, v.modelo, v.placa, v.chassi, n.data FROM negociacoes n JOIN veiculos v ON v.id = n.veiculo_id
       WHERE n.tipo = 'venda' AND n.status = 'concluida' AND v.renave_status = 'em_estoque' ORDER BY n.data`),
  }));

  app.post('/api/veiculos/:id/renave/entrada', (req) => renaveEntrada(b, cfg, req.usuario!, Number(req.params.id), req.corpo, injetado));
  app.post('/api/negociacoes/:id/renave/saida', (req) => renaveSaida(b, cfg, req.usuario!, Number(req.params.id), req.corpo, injetado));

  app.post('/api/veiculos/:id/renave/cancelar', async (req) => {
    const v = b.one('SELECT * FROM veiculos WHERE id = ?', [Number(req.params.id)]) ?? falhar('Veículo não encontrado.', 404);
    const motivo = texto(req.corpo.motivo);
    if (motivo.length < 10) falhar('Informe o motivo do cancelamento (mínimo 10 caracteres).');
    const cli = clienteRenave(b, cfg, injetado);
    let r: RespostaRenave;
    if (v.renave_status === 'saida') {
      r = await cli.cancelarSaida(v.renave_id, motivo);
      registrar(b, req.usuario!, v.id, null, 'cancelar_saida', cli.modo, { idEstoque: v.renave_id, motivo }, r);
      if (r.ok) b.atualizar('veiculos', v.id, { renave_status: 'em_estoque' });
    } else if (v.renave_status === 'em_estoque') {
      r = await cli.cancelarEntrada(v.renave_id, motivo);
      registrar(b, req.usuario!, v.id, null, 'cancelar_entrada', cli.modo, { idEstoque: v.renave_id, motivo }, r);
      if (r.ok) b.atualizar('veiculos', v.id, { renave_status: 'pendente', renave_id: '' });
    } else {
      return falhar('Não há registro ativo no RENAVE para cancelar.');
    }
    auditar(b, req.usuario!.id, 'renave_cancelar', 'veiculos', v.id, { ok: r.ok });
    if (!r.ok) falhar(r.mensagem);
    return r;
  });

  app.post('/api/veiculos/:id/renave/consultar', async (req) => {
    const v = b.one('SELECT * FROM veiculos WHERE id = ?', [Number(req.params.id)]) ?? falhar('Veículo não encontrado.', 404);
    const cli = clienteRenave(b, cfg, injetado);
    const r = await cli.consultar(v.chassi);
    registrar(b, req.usuario!, v.id, null, 'consulta', cli.modo, { chassi: v.chassi }, r);
    return r;
  });
}
