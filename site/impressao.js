// Botões das páginas de impressão (sem scripts embutidos, por causa da política de segurança)
document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-acao]');
  if (!b) return;
  if (b.dataset.acao === 'imprimir') window.print();
  if (b.dataset.acao === 'fechar') { window.close(); setTimeout(function () { history.back(); }, 150); }
});
