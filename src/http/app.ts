import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, sep, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { TLSSocket } from 'node:tls';
import { ErroNegocio } from '../util/comum.js';
import { regraDaRota, autorizado } from './permissoes.js';

export interface Usuario {
  id: number;
  nome: string;
  email: string;
  perfil: string;
  admin: boolean;
  permissoes: Set<string>;
  comissao_pct: number | null;
}

export interface Req {
  metodo: string;
  caminho: string;
  params: Record<string, string>;
  query: URLSearchParams;
  corpo: any;
  cookies: Record<string, string>;
  usuario?: Usuario;
  /** Token da sessão atual (para encerrar as outras ao trocar a senha). */
  sessao?: string;
  ip: string;
  https: boolean;
  bruto: IncomingMessage;
}

export type Resposta =
  | { status?: number; json: unknown; headers?: Record<string, string> }
  | { status?: number; corpo: string | Buffer; tipo: string; headers?: Record<string, string> };

export type Handler = (req: Req) => Promise<Resposta | unknown> | Resposta | unknown;

interface Rota {
  metodo: string;
  padrao: string;
  regex: RegExp;
  nomes: string[];
  handler: Handler;
  publica: boolean;
  limiteMb: number;
}

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
};

/** Rotas que recebem arquivos (em MB). As demais aceitam no máximo 1 MB. */
const LIMITES_MB: Record<string, number> = {
  'POST /api/carnes': 6, 'PUT /api/carnes/:id': 6,
  'POST /api/documentos': 60, 'PUT /api/documentos/:id': 60,
  'POST /api/empresa/certificado': 2, 'POST /api/empresa/logo': 6, 'POST /api/empresa/assinatura': 2,
  'POST /api/importar': 60, 'POST /api/contratos/:id/assinar': 2,
  'POST /api/veiculos/:id/fotos': 12, 'POST /api/veiculos/ler-documento': 16, 'POST /api/veiculos/entrada': 16,
};

export interface OpcoesRota {
  publica?: boolean;
  /** Tamanho máximo do corpo da requisição (padrão 1 MB). */
  limiteMb?: number;
}

/**
 * Política de segurança de conteúdo: só carrega scripts do próprio site,
 * proíbe o site de ser aberto dentro de outro (clickjacking) e limita
 * para onde o navegador pode enviar dados.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://viacep.com.br",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://wa.me https://api.whatsapp.com",
  "object-src 'none'",
].join('; ');

function cabecalhosSeguranca(res: ServerResponse, https: boolean) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (https) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

export interface ConfigServidor {
  /** Confia nos cabeçalhos X-Forwarded-* (só quando há um proxy como Caddy/Nginx na frente). */
  confiarProxy: boolean;
  /** Endereço público, ex.: https://crveiculos.com.br. Usado para conferir a origem dos pedidos. */
  urlPublica?: string;
  producao: boolean;
}

export class App {
  private rotas: Rota[] = [];
  autenticar: (token: string, req: { ip: string }) => Usuario | undefined = () => undefined;
  /** Páginas geradas no servidor (catálogo público). Retorna undefined para seguir adiante. */
  paginas: { prefixo: string; tratar: (req: Req, res: ServerResponse) => Promise<boolean> }[] = [];
  pastasEstaticas: { prefixo: string; pasta: string; protegida: boolean; spa?: boolean; cache?: boolean; semIndexar?: boolean }[] = [];

  constructor(readonly cfg: ConfigServidor = { confiarProxy: false, producao: false }) {}

  rota(metodo: string, padrao: string, handler: Handler, op: OpcoesRota = {}): void {
    if (!op.publica && !regraDaRota(metodo, padrao)) {
      throw new Error(`Rota sem permissão declarada em http/permissoes.ts: ${metodo} ${padrao}`);
    }
    const nomes: string[] = [];
    const regex = new RegExp('^' + padrao.replace(/:(\w+)/g, (_, n) => (nomes.push(n), '([^/]+)')) + '/?$');
    this.rotas.push({ metodo, padrao, regex, nomes, handler, publica: !!op.publica, limiteMb: op.limiteMb ?? LIMITES_MB[`${metodo} ${padrao}`] ?? 1 });
  }
  get(p: string, h: Handler, op?: OpcoesRota) { this.rota('GET', p, h, op); }
  post(p: string, h: Handler, op?: OpcoesRota) { this.rota('POST', p, h, op); }
  put(p: string, h: Handler, op?: OpcoesRota) { this.rota('PUT', p, h, op); }
  delete(p: string, h: Handler, op?: OpcoesRota) { this.rota('DELETE', p, h, op); }

  /** Lista de rotas (usada nos testes de cobertura de permissão). */
  listarRotas() { return this.rotas.map((r) => ({ metodo: r.metodo, padrao: r.padrao, publica: r.publica })); }

