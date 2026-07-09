import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    vus: 50, // 50 usuários simultâneos
    duration: '30s', // Duração do teste
};

export default function () {
    // Busca a URL que inserimos propositalmente no final do seed
    const res = http.get('http://localhost:3000/nu9999');

    check(res, {
        'status é 200 ou 302': (r) => r.status === 200 || r.status === 302,
        'tempo de resposta < 200ms': (r) => r.timings.duration < 200,
    });

    sleep(0.1); // Pequena pausa entre requisições por VU
}
