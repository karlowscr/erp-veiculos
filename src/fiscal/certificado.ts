import { execFileSync } from 'node:child_process';
import { X509Certificate, createPrivateKey, createSign, createVerify } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { lerPfx, ErroSenha } from './pkcs12.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Certificado {
  chavePem: string;
  certPem: string;
  /** Certificado em DER base64, para o <X509Certificate> da assinatura. */
  certBase64: string;
  titular: string;
  cnpj: string;
  validoAte: Date;
}

/**
 * Lê o certificado A1 (.pfx/.p12). A leitura é feita pelo próprio Node
 * (fiscal/pkcs12.ts), sem depender de programas instalados. Só se o arquivo
 * usar um algoritmo raro o sistema tenta o OpenSSL, se existir.
 */
export function carregarPfx(arquivo: string, senha: string): Certificado {
  const dados = readFileSync(arquivo);
  try {
    const p = lerPfx(dados, senha);
    return deStringsPem(p.chavePem, p.certificadosPem.join(''));
  } catch (e) {
    if (e instanceof ErroSenha) throw e;
    const msg = (e as Error).message;
    if (!/não suportad/.test(msg)) throw e;
    try {
      return carregarComOpenssl(arquivo, senha);
    } catch {
      throw new Error(msg);
    }
  }
}

function binOpenssl(): string {
  if (process.env.OPENSSL_BIN) return process.env.OPENSSL_BIN;
  if (process.platform === 'win32') {
    for (const c of ['C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe']) {
      if (existsSync(c)) return c;
    }
  }
  return 'openssl';
}

function carregarComOpenssl(arquivo: string, senha: string): Certificado {
  const pasta = mkdtempSync(join(tmpdir(), 'cert-'));
  const senhaArq = join(pasta, 's');
  writeFileSync(senhaArq, senha, { mode: 0o600 });
  const converter = (extra: string[]) =>
    execFileSync(binOpenssl(), ['pkcs12', '-in', arquivo, '-nodes', '-passin', `file:${senhaArq}`, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  try {
    let pem: string;
    try {
      pem = converter([]);
    } catch {
      pem = converter(['-legacy']);
    }
    return deStringsPem(pem, pem);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

/** Monta o certificado a partir de PEMs (chave privada + certificado). */
export function deStringsPem(chavePemOuBundle: string, certPemOuBundle: string): Certificado {
  const chaveMatch = /-----BEGIN (?:RSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |ENCRYPTED )?PRIVATE KEY-----/.exec(chavePemOuBundle);
  if (!chaveMatch) throw new Error('Chave privada não encontrada no certificado.');
  const chavePem = createPrivateKey(chaveMatch[0]).export({ type: 'pkcs8', format: 'pem' }).toString();
  const certs = [...certPemOuBundle.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)].map((m) => m[0]);
  if (!certs.length) throw new Error('Certificado não encontrado no arquivo.');
  // Escolhe o certificado que corresponde à chave privada (o do titular, não o da AC)
  const certPem = certs.find((c) => corresponde(chavePem, c)) ?? certs[0];
  const x = new X509Certificate(certPem);
  const subject = x.subject;
  const cn = /CN=([^\n,]+)/.exec(subject)?.[1] ?? subject;
  // No e-CNPJ, o CNPJ aparece no CN após ":" (ex.: "EMPRESA LTDA:12345678000199")
  const cnpj = /:([0-9A-Z]{14})\b/.exec(cn)?.[1] ?? '';
  return {
    chavePem, certPem, certBase64: x.raw.toString('base64'),
    titular: cn.split(':')[0], cnpj, validoAte: new Date(x.validTo),
  };
}

function corresponde(chavePem: string, certPem: string): boolean {
  try {
    const dado = 'teste';
    const ass = createSign('RSA-SHA256').update(dado).sign(chavePem);
    return createVerify('RSA-SHA256').update(dado).verify(new X509Certificate(certPem).publicKey, ass);
  } catch {
    return false;
  }
}

/** Cache simples: abre o certificado uma vez por arquivo/senha. */
const cache = new Map<string, Certificado>();
export function obterCertificado(arquivo: string, senha: string): Certificado {
  const k = arquivo + '\0' + senha;
  let c = cache.get(k);
  if (!c) {
    c = arquivo.endsWith('.pem') ? deStringsPem(readFileSync(arquivo, 'utf8'), readFileSync(arquivo, 'utf8')) : carregarPfx(arquivo, senha);
    cache.set(k, c);
  }
  return c;
}
export const limparCacheCertificado = () => cache.clear();
