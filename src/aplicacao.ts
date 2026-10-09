import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { App, type ConfigServidor } from './http/app.js';
import { Banco } from './db/database.js';
import { registrarAuth } from './modulos/auth.js';
import { registrarPessoas } from './modulos/pessoas.js';
import { registrarVeiculos } from './modulos/veiculos.js';
import { registrarNegociacoes } from './modulos/negociacoes.js';
import { registrarFinanceiro } from './modulos/financeiro.js';
import { registrarFiscal } from './modulos/fiscal.js';
import { registrarRenave } from './modulos/renave.js';
import { iniciarSegredo } from './util/cripto.js';
import { configurarNuvem } from './util/nuvem.js';
import { registrarContratos } from './modulos/contratos.js';
import { registrarCobrancas } from './modulos/cobrancas.js';
import { registrarCarnes } from './modulos/carnes.js';
import { registrarDocumentos } from './modulos/documentos.js';
import { registrarImportacao } from './modulos/importacao.js';
import { registrarCatalogo } from './modulos/catalogo.js';
import { Fipe } from './modulos/fipe.js';
import type { lerDocumentoVeiculo } from './modulos/leitor-documento.js';
import type { Transporte } from './fiscal/sefaz.js';
import type { ClienteRenave } from './renave/cliente.js';

export interface OpcoesAplicacao {
  pastaDados: string;
  pastaPublica: string;
  /** Arquivos públicos do catálogo e das páginas de impressão. */
  pastaSite?: string;
  arquivoBanco?: string;
  transporteSefaz?: Transporte;
  clienteRenave?: ClienteRenave;
  /** Substitui o acesso à internet da consulta FIPE (usado nos testes). */
  buscarFipe?: typeof fetch;
  leitorDocumento?: typeof lerDocumentoVeiculo;
  servidor?: Partial<ConfigServidor>;
  /** Endereço secreto da área administrativa (sem barras). */
  caminhoAdmin?: string;
}

const CAMINHO_VALIDO = /^[a-zA-Z0-9][a-zA-Z0-9_-]{5,63}$/;
const RESERVADOS = ['api', 's', 'fotos', 'fotos-publicas', 'arquivos', 'veiculo', 'marca', 'robots.txt', 'sitemap.xml'];

/**
 * A área administrativa fica num endereço que só a equipe conhece
 * (ex.: https://sualoja.com.br/painel-k3j9x2q7/). Definido por ADMIN_PATH ou
 * gerado na primeira execução e guardado no banco.
 */
function definirCaminhoAdmin(b: Banco, pedido?: string): string {
  const env = (pedido ?? process.env.ADMIN_PATH ?? '').replace(/^\/+|\/+$/g, '');
  if (env) {
    if (!CAMINHO_VALIDO.test(env) || RESERVADOS.includes(env.toLowerCase())) {
      throw new Error('ADMIN_PATH inválido: use de 6 a 64 letras, números, "-" ou "_" (ex.: gestao-loja-2025).');
    }
    return env;
  }
  const salvo = b.one("SELECT valor FROM config_sistema WHERE chave = 'caminho_admin'")?.valor;
  if (salvo) return salvo;
  const letras = 'abcdefghijkmnpqrstuvwxyz23456789';
  const novo = 'painel-' + [...randomBytes(10)].map((n) => letras[n % letras.length]).join('');
  b.run("INSERT INTO config_sistema (chave, valor) VALUES ('caminho_admin', ?)", [novo]);
  return novo;
}

export function criarAplicacao(op: OpcoesAplicacao) {
  const pastaDados = resolve(op.pastaDados);
  iniciarSegredo(join(pastaDados, '.segredo'));
  configurarNuvem(pastaDados);
  const banco = new Banco(op.arquivoBanco ?? process.env.BANCO_URL ?? join(pastaDados, 'erp.db'));
  const producao = process.env.NODE_ENV === 'production' || process.env.PRODUCAO === '1';
  const app = new App({
    confiarProxy: process.env.CONFIAR_PROXY === '1',
    urlPublica: process.env.URL_PUBLICA || undefined,
    producao,
    ...op.servidor,
  });
  const pastaArquivos = join(pastaDados, 'arquivos');
  const pastaFotos = join(pastaDados, 'fotos');
  const cfgFiscal = { pastaCertificados: join(pastaDados, 'certificados'), pastaArquivos, transporte: op.transporteSefaz };
  const caminhoAdmin = definirCaminhoAdmin(banco, op.caminhoAdmin);

  registrarAuth(app, banco);
  registrarPessoas(app, banco);
  registrarVeiculos(app, banco, { pastaFotos, pastaArquivos, fipe: op.buscarFipe ? new Fipe(banco, op.buscarFipe) : undefined, leitor: op.leitorDocumento });
  registrarNegociacoes(app, banco);
  registrarFinanceiro(app, banco);
  registrarFiscal(app, banco, cfgFiscal);
  registrarRenave(app, banco, cfgFiscal, op.clienteRenave);
  registrarContratos(app, banco);
  registrarCobrancas(app, banco);
  registrarCarnes(app, banco, pastaArquivos);
  registrarDocumentos(app, banco, pastaArquivos);
  registrarImportacao(app, banco, pastaArquivos);
  registrarCatalogo(app, banco, { pastaFotos, pastaArquivos, caminhoAdmin, urlPublica: app.cfg.urlPublica });

  app.pastasEstaticas.push(
    { prefixo: '/s/', pasta: resolve(op.pastaSite ?? join(op.pastaPublica, '..', 'site')), protegida: false, cache: true },
    { prefixo: '/fotos/', pasta: pastaFotos, protegida: true },
    { prefixo: '/arquivos/', pasta: pastaArquivos, protegida: true },
    { prefixo: `/${caminhoAdmin}/`, pasta: resolve(op.pastaPublica), protegida: false, spa: true, semIndexar: true },
  );
  return { app, banco, caminhoAdmin };
}
