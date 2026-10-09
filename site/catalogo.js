// Catálogo público: galeria, favoritos, simulador de financiamento e pedidos pelo WhatsApp.
(function () {
  'use strict';
  var corpo = document.body;
  var zap = corpo.dataset.whats || '';
  var loja = corpo.dataset.loja || 'a loja';
  var moeda = function (v) { return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); };
  var guardar = {
    ler: function () { try { return JSON.parse(localStorage.getItem('salvos') || '[]').filter(Number.isInteger); } catch (e) { return []; } },
    gravar: function (l) { try { localStorage.setItem('salvos', JSON.stringify(l.slice(0, 40))); } catch (e) { /* navegação privada */ } },
  };

  // ---- Favoritos ----
  function marcarFavoritos() {
    var l = guardar.ler();
    document.querySelectorAll('[data-favoritar]').forEach(function (b) {
      var on = l.indexOf(Number(b.dataset.favoritar)) >= 0;
      b.setAttribute('aria-pressed', String(on));
      var t = b.querySelector('span');
      if (t) t.textContent = on ? 'Salvo' : 'Salvar';
    });
    var link = document.querySelector('[data-salvos]');
    if (link) {
      link.hidden = !l.length;
      link.href = '/?salvos=1&ids=' + l.join(',') + '#estoque';
      link.querySelector('[data-salvos-qtd]').textContent = l.length;
    }
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-favoritar]');
    if (!b) return;
    ev.preventDefault();
    var id = Number(b.dataset.favoritar);
    var l = guardar.ler();
    var i = l.indexOf(id);
    if (i >= 0) l.splice(i, 1); else l.unshift(id);
    guardar.gravar(l);
    marcarFavoritos();
  });
  marcarFavoritos();

  // ---- Galeria (arrastar no celular, setas, miniaturas, tela cheia) ----
  var g = document.querySelector('[data-galeria]');
  if (g) {
    var palco = g.querySelector('.palco');
    var fotos = palco.querySelectorAll('img');
    var cont = g.querySelector('.contador');
    var minis = g.querySelectorAll('[data-foto]');
    var atual = 0;
    var ir = function (i) {
      if (!fotos.length) return;
      atual = (i + fotos.length) % fotos.length;
      palco.scrollTo({ left: palco.clientWidth * atual, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    var marcar = function () {
      var i = Math.round(palco.scrollLeft / Math.max(1, palco.clientWidth));
      atual = i;
      if (cont) cont.textContent = (i + 1) + '/' + fotos.length;
      minis.forEach(function (m, j) { m.classList.toggle('ativa', j === i); });
    };
    var t;
    palco.addEventListener('scroll', function () { clearTimeout(t); t = setTimeout(marcar, 60); }, { passive: true });
    var telaCheia = function (on) {
      g.classList.toggle('tela-cheia', on);
      document.documentElement.classList.toggle('travado', on);
      setTimeout(function () { ir(atual); }, 30);
    };
    g.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ir],[data-foto],[data-ampliar]');
      if (b && b.dataset.ir) ir(atual + Number(b.dataset.ir));
      else if (b && b.hasAttribute('data-ampliar')) telaCheia(!g.classList.contains('tela-cheia'));
      else if (b) ir(Number(b.dataset.foto));
      else if (e.target.tagName === 'IMG' && e.target.closest('.palco')) telaCheia(!g.classList.contains('tela-cheia'));
    });
    document.addEventListener('keydown', function (e) {
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'ArrowRight') ir(atual + 1);
      if (e.key === 'ArrowLeft') ir(atual - 1);
      if (e.key === 'Escape' && g.classList.contains('tela-cheia')) telaCheia(false);
    });
    marcar();
  }

  // ---- Simulador de financiamento (tabela Price) ----
  var sim = document.querySelector('[data-simulador]');
  var simAtual = null;
  if (sim) {
    var preco = Number(sim.dataset.preco);
    var taxa = Number(sim.dataset.taxa) / 100;
    var faixa = sim.querySelector('[data-entrada]');
    var calcular = function () {
      var pct = Number(faixa.value);
      var entrada = Math.round(preco * pct / 100);
      var n = Number(sim.querySelector('input[name=prazo]:checked').value);
      var financiado = preco - entrada;
      var parcela = financiado <= 0 ? 0 : taxa > 0 ? financiado * taxa / (1 - Math.pow(1 + taxa, -n)) : financiado / n;
      sim.querySelector('[data-entrada-valor]').textContent = moeda(entrada);
      sim.querySelector('[data-entrada-pct]').textContent = pct;
      sim.querySelector('[data-parcela]').textContent = financiado <= 0 ? 'À vista' : n + 'x ' + moeda(parcela);
      sim.querySelector('[data-sim-resumo]').textContent = financiado <= 0 ? '' : 'Entrada de ' + moeda(entrada) + ' e ' + moeda(financiado) + ' financiados';
      faixa.style.setProperty('--p', (pct / 90 * 100) + '%');
      simAtual = { entrada: moeda(entrada), prazo: n + 'x', parcela: moeda(parcela), financiado: moeda(financiado) };
    };
    sim.addEventListener('input', calcular);
    sim.addEventListener('change', calcular);
    calcular();
  }

  // ---- Pedidos (visita, troca, financiamento) ----
  var janela = document.getElementById('janela');
  var form = document.getElementById('form-contato');
  var TEXTOS = {
    visita: ['Agendar visita', 'Escolha o melhor dia. A loja confirma pelo WhatsApp.'],
    troca: ['Avaliar meu carro na troca', 'Conte qual carro você quer dar na troca.'],
    financiamento: ['Quero esta simulação', 'A loja faz a análise de crédito e responde pelo WhatsApp.'],
    interesse: ['Tenho interesse', ''],
  };
  var CAMPOS_TROCA = '<label>Seu carro (marca e modelo)<input name="t_modelo" required maxlength="60" placeholder="Ex.: Fiat Uno Way 1.0"></label>' +
    '<div class="duas"><label>Ano<input name="t_ano" required inputmode="numeric" maxlength="9" placeholder="2017/2018"></label><label>Quilometragem<input name="t_km" inputmode="numeric" maxlength="9" placeholder="85.000"></label></div>';
  var hoje = new Date();
  var dataMin = new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  var CAMPOS_VISITA = '<div class="duas"><label>Dia<input type="date" name="v_dia" required min="' + dataMin + '"></label><label>Período<select name="v_periodo"><option>Manhã</option><option>Tarde</option></select></label></div>';
  var contexto = {};

  function abrir(tipo, dados) {
    if (!janela || typeof janela.showModal !== 'function') return;
    contexto = dados || {};
    form.reset();
    form.tipo.value = tipo;
    form.veiculo_id.value = contexto.veiculo || '';
    janela.querySelector('#janela-titulo').textContent = TEXTOS[tipo][0];
    janela.querySelector('.janela-sub').textContent = (contexto.nome ? contexto.nome + '. ' : '') + TEXTOS[tipo][1];
    form.querySelector('.extra').innerHTML = tipo === 'visita' ? CAMPOS_VISITA : tipo === 'troca' && !contexto.troca ? CAMPOS_TROCA : '';
    form.querySelector('.erro').hidden = true;
    try { var p = JSON.parse(localStorage.getItem('contato') || '{}'); if (p.nome) form.nome.value = p.nome; if (p.telefone) form.telefone.value = p.telefone; } catch (e) { /* sem storage */ }
    janela.showModal();
    (form.querySelector('.extra input') || (form.nome.value ? form.querySelector('button[type=submit]') : form.nome)).focus();
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-abrir]');
    if (!b) return;
    abrir(b.dataset.abrir, { veiculo: b.dataset.veiculo, nome: b.dataset.veiculoNome });
  });
  if (janela) janela.addEventListener('click', function (e) { if (e.target === janela) janela.close(); });

  var formTroca = document.querySelector('[data-troca]');
  if (formTroca) formTroca.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!formTroca.reportValidity()) return;
    var d = Object.fromEntries(new FormData(formTroca));
    abrir('troca', { troca: d });
  });

  function mensagem(tipo, d) {
    var v = contexto.nome ? ' o ' + contexto.nome : '';
    var linhas = ['Olá! Sou ' + d.nome + '.'];
    if (tipo === 'visita') linhas.push('Quero agendar uma visita para ver' + (v || ' os veículos') + ' no dia ' + d.v_dia.split('-').reverse().join('/') + ', pela ' + d.v_periodo.toLowerCase() + '.');
    if (tipo === 'troca') {
      var t = contexto.troca || d;
      linhas.push((contexto.nome ? 'Tenho interesse no ' + contexto.nome + ' e quero dar meu carro na troca: ' : 'Quero uma avaliação do meu carro: ') +
        t.t_modelo + ', ' + t.t_ano + (t.t_km ? ', ' + t.t_km + ' km' : '') + (t.t_quitado ? ' (' + t.t_quitado.toLowerCase() + ')' : '') + '.');
    }
    if (tipo === 'financiamento' && simAtual) linhas.push('Quero financiar' + v + ': entrada de ' + simAtual.entrada + ' e ' + simAtual.prazo + ' de cerca de ' + simAtual.parcela + '.');
    linhas.push(location.href.split('#')[0]);
    return linhas.join('\n');
  }

  if (form) form.addEventListener('submit', function (e) {
    e.preventDefault();
    var erro = form.querySelector('.erro');
    if (!form.reportValidity()) return;
    var d = Object.fromEntries(new FormData(form));
    var tipo = d.tipo;
    var extra = {};
    ['t_modelo', 't_ano', 't_km', 't_quitado', 'v_dia', 'v_periodo'].forEach(function (k) { var x = (contexto.troca && contexto.troca[k]) || d[k]; if (x) extra[k] = x; });
    if (tipo === 'financiamento' && simAtual) Object.keys(simAtual).forEach(function (k) { extra[k] = simAtual[k]; });
    var texto = mensagem(tipo, Object.assign({}, d, extra));
    try { localStorage.setItem('contato', JSON.stringify({ nome: d.nome, telefone: d.telefone })); } catch (er) { /* sem storage */ }
    // Abre o WhatsApp já (bloqueadores de pop-up não deixam abrir depois de esperar o servidor)
    if (zap) window.open('https://wa.me/' + zap + '?text=' + encodeURIComponent(texto), '_blank', 'noopener');
    var botao = form.querySelector('button[type=submit]');
    botao.disabled = true;
    fetch('/api/site/contato', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: tipo, nome: d.nome, telefone: d.telefone, site: d.site, veiculo_id: d.veiculo_id || null, mensagem: texto, dados: extra }),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (r) {
      botao.disabled = false;
      if (!r.ok) { erro.textContent = r.j.erro || 'Não foi possível enviar.'; erro.hidden = false; return; }
      janela.querySelector('#janela-titulo').textContent = 'Pedido enviado';
      janela.querySelector('.janela-sub').textContent = 'A ' + loja + ' recebeu seu pedido' + (zap ? ' e a conversa foi aberta no WhatsApp' : '') + '.';
      setTimeout(function () { if (janela.open) janela.close(); }, 2600);
      if (formTroca) formTroca.reset();
    }).catch(function () {
      botao.disabled = false;
      erro.textContent = 'Sem conexão. Tente de novo ou chame a loja pelo WhatsApp.';
      erro.hidden = false;
    });
  });

  // ---- Busca: listas mudam na hora ----
  var busca = document.querySelector('.busca-linha');
  if (busca) busca.querySelectorAll('select').forEach(function (s) { s.addEventListener('change', function () { busca.submit(); }); });

  // ---- Compartilhar ----
  var c = document.querySelector('[data-compartilhar]');
  if (c) c.addEventListener('click', function () {
    var dados = { title: c.dataset.titulo, url: c.dataset.url };
    if (navigator.share) navigator.share(dados).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(dados.url).then(function () { c.querySelector('span').textContent = 'Link copiado'; });
  });
})();