  /** Atende uma requisição (usado pelo servidor e pela Vercel). */
  readonly tratarRequisicao = (req: IncomingMessage, res: ServerResponse) => {
    this.tratar(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) enviarJson(res, 500, { erro: 'Erro interno do servidor.' });
    });
  };

  servidor(tls?: { key: Buffer; cert: Buffer }): Server {
    const s = tls ? createHttpsServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' }, this.tratarRequisicao) : createServer(this.tratarRequisicao);
    // Corta conexões lentas de propósito (ataque "slowloris")
    s.headersTimeout = 20_000;
    s.requestTimeout = 120_000;
    s.keepAliveTimeout = 5_000;
    return s as Server;
  }

  ipDe(req: IncomingMessage): string {
    if (this.cfg.confiarProxy) {
      const f = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
      if (f) return f;
    }
    return req.socket.remoteAddress ?? '';
  }

  ehHttps(req: IncomingMessage): boolean {
    if (req.socket instanceof TLSSocket) return true;
    return this.cfg.confiarProxy && String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';
  }

  /** Pedidos que alteram dados precisam vir do próprio site (proteção contra CSRF). */
  private origemValida(req: IncomingMessage, https: boolean): boolean {
    const origem = req.headers.origin ?? (req.headers.referer ? new URL(String(req.headers.referer)).origin : '');
    if (!origem) return !this.cfg.producao; // ferramentas de linha de comando em desenvolvimento
    if (this.cfg.urlPublica && origem === new URL(this.cfg.urlPublica).origin) return true;
    const host = (this.cfg.confiarProxy && req.headers['x-forwarded-host']) || req.headers.host;
    return origem === `${https ? 'https' : 'http'}://${host}`;
  }

  private async tratar(bruto: IncomingMessage, res: ServerResponse): Promise<void> {
    const https = this.ehHttps(bruto);
    cabecalhosSeguranca(res, https);
    let url: URL;
    let caminho: string;
    try {
      url = new URL(bruto.url ?? '/', 'http://localhost');
      caminho = decodeURIComponent(url.pathname);
    } catch {
      return enviarJson(res, 400, { erro: 'Endereço inválido.' });
    }
    if (caminho.includes('\0')) return enviarJson(res, 400, { erro: 'Endereço inválido.' });
    const ip = this.ipDe(bruto);
    const cookies = lerCookies(bruto.headers.cookie);
    const sessao = cookies.sessao;
    const usuario = sessao ? this.autenticar(sessao, { ip }) : undefined;
    const metodo = bruto.method ?? 'GET';
    const base = { metodo, caminho, params: {}, query: url.searchParams, corpo: {}, cookies, usuario, sessao, ip, https, bruto };

    if (caminho.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      let encontrouCaminho = false;
      for (const r of this.rotas) {
        const m = r.regex.exec(caminho);
        if (!m) continue;
        encontrouCaminho = true;
        if (r.metodo !== metodo) continue;
        if (metodo !== 'GET' && !this.origemValida(bruto, https)) {
          return enviarJson(res, 403, { erro: 'Pedido recusado: origem não confere.' });
        }
        if (!r.publica) {
          if (!usuario) return enviarJson(res, 401, { erro: 'Faça login para continuar.' });
          const regra = regraDaRota(r.metodo, r.padrao)!;
          if (!autorizado(usuario, regra)) return enviarJson(res, 403, { erro: 'Você não tem permissão para esta ação. Fale com o administrador.' });
        }
        const params: Record<string, string> = {};
        r.nomes.forEach((n, i) => (params[n] = m[i + 1]));
        try {
          const corpo = metodo === 'GET' || metodo === 'DELETE' ? {} : await lerJson(bruto, r.limiteMb);
          const out = await r.handler({ ...base, params, corpo });
          return responder(res, out);
        } catch (e) {
          if (e instanceof ErroNegocio) return enviarJson(res, e.status, { erro: e.message });
          if (e instanceof SyntaxError) return enviarJson(res, 400, { erro: 'Dados enviados em formato inválido.' });
          const msg = String((e as Error)?.message ?? e);
          if (msg.includes('UNIQUE constraint failed')) {
            return enviarJson(res, 409, { erro: 'Já existe um cadastro com esses dados (' + msg.split(':').pop()?.trim().split('.').pop() + ').' });
          }
          const codigo = randomBytes(4).toString('hex');
          console.error(`[erro ${codigo}] ${metodo} ${caminho}`, e);
          return enviarJson(res, 500, { erro: this.cfg.producao ? `Erro interno (código ${codigo}). Tente de novo ou avise o suporte.` : 'Erro interno: ' + msg });
        }
      }
      return enviarJson(res, encontrouCaminho ? 405 : 404, { erro: 'Rota não encontrada.' });
    }

    if (metodo !== 'GET' && metodo !== 'HEAD') return enviarJson(res, 405, { erro: 'Método não permitido.' });

    for (const p of this.paginas) {
      if (caminho === p.prefixo || caminho.startsWith(p.prefixo)) {
        if (await p.tratar(base as Req, res)) return;
      }
    }

    // Arquivos estáticos (a pasta é conferida para impedir ../ fora dela)
    for (const p of this.pastasEstaticas) {
      if (!caminho.startsWith(p.prefixo)) continue;
      if (p.protegida && !usuario) return enviarJson(res, 401, { erro: 'Não autorizado.' });
      if (p.semIndexar) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      const raiz = resolve(p.pasta);
      const rel = normalize(caminho.slice(p.prefixo.length));
      const arquivo = resolve(raiz, '.' + sep + (rel === '' || rel === '.' || rel === sep ? 'index.html' : rel));
      if (arquivo !== raiz && !arquivo.startsWith(raiz + sep)) return enviarJson(res, 404, { erro: 'Não encontrado.' });
      try {
        const s = await stat(arquivo);
        if (s.isFile()) {
          res.writeHead(200, {
            'Content-Type': TIPOS[extname(arquivo).toLowerCase()] ?? 'application/octet-stream',
            'Cache-Control': p.protegida ? 'private, no-cache' : p.cache ? 'public, max-age=86400' : 'no-cache',
          });
          res.end(metodo === 'HEAD' ? undefined : await readFile(arquivo));
          return;
        }
      } catch { /* tenta o próximo */ }
      if (p.spa) {
        res.writeHead(200, { 'Content-Type': TIPOS['.html'], 'Cache-Control': 'no-cache' });
        res.end(await readFile(join(raiz, 'index.html')));
        return;
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>Página não encontrada</title><body style="font-family:system-ui;padding:3rem;text-align:center"><h1>Página não encontrada</h1><p><a href="/">Ver veículos disponíveis</a></p></body>');
  }
}

export function responder(res: ServerResponse, out: unknown): void {
  if (out && typeof out === 'object' && ('json' in out || 'corpo' in out)) {
    const r = out as Resposta;
    if ('json' in r) return enviarJson(res, r.status ?? 200, r.json, r.headers);
    res.writeHead(r.status ?? 200, { 'Content-Type': r.tipo, ...(r.headers ?? {}) });
    res.end(r.corpo);
    return;
  }
  enviarJson(res, 200, out ?? { ok: true });
}

export function enviarJson(res: ServerResponse, status: number, dados: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(dados));
}

