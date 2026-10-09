import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { criarAplicacao } from './aplicacao.js';
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.HOST ?? '0.0.0.0';
const certTls = process.env.TLS_CERT;
const chaveTls = process.env.TLS_KEY;
const comTls = !!(certTls && chaveTls);
const porta = Number(process.env.PORTA ?? (comTls ? 443 : 3000));
const { app, banco, caminhoAdmin } = criarAplicacao({
    pastaDados: process.env.PASTA_DADOS ?? join(raiz, 'data'),
    pastaPublica: join(raiz, 'public'),
    pastaSite: join(raiz, 'site'),
});
if (comTls && (!existsSync(certTls) || !existsSync(chaveTls))) {
    console.error('TLS_CERT/TLS_KEY apontam para arquivos que não existem.');
    process.exit(1);
}
let tls = comTls ? { cert: readFileSync(certTls), key: readFileSync(chaveTls) } : undefined;
const servidor = app.servidor(tls);
// Com HTTPS próprio, a porta 80 só redireciona para https://
let redirecionador;
if (comTls && process.env.PORTA_HTTP !== '0') {
    const portaHttp = Number(process.env.PORTA_HTTP ?? 80);
    redirecionador = createServer((req, res) => {
        const h = String(req.headers.host ?? '').replace(/:\d+$/, '').replace(/[^\w.-]/g, '');
        res.writeHead(301, { Location: `https://${h}${porta === 443 ? '' : ':' + porta}${req.url ?? '/'}` });
        res.end();
    });
    redirecionador.listen(portaHttp, host).on('error', (e) => console.error(`Não foi possível abrir a porta ${portaHttp} para redirecionar ao HTTPS:`, e.message));
}
if (comTls) {
    // Renova o certificado (Let's Encrypt troca a cada 90 dias) sem reiniciar
    setInterval(() => {
        try {
            tls = { cert: readFileSync(certTls), key: readFileSync(chaveTls) };
            servidor.setSecureContext(tls);
        }
        catch (e) {
            console.error('Falha ao recarregar o certificado TLS:', e.message);
        }
    }, 12 * 3600_000).unref();
}
servidor.listen(porta, host, () => {
    const base = process.env.URL_PUBLICA?.replace(/\/$/, '') ?? `${comTls ? 'https' : 'http'}://localhost${[80, 443].includes(porta) ? '' : ':' + porta}`;
    console.log(`Catálogo público:  ${base}/`);
    console.log(`Área da loja:      ${base}/${caminhoAdmin}/   (guarde este endereço; ele não aparece no site)`);
    if (!app.cfg.producao)
        console.log('Modo desenvolvimento. Em produção use NODE_ENV=production (veja o README, seção "Colocar no ar").');
    if (app.cfg.producao && !comTls && !app.cfg.confiarProxy)
        console.warn('ATENÇÃO: produção sem HTTPS. Use um proxy (Caddy) com CONFIAR_PROXY=1 ou configure TLS_CERT e TLS_KEY.');
    if (process.env.NFE_SIMULADO === '1')
        console.log('Atenção: NF-e em MODO SIMULADO (notas sem valor fiscal).');
    if (!process.env.ANTHROPIC_API_KEY)
        console.log('Leitura automática de documentos desligada (defina ANTHROPIC_API_KEY para ativar).');
});
const encerrar = () => {
    redirecionador?.close();
    servidor.close(() => {
        banco.fechar();
        process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
