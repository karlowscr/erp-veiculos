export class ErroApi extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
let aoDeslogar = () => undefined;
export const definirAoDeslogar = (fn) => (aoDeslogar = fn);
async function chamar(metodo, url, corpo) {
    const r = await fetch(url, {
        method: metodo,
        credentials: 'same-origin',
        headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const tipo = r.headers.get('content-type') ?? '';
    const dados = tipo.includes('json') ? await r.json() : await r.text();
    if (!r.ok) {
        if (r.status === 401 && !url.endsWith('/login'))
            aoDeslogar();
        throw new ErroApi(dados?.erro ?? `Erro ${r.status}`, r.status);
    }
    return dados;
}
export const api = {
    get: (url) => chamar('GET', url),
    post: (url, corpo = {}) => chamar('POST', url, corpo),
    put: (url, corpo) => chamar('PUT', url, corpo),
    del: (url) => chamar('DELETE', url),
};
export const sessao = {};
/** Verdadeiro se o usuário tem pelo menos uma das permissões (o administrador tem todas). */
export const pode = (...permissoes) => !!sessao.usuario && (sessao.usuario.admin || permissoes.some((p) => sessao.usuario.permissoes.includes(p)));
export const ehAdmin = () => !!sessao.usuario?.admin;