async function lerJson(req: IncomingMessage, limiteMb: number): Promise<any> {
  const tipo = String(req.headers['content-type'] ?? '');
  if (tipo && !tipo.startsWith('application/json')) throw new ErroNegocio('Envie os dados em JSON.', 415);
  const limite = limiteMb * 1024 * 1024;
  if (Number(req.headers['content-length'] ?? 0) > limite) throw new ErroNegocio(`Envio muito grande (limite ${limiteMb} MB).`, 413);
  const partes: Buffer[] = [];
  let total = 0;
  for await (const p of req) {
    total += (p as Buffer).length;
    if (total > limite) throw new ErroNegocio(`Envio muito grande (limite ${limiteMb} MB).`, 413);
    partes.push(p as Buffer);
  }
  const txt = Buffer.concat(partes).toString('utf8');
  if (!txt) return {};
  const v = JSON.parse(txt);
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new SyntaxError('corpo');
  return v;
}

function lerCookies(h?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const par of (h ?? '').split(';')) {
    const i = par.indexOf('=');
    if (i <= 0) continue;
    try { out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim()); } catch { /* cookie malformado */ }
  }
  return out;
}

/** Limitador de tentativas em memória (login, leitura de documento, consultas). */
export class Limitador {
  private mapa = new Map<string, { n: number; inicio: number; bloqueadoAte: number }>();
  constructor(private max: number, private janelaMs: number, private bloqueioMs: number) {}
  /** Retorna os segundos de espera se estiver bloqueado, ou 0. */
  bloqueado(chave: string): number {
    const e = this.mapa.get(chave);
    if (!e) return 0;
    const agora = Date.now();
    if (e.bloqueadoAte > agora) return Math.ceil((e.bloqueadoAte - agora) / 1000);
    return 0;
  }
  registrar(chave: string): void {
    const agora = Date.now();
    let e = this.mapa.get(chave);
    if (!e || agora - e.inicio > this.janelaMs) e = { n: 0, inicio: agora, bloqueadoAte: 0 };
    e.n++;
    if (e.n >= this.max) e.bloqueadoAte = agora + this.bloqueioMs;
    this.mapa.set(chave, e);
    if (this.mapa.size > 50_000) this.limpar();
  }
  zerar(chave: string): void { this.mapa.delete(chave); }
  private limpar() {
    const agora = Date.now();
    for (const [k, e] of this.mapa) if (agora - e.inicio > this.janelaMs && e.bloqueadoAte < agora) this.mapa.delete(k);
  }
}
