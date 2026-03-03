fetch('http://localhost:3000/api/admin/config', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ active_template: 'test' })
}).then(res => res.text()).then(console.log);
