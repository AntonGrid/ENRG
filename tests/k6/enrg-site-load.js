import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '30s', target: 50 },  // Разогрев: 0 → 50 VU за 30 сек
    { duration: '60s', target: 50 },  // Стабильность: 50 VU на 60 сек
    { duration: '30s', target: 0 },   // Спад: 50 → 0 VU за 30 сек
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],  // 95% < 500ms, 99% < 1000ms
    http_req_failed: ['rate<0.01'],  // Ошибки < 1%
  },
};

export default function () {
  let response = http.get('https://enrg.network');
  
  check(response, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
    'response time < 500ms': (r) => r.timings.duration < 500,
    'content-length > 0': (r) => r.body.length > 0,
  });

  sleep(1);
}
