import pg from 'pg';
const { Client } = pg;
import { embedText } from './dist/services/embedding.js';

async function test() {
  // Use exact same connection as bot
  const client = new Client({
    connectionString: 'postgresql://pack50:dev_password@localhost:15432/pack50'
  });

  await client.connect();
  console.log('✅ Connected to database');

  // Create query embedding
  const query = 'Что такое Pack50?';
  const embedding = await embedText(query);
  const embeddingStr = JSON.stringify(embedding);

  console.log('\n📊 Testing exact bot query...');
  console.log('Query:', query);
  console.log('Embedding length:', embeddingStr.length);

  // Test 1: Exact bot SQL
  const botSQL = `SELECT content, metadata, 1 - (embedding <=> $1::vector) as similarity FROM document_chunks ORDER BY embedding <=> $1::vector LIMIT $2`;
  console.log('\n1️⃣ Bot SQL:', botSQL);
  console.log('Params:', ['[embedding]', 5]);

  const result1 = await client.query(botSQL, [embeddingStr, 5]);
  console.log('Results:', result1.rows.length);
  result1.rows.forEach((row, i) => {
    console.log(`  ${i + 1}. ${row.content.substring(0, 50)}... (${row.similarity})`);
  });

  // Test 2: Without LIMIT parameter
  const sql2 = `SELECT content, 1 - (embedding <=> $1::vector) as similarity FROM document_chunks ORDER BY similarity DESC`;
  console.log('\n2️⃣ Without LIMIT param:');
  const result2 = await client.query(sql2, [embeddingStr]);
  console.log('Results:', result2.rows.length);
  result2.rows.forEach((row, i) => {
    console.log(`  ${i + 1}. ${row.content.substring(0, 50)}... (${row.similarity})`);
  });

  // Test 3: Check if it's an ORDER BY issue
  const sql3 = `SELECT content, 1 - (embedding <=> $1::vector) as similarity FROM document_chunks ORDER BY (embedding <=> $1::vector) LIMIT $2`;
  console.log('\n3️⃣ Different ORDER BY syntax:');
  const result3 = await client.query(sql3, [embeddingStr, 5]);
  console.log('Results:', result3.rows.length);
  result3.rows.forEach((row, i) => {
    console.log(`  ${i + 1}. ${row.content.substring(0, 50)}... (${row.similarity})`);
  });

  await client.end();
  process.exit(0);
}

test().catch(console.error);
