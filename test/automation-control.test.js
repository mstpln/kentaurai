import test from 'node:test';
import assert from 'node:assert/strict';

import {
  automaticWorkflowGate,
  getAutomationControl,
  nextAutomaticRunAt,
  setAutomationControl
} from '../src/automation-control.js';
import { createTestEnv } from './helpers/d1.js';

test('automation control defaults enabled and persists explicit pause/resume', async () => {
  const { env, db } = createTestEnv();

  let control = await getAutomationControl(env);
  assert.equal(control.enabled, true);

  control = await setAutomationControl(env, false, {
    now: new Date('2099-09-27T18:00:00Z'),
    via: 'app'
  });
  assert.deepEqual(control, {
    enabled: false,
    updatedAt: '2099-09-27T18:00:00.000Z',
    updatedVia: 'app'
  });
  assert.equal(db.prepare("SELECT enabled FROM automation_controls WHERE id='automatic_workflows'").get().enabled, 0);

  let gate = await automaticWorkflowGate(env);
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, 'automation_paused');

  await setAutomationControl(env, true, {
    now: new Date('2099-09-27T18:05:00Z'),
    via: 'app'
  });
  gate = await automaticWorkflowGate(env);
  assert.equal(gate.allowed, true);
  assert.equal(gate.reason, null);
});

test('automation gate fails closed when its durable control cannot be read', async () => {
  const result = await automaticWorkflowGate({
    DB: {
      prepare() {
        throw new Error('synthetic D1 outage');
      }
    }
  });
  assert.equal(result.allowed, false);
  assert.equal(result.enabled, false);
  assert.equal(result.reason, 'automation_control_unavailable');
});

test('next automatic run follows the single 05:15 UTC schedule', () => {
  assert.equal(
    nextAutomaticRunAt(new Date('2099-09-27T05:14:59Z')),
    '2099-09-27T05:15:00.000Z'
  );
  assert.equal(
    nextAutomaticRunAt(new Date('2099-09-27T05:15:00Z')),
    '2099-09-28T05:15:00.000Z'
  );
});
