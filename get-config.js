fetch('http://localhost:3000/api/admin/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'changeme' })
}).then(r => r.json()).then(data => {
  return fetch('http://localhost:3000/api/admin/config', {
    headers: { 'Authorization': `Bearer ${data.token}` }
  });
}).then(r => r.text()).then(console.log).catch(console.error);
