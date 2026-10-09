import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { Limitador } from '../http/app.js';
import { falhar, texto, numero } from '../util/comum.js';
import { emailValido } from '../util/validacao.js';
import { MODULOS, MODELOS, lerPermissoes, permissaoValida, tem } from '../http/permissoes.js';
import { cifrar, decifrar } from '../util/cripto.js';
import { novoSegredoTotp, conferirTotp, uriTotp } from '../util/totp.js';
import { qrSvg } from '../util/qrcode.js';
const HORAS_SESSAO = 12;
const MAX_FALHAS_CONTA = 5;
const MINUTOS_BLOQUEIO = 15;
const CARGOS = ['admin', 'gerente', 'vendedor', 'financeiro'];
/** Tentativas de login por IP: 15 erros em 15 min bloqueiam o IP por 15 min. */
const limiteIp = new Limitador(15, 15 * 60_000, 15 * 60_000);
export function hashSenha(senha) {
    const sal = randomBytes(16);
    const hash = scryptSync(senha, sal, 64);
    return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}
export function conferirSenha(senha, guardado) {
    const [alg, salHex, hashHex] = String(guardado ?? '').split('$');
    if (alg !== 'scrypt' || !salHex || !hashHex)
        return false;
    const esperado = Buffer.from(hashHex, 'hex');
    const obtido = scryptSync(senha, Buffer.from(salHex, 'hex'), esperado.length);
    return timingSafeEqual(esperado, obtido);
}
/** Usado quando o e-mail não existe, para a resposta demorar o mesmo tempo. */
const HASH_FALSO = hashSenha(randomBytes(12).toString('hex'));
export function validarSenhaNova(senha, email = '') {
    if (senha.length < 8)
        falhar('A senha precisa ter pelo menos 8 caracteres.');
    if (senha.length > 200)
        falhar('Senha muito longa.');
    if (!/[a-zA-Z]/.test(senha) || !/\d/.test(senha))
        falhar('Use letras e números na senha.');
    const usuarioEmail = email.split('@')[0].toLowerCase();
    if (usuarioEmail.length >= 4 && senha.toLowerCase().includes(usuarioEmail))
        falhar('A senha não pode conter o seu e-mail.');
    if (/^(.)\1+$/.test(senha) || ['12345678', 'senha123', 'password1', 'abc12345', 'mudar123'].includes(senha.toLowerCase()))
        falhar('Senha muito fácil de adivinhar.');
    return senha;
}
export function auditar(b, usuarioId, acao, entidade, id, detalhes) {
    b.run('INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes) VALUES (?,?,?,?,?)', [
        usuarioId ?? null, acao, entidade, id ?? null, detalhes === undefined ? null : JSON.stringify(detalhes),
    ]);
}
function lerListaPermissoes(v) {
    if (!Array.isArray(v))
        return [];
    return [...new Set(v.map(String).filter(permissaoValida))];
}
export function criarUsuario(b, d) {
    if (!d.nome)
        falhar('Informe o nome.');
    if (!emailValido(d.email))
        falhar('E-mail inválido.');
    validarSenhaNova(d.senha, d.email);
    if (!CARGOS.includes(d.perfil))
        falhar('Cargo inválido.');
    const permissoes = d.perfil === 'admin' ? [] : (d.permissoes ?? MODELOS[d.perfil]?.permissoes ?? []);
    return b.inserir('usuarios', {
        nome: d.nome, email: d.email.toLowerCase(), senha_hash: hashSenha(d.senha), perfil: d.perfil,
        comissao_pct: d.comissao_pct ?? null, permissoes: JSON.stringify(permissoes),
    });
}
const tokenHash = (t) => createHash('sha256').update(t).digest('hex');
function cookieSessao(req, valor, maxAge) {
    const seguro = req.https || process.env.COOKIE_SEGURO === '1' ? '; Secure' : '';
    return `sessao=${valor}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${seguro}`;
}
function publico(u) {
    return {
        id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, admin: u.perfil === 'admin', ativo: !!u.ativo,
        permissoes: u.perfil === 'admin' ? [] : [...lerPermissoes(u.permissoes)], comissao_pct: u.comissao_pct,
        criado_em: u.criado_em, ultimo_acesso: u.ultimo_acesso, dois_fatores: !!u.totp_segredo,
        bloqueado: !!u.bloqueado_ate && u.bloqueado_ate > new Date().toISOString().replace('T', ' ').slice(0, 19),
    };
}
export function registrarAuth(app, b) {
    // O token fica no cookie; no banco guardamos só o hash dele (vazamento do banco não dá acesso)
    app.autenticar = (token) => {
        if (!/^[0-9a-f]{64}$/.test(token))
            return undefined;
        const u = b.one(`SELECT u.id, u.nome, u.email, u.perfil, u.permissoes, u.comissao_pct FROM sessoes s
       JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.token = ? AND s.expira_em > datetime('now') AND u.ativo = 1`, [tokenHash(token)]);
        if (!u)
            return undefined;
        const admin = u.perfil === 'admin';
        return { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, admin, permissoes: admin ? new Set() : lerPermissoes(u.permissoes), comissao_pct: u.comissao_pct };
    };
    app.get('/api/setup', () => ({ precisaSetup: !b.one('SELECT 1 FROM usuarios LIMIT 1') }), { publica: true });
    // Primeiro acesso: cria o administrador quando ainda não há usuários
    app.post('/api/setup', (req) => {
        if (b.one('SELECT 1 FROM usuarios LIMIT 1'))
            falhar('O sistema já foi configurado.', 409);
        const id = criarUsuario(b, { nome: texto(req.corpo.nome), email: texto(req.corpo.email), senha: String(req.corpo.senha ?? ''), perfil: 'admin' });
        auditar(b, id, 'setup', 'usuarios', id);
        return { id };
    }, { publica: true });
    app.post('/api/login', (req) => {
        const espera = limiteIp.bloqueado(req.ip);
        if (espera)
            falhar(`Muitas tentativas. Aguarde ${Math.ceil(espera / 60)} minuto(s) e tente de novo.`, 429);
        const email = texto(req.corpo.email).toLowerCase().slice(0, 200);
        const senha = String(req.corpo.senha ?? '').slice(0, 200);
        const u = b.one('SELECT * FROM usuarios WHERE email = ?', [email]);
        const senhaOk = conferirSenha(senha, u?.senha_hash ?? HASH_FALSO);
        const recusar = (motivo) => {
            limiteIp.registrar(req.ip);
            if (u) {
                const falhas = u.falhas_login + 1;
                const bloquear = falhas >= MAX_FALHAS_CONTA;
                b.run(`UPDATE usuarios SET falhas_login = ?, bloqueado_ate = ${bloquear ? `datetime('now', '+${MINUTOS_BLOQUEIO} minutes')` : 'bloqueado_ate'} WHERE id = ?`, [bloquear ? 0 : falhas, u.id]);
                auditar(b, u.id, bloquear ? 'login_bloqueado' : 'login_falhou', 'usuarios', u.id, { ip: req.ip, motivo });
            }
            return falhar(motivo === 'codigo' ? 'Código de verificação incorreto.' : 'E-mail ou senha incorretos.', 401);
        };
        if (u?.bloqueado_ate && b.one("SELECT 1 FROM usuarios WHERE id = ? AND bloqueado_ate > datetime('now')", [u.id])) {
            falhar(`Usuário bloqueado por excesso de tentativas. Tente de novo em ${MINUTOS_BLOQUEIO} minutos ou peça ao administrador para desbloquear.`, 429);
        }
        if (!u || !u.ativo || !senhaOk)
            return recusar('senha');
        if (u.totp_segredo) {
            const codigo = texto(req.corpo.codigo);
            if (!codigo)
                return { precisa_codigo: true };
            const passo = conferirTotp(decifrar(u.totp_segredo), codigo, u.totp_ultimo);
            if (!passo)
                return recusar('codigo');
            b.run('UPDATE usuarios SET totp_ultimo = ? WHERE id = ?', [passo, u.id]);
        }
        limiteIp.zerar(req.ip);
        const token = randomBytes(32).toString('hex');
        b.run("DELETE FROM sessoes WHERE expira_em < datetime('now')");
        b.run(`INSERT INTO sessoes (token, usuario_id, expira_em, criado_em, ip, agente) VALUES (?, ?, datetime('now', '+${HORAS_SESSAO} hours'), datetime('now'), ?, ?)`, [tokenHash(token), u.id, req.ip, String(req.bruto.headers['user-agent'] ?? '').slice(0, 200)]);
        b.run("UPDATE usuarios SET falhas_login = 0, bloqueado_ate = NULL, ultimo_acesso = datetime('now') WHERE id = ?", [u.id]);
        auditar(b, u.id, 'login', 'usuarios', u.id, { ip: req.ip });
        return { json: { id: u.id, nome: u.nome }, headers: { 'Set-Cookie': cookieSessao(req, token, HORAS_SESSAO * 3600) } };
    }, { publica: true });
    app.post('/api/logout', (req) => {
        if (req.sessao)
            b.run('DELETE FROM sessoes WHERE token = ?', [tokenHash(req.sessao)]);
        return { json: { ok: true }, headers: { 'Set-Cookie': cookieSessao(req, '', 0) } };
    }, { publica: true });
    app.get('/api/me', (req) => {
        const u = b.one('SELECT * FROM usuarios WHERE id = ?', [req.usuario.id]);
        return publico(u);
    });
    app.post('/api/me/senha', (req) => {
        const u = b.one('SELECT * FROM usuarios WHERE id = ?', [req.usuario.id]);
        if (!conferirSenha(String(req.corpo.atual ?? ''), u.senha_hash))
            falhar('Senha atual incorreta.');
        const nova = validarSenhaNova(String(req.corpo.nova ?? ''), u.email);
        b.run('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [hashSenha(nova), u.id]);
        // Desconecta os outros aparelhos (quem tinha a senha antiga perde o acesso)
        b.run('DELETE FROM sessoes WHERE usuario_id = ? AND token <> ?', [u.id, tokenHash(req.sessao ?? '')]);
        auditar(b, u.id, 'trocar_senha', 'usuarios', u.id);
        return { ok: true };
    });
    // ---- Verificação em duas etapas (aplicativo autenticador) ----
    const pendentes2fa = new Map();
    app.post('/api/me/2fa/iniciar', (req) => {
        const u = req.usuario;
        const segredo = novoSegredoTotp();
        pendentes2fa.set(u.id, { segredo, expira: Date.now() + 10 * 60_000 });
        const loja = (b.one('SELECT nome_fantasia, razao_social FROM empresa WHERE id = 1') ?? {});
        const uri = uriTotp(segredo, u.email, loja.nome_fantasia || loja.razao_social || 'ERP Veiculos');
        return { segredo, qr: qrSvg(uri, 200) };
    });
    app.post('/api/me/2fa/ativar', (req) => {
        const u = req.usuario;
        const p = pendentes2fa.get(u.id);
        if (!p || p.expira < Date.now())
            falhar('Gere o QR Code de novo.');
        const passo = conferirTotp(p.segredo, texto(req.corpo.codigo));
        if (!passo)
            falhar('Código incorreto. Confira se o horário do celular está automático.');
        b.run('UPDATE usuarios SET totp_segredo = ?, totp_ultimo = ? WHERE id = ?', [cifrar(p.segredo), passo, u.id]);
        pendentes2fa.delete(u.id);
        auditar(b, u.id, '2fa_ativar', 'usuarios', u.id);
        return { ok: true };
    });
    app.post('/api/me/2fa/desativar', (req) => {
        const u = b.one('SELECT * FROM usuarios WHERE id = ?', [req.usuario.id]);
        if (!conferirSenha(String(req.corpo.senha ?? ''), u.senha_hash))
            falhar('Senha incorreta.');
        b.run("UPDATE usuarios SET totp_segredo = '', totp_ultimo = 0 WHERE id = ?", [u.id]);
        auditar(b, u.id, '2fa_desativar', 'usuarios', u.id);
        return { ok: true };
    });
    // ---- Usuários e permissões ----
    app.get('/api/usuarios/permissoes', () => ({ modulos: MODULOS, modelos: MODELOS }));
    app.get('/api/usuarios/vendedores', () => b.all('SELECT id, nome, comissao_pct FROM usuarios WHERE ativo = 1 ORDER BY nome'));
    app.get('/api/usuarios', () => b.all('SELECT * FROM usuarios ORDER BY ativo DESC, nome').map(publico));
    /** Quem não é administrador só pode dar permissões que ele mesmo tem, e não mexe em administradores. */
    const conferirPoder = (req, alvo, permissoes, virarAdmin) => {
        const eu = req.usuario;
        if (eu.admin)
            return;
        if (alvo?.perfil === 'admin' || virarAdmin)
            falhar('Só um administrador pode criar ou alterar administradores.', 403);
        const extras = permissoes.filter((p) => !tem(eu, p));
        if (extras.length)
            falhar('Você não pode dar permissões que você mesmo não tem: ' + extras.join(', '), 403);
    };
    app.post('/api/usuarios', (req) => {
        const c = req.corpo;
        const admin = c.admin === true || c.perfil === 'admin';
        const cargo = admin ? 'admin' : CARGOS.includes(c.perfil) ? c.perfil : 'vendedor';
        // Sem lista de permissões, usa o modelo do cargo (vendedor, gerente, financeiro)
        const permissoes = c.permissoes === undefined ? (MODELOS[cargo]?.permissoes ?? []) : lerListaPermissoes(c.permissoes);
        conferirPoder(req, undefined, permissoes, admin);
        const id = criarUsuario(b, {
            nome: texto(c.nome), email: texto(c.email), senha: String(c.senha ?? ''), perfil: cargo, permissoes,
            comissao_pct: c.comissao_pct === '' || c.comissao_pct == null ? null : numero(c.comissao_pct),
        });
        auditar(b, req.usuario.id, 'criar', 'usuarios', id, { admin, permissoes });
        return { id };
    });
    app.put('/api/usuarios/:id', (req) => {
        const id = Number(req.params.id);
        const alvo = b.one('SELECT * FROM usuarios WHERE id = ?', [id]) ?? falhar('Usuário não encontrado.', 404);
        const c = req.corpo;
        const eu = req.usuario;
        const virarAdmin = c.admin === undefined ? alvo.perfil === 'admin' : c.admin === true;
        const permissoes = c.permissoes === undefined ? [...lerPermissoes(alvo.permissoes)] : lerListaPermissoes(c.permissoes);
        conferirPoder(req, alvo, c.permissoes === undefined ? [] : permissoes, c.admin === true && alvo.perfil !== 'admin');
        const desativar = c.ativo === false || c.ativo === 0;
        if (id === eu.id && (desativar || (alvo.perfil === 'admin' && !virarAdmin)))
            falhar('Você não pode desativar nem tirar o administrador do próprio usuário.');
        if (alvo.perfil === 'admin' && (!virarAdmin || desativar)) {
            const outros = b.one("SELECT COUNT(*) AS q FROM usuarios WHERE perfil = 'admin' AND ativo = 1 AND id <> ?", [id]).q;
            if (!outros)
                falhar('É preciso manter pelo menos um administrador ativo.');
        }
        let perfil = alvo.perfil;
        if (virarAdmin)
            perfil = 'admin';
        else if (CARGOS.includes(c.perfil) && c.perfil !== 'admin')
            perfil = c.perfil;
        else if (alvo.perfil === 'admin')
            perfil = 'gerente';
        const email = c.email === undefined ? undefined : texto(c.email).toLowerCase();
        if (email !== undefined && !emailValido(email))
            falhar('E-mail inválido.');
        b.atualizar('usuarios', id, {
            nome: c.nome === undefined ? undefined : texto(c.nome) || falhar('Informe o nome.'),
            email,
            perfil,
            permissoes: JSON.stringify(perfil === 'admin' ? [] : permissoes),
            comissao_pct: c.comissao_pct === undefined ? undefined : c.comissao_pct === '' || c.comissao_pct === null ? null : numero(c.comissao_pct),
            ativo: c.ativo === undefined ? undefined : !!c.ativo,
            senha_hash: c.senha ? hashSenha(validarSenhaNova(String(c.senha), email ?? alvo.email)) : undefined,
            falhas_login: c.desbloquear ? 0 : undefined,
            bloqueado_ate: c.desbloquear ? null : undefined,
            totp_segredo: c.remover_2fa ? '' : undefined,
        });
        // Alterou senha, permissões ou desativou: derruba as sessões abertas para valer na hora
        if (desativar || c.senha || c.permissoes !== undefined || c.admin !== undefined) {
            b.run('DELETE FROM sessoes WHERE usuario_id = ?' + (id === eu.id ? ' AND token <> ?' : ''), id === eu.id ? [id, tokenHash(req.sessao ?? '')] : [id]);
        }
        auditar(b, eu.id, 'alterar', 'usuarios', id, {
            ...(c.permissoes !== undefined ? { permissoes } : {}), ...(c.admin !== undefined ? { admin: virarAdmin } : {}),
            ...(c.senha ? { senha: 'redefinida' } : {}), ...(c.ativo !== undefined ? { ativo: !!c.ativo } : {}),
            ...(c.desbloquear ? { desbloqueado: true } : {}), ...(c.remover_2fa ? { remover_2fa: true } : {}),
        });
        return { ok: true };
    });
    app.post('/api/usuarios/:id/encerrar-sessoes', (req) => {
        const id = Number(req.params.id);
        const r = b.run('DELETE FROM sessoes WHERE usuario_id = ?' + (id === req.usuario.id ? ' AND token <> ?' : ''), id === req.usuario.id ? [id, tokenHash(req.sessao ?? '')] : [id]);
        auditar(b, req.usuario.id, 'encerrar_sessoes', 'usuarios', id);
        return { encerradas: r.alteradas };
    });
    app.get('/api/auditoria', (req) => {
        const where = [];
        const p = [];
        const uid = numero(req.query.get('usuario'));
        if (uid) {
            where.push('a.usuario_id = ?');
            p.push(uid);
        }
        const ent = texto(req.query.get('entidade'));
        if (ent) {
            where.push('a.entidade = ?');
            p.push(ent);
        }
        return b.all(`SELECT a.id, a.acao, a.entidade, a.entidade_id, a.detalhes, a.criado_em, u.nome AS usuario_nome
       FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY a.id DESC LIMIT 300`, p);
    });
}
