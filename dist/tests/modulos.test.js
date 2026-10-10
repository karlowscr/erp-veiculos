/** Contratos e assinatura, cobranças, carnês com Pix, documentos e importação. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarAplicacao } from '../aplicacao.js';
import { situacao } from '../modulos/cobrancas.js';
import { valorPorExtenso } from '../util/extenso.js';
import { pixCopiaECola } from '../util/pix.js';
import { lerCsv } from '../util/csv.js';
const pasta = mkdtempSync(join(tmpdir(), 'erp-mod-'));
const { app, banco } = criarAplicacao({ pastaDados: pasta, pastaPublica: join(pasta, 'pub') });
let servidor;
let base = '';
let cookie = '';
async function req(m, u, c) {
    const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: c ? JSON.stringify(c) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc)
        cookie = sc.split(';')[0];
    const txt = await r.text();
    let json = txt;
    try {
        json = JSON.parse(txt);
    }
    catch { /* html */ }
    return { status: r.status, json, txt };
}
async function ok(m, u, c) {
    const r = await req(m, u, c);
    assert.ok(r.status < 300, `${m} ${u} → ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
}
// PNG 1x1 transparente repetido para simular uma assinatura com tamanho realista
const PNG = 'data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='.repeat(1) + 'A'.repeat(600);
before(async () => {
    servidor = app.servidor();
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${servidor.address().port}`;
    await ok('POST', '/api/setup', { nome: 'Admin', email: 'a@loja.com', senha: 'senha-forte-1' });
    await ok('POST', '/api/login', { email: 'a@loja.com', senha: 'senha-forte-1' });
    await ok('PUT', '/api/empresa', { razao_social: 'CR Veiculos LTDA', nome_fantasia: 'CR Veículos', cnpj: '60696476000130', municipio: 'Ocara', uf: 'CE', chave_pix: '60.696.476/0001-30', whatsapp: '5585987346133' });
});
after(() => { servidor.close(); banco.fechar(); rmSync(pasta, { recursive: true, force: true }); });
test('valor por extenso e CSV com quebra de linha', () => {
    assert.equal(valorPorExtenso(15000), 'quinze mil reais');
    assert.equal(valorPorExtenso(42900), 'quarenta e dois mil e novecentos reais');
    assert.equal(valorPorExtenso(1250.5), 'mil duzentos e cinquenta reais e cinquenta centavos');
    assert.equal(valorPorExtenso(1_000_000), 'um milhão de reais');
    const l = lerCsv('"a","b"\n"x ""y""","linha1\nlinha2"\n');
    assert.deepEqual(l, [{ a: 'x "y"', b: 'linha1\nlinha2' }]);
});
test('Pix copia e cola com valor e CRC', () => {
    const c = pixCopiaECola({ chave: '60.696.476/0001-30', nome: 'CR Veículos LTDA', cidade: 'Ocara', valor: 5000, txid: 'C1P1' });
    assert.match(c, /^000201/);
    assert.match(c, /0114606964760001305204/);
    assert.match(c, /54075000\.00/);
    assert.match(c, /6304[0-9A-F]{4}$/);
});
test('contrato: criar, assinar com hash, travar edição, imprimir e garantia', async () => {
    const p = await ok('POST', '/api/pessoas', { cpf_cnpj: '52998224725', nome: 'Maria Teste', telefone: '85999990000', logradouro: 'Rua A', municipio: 'Ocara', uf: 'CE' });
    const mod = await ok('GET', '/api/contratos/modelo?tipo=venda');
    const { id } = await ok('POST', '/api/contratos', { ...mod, pessoa_id: p.id, veiculo_marca: 'Honda', veiculo_modelo: 'Bros 160', veiculo_ano: '2025', valor: 15000, forma_pagamento: 'Pix' });
    const c = await ok('GET', `/api/contratos/${id}`);
    assert.match(c.numero, /^CV-\d{5}$/);
    assert.equal(c.cliente_doc, '52998224725');
    assert.equal((await req('POST', `/api/contratos/${id}/assinar`, { assinatura: PNG })).status, 400, 'exige aceite');
    const r = await ok('POST', `/api/contratos/${id}/assinar`, { assinatura: PNG, aceite: true });
    assert.match(r.hash, /^[0-9a-f]{64}$/);
    assert.equal((await req('POST', `/api/contratos/${id}/assinar`, { assinatura: PNG, aceite: true })).status, 400);
    const e = await ok('PUT', `/api/contratos/${id}`, { valor: 1, obs: 'entregue' });
    assert.equal(e.somente_obs, true);
    const depois = await ok('GET', `/api/contratos/${id}`);
    assert.equal(depois.valor, 15000);
    assert.equal(depois.obs, 'entregue');
    const html = (await req('GET', `/api/contratos/${id}/imprimir`)).txt;
    assert.match(html, /quinze mil reais/);
    assert.match(html, /Assinado eletronicamente/);
    assert.match((await req('GET', `/api/contratos/${id}/garantia`)).txt, /CR Veiculos LTDA concede/);
    const pend = await ok('GET', '/api/contratos?status=pendente');
    assert.equal(pend.length, 0);
});
test('cobrança: situação calculada, pagamento lança no financeiro e estorno', async () => {
    const s = situacao({ parcelas_pagas: 1, total_parcelas: 3, primeiro_vencimento: '2026-08-10', valor_parcela: 500 }, '2026-10-09');
    assert.equal(s.situacao, 'atrasado');
    assert.equal(s.proximo_vencimento, '2026-09-10');
    assert.equal(s.parcelas_atrasadas, 1);
    assert.equal(s.saldo, 1000);
    const p = await ok('POST', '/api/pessoas', { cpf_cnpj: '11144477735', nome: 'Joao Teste', telefone: '85988887777' });
    const { id } = await ok('POST', '/api/cobrancas', { pessoa_id: p.id, descricao: 'Financiamento Titan', total_parcelas: 3, valor_parcela: 500, primeiro_vencimento: '2026-08-10' });
    let lista = await ok('GET', '/api/cobrancas');
    assert.equal(lista.resumo.atrasados, 1);
    await ok('POST', `/api/cobrancas/${id}/pagar`, { quantidade: 2, valor: 1000, data: '2026-10-09', forma: 'pix' });
    const tit = await ok('GET', '/api/titulos?status=pago');
    assert.equal(tit.filter((t) => t.categoria === 'cobranca').length, 2);
    lista = await ok('GET', '/api/cobrancas');
    assert.equal(lista.itens[0].parcelas_pagas, 2);
    await ok('POST', `/api/cobrancas/${id}/estornar`);
    assert.equal((await ok('GET', `/api/cobrancas/${id}`)).parcelas_pagas, 1);
    assert.equal((await req('PUT', `/api/cobrancas/${id}`, { parcelas_pagas: 0 })).status, 400, 'não apaga pagamento registrado editando');
    assert.match((await req('GET', `/api/cobrancas/${id}/imprimir`)).txt, /Extrato de parcelamento/);
    assert.match((await req('GET', '/api/cobrancas/relatorio')).txt, /Relatório de cobranças/);
});
test('carnê: gera QR Pix por parcela e cria cobrança vinculada', async () => {
    const { id } = await ok('POST', '/api/carnes', { cliente_nome: 'Paulo Teste', total_parcelas: 3, valor_parcela: 600, primeiro_vencimento: '2026-11-28', forma_pagamento: 'pix', criar_cobranca: true });
    const c = await ok('GET', `/api/carnes/${id}`);
    assert.equal(c.chave_pix, '60.696.476/0001-30', 'usa a chave padrão da loja');
    assert.ok(c.cobranca_id);
    const html = (await req('GET', `/api/carnes/${id}/imprimir`)).txt;
    assert.equal((html.match(/<section class="parcela">/g) ?? []).length, 3);
    assert.equal((html.match(/<svg xmlns/g) ?? []).length, 3);
    assert.match(html, /28\/01\/2027/);
    const lista = await ok('GET', '/api/carnes');
    assert.equal(lista[0].situacao, 'em_dia');
});
test('documentos com arquivo e acesso protegido', async () => {
    const jpg = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const { id } = await ok('POST', '/api/documentos', { tipo: 'CNH', nome: 'Maria Teste', numero: '123', arquivos: [jpg] });
    const d = await ok('GET', `/api/documentos/${id}`);
    assert.equal(d.arquivos.length, 1);
    assert.equal((await req('GET', d.arquivos[0].url)).status, 200);
    const sem = await fetch(base + d.arquivos[0].url);
    assert.equal(sem.status, 401, 'arquivo exige login');
    await ok('PUT', `/api/documentos/${id}`, { remover: [d.arquivos[0].id] });
    assert.equal((await ok('GET', `/api/documentos/${id}`)).arquivos.length, 0);
});
test('importação do sistema anterior e repetição sem duplicar', async () => {
    const clientes = '"address","notes","phone","city","name","cpf","state","email","id","created_date"\n"Rua X","obs\nlinha 2","85999990000","Ocara","Fulano de Tal","39053344705","Ceara","","c1","2026-03-10T10:00:00"\n"","","","Ocara","Sem Doc","000.000.000-00","CE","","c2","2026-03-10T10:00:00"\n';
    const contratos = '"date","city","buyerName","buyerCPF","client_id","number","vehicleBrand","vehicleModel","vehicleYear","amount","contract_type","paymentMethod","clauses","warranty_text","id"\n"2026-05-01","Ocara","Fulano de Tal","39053344705","c1","CV-11111","HONDA","POP","2019","2000","venda","Avista","","","k1"\n';
    const parc = '"end_date","client_phone","due_day","notes","total_installments","description","paid_installments","client_id","total_amount","installment_value","client_name","vehicle_info","start_date","status","id"\n"2026-12-01","85999990000","1","","4","Financiamento","1","c1","2000","500","Fulano de Tal","POP","2026-09-01","em_dia","i1"\n';
    const arquivos = [{ nome: 'Client.csv', conteudo: clientes }, { nome: 'Contract.csv', conteudo: contratos }, { nome: 'Installment.csv', conteudo: parc }];
    const r = await ok('POST', '/api/importar', { arquivos });
    assert.deepEqual(r.map((x) => [x.tipo, x.importados]), [['clientes', 2], ['contratos', 1], ['cobrancas', 1]]);
    assert.ok(r[0].avisos.some((a) => a.includes('Sem Doc')));
    const r2 = await ok('POST', '/api/importar', { arquivos });
    assert.deepEqual(r2.map((x) => x.importados), [0, 0, 0]);
    const pessoas = await ok('GET', '/api/pessoas?q=Fulano');
    const det = await ok('GET', `/api/pessoas/${pessoas[0].id}`);
    assert.equal(det.uf, 'CE');
    assert.equal(det.contratos.length, 1);
    assert.equal(det.cobrancas.length, 1);
});
test('mural: envio do cliente com travas, aprovação e foto sem dados de localização', async () => {
    // JPEG mínimo com um bloco EXIF (onde ficaria o GPS) que precisa sair
    const jpeg = (marca) => 'data:image/jpeg;base64,' + Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0e]), Buffer.from('Exif\0\0GPS123'),
        Buffer.from([0xff, 0xdb, 0x00, 0x04, 0x00, marca, 0xff, 0xda, 0x00, 0x04, 0x00, 0x00, 1, 2, 3, 0xff, 0xd9]),
    ]).toString('base64');
    const envio = { nome: 'Maria Cliente', telefone: '85999990000', veiculo: 'Honda HR-V', cidade: 'Ocara', mensagem: 'Amei! veja www.golpe.com', autorizo: true, inicio: Date.now() - 10000 };
    assert.equal((await req('POST', '/api/site/mural', { ...envio, imagem: jpeg(1), autorizo: false })).status, 400, 'sem autorização não entra');
    assert.equal((await req('POST', '/api/site/mural', { ...envio, imagem: jpeg(1), inicio: Date.now() })).status, 400, 'rápido demais (robô)');
    assert.equal((await req('POST', '/api/site/mural', { ...envio, imagem: PNG })).status, 400, 'do site só JPEG');
    await ok('POST', '/api/site/mural', { ...envio, imagem: jpeg(1) });
    const repetida = await req('POST', '/api/site/mural', { ...envio, imagem: jpeg(1) });
    assert.match(repetida.json.erro, /já foi enviada/);
    // Pendente: não aparece no site
    assert.match((await req('GET', '/mural')).txt, /esperando você/);
    const { lista } = await ok('GET', '/api/mural?status=pendente');
    assert.equal(lista.length, 1);
    assert.equal(lista[0].mensagem, 'Amei! veja', 'links saem do recado');
    assert.equal((await req('GET', `/mural-fotos/${lista[0].arquivo}`)).status, 404, 'foto pendente não é pública');
    const { readFileSync } = await import('node:fs');
    assert.ok(!readFileSync(join(pasta, 'arquivos', 'mural', lista[0].arquivo)).includes('GPS123'), 'EXIF/GPS apagado');
    // Aprovada: aparece
    await ok('PUT', `/api/mural/${lista[0].id}`, { status: 'aprovado' });
    const pg = await req('GET', '/mural');
    assert.match(pg.txt, /Maria Cliente/);
    assert.match(pg.txt, /Sou cliente CR Veículos/);
    assert.equal((await req('GET', `/mural-fotos/${lista[0].arquivo}`)).status, 200);
    assert.equal((await req('GET', `/mural/${lista[0].id}`)).status, 200);
    assert.ok(!(await req('GET', `/mural/${lista[0].id}`)).txt.includes('85999990000'), 'WhatsApp não aparece no site');
    // Limite por dia: 3 envios
    await ok('POST', '/api/site/mural', { ...envio, imagem: jpeg(2) });
    await ok('POST', '/api/site/mural', { ...envio, imagem: jpeg(3) });
    assert.equal((await req('POST', '/api/site/mural', { ...envio, imagem: jpeg(4) })).status, 429);
    assert.equal((await ok('GET', '/api/contadores')).mural_pendentes, 2);
});
