import { request } from 'node:https';
import { randomBytes } from 'node:crypto';
import { chassiValido, renavamValido, docValido } from '../util/validacao.js';
function conferirEntrada(d) {
    const erros = [];
    if (!chassiValido(d.chassi))
        erros.push('chassi inválido');
    if (!renavamValido(d.renavam))
        erros.push('RENAVAM inválido');
    if (!docValido(d.docVendedor))
        erros.push('CPF/CNPJ do vendedor inválido');
    if (!/^\w{44}$/.test(d.chaveNFeEntrada))
        erros.push('chave da NF-e de entrada inválida');
    if (!(d.valor > 0))
        erros.push('valor inválido');
    if (!(d.km >= 0))
        erros.push('quilometragem inválida');
    return erros;
}
function conferirSaida(d) {
    const erros = [];
    if (!d.idEstoque)
        erros.push('veículo sem identificação de estoque no RENAVE');
    if (!docValido(d.docComprador))
        erros.push('CPF/CNPJ do comprador inválido');
    if (!d.emailComprador)
        erros.push('e-mail do comprador é obrigatório no RENAVE');
    if (!/^\w{44}$/.test(d.chaveNFeVenda))
        erros.push('chave da NF-e de venda inválida');
    const e = d.enderecoComprador;
    if (!e.logradouro || !e.codMunicipioIbge || !e.cep)
        erros.push('endereço do comprador incompleto');
    return erros;
}
/**
 * Modo simulado: aplica as mesmas conferências de dados e devolve
 * respostas no formato do ERP, sem comunicação externa. Use até o
 * credenciamento sair, para treinar a equipe e testar o fluxo.
 */
