// Ponto de entrada na Vercel.
//
// Com o Supabase ligado ao projeto (variáveis POSTGRES_URL, SUPABASE_URL e
// SUPABASE_SERVICE_ROLE_KEY, criadas pela integração), os dados ficam no
// PostgreSQL do Supabase e os arquivos (fotos, documentos, logo, certificado)
// no Supabase Storage. Sem essas variáveis, roda como demonstração em /tmp.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

process.env.NODE_ENV = 'production';
process.env.CONFIAR_PROXY = '1';
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const pastaDados = '/tmp/erp-dados';
const urlBanco = process.env.POSTGRES_URL || process.env.DATABASE_URL || undefined;

const { criarAplicacao } = await import(join(raiz, 'dist/aplicacao.js'));
const { criarUsuario } = await import(join(raiz, 'dist/modulos/auth.js'));
const { semearDemo } = await import(join(raiz, 'dist/scripts/demo.js'));
const { enviarNuvem, trazerDaNuvem, nuvemAtiva } = await import(join(raiz, 'dist/util/nuvem.js'));

const { app, banco } = criarAplicacao({
  pastaDados,
  arquivoBanco: urlBanco,
  pastaPublica: join(raiz, 'public'),
  pastaSite: join(raiz, 'site'),
  caminhoAdmin: process.env.ADMIN_PATH || undefined,
});

// Primeira vez: dados da loja, o administrador e os veículos de exemplo do catálogo
if (!banco.one('SELECT 1 FROM usuarios LIMIT 1')) {
  banco.tx(() => {
    if (!banco.one("SELECT 1 FROM usuarios LIMIT 1")) {
      banco.run(`UPDATE empresa SET nome_fantasia = ?, razao_social = ?, cnpj = ?, logradouro = ?, numero = ?, bairro = ?, municipio = ?, uf = ?,
        whatsapp = ?, telefone = ?, horario = ?, instagram = ?, catalogo_titulo = ?, catalogo_sobre = ?, chave_pix = ?, cidade_contrato = ? WHERE id = 1`, [
        'CR Veículos', 'CR VEICULOS LTDA', '60696476000130', 'Rua Principal', '100', 'Centro', 'Ocara', 'CE',
        process.env.DEMO_WHATSAPP || '5585987346133', '', 'Seg a sex 8h às 18h, sáb 8h às 12h', 'crveiculos',
        'Seminovos revisados em Ocara e região', '', '60.696.476/0001-30', 'Ocara/CE',
      ]);
      criarUsuario(banco, { nome: 'Administrador', email: process.env.DEMO_EMAIL || 'admin@demo.com', senha: process.env.DEMO_SENHA || 'Demo2026loja', perfil: 'admin' });
      if (process.env.SEM_VEICULOS_EXEMPLO !== '1') semearDemo(banco, join(pastaDados, 'fotos'));
    }
  });
  if (nuvemAtiva()) {
    for (const f of banco.all("SELECT arquivo FROM veiculo_fotos WHERE arquivo LIKE 'demo-%'")) {
      const local = join(pastaDados, 'fotos', f.arquivo);
      if (existsSync(local)) await enviarNuvem(local);
    }
  }
}

export default async function handler(req, res) {
  // O certificado digital pode ter sido enviado por outra instância: traz do Storage antes de usar
  if (nuvemAtiva() && req.method !== 'GET' && req.url?.includes('/api/')) {
    const cert = banco.one('SELECT cert_arquivo FROM empresa WHERE id = 1')?.cert_arquivo;
    if (cert) await trazerDaNuvem(cert);
  }
  return app.tratarRequisicao(req, res);
}
