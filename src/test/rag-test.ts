import { searchDocuments, formatCitations } from '../services/retrieval.js';

const testQueries = [
  'What is the refund policy?',
  'How do I contact support?',
  'What are the pricing options?',
  'Как происходит возврат средств?'  // Russian query
];

for (const query of testQueries) {
  console.log(`\nQuery: ${query}`);
  const results = await searchDocuments(query, { k: 3 });

  if (results.length > 0) {
    console.log(formatCitations(results));
    console.log(`Avg similarity: ${(results.reduce((s, r) => s + r.similarity, 0) / results.length * 100).toFixed(1)}%`);
  } else {
    console.log('No results found');
  }
}
