// Try importing named export
try {
  const pdf = await import('pdf-parse');
  console.log('Named exports:', Object.keys(pdf).filter(k => typeof pdf[k] === 'function'));
  
  // Check for parsing function
  if (pdf.PDFParse) {
    console.log('Found PDFParse class');
    const parser = new pdf.PDFParse();
    console.log('Parser methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(parser)));
  }
} catch (e) {
  console.error('Error:', e.message);
}
