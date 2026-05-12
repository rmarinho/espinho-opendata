import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUpdateSchema } from '../scripts/update-schema.mjs';

function validPayload() {
  return {
    date: '2026-05-12',
    generatedAt: '2026-05-12T19:00:00.000Z',
    title: 'Atualização diária de Espinho - 2026-05-12',
    facebookDraft: 'Rascunho local para revisão.',
    updates: [
      {
        topic: 'Evento em Espinho',
        text: 'Concerto local no fim de semana.',
        dateTime: '2026-05-12T19:00:00.000Z',
        location: 'Espinho',
        sources: ['https://www.visit.espinho.pt/pt/eventos/']
      }
    ],
    sources: [
      {
        title: 'Visit Espinho - Eventos',
        url: 'https://www.visit.espinho.pt/pt/eventos/',
        publisher: 'Turismo de Espinho'
      }
    ],
    checkedSources: ['https://www.visit.espinho.pt/pt/eventos/'],
    noSignificantUpdates: false
  };
}

test('validateUpdateSchema accepts a valid payload', () => {
  const errors = validateUpdateSchema(validPayload());
  assert.deepEqual(errors, []);
});

test('validateUpdateSchema rejects missing and invalid fields', () => {
  const payload = validPayload();
  delete payload.date;
  payload.generatedAt = '12/05/2026';
  payload.updates[0].sources = ['not-a-url'];

  const errors = validateUpdateSchema(payload);
  assert.ok(errors.some((error) => error.includes('Missing root key: date')));
  assert.ok(errors.some((error) => error.includes('generatedAt must be a valid ISO datetime string')));
  assert.ok(errors.some((error) => error.includes('updates[0].sources must contain only http(s) URLs')));
});
