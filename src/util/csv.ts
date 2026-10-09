/** Leitor de CSV (RFC 4180): aspas, aspas duplicadas e quebras de linha dentro de campos. */
export function lerCsv(texto: string, separador?: string): Record<string, string>[] {
  const t = texto.replace(/^﻿/, '');
  const sep = separador ?? (t.split('\n')[0].split(';').length > t.split('\n')[0].split(',').length ? ';' : ',');
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.length > 1 || linha[0] !== '') linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  if (!linhas.length) return [];
  const cab = linhas[0].map((h) => h.trim());
  return linhas.slice(1).map((l) => Object.fromEntries(cab.map((h, i) => [h, l[i] ?? ''])));
}
