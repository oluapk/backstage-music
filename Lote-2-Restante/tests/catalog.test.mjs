import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createSearchIndex, makeSearchEntries, getSearchSuggestions } from '../src/search.js';
import { loadPublishedTracks } from '../src/catalog.js';

test('busca indexada aceita acentos, fragmentos e termos em ordens diferentes', () => {
  const entries = makeSearchEntries([
    { id: 'supabase-1', title: 'Coração Azul', artist: 'João', album: 'Maré' },
    { id: 'supabase-2', title: 'Noite', artist: 'Lia', album: 'Azul' },
  ]);
  const index = createSearchIndex(entries);
  for (const query of ['coracao', 'JOAO cora', 'mare azul', 'oração', 'a']) {
    assert.ok(getSearchSuggestions(query, index, Infinity).some(entry => entry.id === 'supabase-1'), query);
  }
  assert.deepEqual(getSearchSuggestions('inexistente', index), []);
  assert.deepEqual(getSearchSuggestions('', index), []);
  assert.equal(getSearchSuggestions('noite', entries)[0].title, 'Noite');
});

test('índice encontra faixa no final de um catálogo de 20 mil itens', t => {
  const songs = Array.from({ length: 20000 }, (_, i) => ({ id: `supabase-${i}`, title: `Faixa ${i}`, artist: `Artista ${i % 100}`, album: 'Catálogo' }));
  const index = createSearchIndex(makeSearchEntries(songs));
  const start = performance.now();
  for (let i = 0; i < 100; i++) assert.equal(getSearchSuggestions('faixa 19999', index)[0].id, 'supabase-19999');
  t.diagnostic(`100 consultas em ${(performance.now() - start).toFixed(1)} ms (medição local, sem rede).`);
});

function mockClient(respond) {
  const calls = [];
  return { calls, from(table) {
    assert.equal(table, 'tracks');
    const request = { select(columns) { this.columns = columns; return this; }, eq() { return this; }, order() { return this; }, range(from, to) { calls.push({ columns: this.columns, from, to }); return Promise.resolve(respond(this.columns, from, to)); } };
    return request;
  } };
}

test('paginação lê mais de mil faixas e remove IDs repetidos', async () => {
  const rows = Array.from({ length: 1003 }, (_, i) => ({ id: String(i) }));
  const client = mockClient((_columns, from, to) => ({ data: rows.slice(from, to + 1), error: null }));
  const result = await loadPublishedTracks(client);
  assert.equal(result.data.length, 1003);
  assert.equal(client.calls.length, 2);
});

test('colunas opcionais ausentes não derrubam o catálogo antigo', async () => {
  const client = mockClient(columns => {
    const optional = ['duration_seconds', 'cover_path', 'content_type'].find(field => columns.includes(field));
    return optional ? { data: null, error: { code: '42703', message: `column tracks.${optional} does not exist` } } : { data: [{ id: '1' }], error: null };
  });
  assert.equal((await loadPublishedTracks(client)).data.length, 1);
  assert.equal(client.calls.length, 4);
});

test('erro de permissão permanece visível, sem fallback inseguro', async () => {
  const error = { code: '42501', message: 'permission denied for table tracks' };
  const client = mockClient(() => ({ data: null, error }));
  assert.equal((await loadPublishedTracks(client)).error, error);
  assert.equal(client.calls.length, 1);
});
