import { request } from 'node:https';
import { randomBytes } from 'node:crypto';
import type { Certificado } from '../fiscal/certificado.js';
import { chassiValido, renavamValido, docValido } from '../util/validacao.js';

/**
 * Integração com o RENAVE (Registro Nacional de Veículos em Estoque),
 * serviço do Serpro/SENATRAN. A loja precisa estar credenciada no DETRAN
 * (sistema Credencia), contratar o serviço na Loja Serpro e usar o
 * certificado digital da empresa (autenticação mútua).
 *
 * Os nomes de campos abaixo são o modelo interno do ERP. A tradução para o
 * formato exato do RENAVE-WS fica em `ClienteRenaveHttp.payload*` e deve ser
 * conferida com o Manual de Integração recebido do Serpro no credenciamento.
 */

export interface Endereco {
  logradouro: string; numero: string; complemento?: string; bairro: string; codMunicipioIbge: string; uf: string; cep: string;
}

export interface EntradaEstoque {
  chassi: string;
  placa: string;
  renavam: string;
  /** CPF/CNPJ de quem vendeu/consignou o veículo à loja. */
  docVendedor: string;
  valor: number;
  chaveNFeEntrada: string;
  km: number;
  dataHoraMedicaoKm: string;
  emailEstabelecimento: string;
  /** Tipo de entrada: compra/troca ou consignação. */
  tipo: 'compra' | 'consignacao';
  numeroAtpve?: string;
}

export interface SaidaEstoque {
  idEstoque: string;
  chassi: string;
  docComprador: string;
  nomeComprador: string;
  emailComprador: string;
  enderecoComprador: Endereco;
  valor: number;
  chaveNFeVenda: string;
  km: number;
  dataHoraMedicaoKm: string;
}

export interface RespostaRenave {
  ok: boolean;
  protocolo?: string;
  idEstoque?: string;
  mensagem: string;
  bruto: unknown;
}

export interface ClienteRenave {
  readonly modo: string;
  entrada(d: EntradaEstoque): Promise<RespostaRenave>;
  saida(d: SaidaEstoque): Promise<RespostaRenave>;
  cancelarEntrada(idEstoque: string, motivo: string): Promise<RespostaRenave>;
  cancelarSaida(idEstoque: string, motivo: string): Promise<RespostaRenave>;
  consultar(chassi: string): Promise<RespostaRenave>;
}

function conferirEntrada(d: EntradaEstoque): string[] {
  const erros: string[] = [];
  if (!chassiValido(d.chassi)) erros.push('chassi inválido');
  if (!renavamValido(d.renavam)) erros.push('RENAVAM inválido');
  if (!docValido(d.docVendedor)) erros.push('CPF/CNPJ do vendedor inválido');
  if (!/^\w{44}$/.test(d.chaveNFeEntrada)) erros.push('chave da NF-e de entrada inválida');
  if (!(d.valor > 0)) erros.push('valor inválido');
  if (!(d.km >= 0)) erros.push('quilometragem inválida');
  return erros;
}

function conferirSaida(d: SaidaEstoque): string[] {
  const erros: string[] = [];
  if (!d.idEstoque) erros.push('veículo sem identificação de estoque no RENAVE');
  if (!docValido(d.docComprador)) erros.push('CPF/CNPJ do comprador inválido');
  if (!d.emailComprador) erros.push('e-mail do comprador é obrigatório no RENAVE');
  if (!/^\w{44}$/.test(d.chaveNFeVenda)) erros.push('chave da NF-e de venda inválida');
  const e = d.enderecoComprador;
  if (!e.logradouro || !e.codMunicipioIbge || !e.cep) erros.push('endereço do comprador incompleto');
  return erros;
}

/**
 * Modo simulado: aplica as mesmas conferências de dados e devolve
 * respostas no formato do ERP, sem comunicação externa. Use até o
 * credenciamento sair, para treinar a equipe e testar o fluxo.
 */
export class ClienteRenaveSimulado implements ClienteRenave {
  readonly modo = 'simulado';
  private id = () => 'SIM' + randomBytes(5).toString('hex').toUpperCase();
  async entrada(d: EntradaEstoque) {
    const erros = conferirEntrada(d);
    if (erros.length) return { ok: false, mensagem: 'Entrada recusada: ' + erros.join('; '), bruto: { erros } };
    const idEstoque = this.id();
    return { ok: true, idEstoque, protocolo: this.id(), mensagem: 'Entrada registrada no estoque (SIMULADO)', bruto: { idEstoque, ...d } };
  }
  async saida(d: SaidaEstoque) {
    const erros = conferirSaida(d);
    if (erros.length) return { ok: false, mensagem: 'Saída recusada: ' + erros.join('; '), bruto: { erros } };
    return { ok: true, protocolo: this.id(), mensagem: 'Saída por venda registrada; ATPV-e gerada para o comprador (SIMULADO)', bruto: d };
  }
  async cancelarEntrada(idEstoque: string) {
    return { ok: true, protocolo: this.id(), mensagem: `Entrada ${idEstoque} cancelada (SIMULADO)`, bruto: { idEstoque } };
  }
  async cancelarSaida(idEstoque: string) {
    return { ok: true, protocolo: this.id(), mensagem: `Saída do veículo ${idEstoque} cancelada (SIMULADO)`, bruto: { idEstoque } };
  }
  async consultar(chassi: string) {
    return { ok: true, mensagem: `Consulta simulada do chassi ${chassi}: sem restrições`, bruto: { chassi, restricoes: [] } };
  }
}

