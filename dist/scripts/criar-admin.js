/**
 * Cria (ou redefine a senha de) um administrador pela linha de comando.
 * Uso: npm run criar-admin -- "Nome" email@loja.com.br senhaForte123
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Banco } from '../db/database.js';
import { criarUsuario, hashSenha, validarSenhaNova } from '../modulos/auth.js';
const [nome, email, senha] = process.argv.slice(2);
if (!nome || !email || !senha) {
    console.error('Uso: npm run criar-admin -- "Nome" email senha');
    process.exit(1);
}
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const b = new Banco(join(process.env.PASTA_DADOS ?? join(raiz, 'data'), 'erp.db'));
const existente = b.one('SELECT id FROM usuarios WHERE email = ?', [email.toLowerCase()]);
if (existente) {
    b.run("UPDATE usuarios SET senha_hash = ?, perfil = 'admin', ativo = 1, falhas_login = 0, bloqueado_ate = NULL, totp_segredo = '' WHERE id = ?", [hashSenha(validarSenhaNova(senha, email)), existente.id]);
    b.run('DELETE FROM sessoes WHERE usuario_id = ?', [existente.id]);
    console.log('Senha redefinida, usuário desbloqueado, verificação em duas etapas removida e promovido a administrador.');
}
else {
    criarUsuario(b, { nome, email, senha, perfil: 'admin' });
    console.log('Administrador criado.');
}
const caminho = process.env.ADMIN_PATH || b.one("SELECT valor FROM config_sistema WHERE chave = 'caminho_admin'")?.valor;
if (caminho)
    console.log(`Endereço da área da loja: /${caminho}/`);
b.fechar();
