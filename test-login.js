fetch('http://localhost:3000/api/admin/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'changeme_OtzZjXJDMu4=' })
}).then(res => res.json()).then(async data => {
  const token = data.token;
  console.log('Got token:', token ? 'yes' : 'no');
  if(!token) { console.log(data); return; }
  
  const res = await fetch('http://localhost:3000/api/admin/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ active_template: 'test' })
  });
  console.log('Status:', res.status);
  console.log(await res.text());
});
