const test = require('node:test');
const assert = require('node:assert/strict');

async function loadMeetingCopilot() {
  const [{ createDemoSession, meetingCopilotModes, buildMeetingSummary, convertFloat32ToInt16, createLiveSessionConfig }, { textForLanguage }] = await Promise.all([
    import('../meeting-copilot.mjs'),
    import('../i18n.mjs')
  ]);
  return { createDemoSession, meetingCopilotModes, buildMeetingSummary, convertFloat32ToInt16, createLiveSessionConfig, textForLanguage };
}

test('meeting copilot demo session is isolated and clearly marked as practice', async () => {
  const { createDemoSession } = await loadMeetingCopilot();
  const session = createDemoSession({
    name: 'Demo kickoff',
    client: 'Alpha Labs',
    project: 'Portal web',
    objective: 'Definir alcance del primer sprint',
    mode: 'sales',
    context: 'Cierre de la propuesta con presupuesto ajustado.'
  });

  assert.equal(session.provider, 'demo');
  assert.equal(session.mode, 'sales');
  assert.equal(session.practice, true);
  assert.match(session.badge, /Practice|Práctica/i);
  assert.ok(session.transcript.length >= 3);
  assert.ok(session.suggestions.length >= 2);
  assert.ok(session.alerts.length >= 1);
});

test('meeting copilot modes and summary include intervention context in both languages', async () => {
  const { meetingCopilotModes, buildMeetingSummary, textForLanguage } = await loadMeetingCopilot();

  assert.ok(meetingCopilotModes.includes('general'));
  assert.ok(meetingCopilotModes.includes('sales'));

  const summary = buildMeetingSummary({
    name: 'Demo kickoff',
    client: 'Alpha Labs',
    objective: 'Definir alcance del primer sprint'
  });

  assert.ok(summary.decisions.length >= 1);
  assert.ok(summary.actionItems.length >= 1);
  assert.ok(summary.risks.length >= 1);

  for (const language of ['es', 'en']) {
    const translated = textForLanguage(language, 'meeting.copilotTitle', {
      name: 'Demo kickoff'
    });
    assert.ok(translated.length > 0);
    assert.ok(translated.includes('Trato'));
  }
});

test('meeting copilot live audio conversion and relay config are explicit and browser-safe', async () => {
  const { convertFloat32ToInt16, createLiveSessionConfig } = await loadMeetingCopilot();

  const input = new Float32Array([0, 0.5, -0.5, 1]);
  const pcm = convertFloat32ToInt16(input);

  assert.equal(pcm instanceof Int16Array, true);
  assert.equal(pcm.length, input.length);
  assert.equal(pcm[0], 0);
  assert.equal(pcm[1], 16384);
  assert.equal(pcm[2], -16384);
  assert.equal(pcm[3], 32767);

  const config = createLiveSessionConfig({
    sessionId: 'session-42',
    source: 'microphone',
    language: 'es',
    origin: 'http://localhost:5173',
    token: 'access-token-from-trato-session',
    ticket: 'one-time-session-ticket'
  });

  assert.equal(config.sessionId, 'session-42');
  assert.equal(config.source, 'microphone');
  assert.equal(config.wsUrl.includes('localhost'), true);
  assert.equal(config.wsUrl.includes('ticket=one-time-session-ticket'), true);
  assert.equal(config.authHeader.startsWith('Bearer '), true);
  assert.equal(config.requireOrigin, true);
});