export class ClienteRenaveSimulado {
    modo = 'simulado';
    id = () => 'SIM' + randomBytes(5).toString('hex').toUpperCase();
    async entrada(d) {
        const erros = conferirEntrada(d);
        if (erros.length)
            return { ok: false, mensagem: 'Entrada recusada: ' + erros.join('; '), bruto: { erros } };
        const idEstoque = this.id();
        return { ok: true, idEstoque, protocolo: this.id(), mensagem: 'Entrada registrada no estoque (SIMULADO)', bruto: { idEstoque, ...d } };
    }
    async saida(d) {
        const erros = conferirSaida(d);
        if (erros.length)
            return { ok: false, mensagem: 'Saída recusada: ' + erros.join('; '), bruto: { erros } };
        return { ok: true, protocolo: this.id(), mensagem: 'Saída por venda registrada; ATPV-e gerada para o comprador (SIMULADO)', bruto: d };
    }
    async cancelarEntrada(idEstoque) {
        return { ok: true, protocolo: this.id(), mensagem: `Entrada ${idEstoque} cancelada (SIMULADO)`, bruto: { idEstoque } };
    }
    async cancelarSaida(idEstoque) {
        return { ok: true, protocolo: this.id(), mensagem: `Saída do veículo ${idEstoque} cancelada (SIMULADO)`, bruto: { idEstoque } };
    }
    async consultar(chassi) {
        return { ok: true, mensagem: `Consulta simulada do chassi ${chassi}: sem restrições`, bruto: { chassi, restricoes: [] } };
    }
}
export class ClienteRenaveHttp {
    modo;
    base;
    endpoints;
    cert;
    constructor(modo, base, endpoints, cert) {
        this.modo = modo;
        this.base = base;
        this.endpoints = endpoints;
        this.cert = cert;
        if (!base)
            throw new Error('Informe a URL base do RENAVE em Configurações > Empresa (fornecida pelo Serpro).');
    }
    static endpointsDoAmbiente() {
        const raw = process.env.RENAVE_ENDPOINTS;
        if (!raw)
            throw new Error('Defina a variável RENAVE_ENDPOINTS com os caminhos do Manual de Integração RENAVE-WS (veja o README).');
        return JSON.parse(raw);
    }
    // ---- Tradução para o formato do RENAVE-WS: conferir com o manual do Serpro ----
    payloadEntrada(d) {
        return {
            chassi: d.chassi, placa: d.placa, renavam: d.renavam, cpfCnpjVendedor: d.docVendedor, valorCompra: d.valor,
            chaveNotaFiscal: d.chaveNFeEntrada, quilometragemHodometro: d.km, dataHoraMedicaoHodometro: d.dataHoraMedicaoKm,
            emailEstabelecimento: d.emailEstabelecimento, tipoEntrada: d.tipo === 'consignacao' ? 'CONSIGNACAO' : 'COMPRA',
            numeroAtpve: d.numeroAtpve,
        };
    }
    payloadSaida(d) {
        return {
            idEstoque: d.idEstoque, chassi: d.chassi, cpfCnpjComprador: d.docComprador, nomeComprador: d.nomeComprador,
            emailComprador: d.emailComprador, enderecoComprador: d.enderecoComprador, valorVenda: d.valor,
            chaveNotaFiscal: d.chaveNFeVenda, quilometragemHodometro: d.km, dataHoraMedicaoHodometro: d.dataHoraMedicaoKm,
        };
    }
    chamar(metodo, caminho, corpo) {
        const url = new URL(caminho, this.base.endsWith('/') ? this.base : this.base + '/');
        const dados = corpo === undefined ? undefined : JSON.stringify(corpo);
        return new Promise((resolve, reject) => {
            const req = request(url, {
                method: metodo, key: this.cert.chavePem, cert: this.cert.certPem, timeout: 30_000,
                headers: { Accept: 'application/json', ...(dados ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) } : {}) },
            }, (res) => {
                const partes = [];
                res.on('data', (c) => partes.push(c));
                res.on('end', () => {
                    const txt = Buffer.concat(partes).toString('utf8');
                    let json = txt;
                    try {
                        json = txt ? JSON.parse(txt) : {};
                    }
                    catch { /* resposta não-JSON */ }
                    resolve({ status: res.statusCode ?? 0, json });
                });
            });
            req.on('timeout', () => req.destroy(new Error('Tempo esgotado aguardando o RENAVE.')));
            req.on('error', (e) => reject(new Error('Falha de comunicação com o RENAVE: ' + e.message)));
            req.end(dados);
        });
    }
    interpretar(r, ok) {
        const j = r.json ?? {};
        const sucesso = r.status >= 200 && r.status < 300;
        const mensagem = sucesso ? ok : (j.mensagem ?? j.message ?? j.erros?.map?.((e) => e.mensagem ?? e).join('; ') ?? `HTTP ${r.status}`);
        return { ok: sucesso, idEstoque: j.idEstoque ?? j.id, protocolo: j.protocolo ?? j.numeroProtocolo, mensagem: String(mensagem), bruto: j };
    }
    trocar(caminho, id) {
        return caminho.replace('{id}', encodeURIComponent(id)).replace('{chassi}', encodeURIComponent(id));
    }
    async entrada(d) {
        const erros = conferirEntrada(d);
        if (erros.length)
            return { ok: false, mensagem: erros.join('; '), bruto: null };
        return this.interpretar(await this.chamar('POST', this.endpoints.entrada, this.payloadEntrada(d)), 'Entrada registrada no RENAVE');
    }
    async saida(d) {
        const erros = conferirSaida(d);
        if (erros.length)
            return { ok: false, mensagem: erros.join('; '), bruto: null };
        return this.interpretar(await this.chamar('POST', this.trocar(this.endpoints.saida, d.idEstoque), this.payloadSaida(d)), 'Saída registrada no RENAVE');
    }
    async cancelarEntrada(id, motivo) {
        return this.interpretar(await this.chamar('POST', this.trocar(this.endpoints.cancelarEntrada, id), { motivo }), 'Entrada cancelada no RENAVE');
    }
    async cancelarSaida(id, motivo) {
        return this.interpretar(await this.chamar('POST', this.trocar(this.endpoints.cancelarSaida, id), { motivo }), 'Saída cancelada no RENAVE');
    }
    async consultar(chassi) {
        return this.interpretar(await this.chamar('GET', this.trocar(this.endpoints.consultar, chassi)), 'Consulta realizada');
    }
}