/** Caminhos dos serviços. Defina RENAVE_ENDPOINTS conforme o manual do Serpro. */
export interface EndpointsRenave {
  entrada: string; saida: string; cancelarEntrada: string; cancelarSaida: string; consultar: string;
}

export class ClienteRenaveHttp implements ClienteRenave {
  constructor(readonly modo: string, private base: string, private endpoints: EndpointsRenave, private cert: Certificado) {
    if (!base) throw new Error('Informe a URL base do RENAVE em Configurações > Empresa (fornecida pelo Serpro).');
  }

  static endpointsDoAmbiente(): EndpointsRenave {
    const raw = process.env.RENAVE_ENDPOINTS;
    if (!raw) throw new Error('Defina a variável RENAVE_ENDPOINTS com os caminhos do Manual de Integração RENAVE-WS (veja o README).');
    return JSON.parse(raw);
  }

  // ---- Tradução para o formato do RENAVE-WS: conferir com o manual do Serpro ----
  payloadEntrada(d: EntradaEstoque) {
    return {
      chassi: d.chassi, placa: d.placa, renavam: d.renavam, cpfCnpjVendedor: d.docVendedor, valorCompra: d.valor,
      chaveNotaFiscal: d.chaveNFeEntrada, quilometragemHodometro: d.km, dataHoraMedicaoHodometro: d.dataHoraMedicaoKm,
      emailEstabelecimento: d.emailEstabelecimento, tipoEntrada: d.tipo === 'consignacao' ? 'CONSIGNACAO' : 'COMPRA',
      numeroAtpve: d.numeroAtpve,
    };
  }
  payloadSaida(d: SaidaEstoque) {
    return {
      idEstoque: d.idEstoque, chassi: d.chassi, cpfCnpjComprador: d.docComprador, nomeComprador: d.nomeComprador,
      emailComprador: d.emailComprador, enderecoComprador: d.enderecoComprador, valorVenda: d.valor,
      chaveNotaFiscal: d.chaveNFeVenda, quilometragemHodometro: d.km, dataHoraMedicaoHodometro: d.dataHoraMedicaoKm,
    };
  }

  private chamar(metodo: string, caminho: string, corpo?: unknown): Promise<{ status: number; json: any }> {
    const url = new URL(caminho, this.base.endsWith('/') ? this.base : this.base + '/');
    const dados = corpo === undefined ? undefined : JSON.stringify(corpo);
    return new Promise((resolve, reject) => {
      const req = request(url, {
        method: metodo, key: this.cert.chavePem, cert: this.cert.certPem, timeout: 30_000,
        headers: { Accept: 'application/json', ...(dados ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) } : {}) },
      }, (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c) => partes.push(c));
        res.on('end', () => {
          const txt = Buffer.concat(partes).toString('utf8');
          let json: any = txt;
          try { json = txt ? JSON.parse(txt) : {}; } catch { /* resposta não-JSON */ }
          resolve({ status: res.statusCode ?? 0, json });
        });
      });
      req.on('timeout', () => req.destroy(new Error('Tempo esgotado aguardando o RENAVE.')));
      req.on('error', (e) => reject(new Error('Falha de comunicação com o RENAVE: ' + e.message)));
      req.end(dados);
    });
  }

  private interpretar(r: { status: number; json: any }, ok: string): RespostaRenave {
    const j = r.json ?? {};
    const sucesso = r.status >= 200 && r.status < 300;
    const mensagem = sucesso ? ok : (j.mensagem ?? j.message ?? j.erros?.map?.((e: any) => e.mensagem ?? e).join('; ') ?? `HTTP ${r.status}`);
    return { ok: sucesso, idEstoque: j.idEstoque ?? j.id, protocolo: j.protocolo ?? j.numeroProtocolo, mensagem: String(mensagem), bruto: j };
  }

  private trocar(caminho: string, id: string) {
    return caminho.replace('{id}', encodeURIComponent(id)).replace('{chassi}', encodeURIComponent(id));
  }

  async entrada(d: EntradaEstoque) {
    const erros = conferirEntrada(d);
    if (erros.length) return { ok: false, mensagem: erros.join('; '), bruto: null };
    return this.interpretar(await this.chamar('POST', this.endpoints.entrada, this.payloadEntrada(d)), 'Entrada registrada no RENAVE');
  }
  async saida(d: SaidaEstoque) {
    const erros = conferirSaida(d);
    if (erros.length) return { ok: false, mensagem: erros.join('; '), bruto: null };
    return this.interpretar(await this.chamar('POST', this.trocar(this.endpoints.saida, d.idEstoque), this.payloadSaida(d)), 'Saída registrada no RENAVE');
  }
  async cancelarEntrada(id: string, motivo: string) {
    return this.interpretar(await this.chamar('POST', this.trocar(this.endpoints.cancelarEntrada, id), { motivo }), 'Entrada cancelada no RENAVE');
  }
  async cancelarSaida(id: string, motivo: string) {
    return this.interpretar(await this.chamar('POST', this.trocar(this.endpoints.cancelarSaida, id), { motivo }), 'Saída cancelada no RENAVE');
  }
  async consultar(chassi: string) {
    return this.interpretar(await this.chamar('GET', this.trocar(this.endpoints.consultar, chassi)), 'Consulta realizada');
  }
}
