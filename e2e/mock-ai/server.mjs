import { createServer } from 'node:http';

const proposal = {
  reply: '已生成确定性的 E2E 记账提议，请确认后写入。',
  actions: [
    {
      type: 'create_expense',
      data: {
        amount: 66,
        category: '餐饮',
        description: 'E2E mock AI proposal',
        date: '2026-09-01',
      },
    },
  ],
};

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (request.method === 'POST' && request.url === '/v1/chat/completions') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: 'e2e-deterministic-completion',
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: JSON.stringify(proposal) },
        finish_reason: 'stop',
      }],
    }));
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not found' }));
});

server.listen(8787, '0.0.0.0', () => {
  console.log('Deterministic E2E AI mock listening on 8787');
});
