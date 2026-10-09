// Ponto de entrada na Vercel (demonstração). Cada instância monta o banco
// em /tmp, com a loja, o administrador e os veículos de exemplo.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

process.env.NODE_ENV = 'production';
process.env.CONFIAR_PROXY = '1';
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const pastaDados = '/tmp/erp-demo';

const { criarAplicacao } = await import(join(raiz, 'dist/aplicacao.js'));
const { criarUsuario } = await import(join(raiz, 'dist/modulos/auth.js'));
const { semearDemo } = await import(join(raiz, 'dist/scripts/demo.js'));

const novo = !existsSync(join(pastaDados, 'erp.db'));
const { app, banco } = criarAplicacao({
  pastaDados,
  pastaPublica: join(raiz, 'public'),
  pastaSite: join(raiz, 'site'),
  caminhoAdmin: process.env.ADMIN_PATH || 'painel-demo-loja',
});

if (novo || !banco.one('SELECT 1 FROM usuarios LIMIT 1')) {
  banco.run(`UPDATE empresa SET nome_fantasia = ?, razao_social = ?, cnpj = ?, logradouro = ?, numero = ?, bairro = ?, municipio = ?, uf = ?,
    whatsapp = ?, telefone = ?, horario = ?, instagram = ?, catalogo_titulo = ?, catalogo_sobre = ?, chave_pix = ?, cidade_contrato = ? WHERE id = 1`, [
    'CR Veículos', 'CR VEICULOS LTDA', '60696476000130', 'Rua Principal', '100', 'Centro', 'Ocara', 'CE',
    process.env.DEMO_WHATSAPP || '5585987346133', '', 'Seg a sex 8h às 18h, sáb 8h às 12h', 'crveiculos',
    'Seminovos revisados em Ocara e região', '', '60.696.476/0001-30', 'Ocara/CE',
  ]);
  criarUsuario(banco, { nome: 'Administrador (demonstração)', email: process.env.DEMO_EMAIL || 'admin@demo.com', senha: process.env.DEMO_SENHA || 'Demo2026loja', perfil: 'admin' });
  semearDemo(banco, join(pastaDados, 'fotos'));
}

export default function handler(req, res) {
  return app.tratarRequisicao(req, res);
}
