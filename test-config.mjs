import fetch from 'node-fetch';

async function run() {
  const login = await fetch('http://localhost:3000/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'changeme' })
  });
  const { token } = await login.json();
  
  const res = await fetch('http://localhost:3000/api/admin/config', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log(await res.text());
}
run();
