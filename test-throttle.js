async function sendRequest(i) {
  try {
    const res = await fetch('http://localhost:3000/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'bot_test',
        productId: '3e4cb592-ade8-4f86-b233-a8f8e0ee4f7c',
        quantity: 1,
      }),
    });
    const data = await res.json();
    console.log(`Lần ${i} - Status [${res.status}]:`, data.message || data);
  } catch (err) {
    console.error(`Lần ${i} - Lỗi:`, err.message);
  }
}

async function run() {
  console.log('🚀 Đang gửi liên tiếp 5 requests...\n');
  for (let i = 1; i <= 5; i++) {
    await sendRequest(i);
  }
}

run();