import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpfValido, cnpjValido, renavamValido, chassiValido, placaValida } from '../util/validacao.js';
import { parcelar, somarMeses, r2 } from '../util/comum.js';
import { dvChave, montarChave } from '../fiscal/chave.js';
import { PADROES_CODE128, code128C } from '../fiscal/danfe.js';
import { t, g } from '../fiscal/xml.js';

test('CPF e CNPJ (inclusive alfanumérico)', () => {
  assert.ok(cpfValido('529.982.247-25'));
  assert.ok(!cpfValido('529.982.247-26'));
  assert.ok(!cpfValido('111.111.111-11'));
  assert.ok(cnpjValido('11.222.333/0001-81'));
  assert.ok(!cnpjValido('11.222.333/0001-82'));
  assert.ok(cnpjValido('12.ABC.345/01DE-35'), 'exemplo oficial da Receita de CNPJ alfanumérico');
});

test('RENAVAM, chassi e placa', () => {
  // Monta um RENAVAM com DV calculado à parte
  const base = '0063977370';
  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let dv = (pesos.reduce((s, p, i) => s + p * Number(base[i]), 0) * 10) % 11;
  if (dv === 10) dv = 0;
  assert.ok(renavamValido(base + dv));
  assert.ok(!renavamValido(base + ((dv + 1) % 10)));
  assert.ok(chassiValido('9BWZZZ377VT004251'));
  assert.ok(!chassiValido('9BWZZZ377VT00425I'), 'letra I não é permitida');
  assert.ok(placaValida('ABC1D23') && placaValida('ABC-1234') && !placaValida('AB1234'));
});

test('parcelamento fecha centavos e datas de vencimento', () => {
  const p = parcelar(1000, 3);
  assert.equal(r2(p.reduce((a, b) => a + b, 0)), 1000);
  assert.deepEqual(p, [333.34, 333.33, 333.33]);
  assert.equal(somarMeses('2026-01-31', 1), '2026-02-28');
  assert.equal(somarMeses('2026-11-15', 3), '2027-02-15');
});

test('chave de acesso: DV do exemplo do manual da NF-e', () => {
  assert.equal(dvChave('5206043300991100250655012000000780026730161'), 5);
  const { chave } = montarChave({ uf: 'CE', dhEmi: '2026-10-09T10:00:00-03:00', cnpj: '11222333000181', serie: 1, numero: 42, cNF: '12345678' });
  assert.equal(chave.length, 44);
  assert.equal(chave.slice(0, 6), '232610');
  assert.equal(Number(chave[43]), dvChave(chave.slice(0, 43)));
});

test('tabela Code 128 íntegra e código de barras gera SVG', () => {
  assert.equal(PADROES_CODE128.length, 106);
  for (const p of PADROES_CODE128) assert.equal([...p].reduce((s, c) => s + Number(c), 0), 11, p);
  assert.equal(new Set(PADROES_CODE128).size, 106);
  assert.match(code128C('23261011222333000181550010000000421123456780'), /^<svg/);
});

test('XML canônico: escapa texto e omite vazios', () => {
  assert.equal(t('a', 'x & <y> "z"'), '<a>x &amp; &lt;y&gt; "z"</a>');
  assert.equal(t('a', ''), '');
  assert.equal(g('b', t('a', ''), ''), '');
});
