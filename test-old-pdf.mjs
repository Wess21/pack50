const mod = await import('pdf-parse');
console.log('default type:', typeof mod.default);
console.log('Is function:', typeof mod.default === 'function');
