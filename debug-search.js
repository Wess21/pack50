import { db } from './dist/db/client.js';
import { embedText } from './dist/services/embedding.js';

async function debug() {
  const query = 'Что такое Pack50?';

  console.log('1. Creating embedding...');
  const embedding = await embedText(query);
  const embeddingStr = JSON.stringify(embedding);

  console.log('2. Checking database...');
  const countResult = await db.query('SELECT COUNT(*) FROM document_chunks');
  console.log('   Total chunks:', countResult.rows[0].count);

  console.log('\n3. Testing exact SQL from bot logs...');
  const sql = `
    SELECT
      content,
      metadata,
      1 - (embedding <=> $1::vector) as similarity
    FROM document_chunks
    WHERE 1=1

    ORDER BY embedding <=> $1::vector
    LIMIT $2
  `;

  const params = [embeddingStr, 5];
  console.log('   Params:', params.map((p, i) => i === 0 ? `[embedding ${p.length} chars]` : p));

  const result = await db.query(sql, params);
  console.log('   Results found:', result.rows.length);

  if (result.rows.length > 0) {
    console.log('\n4. Results:');
    result.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. ${row.content.substring(0, 60)}...`);
      console.log(`      Similarity: ${row.similarity}`);
    });
  } else {
    console.log('\n4. NO RESULTS - Debugging...');

    // Test without WHERE clause
    const simpleResult = await db.query(
      `SELECT content,
              1 - (embedding <=> $1::vector) as similarity
       FROM document_chunks
       ORDER BY similarity DESC
       LIMIT 5`,
      [embeddingStr]
    );
    console.log('   Without WHERE 1=1:', simpleResult.rows.length, 'results');
    if (simpleResult.rows.length > 0) {
      simpleResult.rows.forEach(row => {
        console.log(`      - ${row.content.substring(0, 50)}... (${row.similarity})`);
      });
    }
  }

  await db.end();
  process.exit(0);
}

debug();
