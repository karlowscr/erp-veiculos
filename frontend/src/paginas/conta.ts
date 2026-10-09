import { api, sessao } from '../api.js';
import { html, montar, $, campos, aoEnviar, aviso, cabecalhoPagina, cru, rotulo } from '../ui.js';
import { icone } from '../icones.js';

export async function render(el: HTMLElement) {
  const eu = await api.get('/api/me');
  sessao.usuario = eu;
  montar(el, html`
  ${cabecalhoPagina('Minha conta', `${eu.nome} · ${eu.email} · ${eu.admin ? 'Administrador' : rotulo(eu.perfil)}`)}
  <div class="coluna-config">
  <section class="bloco"><h2>Trocar minha senha</h2>
    <form id="f-s"><div class="grade-form">${campos([
      { nome: 'atual', rotulo: 'Senha atual', tipo: 'senha', obrigatorio: true, largura: 4, attrs: 'autocomplete="current-password"' },
      { nome: 'nova', rotulo: 'Nova senha', tipo: 'senha', obrigatorio: true, largura: 2, attrs: 'minlength="8" autocomplete="new-password"', dica: '8+ caracteres, com letras e números.' },
      { nome: 'nova2', rotulo: 'Repita a nova senha', tipo: 'senha', obrigatorio: true, largura: 2, attrs: 'minlength="8" autocomplete="new-password"' },
    ])}</div><div class="acoes-form"><button type="submit">Trocar senha</button></div></form>
    <p class="mudo pequeno">Ao trocar a senha, os outros aparelhos conectados com a sua conta são desconectados.</p>
  </section>
  <section class="bloco"><h2>${icone('cadeado', 18)} Verificação em duas etapas</h2>
    <div id="dois">${eu.dois_fatores
      ? html`<p class="cert-ok">${icone('ok', 18)}<span><b>Ativada.</b> Além da senha, o login pede o código do aplicativo autenticador.</span></p>
        <form id="f-2off" class="linha-form"><input type="password" name="senha" placeholder="Sua senha" required autocomplete="current-password" aria-label="Sua senha"><button type="submit" class="sec perigo">Desativar</button></form>`
      : html`<p>Recomendado para administradores e para quem vê o financeiro: mesmo que alguém descubra a sua senha, não entra sem o código do seu celular.</p>
        <button type="button" data-ativar>${icone('cadeado', 16)}Ativar com aplicativo autenticador</button>`}</div>
  </section></div>`);

  aoEnviar($('#f-s', el), async (d) => {
    if (d.nova !== d.nova2) throw new Error('As duas senhas novas não são iguais.');
    await api.post('/api/me/senha', { atual: d.atual, nova: d.nova });
    aviso('Senha alterada.');
    ($('#f-s', el) as HTMLFormElement).reset();
  });
  const off = el.querySelector<HTMLFormElement>('#f-2off');
  if (off) aoEnviar(off, async (d) => { await api.post('/api/me/2fa/desativar', d); aviso('Verificação em duas etapas desativada.'); render(el); });
  el.querySelector('[data-ativar]')?.addEventListener('click', async () => {
    const r = await api.post('/api/me/2fa/iniciar');
    montar($('#dois', el), html`
      <ol class="passos">
        <li>Instale no celular um aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou Authy).</li>
        <li>No aplicativo, toque em <b>+</b> e leia este QR Code:<div class="qr-2fa">${cru(r.qr)}</div>
          <small>Não consegue ler? Digite a chave: <code>${r.segredo.replace(/(.{4})/g, '$1 ').trim()}</code></small></li>
        <li>Digite o código de 6 dígitos que aparece no aplicativo:</li>
      </ol>
      <form id="f-2on" class="linha-form"><input name="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000000" required aria-label="Código de 6 dígitos"><button type="submit">Confirmar e ativar</button></form>`);
    aoEnviar($('#f-2on', el), async (d) => { await api.post('/api/me/2fa/ativar', d); aviso('Verificação em duas etapas ativada.'); render(el); });
  });
}
