/**
 * Teste de ponta a ponta pela API HTTP: compra, NF-e de entrada, RENAVE,
 * venda com troca e financiamento, NF-e de venda, carta de correção,
 * cancelamentos, consignação e devolução, financeiro, comissões e permissões.
 * Usa a SEFAZ simulada (que confere a assinatura de verdade) e o RENAVE simulado.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { criarAplicacao } from '../aplicacao.js';
import { transporteSimulado } from '../fiscal/simulador.js';
import type { Transporte } from '../fiscal/sefaz.js';

process.env.NFE_SIMULADO = '1';
const pasta = mkdtempSync(join(tmpdir(), 'erp-teste-'));
const captura = process.env.CAPTURA_DIR;
let n = 0;
const transporte: Transporte = {
  async enviar(url, servico, envelope, cert) {
    if (captura) { mkdirSync(captura, { recursive: true }); writeFileSync(join(captura, `${String(++n).padStart(2, '0')}-${servico}.xml`), envelope); }
    return transporteSimulado.enviar(url, servico, envelope, cert);
  },
};
const { app, banco } = criarAplicacao({ pastaDados: pasta, pastaPublica: join(pasta, 'pub'), transporteSefaz: transporte });
let servidor: Server;
let base = '';

class Cliente {
  cookie = '';
  async req(metodo: string, url: string, corpo?: unknown) {
    const r = await fetch(base + url, {
      method: metodo,
      headers: { ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const txt = await r.text();
    let json: any = txt;
    try { json = JSON.parse(txt); } catch { /* html/xml */ }
    return { status: r.status, json, txt };
  }
  async ok(metodo: string, url: string, corpo?: unknown) {
    const r = await this.req(metodo, url, corpo);
    assert.ok(r.status < 300, `${metodo} ${url} → ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  }
}
const adm = new Cliente();

before(async () => {
  servidor = app.servidor();
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
after(() => {
  servidor.close();
  banco.fechar();
  rmSync(pasta, { recursive: true, force: true });
});

const end = { cep: '60110000', logradouro: 'Av. Santos Dumont', numero: '1000', bairro: 'Aldeota', municipio: 'Fortaleza', uf: 'CE', cod_municipio: '2304400' };
const veiculo1 = { condicao: 'usado', marca: 'Fiat', modelo: 'Argo', versao: 'Drive 1.0', ano_fab: 2021, ano_mod: 2022, placa: 'PMX1A23', renavam: '01234567897', chassi: '9BD358A1NMY123456', cor: 'Branco', km: 42000, preco_venda: 72000, preco_minimo: 68000 };
const ids: Record<string, number> = {};

test('primeiro acesso, login e configuração da empresa', async () => {
  assert.equal((await adm.ok('GET', '/api/setup')).precisaSetup, true);
  assert.equal((await adm.req('GET', '/api/me')).status, 401);
  await adm.ok('POST', '/api/setup', { nome: 'Dono da Loja', email: 'dono@loja.com', senha: 'senha-forte-1' });
  assert.equal((await adm.req('POST', '/api/setup', { nome: 'X', email: 'x@x.com', senha: '12345678' })).status, 409);
  assert.equal((await adm.req('POST', '/api/login', { email: 'dono@loja.com', senha: 'errada' })).status, 401);
  await adm.ok('POST', '/api/login', { email: 'dono@loja.com', senha: 'senha-forte-1' });
  await adm.ok('PUT', '/api/empresa', {
    cnpj: '11.222.333/0001-81', razao_social: 'Pátio Veículos LTDA', nome_fantasia: 'Pátio Veículos', ie: '06.123456-7', crt: 1,
    ...end, telefone: '85 3333-0000', email: 'loja@patio.com', nfe_ambiente: 2, nfe_serie: 1, nfe_proximo_numero: 100, comissao_padrao_pct: 1, renave_modo: 'simulado',
  });
  const e = await adm.ok('GET', '/api/empresa');
  assert.equal(e.cnpj, '11222333000181');
  assert.equal(e.cert_senha, undefined, 'senha do certificado nunca é devolvida');
});

test('cadastros de pessoas com validação', async () => {
  assert.equal((await adm.req('POST', '/api/pessoas', { cpf_cnpj: '123.456.789-00', nome: 'Inválido' })).status, 400);
  ids.vendedorPf = (await adm.ok('POST', '/api/pessoas', { cpf_cnpj: '529.982.247-25', nome: 'Carlos Vendedor', email: 'carlos@ex.com', ...end, fornecedor: true })).id;
  ids.cliente = (await adm.ok('POST', '/api/pessoas', { cpf_cnpj: '111.444.777-35', nome: 'Maria Compradora', email: 'maria@ex.com', ...end })).id;
  ids.banco = (await adm.ok('POST', '/api/pessoas', { cpf_cnpj: '60.701.190/0001-04', nome: 'Banco Financiador SA', ie: 'ISENTO', ...end, cliente: false, fornecedor: true })).id;
  assert.equal((await adm.req('POST', '/api/pessoas', { cpf_cnpj: '52998224725', nome: 'Duplicado' })).status, 409);
  const p = await adm.ok('GET', `/api/pessoas/${ids.banco}`);
  assert.equal(p.ind_ie_dest, 2);
});

test('compra com pagamento, custo de preparação e validação de veículo', async () => {
  const ruim = await adm.req('POST', '/api/negociacoes/compra', { pessoa_id: ids.vendedorPf, valor: 1000, veiculo: { ...veiculo1, chassi: 'CURTO' } });
  assert.equal(ruim.status, 400);
  const r = await adm.ok('POST', '/api/negociacoes/compra', { pessoa_id: ids.vendedorPf, valor: 58000, veiculo: veiculo1, pagamentos: [{ forma: 'pix', valor: 58000 }] });
  ids.compra = r.id;
  const n = await adm.ok('GET', `/api/negociacoes/${r.id}`);
  ids.v1 = n.veiculo.id;
  assert.equal(n.titulos.length, 1);
  assert.equal(n.titulos[0].status, 'pago');
  await adm.ok('POST', `/api/veiculos/${ids.v1}/custos`, { descricao: 'Polimento e higienização', valor: 800, gerar_conta_pagar: true });
  const v = await adm.ok('GET', `/api/veiculos/${ids.v1}`);
  assert.equal(v.custo_total, 58800);
  assert.equal(v.situacao, 'estoque');
});

test('NF-e de entrada autorizada e entrada no RENAVE', async () => {
  const sem = await adm.req('POST', `/api/veiculos/${ids.v1}/renave/entrada`, { km: 42000 });
  assert.equal(sem.status, 400, 'RENAVE exige NF-e de entrada');
  const previa = await adm.ok('GET', `/api/negociacoes/${ids.compra}/nfe/previa`);
  assert.equal(previa.cfop, '1102');
  const nf = await adm.ok('POST', `/api/negociacoes/${ids.compra}/nfe`, {});
  assert.equal(nf.status, 'autorizada', JSON.stringify(nf));
  assert.equal(nf.numero, 100);
  ids.nfeEntrada = nf.id;
  const de2 = await adm.req('POST', `/api/negociacoes/${ids.compra}/nfe`, {});
  assert.equal(de2.status, 400, 'não emite duas vezes');
  const xml = (await adm.req('GET', `/api/nfes/${nf.id}/xml`)).txt;
  assert.match(xml, /^<\?xml[^>]*\?><nfeProc /);
  assert.match(xml, /<tpNF>0<\/tpNF>/);
  assert.match(xml, /<tPag>90<\/tPag><vPag>0.00<\/vPag>/);
  assert.match(xml, /NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO/);
  const r = await adm.ok('POST', `/api/veiculos/${ids.v1}/renave/entrada`, { km: 42000 });
  assert.ok(r.ok);
  assert.equal((await adm.ok('GET', `/api/veiculos/${ids.v1}`)).renave_status, 'em_estoque');
});

test('venda com troca e financiamento, comissão e títulos', async () => {
  const vend = await adm.ok('POST', '/api/usuarios', { nome: 'João Vendedor', email: 'joao@loja.com', senha: 'vendedor-123', perfil: 'vendedor', comissao_pct: 1.5 });
  ids.userVendedor = vend.id;
  const corpo = {
    veiculo_id: ids.v1, pessoa_id: ids.cliente, vendedor_id: vend.id, valor: 72000, desconto: 1000, km_entrega: 42050,
    troca: { valor: 25000, veiculo: { condicao: 'usado', marca: 'VW', modelo: 'Gol', ano_fab: 2015, ano_mod: 2016, placa: 'HXY4321', renavam: '00639773700', chassi: '9BWAA05U5GP012345', km: 98000, preco_venda: 32000 } },
    pagamentos: [{ forma: 'pix', valor: 6000 }, { forma: 'financiamento', valor: 40000, pessoa_id: ids.banco }],
  };
  // RENAVAM da troca precisa de DV válido: corrige antes de enviar
  const b = corpo.troca.veiculo.renavam.slice(0, 10);
  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let dv = (pesos.reduce((s, p, i) => s + p * Number(b[i]), 0) * 10) % 11;
  if (dv === 10) dv = 0;
  corpo.troca.veiculo.renavam = b + dv;

  const errada = await adm.req('POST', '/api/negociacoes/venda', { ...corpo, pagamentos: [{ forma: 'pix', valor: 100 }] });
  assert.equal(errada.status, 400, 'pagamentos precisam fechar com o valor');
  const r = await adm.ok('POST', '/api/negociacoes/venda', corpo);
  ids.venda = r.id;
  const n = await adm.ok('GET', `/api/negociacoes/${r.id}`);
  assert.equal(n.valor_final, 71000);
  assert.equal(n.comissao_valor, 1065);
  assert.ok(n.troca, 'veículo da troca registrado');
  ids.vTroca = n.troca.id;
  // A troca vira uma compra com NF-e de entrada própria, que pode ser emitida logo após a venda
  assert.equal(r.troca_veiculo_id, n.troca.id);
  assert.ok(r.troca_negociacao_id && n.troca.negociacao_id === r.troca_negociacao_id, 'compra da troca ligada à venda');
  const previaTroca = await adm.ok('GET', `/api/negociacoes/${r.troca_negociacao_id}/nfe/previa`);
  assert.match(String(previaTroca.cfop), /^1/, 'NF-e de entrada (CFOP 1xxx)');
  assert.equal((await adm.req('POST', `/api/veiculos/${n.troca.id}/documento`, { documento: 'docveic-0000000000000000.jpg' })).status, 400, 'só documento lido de verdade');
  assert.equal(n.resultado, 71000 - 58800 - 1065);
  const receber = n.titulos.filter((t: any) => t.tipo === 'receber');
  assert.equal(receber.length, 2);
  assert.equal(receber.find((t: any) => t.forma === 'financiamento').pessoa_id, ids.banco);
  assert.equal((await adm.ok('GET', `/api/veiculos/${ids.v1}`)).situacao, 'vendido');
  const vt = await adm.ok('GET', `/api/veiculos/${ids.vTroca}`);
  assert.equal(vt.origem, 'troca');
  assert.equal(vt.preco_compra, 25000);
});

test('NF-e de venda, saída no RENAVE e carta de correção', async () => {
  const nf = await adm.ok('POST', `/api/negociacoes/${ids.venda}/nfe`, {});
  assert.equal(nf.status, 'autorizada', JSON.stringify(nf));
  assert.equal(nf.numero, 101);
  ids.nfeVenda = nf.id;
  const xml = (await adm.req('GET', `/api/nfes/${nf.id}/xml`)).txt;
  assert.match(xml, /<CFOP>5102<\/CFOP>/);
  assert.match(xml, /<vDesc>1000.00<\/vDesc>/);
  assert.match(xml, /<vNF>71000.00<\/vNF>/);
  assert.match(xml, /<tPag>17<\/tPag>/);
  assert.match(xml, /<xPag>Financiamento bancario<\/xPag>/);
  assert.match(xml, /<xPag>Veiculo usado recebido na troca<\/xPag>/);
  assert.match(xml, /CHASSI 9BD358A1NMY123456/);
  assert.match(xml, /<nProt>\d+<\/nProt>/);
  const danfe = await adm.req('GET', `/api/nfes/${nf.id}/danfe`);
  assert.match(danfe.txt, /DANFE/);
  assert.match(danfe.txt, /<svg/);
  const s = await adm.ok('POST', `/api/negociacoes/${ids.venda}/renave/saida`, { km: 42050 });
  assert.ok(s.ok);
  const cce = await adm.ok('POST', `/api/nfes/${nf.id}/carta-correcao`, { correcao: 'Correção da cor do veículo: onde se lê Branco, leia-se Branco Banchisa.' });
  assert.equal(cce.sequencia, 1);
});

test('cancelamento respeita a ordem: NF-e, RENAVE, negociação', async () => {
  const c1 = await adm.req('POST', `/api/negociacoes/${ids.venda}/cancelar`, { motivo: 'Cliente desistiu' });
  assert.equal(c1.status, 400);
  assert.match(c1.json.erro, /NF-e/);
  assert.equal((await adm.req('POST', `/api/nfes/${ids.nfeVenda}/cancelar`, { justificativa: 'curta' })).status, 400);
  await adm.ok('POST', `/api/nfes/${ids.nfeVenda}/cancelar`, { justificativa: 'Cliente desistiu da compra antes da entrega' });
  const c2 = await adm.req('POST', `/api/negociacoes/${ids.venda}/cancelar`, { motivo: 'Cliente desistiu' });
  assert.match(c2.json.erro, /RENAVE/);
  await adm.ok('POST', `/api/veiculos/${ids.v1}/renave/cancelar`, { motivo: 'Venda desfeita pelo cliente' });
  await adm.ok('POST', `/api/negociacoes/${ids.venda}/cancelar`, { motivo: 'Cliente desistiu' });
  const v = await adm.ok('GET', `/api/veiculos/${ids.v1}`);
  assert.equal(v.situacao, 'estoque');
  assert.equal(v.renave_status, 'em_estoque');
  assert.equal((await adm.ok('GET', `/api/veiculos/${ids.vTroca}`)).situacao, 'devolvido');
  const com = await adm.ok('GET', '/api/comissoes');
  assert.equal(com[0].status, 'cancelada');
  const nfes = await adm.ok('GET', '/api/nfes');
  assert.equal(nfes.find((x: any) => x.id === ids.nfeVenda).status, 'cancelada');
});

test('consignação: entrada, devolução com NF-e referenciada', async () => {
  const r = await adm.ok('POST', '/api/negociacoes/consignacao', {
    pessoa_id: ids.vendedorPf, valor_repasse: 40000,
    veiculo: { condicao: 'usado', marca: 'Honda', modelo: 'City', ano_fab: 2019, ano_mod: 2019, placa: 'OSB2C34', renavam: '01234567897', chassi: '93HGM6650KZ123456', km: 60000, preco_venda: 46000 },
  });
  const n = await adm.ok('GET', `/api/negociacoes/${r.id}`);
  assert.equal(n.titulos.length, 0, 'consignação não gera financeiro na entrada');
  const nf = await adm.ok('POST', `/api/negociacoes/${r.id}/nfe`, {});
  assert.equal(nf.status, 'autorizada');
  assert.match((await adm.req('GET', `/api/nfes/${nf.id}/xml`)).txt, /<CFOP>1917<\/CFOP>/);
  const dev = await adm.ok('POST', '/api/negociacoes/devolucao-consignacao', { veiculo_id: n.veiculo.id });
  const nfd = await adm.ok('POST', `/api/negociacoes/${dev.id}/nfe`, {});
  assert.equal(nfd.status, 'autorizada', JSON.stringify(nfd));
  const xml = (await adm.req('GET', `/api/nfes/${nfd.id}/xml`)).txt;
  assert.match(xml, /<finNFe>4<\/finNFe>/);
  assert.match(xml, new RegExp(`<refNFe>${nf.chave}</refNFe>`));
  assert.match(xml, /<CFOP>5918<\/CFOP>/);
});

test('venda de consignado gera repasse; financeiro e comissões', async () => {
  const r = await adm.ok('POST', '/api/negociacoes/consignacao', {
    pessoa_id: ids.vendedorPf, valor_repasse: 30000,
    veiculo: { condicao: 'usado', marca: 'Toyota', modelo: 'Etios', ano_fab: 2018, ano_mod: 2018, placa: 'PNA5E67', renavam: '01234567897', chassi: '9BRB29BT2J2123456', km: 70000, preco_venda: 36000 },
  });
  const vId = (await adm.ok('GET', `/api/negociacoes/${r.id}`)).veiculo.id;
  const venda = await adm.ok('POST', '/api/negociacoes/venda', {
    veiculo_id: vId, pessoa_id: ids.cliente, vendedor_id: ids.userVendedor, valor: 35000, pagamentos: [{ forma: 'boleto', valor: 35000, parcelas: 3 }],
  });
  const n = await adm.ok('GET', `/api/negociacoes/${venda.id}`);
  const repasse = n.titulos.find((t: any) => t.categoria === 'repasse_consignacao');
  assert.equal(repasse.valor, 30000);
  assert.equal(n.titulos.filter((t: any) => t.tipo === 'receber').length, 3);
  assert.equal(n.resultado, 35000 - 30000 - 525);
  const prev = await adm.ok('GET', `/api/negociacoes/${venda.id}/nfe/previa`);
  assert.equal(prev.cfop, '5115');

  const boleto = n.titulos.find((t: any) => t.tipo === 'receber' && t.parcela === 1);
  await adm.ok('POST', `/api/titulos/${boleto.id}/baixar`, { valor_pago: boleto.valor, forma: 'boleto' });
  await adm.ok('POST', `/api/titulos/${boleto.id}/estornar`);
  await adm.ok('POST', `/api/titulos/${boleto.id}/baixar`, {});
  const lanc = await adm.ok('POST', '/api/titulos', { tipo: 'pagar', descricao: 'Aluguel do pátio', categoria: 'aluguel', valor: 3000, parcelas: 2, vencimento: '2026-11-05' });
  assert.equal(lanc.ids.length, 2);
  const res = await adm.ok('GET', '/api/financeiro/resumo');
  assert.ok(res.recebido >= boleto.valor);

  const com = (await adm.ok('GET', '/api/comissoes?status=pendente'));
  assert.equal(com.length, 1);
  await adm.ok('POST', '/api/comissoes/pagar', { ids: [com[0].id] });
  assert.equal((await adm.ok('GET', '/api/comissoes?status=paga')).length, 1);
  const painel = await adm.ok('GET', '/api/painel');
  assert.equal(painel.estoque.qtd, 1, "só o Argo (venda desfeita) segue no pátio");
});

test('permissões por perfil', async () => {
  const vend = new Cliente();
  await vend.ok('POST', '/api/login', { email: 'joao@loja.com', senha: 'vendedor-123' });
  assert.equal((await vend.req('POST', '/api/negociacoes/compra', {})).status, 403);
  assert.equal((await vend.req('PUT', '/api/empresa', {})).status, 403);
  assert.equal((await vend.req('GET', '/api/titulos')).status, 403);
  assert.equal((await vend.req('POST', `/api/nfes/${ids.nfeEntrada}/cancelar`, {})).status, 403);
  const minhas = await vend.ok('GET', '/api/comissoes');
  assert.ok(minhas.every((c: any) => c.usuario_id === ids.userVendedor));
  // Venda abaixo do mínimo exige gerente
  const abaixo = await vend.req('POST', '/api/negociacoes/venda', { veiculo_id: ids.v1, pessoa_id: ids.cliente, valor: 60000, pagamentos: [{ forma: 'pix', valor: 60000 }] });
  assert.equal(abaixo.status, 400);
  assert.match(abaixo.json.erro, /mínimo/);
  await vend.ok('POST', '/api/logout');
  assert.equal((await vend.req('GET', '/api/me')).status, 401);
});
