import type { App } from '../http/app.js';
import type { Banco, Linha } from '../db/database.js';
import { falhar, texto } from '../util/comum.js';
import { docValido, limparDoc, soDigitos, emailValido } from '../util/validacao.js';
import { auditar } from './auth.js';

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

export function validarPessoa(c: Linha): Linha {
  const doc = limparDoc(c.cpf_cnpj);
  // CPF/CNPJ é opcional no cadastro rápido; é exigido na hora da NF-e e do RENAVE
  if (doc && !docValido(doc)) falhar('CPF/CNPJ inválido. Confira os dígitos ou deixe em branco.');
  const tipo = doc.length === 14 ? 'PJ' : 'PF';
  const nome = texto(c.nome);
  if (nome.length < 2) falhar('Informe o nome.');
  const email = texto(c.email);
  if (email && !emailValido(email)) falhar('E-mail inválido.');
  const uf = texto(c.uf).toUpperCase();
  if (uf && !UFS.includes(uf)) falhar('UF inválida.');
  const codMun = soDigitos(c.cod_municipio);
  if (codMun && codMun.length !== 7) falhar('Código do município (IBGE) deve ter 7 dígitos.');
  const ie = limparDoc(c.ie) === 'ISENTO' ? 'ISENTO' : soDigitos(c.ie);
  // indIEDest: 1 contribuinte com IE, 2 isento, 9 não contribuinte (PF sempre 9)
  const ind = tipo === 'PF' ? 9 : ie === 'ISENTO' ? 2 : ie ? 1 : 9;
  return {
    tipo, cpf_cnpj: doc || null, nome, email, uf, cod_municipio: codMun, ie: ie === 'ISENTO' ? '' : ie, ind_ie_dest: ind,
    rg: texto(c.rg), nascimento: texto(c.nascimento), telefone: texto(c.telefone),
    logradouro: texto(c.logradouro), numero: texto(c.numero), complemento: texto(c.complemento),
    bairro: texto(c.bairro), municipio: texto(c.municipio), cep: soDigitos(c.cep),
    cliente: c.cliente === undefined ? true : !!c.cliente, fornecedor: !!c.fornecedor, obs: texto(c.obs),
  };
}

/** Confere se a pessoa tem o endereço completo exigido pela NF-e. */
export function pendenciasEnderecoNFe(p: Linha): string[] {
  const falta: string[] = [];
  if (!p.cpf_cnpj) falta.push('CPF/CNPJ');
  for (const [campo, nome] of [['logradouro', 'logradouro'], ['numero', 'número'], ['bairro', 'bairro'], ['cod_municipio', 'código IBGE do município'], ['municipio', 'município'], ['uf', 'UF'], ['cep', 'CEP']]) {
    if (!p[campo]) falta.push(nome);
  }
  return falta;
}

export function registrarPessoas(app: App, b: Banco): void {
  app.get('/api/pessoas', (req) => {
    const q = `%${texto(req.query.get('q'))}%`;
    const papel = req.query.get('papel');
    const filtro = papel === 'cliente' ? 'AND cliente = 1' : papel === 'fornecedor' ? 'AND fornecedor = 1' : '';
    return b.all(
      `SELECT id, tipo, cpf_cnpj, nome, telefone, email, logradouro, municipio, uf, cliente, fornecedor FROM pessoas
       WHERE (nome LIKE ? OR cpf_cnpj LIKE ? OR telefone LIKE ?) ${filtro} ORDER BY lower(nome) LIMIT 1000`,
      [q, `%${limparDoc(req.query.get('q') ?? '')}%`, q]);
  });

  app.get('/api/pessoas/:id', (req) => {
    const p = b.one('SELECT * FROM pessoas WHERE id = ?', [Number(req.params.id)]) ?? falhar('Pessoa não encontrada.', 404);
    const negociacoes = b.all(
      `SELECT n.id, n.tipo, n.data, n.valor_final, n.status, v.marca, v.modelo, v.placa FROM negociacoes n
       JOIN veiculos v ON v.id = n.veiculo_id WHERE n.pessoa_id = ? ORDER BY n.data DESC`, [p.id]);
    return {
      ...p, negociacoes,
      contratos: b.all('SELECT id, numero, tipo, data, valor, assinado_em FROM contratos WHERE pessoa_id = ? ORDER BY data DESC', [p.id]),
      cobrancas: b.all('SELECT id, descricao, total_parcelas, parcelas_pagas, valor_parcela FROM cobrancas WHERE pessoa_id = ? ORDER BY id DESC', [p.id]),
      documentos: b.all('SELECT id, tipo, numero FROM documentos WHERE pessoa_id = ? ORDER BY id DESC', [p.id]),
    };
  });

  app.post('/api/pessoas', (req) => {
    const id = b.inserir('pessoas', validarPessoa(req.corpo));
    auditar(b, req.usuario!.id, 'criar', 'pessoas', id);
    return { id };
  });

  app.put('/api/pessoas/:id', (req) => {
    const id = Number(req.params.id);
    if (!b.one('SELECT 1 FROM pessoas WHERE id = ?', [id])) falhar('Pessoa não encontrada.', 404);
    b.atualizar('pessoas', id, validarPessoa(req.corpo));
    auditar(b, req.usuario!.id, 'alterar', 'pessoas', id);
    return { ok: true };
  });

  app.delete('/api/pessoas/:id', (req) => {
    const id = Number(req.params.id);
    const usada = b.one(
      `SELECT 1 FROM negociacoes WHERE pessoa_id = ? UNION SELECT 1 FROM titulos WHERE pessoa_id = ?
       UNION SELECT 1 FROM veiculos WHERE proprietario_id = ? UNION SELECT 1 FROM contratos WHERE pessoa_id = ?
       UNION SELECT 1 FROM cobrancas WHERE pessoa_id = ? UNION SELECT 1 FROM carnes WHERE pessoa_id = ?
       UNION SELECT 1 FROM documentos WHERE pessoa_id = ? LIMIT 1`, [id, id, id, id, id, id, id]);
    if (usada) falhar('Esta pessoa tem negociações, contratos, cobranças, carnês ou documentos vinculados e não pode ser excluída.');
    b.run('DELETE FROM pessoas WHERE id = ?', [id]);
    auditar(b, req.usuario!.id, 'excluir', 'pessoas', id);
    return { ok: true };
  });

}
