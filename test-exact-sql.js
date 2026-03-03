import { db } from './dist/db/client.js';
import { embedText } from './dist/services/embedding.js';

async function test() {
  const query = 'Что такое Pack50?';

  // Create embedding
  const embedding = await embedText(query);
  const embeddingStr = JSON.stringify(embedding);

  console.log('Testing EXACT SQL from bot logs...\n');

  // EXACT SQL from logs
  const sql = `SELECT content, metadata, 1 - (embedding <=> $1::vector) as similarity FROM document_chunks WHERE 1=1 ORDER BY embedding <=> $1::vector LIMIT $2`;
  const params = [embeddingStr, 5];

  console.log('SQL:', sql);
  console.log('Params:', params.map((p, i) => i === 0 ? `[embedding ${p.length} chars]` : p));
  console.log('');

  try {
    const result = await db.query(sql, params);
    console.log('✅ Results found:', result.rows.length);

    if (result.rows.length > 0) {
      console.log('\nResults:');
      result.rows.forEach((row, i) => {
        console.log(`${i + 1}. ${row.content.substring(0, 70)}...`);
        console.log(`   Similarity: ${row.similarity}`);
        console.log(`   Metadata:`, row.metadata);
      });
    } else {
      console.log('\n❌ NO RESULTS - investigating...');

      // Test without WHERE 1=1
      const sql2 = `SELECT content, 1 - (embedding <=> $1::vector) as similarity FROM document_chunks ORDER BY similarity DESC LIMIT 5`;
      const result2 = await db.query(sql2, [embeddingStr]);
      console.log('\nWithout WHERE 1=1:', result2.rows.length, 'results');
      result2.rows.forEach(row => {
        console.log(`  - ${row.content.substring(0, 60)}... (${row.similarity})`);
      });

      // Test count with WHERE 1=1
      const sql3 = `SELECT COUNT(*) FROM document_chunks WHERE 1=1`;
      const result3 = await db.query(sql3);
      console.log('\nCOUNT with WHERE 1=1:', result3.rows[0].count);

      // Test without any WHERE
      const sql4 = `SELECT COUNT(*) FROM document_chunks`;
      const result4 = await db.query(sql4);
      console.log('COUNT without WHERE:', result4.rows[0].count);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  }

  await db.end();
  process.exit(0);
}

test();
