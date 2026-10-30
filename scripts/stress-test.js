const autocannon = require('autocannon');

// Dán chuỗi UUID thật vào đây
const PRODUCT_ID = '3e4cb592-ade8-4f86-b233-125e66be4eb1';

const instance = autocannon({
  url: 'http://localhost:3000/orders',
  connections: 50,
  duration: 5,
  method: 'POST',
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    userId: 'stress_tester',
    productId: PRODUCT_ID,
    quantity: 1,
  }),
});

autocannon.track(instance, { renderProgressBar: true });