import { db } from './dist/db/client.js';
import { embedText } from './dist/services/embedding.js';

async function test() {
  const queryText = 'Что такое Pack50?';

  console.log('Generating embedding for:', queryText);
  const embedding = await embedText(queryText);
  console.log('Embedding length:', embedding.length);
  console.log('First 5 values:', embedding.slice(0, 5));

  // Test 1: Using JSON.stringify
  const jsonStr = JSON.stringify(embedding);
  console.log('\nTest 1 - JSON.stringify format:');
  console.log('String length:', jsonStr.length);
  console.log('Preview:', jsonStr.substring(0, 100));

  try {
    const result1 = await db.query(
      `SELECT id, substring(content, 1, 50) as content,
              (1 - (embedding <=> $1::vector)) as similarity
       FROM document_chunks
       ORDER BY similarity DESC
       LIMIT 3`,
      [jsonStr]
    );
    console.log('Results found:', result1.rows.length);
    result1.rows.forEach(row => {
      console.log(`  - ${row.content}... (similarity: ${row.similarity})`);
    });
  } catch (error) {
    console.log('Error:', error.message);
  }

  // Test 2: Using array format string
  const arrayStr = `[${embedding.join(',')}]`;
  console.log('\nTest 2 - Array format [x,y,z,...]:');
  console.log('String length:', arrayStr.length);
  console.log('Preview:', arrayStr.substring(0, 100));

  try {
    const result2 = await db.query(
      `SELECT id, substring(content, 1, 50) as content,
              (1 - (embedding <=> $1::vector)) as similarity
       FROM document_chunks
       ORDER BY similarity DESC
       LIMIT 3`,
      [arrayStr]
    );
    console.log('Results found:', result2.rows.length);
    result2.rows.forEach(row => {
      console.log(`  - ${row.content}... (similarity: ${row.similarity})`);
    });
  } catch (error) {
    console.log('Error:', error.message);
  }

  await db.end();
  process.exit(0);
}

test();
