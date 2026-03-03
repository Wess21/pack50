const mod1 = await import('pdf-parse');
console.log('Module keys:', Object.keys(mod1));
console.log('default type:', typeof mod1.default);
console.log('default.default type:', typeof mod1.default?.default);

if (typeof mod1.default === 'function') {
  console.log('✓ Use: mod1.default');
} else if (typeof mod1.default?.default === 'function') {
  console.log('✓ Use: mod1.default.default');
} else {
  console.log('Full module:', mod1);
}
