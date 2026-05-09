import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '15s', target: 10 },  // Разогрев: 0 → 10 VU за 15 сек
    { duration: '60s', target: 10 },  // Стабильность: 10 VU на 60 сек
    { duration: '15s', target: 0 },   // Спад: 10 → 0 VU за 15 сек
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],  // 95% < 1000ms, 99% < 2000ms (RPC может быть медленнее)
    http_req_failed: ['rate<0.01'],  // Ошибки < 1%
  },
};

export default function () {
  let payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getAccountInfo",
    params: ["CcRjGroz7tsDAroZayWak58KtfAczJ7vbPddnRJDSeL4"]
  });

  let params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  let response = http.post('https://api.devnet.solana.com', payload, params);
  
  check(response, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
    'response time < 1000ms': (r) => r.timings.duration < 1000,
    'has jsonrpc in response': (r) => r.body.includes('jsonrpc'),
  });

  sleep(1);
}
